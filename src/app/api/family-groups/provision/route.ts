import { z } from "zod";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { ensureTenantPhotosFolder } from "@/lib/google/drive";
import {
  createTableRecord,
  ensureTenantScaffold,
  getTableRecords,
  upsertTenantAccess,
} from "@/lib/google/sheets";
import { getRequestFamilyGroupContext } from "@/lib/family-group/context";

const payloadSchema = z.object({
  familyGroupKey: z.string().trim().min(1).max(80).optional(),
  tenantKey: z.string().trim().min(1).max(80).optional(),
  familyGroupName: z.string().trim().min(1).max(120).optional(),
  tenantName: z.string().trim().min(1).max(120).optional(),
  patriarchFullName: z.string().trim().min(1).max(160),
  matriarchFullName: z.string().trim().min(1).max(160),
  matriarchMaidenName: z.string().trim().min(1).max(120),
  initialAdminPersonId: z.string().trim().min(1).max(120),
  memberPersonIds: z.array(z.string().trim().min(1).max(120)).max(500).optional().default([]),
  isEnabled: z.boolean().default(true),
});

function normalizeFamilyGroupKey(value: string) {
  return value.trim().replace(/[^a-zA-Z]/g, "").toLowerCase();
}

function normalizeNameSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildSeedPersonId(familyGroupKey: string, role: "patriarch" | "matriarch", fullName: string) {
  const slug = normalizeNameSlug(fullName) || role;
  return `fg-${familyGroupKey}-${role}-${slug}`;
}

function isTrueLike(value: string | undefined) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
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

  const payload = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const rawFamilyGroupKey = parsed.data.familyGroupKey ?? parsed.data.tenantKey;
  const familyGroupName = parsed.data.familyGroupName ?? parsed.data.tenantName;
  if (!rawFamilyGroupKey || !familyGroupName) {
    return NextResponse.json(
      { error: "invalid_payload", issues: "familyGroupKey and familyGroupName are required." },
      { status: 400 },
    );
  }
  const familyGroupKey = normalizeFamilyGroupKey(rawFamilyGroupKey);
  if (familyGroupKey.length < 4) {
    return NextResponse.json(
      {
        error: "invalid_family_group_key",
        issues: "Family group key must follow maiden+partner-last-name pattern, letters only (example: SnowEstes).",
      },
      { status: 400 },
    );
  }

  const photosFolderId = await ensureTenantPhotosFolder(familyGroupKey, familyGroupName);
  await ensureTenantScaffold({
    tenantKey: familyGroupKey,
    tenantName: familyGroupName,
    photosFolderId,
  });

  const targetPeopleRows = await getTableRecords("People", familyGroupKey);
  const existingInTarget = new Set(targetPeopleRows.map((row) => (row.data.person_id ?? "").trim()).filter(Boolean));

  const patriarchPersonId = buildSeedPersonId(familyGroupKey, "patriarch", parsed.data.patriarchFullName);
  if (!existingInTarget.has(patriarchPersonId)) {
    await createTableRecord(
      "People",
      {
        family_group_key: familyGroupKey,
        person_id: patriarchPersonId,
        display_name: parsed.data.patriarchFullName,
        birth_date: "",
        phones: "",
        address: "",
        hobbies: "",
        notes: "Top-level patriarch",
        photo_file_id: "",
        is_pinned: "FALSE",
        relationships: "",
      },
      familyGroupKey,
    );
    existingInTarget.add(patriarchPersonId);
  }

  const matriarchPersonId = buildSeedPersonId(familyGroupKey, "matriarch", parsed.data.matriarchFullName);
  if (!existingInTarget.has(matriarchPersonId)) {
    await createTableRecord(
      "People",
      {
        family_group_key: familyGroupKey,
        person_id: matriarchPersonId,
        display_name: parsed.data.matriarchFullName,
        birth_date: "",
        phones: "",
        address: "",
        hobbies: "",
        notes: `Top-level matriarch (maiden name: ${parsed.data.matriarchMaidenName})`,
        photo_file_id: "",
        is_pinned: "FALSE",
        relationships: "",
      },
      familyGroupKey,
    );
    existingInTarget.add(matriarchPersonId);
  }

  const sourceTenantKeys = Array.from(new Set(context.tenants.map((entry) => entry.tenantKey)));
  const sourcePeopleById = new Map<string, Record<string, string>>();
  for (const sourceTenantKey of sourceTenantKeys) {
    const rows = await getTableRecords("People", sourceTenantKey).catch(() => []);
    for (const row of rows) {
      const personId = (row.data.person_id ?? "").trim();
      if (!personId || sourcePeopleById.has(personId)) {
        continue;
      }
      sourcePeopleById.set(personId, row.data);
    }
  }

  const requestedMemberIds = Array.from(
    new Set([parsed.data.initialAdminPersonId, ...parsed.data.memberPersonIds.map((value) => value.trim()).filter(Boolean)]),
  );
  if (!sourcePeopleById.has(parsed.data.initialAdminPersonId)) {
    return NextResponse.json(
      { error: "invalid_initial_admin", issues: "Initial admin must be an existing person from one of your current family groups." },
      { status: 400 },
    );
  }

  let copiedPeopleCount = 0;
  for (const personId of requestedMemberIds) {
    if (existingInTarget.has(personId)) {
      continue;
    }
    const source = sourcePeopleById.get(personId);
    if (!source) {
      continue;
    }
    await createTableRecord(
      "People",
      {
        family_group_key: familyGroupKey,
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
      familyGroupKey,
    );
    existingInTarget.add(personId);
    copiedPeopleCount += 1;
  }

  const accessRows = await getTableRecords("UserFamilyGroups").catch(() => []);
  const importedAccessKeys = new Set<string>();
  let importedAccessCount = 0;
  for (const row of accessRows) {
    const personId = (row.data.person_id ?? "").trim();
    const userEmail = (row.data.user_email ?? "").trim().toLowerCase();
    if (!personId || !userEmail || !requestedMemberIds.includes(personId)) {
      continue;
    }
    if (!isTrueLike(row.data.is_enabled)) {
      continue;
    }
    const dedupeKey = `${personId}|${userEmail}`;
    if (importedAccessKeys.has(dedupeKey)) {
      continue;
    }
    importedAccessKeys.add(dedupeKey);
    await upsertTenantAccess({
      userEmail,
      tenantKey: familyGroupKey,
      tenantName: familyGroupName,
      role: personId === parsed.data.initialAdminPersonId ? "ADMIN" : ((row.data.role ?? "USER").trim().toUpperCase() === "ADMIN" ? "ADMIN" : "USER"),
      personId,
      isEnabled: parsed.data.isEnabled,
    });
    importedAccessCount += 1;
  }

  return NextResponse.json({
    ok: true,
    photosFolderId,
    familyGroupKey,
    familyGroupName,
    createdPeople: {
      patriarchPersonId,
      matriarchPersonId,
      importedExistingPeopleCount: copiedPeopleCount,
    },
    importedAccessCount,
  });
}
