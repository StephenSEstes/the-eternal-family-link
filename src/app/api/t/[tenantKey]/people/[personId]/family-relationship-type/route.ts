import { NextResponse } from "next/server";
import { z } from "zod";
import { appendAuditLog, getPersonById, getTableRecords, setPersonFamilyGroupRelationshipType } from "@/lib/data/runtime";
import {
  isFounderFamilyGroupRelationshipType,
  normalizeFamilyGroupRelationshipType,
  reconcileFamilyGroupRelationshipTypes,
  toRelationshipLike,
} from "@/lib/family-group/relationship-type";
import { requireTenantAdmin } from "@/lib/family-group/guard";

const payloadSchema = z.object({
  founder: z.boolean(),
});

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function readField(record: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function isEnabledLike(value: string | undefined) {
  const normalized = normalize(value);
  if (!normalized) return true;
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

type RouteProps = {
  params: Promise<{ tenantKey: string; personId: string }>;
};

export async function POST(request: Request, { params }: RouteProps) {
  const { tenantKey, personId } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const person = await getPersonById(personId, resolved.tenant.tenantKey);
  if (!person) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [personFamilyRows, relationshipRows] = await Promise.all([
    getTableRecords("PersonFamilyGroups").catch(() => []),
    getTableRecords("Relationships").catch(() => []),
  ]);

  const scopedMembershipRows = personFamilyRows.filter(
    (row) =>
      normalize(readField(row.data, "family_group_key")) === resolved.tenant.tenantKey &&
      normalize(readField(row.data, "person_id")) === normalize(personId),
  );
  if (scopedMembershipRows.length === 0) {
    return NextResponse.json(
      { error: "person_not_in_family_group", message: "Person must already belong to this family group." },
      { status: 409 },
    );
  }

  const enabledMembershipRows = personFamilyRows.filter(
    (row) =>
      normalize(readField(row.data, "family_group_key")) === resolved.tenant.tenantKey &&
      isEnabledLike(readField(row.data, "is_enabled")),
  );

  if (parsed.data.founder) {
    const founderIds = Array.from(
      new Set(
        enabledMembershipRows
          .filter((row) => isFounderFamilyGroupRelationshipType(readField(row.data, "family_group_relationship_type")))
          .map((row) => readField(row.data, "person_id"))
          .filter(Boolean),
      ),
    );
    if (!founderIds.includes(personId) && founderIds.length >= 2) {
      return NextResponse.json(
        {
          error: "founder_limit_reached",
          message: "A family group can have at most two founders.",
        },
        { status: 409 },
      );
    }

    const enabledMemberIds = new Set(
      enabledMembershipRows.map((row) => readField(row.data, "person_id")).filter(Boolean),
    );
    const hasParentInFamily = relationshipRows
      .map((row) => toRelationshipLike(row.data))
      .some(
        (relationship) =>
          normalize(relationship.relType) === "parent" &&
          normalize(relationship.toPersonId) === normalize(personId) &&
          enabledMemberIds.has(relationship.fromPersonId.trim()),
      );
    if (hasParentInFamily) {
      return NextResponse.json(
        {
          error: "founder_has_parents",
          message: "Remove this person's parents in the family before making them a founder.",
        },
        { status: 409 },
      );
    }

    await setPersonFamilyGroupRelationshipType(personId, resolved.tenant.tenantKey, "founder");
    await appendAuditLog({
      actorEmail: resolved.session.user?.email ?? "",
      actorPersonId: resolved.session.user?.person_id ?? "",
      action: "UPDATE",
      entityType: "PERSON_FAMILY_GROUP",
      entityId: `${resolved.tenant.tenantKey}:${personId}`,
      familyGroupKey: resolved.tenant.tenantKey,
      status: "SUCCESS",
      details: `Marked ${person.displayName} as founder in ${resolved.tenant.tenantKey}.`,
    }).catch(() => undefined);
    return NextResponse.json({
      ok: true,
      tenantKey: resolved.tenant.tenantKey,
      personId,
      familyGroupRelationshipType: "founder",
    });
  }

  await setPersonFamilyGroupRelationshipType(personId, resolved.tenant.tenantKey, "undeclared");
  await reconcileFamilyGroupRelationshipTypes(resolved.tenant.tenantKey);

  const refreshedRows = await getTableRecords("PersonFamilyGroups").catch(() => []);
  const refreshedMembership = refreshedRows.find(
    (row) =>
      normalize(readField(row.data, "family_group_key")) === resolved.tenant.tenantKey &&
      normalize(readField(row.data, "person_id")) === normalize(personId) &&
      isEnabledLike(readField(row.data, "is_enabled")),
  );
  const nextType = normalizeFamilyGroupRelationshipType(
    readField(refreshedMembership?.data ?? {}, "family_group_relationship_type"),
  );

  await appendAuditLog({
    actorEmail: resolved.session.user?.email ?? "",
    actorPersonId: resolved.session.user?.person_id ?? "",
    action: "UPDATE",
    entityType: "PERSON_FAMILY_GROUP",
    entityId: `${resolved.tenant.tenantKey}:${personId}`,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `Removed founder designation for ${person.displayName}; family relationship type is now ${nextType}.`,
  }).catch(() => undefined);

  return NextResponse.json({
    ok: true,
    tenantKey: resolved.tenant.tenantKey,
    personId,
    familyGroupRelationshipType: nextType,
  });
}
