import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getRequestFamilyGroupContext } from "@/lib/family-group/context";
import { appendAuditLog, deleteTableRows, getTableRecords, updateTableRecordById } from "@/lib/google/sheets";

type OrphanPerson = {
  personId: string;
  displayName: string;
};

type OrphanHousehold = {
  householdId: string;
  husbandPersonId: string;
  wifePersonId: string;
};

type FamilyAttributeRecord = {
  source: "FamilyConfig" | "FamilySecurityPolicy";
  tabName: "FamilyConfig" | "TenantConfig" | "FamilySecurityPolicy" | "TenantSecurityPolicy";
  rowNumber: number;
  data: Record<string, string>;
};

type UserDisableCandidate = {
  personId: string;
  userEmail: string;
  username: string;
  reason: string;
};

function normalize(value: string | undefined | null) {
  return (value ?? "").trim().toLowerCase();
}

function isEnabledLike(value: string | undefined) {
  const raw = normalize(value);
  if (!raw) return true;
  return raw === "true" || raw === "yes" || raw === "1";
}

function hasLoginAccess(row: Record<string, string>) {
  const isEnabled = isEnabledLike(row.is_enabled);
  const hasGoogle = normalize(row.google_access) === "true";
  const hasLocal = normalize(row.local_access) === "true";
  const hasUsername = Boolean((row.username ?? "").trim());
  const hasEmail = Boolean((row.user_email ?? "").trim());
  return isEnabled && (hasGoogle || hasLocal || hasUsername || hasEmail);
}

async function deleteRowsByNumber(tabName: string, rowNumbers: number[]) {
  if (rowNumbers.length === 0) {
    return 0;
  }
  return deleteTableRows(tabName, rowNumbers);
}

async function buildDeletePreview(familyGroupKey: string) {
  const targetKey = normalize(familyGroupKey);
  const [peopleRows, personFamilyRows, userFamilyRows, userAccessRows, householdsRows, familyConfigRows, tenantConfigRows, familyPolicyRows, tenantPolicyRows] =
    await Promise.all([
      getTableRecords("People").catch(() => []),
      getTableRecords("PersonFamilyGroups").catch(() => []),
      getTableRecords("UserFamilyGroups").catch(() => []),
      getTableRecords("UserAccess").catch(() => []),
      getTableRecords("Households").catch(() => []),
      getTableRecords("FamilyConfig").catch(() => []),
      getTableRecords("TenantConfig").catch(() => []),
      getTableRecords("FamilySecurityPolicy").catch(() => []),
      getTableRecords("TenantSecurityPolicy").catch(() => []),
    ]);

  const peopleById = new Map<string, string>();
  for (const row of peopleRows) {
    const personId = (row.data.person_id ?? "").trim();
    if (!personId) continue;
    const displayName = (row.data.display_name ?? "").trim() || personId;
    peopleById.set(normalize(personId), displayName);
  }

  const personLinksForTarget = personFamilyRows.filter(
    (row) => normalize(row.data.family_group_key) === targetKey && isEnabledLike(row.data.is_enabled),
  );
  const personIdsForTarget = new Set(
    personLinksForTarget
      .map((row) => normalize(row.data.person_id))
      .filter(Boolean),
  );

  const otherEnabledPersonLinkCounts = new Map<string, number>();
  for (const row of personFamilyRows) {
    const personId = normalize(row.data.person_id);
    const rowKey = normalize(row.data.family_group_key);
    if (!personId || !isEnabledLike(row.data.is_enabled) || rowKey === targetKey) continue;
    otherEnabledPersonLinkCounts.set(personId, (otherEnabledPersonLinkCounts.get(personId) ?? 0) + 1);
  }

  const orphanPeople: OrphanPerson[] = Array.from(personIdsForTarget)
    .filter((personId) => (otherEnabledPersonLinkCounts.get(personId) ?? 0) === 0)
    .map((personId) => ({
      personId,
      displayName: peopleById.get(personId) ?? personId,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const orphanHouseholds: OrphanHousehold[] = householdsRows
    .filter((row) => normalize(row.data.family_group_key) === targetKey)
    .map((row) => ({
      householdId: (row.data.household_id ?? "").trim(),
      husbandPersonId: (row.data.husband_person_id ?? "").trim(),
      wifePersonId: (row.data.wife_person_id ?? "").trim(),
    }))
    .filter((row) => row.householdId)
    .sort((a, b) => a.householdId.localeCompare(b.householdId));

  const familyAttributesToDelete: FamilyAttributeRecord[] = [
    ...familyConfigRows
      .filter((row) => normalize(row.data.family_group_key) === targetKey)
      .map((row) => ({ source: "FamilyConfig" as const, tabName: "FamilyConfig" as const, rowNumber: row.rowNumber, data: row.data })),
    ...tenantConfigRows
      .filter((row) => normalize(row.data.family_group_key) === targetKey)
      .map((row) => ({ source: "FamilyConfig" as const, tabName: "TenantConfig" as const, rowNumber: row.rowNumber, data: row.data })),
    ...familyPolicyRows
      .filter((row) => normalize(row.data.family_group_key) === targetKey)
      .map((row) => ({ source: "FamilySecurityPolicy" as const, tabName: "FamilySecurityPolicy" as const, rowNumber: row.rowNumber, data: row.data })),
    ...tenantPolicyRows
      .filter((row) => normalize(row.data.family_group_key) === targetKey)
      .map((row) => ({ source: "FamilySecurityPolicy" as const, tabName: "TenantSecurityPolicy" as const, rowNumber: row.rowNumber, data: row.data })),
  ];

  const enabledUserFamilyRowsForTarget = userFamilyRows.filter(
    (row) =>
      normalize(row.data.family_group_key) === targetKey &&
      isEnabledLike(row.data.is_enabled) &&
      Boolean((row.data.person_id ?? "").trim()),
  );
  const otherEnabledFamilyAccessByPerson = new Map<string, number>();
  for (const row of userFamilyRows) {
    const personId = normalize(row.data.person_id);
    const rowKey = normalize(row.data.family_group_key);
    if (!personId || !isEnabledLike(row.data.is_enabled) || rowKey === targetKey) continue;
    otherEnabledFamilyAccessByPerson.set(personId, (otherEnabledFamilyAccessByPerson.get(personId) ?? 0) + 1);
  }

  const userAccessByPerson = new Map<string, Record<string, string>[]>();
  for (const row of userAccessRows) {
    const personId = normalize(row.data.person_id);
    if (!personId) continue;
    const list = userAccessByPerson.get(personId) ?? [];
    list.push(row.data);
    userAccessByPerson.set(personId, list);
  }

  const usersToDisable: UserDisableCandidate[] = [];
  for (const row of enabledUserFamilyRowsForTarget) {
    const personId = normalize(row.data.person_id);
    if (!personId) continue;
    if ((otherEnabledFamilyAccessByPerson.get(personId) ?? 0) > 0) continue;
    const loginRows = (userAccessByPerson.get(personId) ?? []).filter((entry) => hasLoginAccess(entry));
    if (loginRows.length === 0) continue;
    const preferred = loginRows[0];
    usersToDisable.push({
      personId,
      userEmail: (preferred.user_email ?? "").trim().toLowerCase(),
      username: (preferred.username ?? "").trim(),
      reason: "No enabled access to any other family group after deletion.",
    });
  }

  const personFamilyRowNumbersForDelete = personLinksForTarget.map((row) => row.rowNumber);
  const userFamilyRowNumbersForDelete = userFamilyRows
    .filter((row) => normalize(row.data.family_group_key) === targetKey)
    .map((row) => row.rowNumber);
  const familyConfigRowNumbersForDelete = familyAttributesToDelete
    .filter((row) => row.tabName === "FamilyConfig")
    .map((row) => row.rowNumber);
  const tenantConfigRowNumbersForDelete = familyAttributesToDelete
    .filter((row) => row.tabName === "TenantConfig")
    .map((row) => row.rowNumber);
  const familyPolicyRowNumbersForDelete = familyAttributesToDelete
    .filter((row) => row.tabName === "FamilySecurityPolicy")
    .map((row) => row.rowNumber);
  const tenantPolicyRowNumbersForDelete = familyAttributesToDelete
    .filter((row) => row.tabName === "TenantSecurityPolicy")
    .map((row) => row.rowNumber);

  return {
    familyGroupKey: targetKey,
    orphanPeople,
    orphanHouseholds,
    familyAttributesToDelete,
    usersToDisable,
    counts: {
      personFamilyRowsToDelete: personFamilyRowNumbersForDelete.length,
      userFamilyRowsToDelete: userFamilyRowNumbersForDelete.length,
      familyConfigRowsToDelete: familyConfigRowNumbersForDelete.length,
      familyPolicyRowsToDelete: familyPolicyRowNumbersForDelete.length + tenantPolicyRowNumbersForDelete.length,
      orphanPeople: orphanPeople.length,
      orphanHouseholds: orphanHouseholds.length,
      usersToDisable: usersToDisable.length,
    },
    _internal: {
      personFamilyRowNumbersForDelete,
      userFamilyRowNumbersForDelete,
      familyConfigRowNumbersForDelete,
      tenantConfigRowNumbersForDelete,
      familyPolicyRowNumbersForDelete,
      tenantPolicyRowNumbersForDelete,
    },
  };
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const context = await getRequestFamilyGroupContext(session);
  if (context.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const familyGroupKey = normalize(searchParams.get("familyGroupKey"));
  if (!familyGroupKey) {
    return NextResponse.json({ error: "invalid_family_group_key" }, { status: 400 });
  }

  const adminAccess = context.tenants.some(
    (entry) => normalize(entry.tenantKey) === familyGroupKey && entry.role === "ADMIN",
  );
  if (!adminAccess) {
    return NextResponse.json({ error: "forbidden_family" }, { status: 403 });
  }

  const preview = await buildDeletePreview(familyGroupKey);
  return NextResponse.json({
    ok: true,
    preview: {
      familyGroupKey: preview.familyGroupKey,
      orphanPeople: preview.orphanPeople,
      orphanHouseholds: preview.orphanHouseholds,
      familyAttributesToDelete: preview.familyAttributesToDelete,
      usersToDisable: preview.usersToDisable,
      counts: preview.counts,
    },
  });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const context = await getRequestFamilyGroupContext(session);
  if (context.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const payload = await request.json().catch(() => null) as {
    familyGroupKey?: string;
    disableOrphanedUsers?: boolean;
  } | null;
  const familyGroupKey = normalize(payload?.familyGroupKey);
  if (!familyGroupKey) {
    return NextResponse.json({ error: "invalid_family_group_key" }, { status: 400 });
  }
  const disableOrphanedUsers = payload?.disableOrphanedUsers !== false;

  const adminAccess = context.tenants.some(
    (entry) => normalize(entry.tenantKey) === familyGroupKey && entry.role === "ADMIN",
  );
  if (!adminAccess) {
    return NextResponse.json({ error: "forbidden_family" }, { status: 403 });
  }

  const preview = await buildDeletePreview(familyGroupKey);

  const deletedPersonFamilyRows = await deleteRowsByNumber(
    "PersonFamilyGroups",
    preview._internal.personFamilyRowNumbersForDelete,
  );
  const deletedUserFamilyRows = await deleteRowsByNumber(
    "UserFamilyGroups",
    preview._internal.userFamilyRowNumbersForDelete,
  );
  const deletedFamilyConfigRows = await deleteRowsByNumber(
    "FamilyConfig",
    preview._internal.familyConfigRowNumbersForDelete,
  );
  const deletedTenantConfigRows = await deleteRowsByNumber(
    "TenantConfig",
    preview._internal.tenantConfigRowNumbersForDelete,
  );
  const deletedFamilyPolicyRows = await deleteRowsByNumber(
    "FamilySecurityPolicy",
    preview._internal.familyPolicyRowNumbersForDelete,
  );
  const deletedTenantPolicyRows = await deleteRowsByNumber(
    "TenantSecurityPolicy",
    preview._internal.tenantPolicyRowNumbersForDelete,
  );

  let disabledUsers = 0;
  if (disableOrphanedUsers) {
    const uniquePeople = Array.from(new Set(preview.usersToDisable.map((row) => row.personId).filter(Boolean)));
    for (const personId of uniquePeople) {
      const updated = await updateTableRecordById(
        "UserAccess",
        personId,
        {
          is_enabled: "FALSE",
          local_access: "FALSE",
          google_access: "FALSE",
        },
        "person_id",
      );
      if (updated) {
        disabledUsers += 1;
      }
    }
  }
  await appendAuditLog({
    actorEmail: session.user?.email ?? "",
    actorPersonId: session.user?.person_id ?? "",
    action: "DELETE",
    entityType: "FAMILY_GROUP",
    entityId: familyGroupKey,
    familyGroupKey,
    status: "SUCCESS",
    details: `Deleted family links/config. personLinks=${deletedPersonFamilyRows}, userLinks=${deletedUserFamilyRows}, disabledUsers=${disabledUsers}`,
  }).catch(() => undefined);

  return NextResponse.json({
    ok: true,
    deletedAt: new Date().toISOString(),
    familyGroupKey,
    deleted: {
      deletedPersonFamilyRows,
      deletedUserFamilyRows,
      deletedFamilyConfigRows,
      deletedFamilyPolicyRows: deletedFamilyPolicyRows + deletedTenantPolicyRows,
      deletedLegacyTenantConfigRows: deletedTenantConfigRows,
      disabledUsers,
    },
    preview: {
      orphanPeople: preview.orphanPeople,
      orphanHouseholds: preview.orphanHouseholds,
      usersToDisable: preview.usersToDisable,
      familyAttributesToDelete: preview.familyAttributesToDelete,
    },
  });
}
