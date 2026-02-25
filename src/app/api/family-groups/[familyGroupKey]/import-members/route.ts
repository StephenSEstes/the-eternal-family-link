import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createTableRecord,
  getTableRecords,
  getTenantConfig,
  upsertTenantAccess,
} from "@/lib/google/sheets";
import { requireTenantAdmin } from "@/lib/family-group/guard";

const payloadSchema = z.object({
  memberPersonIds: z.array(z.string().trim().min(1).max(120)).max(500),
});

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function parseBool(value: string | undefined) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

export async function POST(request: Request, { params }: { params: Promise<{ familyGroupKey: string }> }) {
  const { familyGroupKey } = await params;
  const resolved = await requireTenantAdmin(familyGroupKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const targetFamilyGroupKey = normalize(resolved.tenant.tenantKey);
  const config = await getTenantConfig(targetFamilyGroupKey);
  const requestedPersonIds = Array.from(new Set(parsed.data.memberPersonIds.map((value) => value.trim()).filter(Boolean)));
  if (requestedPersonIds.length === 0) {
    return NextResponse.json({ ok: true, importedPeopleCount: 0, importedAccessCount: 0, missingPersonIds: [] });
  }

  const existingTargetPeopleRows = await getTableRecords("People", targetFamilyGroupKey).catch(() => []);
  const existingTargetPeople = new Set(
    existingTargetPeopleRows.map((row) => (row.data.person_id ?? "").trim()).filter(Boolean),
  );

  const sourceFamilyGroups = Array.from(new Set(resolved.tenant.tenants.map((entry) => entry.tenantKey)));
  const sourcePeopleById = new Map<string, Record<string, string>>();
  for (const sourceFamilyGroupKey of sourceFamilyGroups) {
    const sourceRows = await getTableRecords("People", sourceFamilyGroupKey).catch(() => []);
    for (const row of sourceRows) {
      const personId = (row.data.person_id ?? "").trim();
      if (!personId || sourcePeopleById.has(personId)) {
        continue;
      }
      sourcePeopleById.set(personId, row.data);
    }
  }

  let importedPeopleCount = 0;
  const missingPersonIds: string[] = [];
  for (const personId of requestedPersonIds) {
    if (existingTargetPeople.has(personId)) {
      continue;
    }
    const source = sourcePeopleById.get(personId);
    if (!source) {
      missingPersonIds.push(personId);
      continue;
    }
    await createTableRecord(
      "People",
      {
        family_group_key: targetFamilyGroupKey,
        person_id: personId,
        display_name: source.display_name ?? "",
        birth_date: source.birth_date ?? "",
        phones: source.phones ?? "",
        address: source.address ?? "",
        hobbies: source.hobbies ?? "",
        notes: source.notes ?? "",
        photo_file_id: source.photo_file_id ?? "",
        is_pinned: source.is_pinned ?? "FALSE",
        relationships: source.relationships ?? "",
      },
      targetFamilyGroupKey,
    );
    existingTargetPeople.add(personId);
    importedPeopleCount += 1;
  }

  const linkRows = await getTableRecords("UserFamilyGroups").catch(() => []);
  let importedAccessCount = 0;
  const seenAccess = new Set<string>();
  for (const row of linkRows) {
    const personId = (row.data.person_id ?? "").trim();
    const userEmail = (row.data.user_email ?? "").trim().toLowerCase();
    if (!personId || !userEmail) {
      continue;
    }
    if (!requestedPersonIds.includes(personId)) {
      continue;
    }
    if (!parseBool(row.data.is_enabled)) {
      continue;
    }
    const accessKey = `${personId}|${userEmail}`;
    if (seenAccess.has(accessKey)) {
      continue;
    }
    seenAccess.add(accessKey);
    await upsertTenantAccess({
      userEmail,
      tenantKey: targetFamilyGroupKey,
      tenantName: config.tenantName,
      role: (row.data.role ?? "").trim().toUpperCase() === "ADMIN" ? "ADMIN" : "USER",
      personId,
      isEnabled: true,
    });
    importedAccessCount += 1;
  }

  return NextResponse.json({
    ok: true,
    familyGroupKey: targetFamilyGroupKey,
    importedPeopleCount,
    importedAccessCount,
    missingPersonIds,
  });
}
