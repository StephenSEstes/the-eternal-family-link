import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantAdmin } from "@/lib/family-group/guard";
import { buildPersonId } from "@/lib/person/id";
import {
  appendAuditLog,
  createTableRecord,
  ensurePersonFamilyGroupMembership,
  getPersonById,
  getTableRecords,
  updateTableRecordById,
} from "@/lib/google/sheets";

type RouteProps = {
  params: Promise<{ tenantKey: string; householdId: string }>;
};

const childSchema = z.object({
  first_name: z.string().trim().min(1).max(80),
  middle_name: z.string().trim().max(80).optional().default(""),
  last_name: z.string().trim().min(1).max(80),
  nick_name: z.string().trim().max(80).optional().default(""),
  display_name: z.string().trim().max(140).optional().default(""),
  birth_date: z.string().trim().min(1).max(64),
  gender: z.enum(["male", "female", "unspecified"]).optional().default("unspecified"),
});

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function isEnabledLike(value: string | undefined) {
  const raw = normalize(value);
  if (!raw) return true;
  return raw === "true" || raw === "1" || raw === "yes";
}

function readCell(record: Record<string, string>, ...keys: string[]) {
  const lowered = new Map(Object.entries(record).map(([key, value]) => [key.trim().toLowerCase(), value]));
  for (const key of keys) {
    const value = lowered.get(key.trim().toLowerCase());
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function fullName(firstName: string, middleName: string, lastName: string) {
  return [firstName, middleName, lastName].filter((part) => part.trim()).join(" ").trim();
}

function relId(parentPersonId: string, childPersonId: string) {
  return `${parentPersonId}-${childPersonId}-parent`.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

async function upsertParent(parentPersonId: string, childPersonId: string) {
  const id = relId(parentPersonId, childPersonId);
  const payload = {
    rel_id: id,
    from_person_id: parentPersonId,
    to_person_id: childPersonId,
    rel_type: "parent",
  };
  const updated = await updateTableRecordById("Relationships", id, payload, "rel_id");
  if (!updated) {
    await createTableRecord("Relationships", payload);
  }
}

export async function POST(request: Request, { params }: RouteProps) {
  const { tenantKey, householdId } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }
  const parsed = childSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const households = await getTableRecords("Households", resolved.tenant.tenantKey);
  const household = households.find((row) => readCell(row.data, "household_id", "id") === householdId);
  if (!household) {
    return NextResponse.json({ error: "household_not_found" }, { status: 404 });
  }
  const fatherPersonId = readCell(household.data, "husband_person_id");
  const motherPersonId = readCell(household.data, "wife_person_id");
  if (!fatherPersonId || !motherPersonId) {
    return NextResponse.json({ error: "invalid_household", message: "Household is missing parent links." }, { status: 400 });
  }

  const canonicalName = fullName(parsed.data.first_name, parsed.data.middle_name, parsed.data.last_name);
  const displayName = parsed.data.display_name.trim() || canonicalName;
  const personId = buildPersonId(canonicalName, parsed.data.birth_date);
  if (!personId) {
    return NextResponse.json({ error: "invalid_person_id" }, { status: 400 });
  }

  const existing = await getPersonById(personId);
  if (!existing) {
    await createTableRecord(
      "People",
      {
        person_id: personId,
        display_name: displayName,
        first_name: parsed.data.first_name,
        middle_name: parsed.data.middle_name,
        last_name: parsed.data.last_name,
        nick_name: parsed.data.nick_name,
        birth_date: parsed.data.birth_date,
        gender: parsed.data.gender,
        phones: "",
        address: "",
        hobbies: "",
        notes: "",
        photo_file_id: "",
        is_pinned: "FALSE",
        relationships: "",
      },
      resolved.tenant.tenantKey,
    );
  }

  await ensurePersonFamilyGroupMembership(personId, resolved.tenant.tenantKey, true);
  await upsertParent(fatherPersonId, personId);
  await upsertParent(motherPersonId, personId);

  const parentIds = new Set([fatherPersonId, motherPersonId]);
  const personFamilyRows = await getTableRecords("PersonFamilyGroups").catch(() => []);
  const inheritedFamilyKeys = new Set<string>();
  for (const row of personFamilyRows) {
    const rowPersonId = readCell(row.data, "person_id");
    if (!parentIds.has(rowPersonId)) {
      continue;
    }
    if (!isEnabledLike(readCell(row.data, "is_enabled"))) {
      continue;
    }
    const familyGroupKey = normalize(readCell(row.data, "family_group_key"));
    if (familyGroupKey) {
      inheritedFamilyKeys.add(familyGroupKey);
    }
  }
  if (inheritedFamilyKeys.size === 0) {
    inheritedFamilyKeys.add(normalize(resolved.tenant.tenantKey));
  }

  for (const familyGroupKey of inheritedFamilyKeys) {
    await ensurePersonFamilyGroupMembership(personId, familyGroupKey, true);
  }

  const userGroupRows = await getTableRecords("UserFamilyGroups").catch(() => []);
  const existingChildUserGroupKeys = new Set(
    userGroupRows
      .filter((row) => readCell(row.data, "person_id") === personId)
      .map((row) => normalize(readCell(row.data, "family_group_key", "tenant_key")))
      .filter(Boolean),
  );
  const parentUserGroupRows = userGroupRows.filter((row) => {
    const rowPersonId = readCell(row.data, "person_id");
    return parentIds.has(rowPersonId) && isEnabledLike(readCell(row.data, "is_enabled"));
  });

  for (const row of parentUserGroupRows) {
    const familyGroupKey = normalize(readCell(row.data, "family_group_key", "tenant_key"));
    if (!familyGroupKey || existingChildUserGroupKeys.has(familyGroupKey)) {
      continue;
    }
    await createTableRecord("UserFamilyGroups", {
      user_email: "",
      family_group_key: familyGroupKey,
      family_group_name: readCell(row.data, "family_group_name") || familyGroupKey,
      role: "USER",
      person_id: personId,
      is_enabled: "TRUE",
    });
    existingChildUserGroupKeys.add(familyGroupKey);
  }

  await appendAuditLog({
    actorEmail: resolved.session.user?.email ?? "",
    actorPersonId: resolved.session.user?.person_id ?? "",
    action: "CREATE",
    entityType: "PERSON_CHILD",
    entityId: personId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `Added child ${displayName} to household ${householdId}.`,
  }).catch(() => undefined);

  return NextResponse.json({
    ok: true,
    personId,
    inheritedFamilyGroups: Array.from(inheritedFamilyKeys).sort(),
  });
}
