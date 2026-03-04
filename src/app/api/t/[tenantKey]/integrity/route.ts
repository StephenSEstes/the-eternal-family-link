import { NextResponse } from "next/server";
import { createTableRecord, deleteTableRows, getPeople, getTableRecords, getTenantConfig, listTabs } from "@/lib/google/sheets";
import { requireTenantAdmin } from "@/lib/family-group/guard";

type IntegritySeverity = "error" | "warn";

type IntegrityFinding = {
  severity: IntegritySeverity;
  code: string;
  message: string;
  count: number;
  sample: string[];
};

function readField(record: Record<string, string>, key: string) {
  return (record[key] ?? "").trim();
}

function parseBool(value: string) {
  const out = value.trim().toLowerCase();
  return out === "true" || out === "yes" || out === "1";
}

function isEnabledLike(value: string | undefined) {
  const out = (value ?? "").trim().toLowerCase();
  if (!out) return true;
  return out === "true" || out === "yes" || out === "1";
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function pushFinding(
  findings: IntegrityFinding[],
  severity: IntegritySeverity,
  code: string,
  message: string,
  keys: string[],
) {
  if (keys.length === 0) {
    return;
  }
  findings.push({
    severity,
    code,
    message,
    count: keys.length,
    sample: keys.slice(0, 10),
  });
}

function scoreUserAccessRow(data: Record<string, string>) {
  let score = 0;
  if (parseBool(readField(data, "google_access"))) score += 2;
  if (parseBool(readField(data, "local_access"))) score += 2;
  if (parseBool(readField(data, "is_enabled"))) score += 1;
  if (readField(data, "username")) score += 1;
  if (readField(data, "user_email")) score += 1;
  if (readField(data, "password_hash")) score += 1;
  return score;
}

async function resolveTenantScopedTabName(tabName: string, tenantKey: string) {
  const titles = await listTabs().catch(() => []);
  const byLower = new Map(titles.map((title) => [title.toLowerCase(), title]));
  const normalizedTenant = normalize(tenantKey);
  const candidates =
    normalizedTenant === "snowestes"
      ? [tabName]
      : [`${normalizedTenant}__${tabName}`, tabName];
  for (const candidate of candidates) {
    const match = byLower.get(candidate.toLowerCase());
    if (match) {
      return match;
    }
  }
  return null;
}

async function deleteRowsByNumber(tabName: string, rowNumbers: number[]) {
  if (rowNumbers.length === 0) {
    return 0;
  }
  return deleteTableRows(tabName, rowNumbers);
}

async function runIntegrityAudit(tenantKey: string) {
  const familyGroupKey = normalize(tenantKey);
  const [people, peopleRowsGlobal, personFamilyRows, userAccessRows, userGroupRows, householdsRows, familyConfigRows, legacyLocalRows, tabs] = await Promise.all([
    getPeople(tenantKey).catch(() => []),
    getTableRecords("People").catch(() => []),
    getTableRecords("PersonFamilyGroups").catch(() => []),
    getTableRecords("UserAccess").catch(() => []),
    getTableRecords("UserFamilyGroups").catch(() => []),
    getTableRecords("Households").catch(() => []),
    getTableRecords(["FamilyConfig", "TenantConfig"]).catch(() => []),
    getTableRecords("LocalUsers", tenantKey).catch(() => []),
    listTabs().catch(() => []),
  ]);

  const peopleIds = new Set(
    people
      .map((row) => row.personId)
      .filter(Boolean)
      .map((id) => normalize(id)),
  );
  const allPeopleIds = new Set(
    peopleRowsGlobal
      .map((row) => readField(row.data, "person_id"))
      .filter(Boolean)
      .map((id) => normalize(id)),
  );

  const filteredLinks = userGroupRows.filter(
    (row) => normalize(readField(row.data, "family_group_key")) === familyGroupKey,
  );
  const userAccessByPerson = new Map<string, { rowNumber: number; data: Record<string, string> }[]>();
  const localAccessByUsername = new Map<string, { rowNumber: number; data: Record<string, string> }[]>();
  for (const row of userAccessRows) {
    const personId = normalize(readField(row.data, "person_id"));
    if (personId) {
      const list = userAccessByPerson.get(personId) ?? [];
      list.push(row);
      userAccessByPerson.set(personId, list);
    }
    const username = normalize(readField(row.data, "username"));
    const hasLocal = parseBool(readField(row.data, "local_access"));
    if (username && hasLocal) {
      const list = localAccessByUsername.get(username) ?? [];
      list.push(row);
      localAccessByUsername.set(username, list);
    }
  }

  const findings: IntegrityFinding[] = [];

  const dupUserAccessPerson = Array.from(userAccessByPerson.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([personId]) => personId);
  pushFinding(
    findings,
    "error",
    "duplicate_useraccess_person",
    "Duplicate UserAccess rows for same person_id.",
    dupUserAccessPerson,
  );

  const dupLocalUsername = Array.from(localAccessByUsername.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([username]) => username);
  pushFinding(
    findings,
    "error",
    "duplicate_local_username",
    "Duplicate local-access usernames in UserAccess.",
    dupLocalUsername,
  );

  const linkByPerson = new Map<string, { rowNumber: number; data: Record<string, string> }[]>();
  for (const row of filteredLinks) {
    const personId = normalize(readField(row.data, "person_id"));
    if (!personId) {
      continue;
    }
    const list = linkByPerson.get(personId) ?? [];
    list.push(row);
    linkByPerson.set(personId, list);
  }
  const dupLinks = Array.from(linkByPerson.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([personId]) => personId);
  pushFinding(
    findings,
    "error",
    "duplicate_userfamilygroups_person",
    "Duplicate UserFamilyGroups links for same person_id within this family group.",
    dupLinks,
  );

  const orphanLinks = filteredLinks
    .map((row) => normalize(readField(row.data, "person_id")))
    .filter(Boolean)
    .filter((personId) => !allPeopleIds.has(personId));
  pushFinding(
    findings,
    "warn",
    "orphan_userfamilygroups_person",
    "UserFamilyGroups links with person_id not found in People for this family group.",
    Array.from(new Set(orphanLinks)),
  );

  const linksMissingAccess = filteredLinks
    .map((row) => normalize(readField(row.data, "person_id")))
    .filter(Boolean)
    .filter((personId) => (userAccessByPerson.get(personId) ?? []).length === 0);
  pushFinding(
    findings,
    "warn",
    "missing_useraccess_for_link",
    "UserFamilyGroups links where matching person has no UserAccess row.",
    Array.from(new Set(linksMissingAccess)),
  );

  const peopleMissingLinks = Array.from(peopleIds).filter((personId) => {
    const hasAccess = (userAccessByPerson.get(personId) ?? []).length > 0;
    const hasLink = linkByPerson.has(personId);
    return hasAccess && !hasLink;
  });
  pushFinding(
    findings,
    "warn",
    "people_missing_userfamilygroups_link",
    "People with UserAccess rows but no UserFamilyGroups link for this family group.",
    peopleMissingLinks,
  );

  const enabledPersonFamilyByPerson = new Map<string, number>();
  for (const row of personFamilyRows) {
    const personId = normalize(readField(row.data, "person_id"));
    if (!personId || !isEnabledLike(readField(row.data, "is_enabled"))) {
      continue;
    }
    enabledPersonFamilyByPerson.set(personId, (enabledPersonFamilyByPerson.get(personId) ?? 0) + 1);
  }
  const orphanPeopleNoFamily = Array.from(allPeopleIds).filter(
    (personId) => (enabledPersonFamilyByPerson.get(personId) ?? 0) === 0,
  );
  pushFinding(
    findings,
    "warn",
    "orphan_people_no_family_groups",
    "People rows with no enabled PersonFamilyGroups association.",
    orphanPeopleNoFamily,
  );

  const validFamilyGroupKeys = new Set(
    familyConfigRows
      .map((row) => normalize(readField(row.data, "family_group_key")))
      .filter(Boolean),
  );
  const orphanHouseholdsNoFamily = householdsRows
    .map((row) => ({
      householdId: readField(row.data, "household_id"),
      familyGroupKey: normalize(readField(row.data, "family_group_key")),
    }))
    .filter((row) => row.householdId)
    .filter((row) => !row.familyGroupKey || !validFamilyGroupKeys.has(row.familyGroupKey))
    .map((row) => row.householdId);
  pushFinding(
    findings,
    "warn",
    "orphan_households_no_family_groups",
    "Households rows with no valid family_group_key association.",
    Array.from(new Set(orphanHouseholdsNoFamily)),
  );

  const enabledUserFamilyByPerson = new Map<string, number>();
  for (const row of userGroupRows) {
    const personId = normalize(readField(row.data, "person_id"));
    if (!personId || !isEnabledLike(readField(row.data, "is_enabled"))) {
      continue;
    }
    enabledUserFamilyByPerson.set(personId, (enabledUserFamilyByPerson.get(personId) ?? 0) + 1);
  }
  const orphanUsersNoFamily = userAccessRows
    .map((row) => ({
      personId: normalize(readField(row.data, "person_id")),
      userEmail: normalize(readField(row.data, "user_email")),
      localAccess: parseBool(readField(row.data, "local_access")),
      googleAccess: parseBool(readField(row.data, "google_access")),
      isEnabled: isEnabledLike(readField(row.data, "is_enabled")),
    }))
    .filter((row) => row.personId && row.isEnabled && (row.localAccess || row.googleAccess))
    .filter((row) => (enabledUserFamilyByPerson.get(row.personId) ?? 0) === 0)
    .map((row) => row.userEmail || row.personId);
  pushFinding(
    findings,
    "warn",
    "orphan_users_no_family_groups",
    "UserAccess login users with no enabled family-group association.",
    Array.from(new Set(orphanUsersNoFamily)),
  );

  if (legacyLocalRows.length > 0) {
    findings.push({
      severity: "warn",
      code: "legacy_localusers_rows_present",
      message: "Legacy LocalUsers rows still exist and should be retired.",
      count: legacyLocalRows.length,
      sample: legacyLocalRows.slice(0, 10).map((row) => `${row.rowNumber}`),
    });
  }

  const scopedPeopleTabs = tabs
    .map((tab) => tab.trim())
    .filter((tab) => tab.toLowerCase().endsWith("__people"));
  pushFinding(
    findings,
    "warn",
    "legacy_scoped_people_tabs_present",
    "Legacy tenant-scoped People tabs exist. People data must remain global in the People tab only.",
    scopedPeopleTabs,
  );

  const errorCount = findings.filter((item) => item.severity === "error").length;
  const warnCount = findings.filter((item) => item.severity === "warn").length;
  const summary = {
    status: errorCount > 0 ? "error" : warnCount > 0 ? "warn" : "ok",
    errorCount,
    warnCount,
    peopleCount: people.length,
    userAccessCount: userAccessRows.length,
    userFamilyGroupCount: filteredLinks.length,
    legacyLocalUsersCount: legacyLocalRows.length,
  };

  return {
    familyGroupKey,
    peopleRows: peopleRowsGlobal,
    people,
    userAccessRows,
    userGroupRows,
    legacyLocalRows,
    peopleIds,
    filteredLinks,
    userAccessByPerson,
    linkByPerson,
    summary,
    findings,
  };
}

export async function GET(_: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }
  const report = await runIntegrityAudit(resolved.tenant.tenantKey);

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    generatedAt: new Date().toISOString(),
    summary: report.summary,
    findings: report.findings,
  });
}

export async function POST(_: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const familyGroupKey = resolved.tenant.tenantKey;
  const before = await runIntegrityAudit(familyGroupKey);
  const config = await getTenantConfig(familyGroupKey);

  let deletedDuplicateUserAccessRows = 0;
  let deletedOrphanUserFamilyGroupRows = 0;
  const duplicateUserAccessRowNumbers: number[] = [];
  for (const rows of before.userAccessByPerson.values()) {
    if (rows.length <= 1) {
      continue;
    }
    const ranked = [...rows].sort((a, b) => {
      const scoreA = scoreUserAccessRow(a.data);
      const scoreB = scoreUserAccessRow(b.data);
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      return a.rowNumber - b.rowNumber;
    });
    const [, ...duplicates] = ranked;
    duplicateUserAccessRowNumbers.push(...duplicates.map((row) => row.rowNumber));
  }
  if (duplicateUserAccessRowNumbers.length > 0) {
    deletedDuplicateUserAccessRows = await deleteRowsByNumber("UserAccess", duplicateUserAccessRowNumbers);
  }

  const orphanUserFamilyGroupRowNumbers = before.filteredLinks
    .filter((row) => {
      const personId = normalize(readField(row.data, "person_id"));
      return personId && !before.peopleIds.has(personId);
    })
    .map((row) => row.rowNumber);
  if (orphanUserFamilyGroupRowNumbers.length > 0) {
    deletedOrphanUserFamilyGroupRows = await deleteRowsByNumber("UserFamilyGroups", orphanUserFamilyGroupRowNumbers);
  }

  let createdMissingLinks = 0;
  const missingLinksForPeopleWithAccess = Array.from(before.peopleIds).filter((personId) => {
    const hasAccess = (before.userAccessByPerson.get(personId) ?? []).length > 0;
    const hasLink = before.linkByPerson.has(personId);
    return hasAccess && !hasLink;
  });
  for (const personId of missingLinksForPeopleWithAccess) {
    const accessRows = before.userAccessByPerson.get(personId) ?? [];
    if (accessRows.length === 0) {
      continue;
    }
    const preferred = [...accessRows].sort((a, b) => scoreUserAccessRow(b.data) - scoreUserAccessRow(a.data))[0];
    const email = readField(preferred.data, "user_email").toLowerCase();
    const role = readField(preferred.data, "role").toUpperCase() === "ADMIN" ? "ADMIN" : "USER";
    const enabled =
      parseBool(readField(preferred.data, "is_enabled")) ||
      parseBool(readField(preferred.data, "google_access")) ||
      parseBool(readField(preferred.data, "local_access"));

    await createTableRecord("UserFamilyGroups", {
      family_group_key: normalize(familyGroupKey),
      family_group_name: config.tenantName,
      user_email: email,
      role,
      person_id: personId,
      is_enabled: enabled ? "TRUE" : "FALSE",
    });
    createdMissingLinks += 1;
  }

  let deletedLegacyLocalUsersRows = 0;
  if (before.legacyLocalRows.length > 0) {
    const localUsersTab = await resolveTenantScopedTabName("LocalUsers", familyGroupKey);
    if (localUsersTab) {
      deletedLegacyLocalUsersRows = await deleteRowsByNumber(
        localUsersTab,
        before.legacyLocalRows.map((row) => row.rowNumber),
      );
    }
  }

  const after = await runIntegrityAudit(familyGroupKey);
  return NextResponse.json({
    ok: true,
    repairedAt: new Date().toISOString(),
    repaired: {
      deletedDuplicateUserAccessRows,
      deletedOrphanUserFamilyGroupRows,
      createdMissingLinks,
      deletedLegacyLocalUsersRows,
    },
    before: before.summary,
    after: after.summary,
    findings: after.findings,
  });
}
