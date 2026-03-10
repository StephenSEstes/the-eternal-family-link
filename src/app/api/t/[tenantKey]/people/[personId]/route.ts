import { NextResponse } from "next/server";
import { upsertPersonBirthAttribute } from "@/lib/attributes/store";
import {
  appendAuditLog,
  deleteTableRows,
  getPersonById,
  getTableRecords,
  PERSON_ATTRIBUTES_TABLE,
  updatePerson,
} from "@/lib/data/runtime";
import { requireTenantAccess, requireTenantAdmin } from "@/lib/family-group/guard";
import { classifyOperationalError } from "@/lib/diagnostics/route";
import { isFounderFamilyGroupRelationshipType } from "@/lib/family-group/relationship-type";
import { personUpdateSchema } from "@/lib/validation/person";

type TenantPersonRouteProps = {
  params: Promise<{ tenantKey: string; personId: string }>;
};

type DeletePersonPreview = {
  personId: string;
  displayName: string;
  counts: {
    peopleRowsToDelete: number;
    personFamilyRowsToDelete: number;
    userFamilyRowsToDelete: number;
    userAccessRowsToDelete: number;
    relationshipRowsToDelete: number;
    householdRowsToDelete: number;
    attributeRowsToDelete: number;
    importantDateRowsToDelete: number;
    enabledMembershipsInOtherFamilies: number;
    founderMembershipRowsToDelete: number;
  };
  householdIds: string[];
};

const STEVE_ACCESS_EMAIL = "stephensestes@gmail.com";

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function isEnabledLike(value: string | undefined) {
  const raw = normalize(value);
  if (!raw) return true;
  return raw === "true" || raw === "yes" || raw === "1";
}

async function buildDeletePersonPreview(tenantKey: string, personId: string): Promise<{
  preview: DeletePersonPreview;
  rowNumbers: {
    people: number[];
    personFamilyGroups: number[];
    userFamilyGroups: number[];
    userAccess: number[];
    relationships: number[];
    households: number[];
    personAttributes: number[];
    importantDates: number[];
  };
  isMemberOfTenant: boolean;
} | null> {
  const targetPersonId = personId.trim();
  if (!targetPersonId) {
    return null;
  }
  const targetTenantKey = normalize(tenantKey);
  const [peopleRows, personFamilyRows, userFamilyRows, userAccessRows, relationshipRows, householdRows, attributeRows, importantDateRows] =
    await Promise.all([
      getTableRecords("People").catch(() => []),
      getTableRecords("PersonFamilyGroups").catch(() => []),
      getTableRecords("UserFamilyGroups").catch(() => []),
      getTableRecords("UserAccess").catch(() => []),
      getTableRecords("Relationships").catch(() => []),
      getTableRecords("Households").catch(() => []),
      getTableRecords(PERSON_ATTRIBUTES_TABLE).catch(() => []),
      getTableRecords("ImportantDates").catch(() => []),
    ]);

  const peopleMatches = peopleRows.filter((row) => (row.data.person_id ?? "").trim() === targetPersonId);
  if (peopleMatches.length === 0) {
    return null;
  }
  const displayName = (peopleMatches[0]?.data.display_name ?? "").trim() || targetPersonId;

  const personFamilyMatches = personFamilyRows.filter(
    (row) => (row.data.person_id ?? "").trim() === targetPersonId,
  );
  const isMemberOfTenant = personFamilyMatches.some(
    (row) => normalize(row.data.family_group_key) === targetTenantKey && isEnabledLike(row.data.is_enabled),
  );
  const enabledMembershipsInOtherFamilies = personFamilyMatches.filter(
    (row) => normalize(row.data.family_group_key) !== targetTenantKey && isEnabledLike(row.data.is_enabled),
  ).length;
  const founderMembershipRowsToDelete = personFamilyMatches.filter((row) =>
    isFounderFamilyGroupRelationshipType(row.data.family_group_relationship_type),
  ).length;

  const userFamilyMatches = userFamilyRows.filter((row) => (row.data.person_id ?? "").trim() === targetPersonId);
  const userAccessMatches = userAccessRows.filter((row) => (row.data.person_id ?? "").trim() === targetPersonId);
  const relationshipMatches = relationshipRows.filter((row) => {
    const fromPersonId = (row.data.from_person_id ?? "").trim();
    const toPersonId = (row.data.to_person_id ?? "").trim();
    return fromPersonId === targetPersonId || toPersonId === targetPersonId;
  });
  const householdMatches = householdRows.filter((row) => {
    const husbandPersonId = (row.data.husband_person_id ?? "").trim();
    const wifePersonId = (row.data.wife_person_id ?? "").trim();
    return husbandPersonId === targetPersonId || wifePersonId === targetPersonId;
  });
  const attributeMatches = attributeRows.filter((row) => (row.data.person_id ?? "").trim() === targetPersonId);
  const importantDateMatches = importantDateRows.filter((row) => (row.data.person_id ?? "").trim() === targetPersonId);

  return {
    preview: {
      personId: targetPersonId,
      displayName,
      counts: {
        peopleRowsToDelete: peopleMatches.length,
        personFamilyRowsToDelete: personFamilyMatches.length,
        userFamilyRowsToDelete: userFamilyMatches.length,
        userAccessRowsToDelete: userAccessMatches.length,
        relationshipRowsToDelete: relationshipMatches.length,
        householdRowsToDelete: householdMatches.length,
        attributeRowsToDelete: attributeMatches.length,
        importantDateRowsToDelete: importantDateMatches.length,
        enabledMembershipsInOtherFamilies,
        founderMembershipRowsToDelete,
      },
      householdIds: householdMatches
        .map((row) => (row.data.household_id ?? "").trim())
        .filter(Boolean),
    },
    rowNumbers: {
      people: peopleMatches.map((row) => row.rowNumber),
      personFamilyGroups: personFamilyMatches.map((row) => row.rowNumber),
      userFamilyGroups: userFamilyMatches.map((row) => row.rowNumber),
      userAccess: userAccessMatches.map((row) => row.rowNumber),
      relationships: relationshipMatches.map((row) => row.rowNumber),
      households: householdMatches.map((row) => row.rowNumber),
      personAttributes: attributeMatches.map((row) => row.rowNumber),
      importantDates: importantDateMatches.map((row) => row.rowNumber),
    },
    isMemberOfTenant,
  };
}

export async function GET(_: Request, { params }: TenantPersonRouteProps) {
  const { tenantKey, personId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const person = await getPersonById(personId, resolved.tenant.tenantKey);
  if (!person) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ tenantKey: resolved.tenant.tenantKey, person });
}

export async function POST(request: Request, { params }: TenantPersonRouteProps) {
  const { tenantKey, personId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const body = await request.json().catch(() => null);
  const parsed = personUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const person = await updatePerson(personId, parsed.data, resolved.tenant.tenantKey);
  if (!person) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  await upsertPersonBirthAttribute(resolved.tenant.tenantKey, personId, parsed.data.birth_date);

  await appendAuditLog({
    actorEmail: resolved.session.user?.email ?? "",
    actorPersonId: resolved.session.user?.person_id ?? "",
    action: "UPDATE",
    entityType: "PERSON",
    entityId: personId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `Updated person ${person.displayName}.`,
  }).catch(() => undefined);

  return NextResponse.json({ tenantKey: resolved.tenant.tenantKey, person });
}

export async function DELETE(request: Request, { params }: TenantPersonRouteProps) {
  try {
    const { tenantKey, personId } = await params;
    const resolved = await requireTenantAdmin(tenantKey);
    if ("error" in resolved) {
      return resolved.error;
    }

    const previewOnly = new URL(request.url).searchParams.get("preview") === "1";
    const built = await buildDeletePersonPreview(resolved.tenant.tenantKey, personId);
    if (!built) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (!built.isMemberOfTenant) {
      return NextResponse.json({ error: "forbidden_person_scope" }, { status: 403 });
    }
    const isSteve = (resolved.session.user?.email ?? "").trim().toLowerCase() === STEVE_ACCESS_EMAIL;
    if (built.preview.counts.founderMembershipRowsToDelete > 0 && !isSteve) {
      return NextResponse.json(
        {
          error: "founder_delete_forbidden",
          message: "Founders cannot be deleted except by Steve.",
          preview: built.preview,
        },
        { status: 409 },
      );
    }
    if (previewOnly) {
      return NextResponse.json({ ok: true, preview: built.preview });
    }

    const deletedPeopleRows = await deleteTableRows("People", built.rowNumbers.people);
    const deletedPersonFamilyRows = await deleteTableRows("PersonFamilyGroups", built.rowNumbers.personFamilyGroups);
    const deletedUserFamilyRows = await deleteTableRows("UserFamilyGroups", built.rowNumbers.userFamilyGroups);
    const deletedUserAccessRows = await deleteTableRows("UserAccess", built.rowNumbers.userAccess);
    const deletedRelationshipRows = await deleteTableRows("Relationships", built.rowNumbers.relationships);
    const deletedHouseholdRows = await deleteTableRows("Households", built.rowNumbers.households);
    const deletedAttributeRows = await deleteTableRows(PERSON_ATTRIBUTES_TABLE, built.rowNumbers.personAttributes);
    const deletedImportantDateRows = await deleteTableRows("ImportantDates", built.rowNumbers.importantDates);

    await appendAuditLog({
      actorEmail: resolved.session.user?.email ?? "",
      actorPersonId: resolved.session.user?.person_id ?? "",
      action: "DELETE",
      entityType: "PERSON",
      entityId: personId,
      familyGroupKey: resolved.tenant.tenantKey,
      status: "SUCCESS",
      details: `Deleted person ${built.preview.displayName}; people=${deletedPeopleRows}, rel=${deletedRelationshipRows}, households=${deletedHouseholdRows}, attrs=${deletedAttributeRows}.`,
    }).catch(() => undefined);

    return NextResponse.json({
      ok: true,
      tenantKey: resolved.tenant.tenantKey,
      deleted: {
        deletedPeopleRows,
        deletedPersonFamilyRows,
        deletedUserFamilyRows,
        deletedUserAccessRows,
        deletedRelationshipRows,
        deletedHouseholdRows,
        deletedAttributeRows,
        deletedImportantDateRows,
      },
      preview: built.preview,
    });
  } catch (error) {
    const classified = classifyOperationalError(error);
    const isQuota = classified.status === 429;
    return NextResponse.json(
      {
        error: isQuota ? "person_delete_quota_exceeded" : "person_delete_failed",
        message: classified.message,
        hint: isQuota ? "Close the workbook if open, wait 60-90 seconds, and retry." : undefined,
      },
      { status: isQuota ? 429 : 500 },
    );
  }
}
