import { z } from "zod";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { ensureTenantPhotosFolder } from "@/lib/google/drive";
import {
  createTableRecord,
  ensurePersonFamilyGroupMembership,
  ensureTenantScaffold,
  getPeople,
  getTableRecords,
  updateTableRecordById,
  upsertTenantAccess,
} from "@/lib/google/sheets";
import { getRequestFamilyGroupContext } from "@/lib/family-group/context";
import { buildPersonId } from "@/lib/person/id";

const payloadSchema = z.object({
  familyGroupKey: z.string().trim().min(1).max(80).optional(),
  tenantKey: z.string().trim().min(1).max(80).optional(),
  familyGroupName: z.string().trim().min(1).max(120).optional(),
  tenantName: z.string().trim().min(1).max(120).optional(),
  patriarchFullName: z.string().trim().min(1).max(160),
  patriarchFirstName: z.string().trim().max(80).optional(),
  patriarchMiddleName: z.string().trim().max(80).optional(),
  patriarchLastName: z.string().trim().max(80).optional(),
  patriarchNickName: z.string().trim().max(80).optional(),
  patriarchBirthDate: z.string().trim().max(40).optional(),
  existingPatriarchPersonId: z.string().trim().min(1).max(120).optional(),
  matriarchFullName: z.string().trim().min(1).max(160),
  matriarchFirstName: z.string().trim().max(80).optional(),
  matriarchMiddleName: z.string().trim().max(80).optional(),
  matriarchLastName: z.string().trim().max(80).optional(),
  matriarchNickName: z.string().trim().max(80).optional(),
  matriarchBirthDate: z.string().trim().max(40).optional(),
  existingMatriarchPersonId: z.string().trim().min(1).max(120).optional(),
  matriarchMaidenName: z.string().trim().min(1).max(120),
  sourceFamilyGroupKey: z.string().trim().min(1).max(80).optional(),
  initialAdminPersonId: z.string().trim().min(1).max(120),
  memberPersonIds: z.array(z.string().trim().min(1).max(120)).max(500).optional().default([]),
  householdCandidatePersonIds: z.array(z.string().trim().min(1).max(120)).max(500).optional().default([]),
  parentsAreInitialAdminParents: z.boolean().optional().default(false),
  includeHouseholdCandidates: z.boolean().optional().default(false),
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

function normalizeFamilyNamePart(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z]/g, "")
    .toLowerCase();
}

function titleCaseWord(value: string) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function buildFullName(firstName?: string, middleName?: string, lastName?: string) {
  return [firstName, middleName, lastName]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function extractLastName(fullName: string) {
  const parts = fullName
    .trim()
    .split(/\s+/g)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";
  return parts[parts.length - 1] ?? "";
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

function readValue(record: Record<string, string>, ...keys: string[]) {
  const lowered = new Map(Object.entries(record).map(([key, value]) => [key.trim().toLowerCase(), value]));
  for (const key of keys) {
    const out = lowered.get(key.trim().toLowerCase());
    if (out !== undefined) {
      return out.trim();
    }
  }
  return "";
}

function makeRelationId(fromPersonId: string, toPersonId: string, relType: string) {
  const raw = `${fromPersonId}-${toPersonId}-${relType}`.toLowerCase();
  return raw.replace(/[^a-z0-9_-]+/g, "-");
}

function makeFamilyUnitId(familyGroupKey: string, personA: string, personB: string) {
  const pair = [personA, personB].sort().join("-");
  const raw = `${familyGroupKey}-fu-${pair}`.toLowerCase();
  return raw.replace(/[^a-z0-9_-]+/g, "-");
}

async function upsertParentRelation(
  fromPersonId: string,
  toPersonId: string,
) {
  const relId = makeRelationId(fromPersonId, toPersonId, "parent");
  const payload: Record<string, string> = {
    rel_id: relId,
    from_person_id: fromPersonId,
    to_person_id: toPersonId,
    rel_type: "parent",
  };
  const updated = await updateTableRecordById("Relationships", relId, payload, "rel_id");
  if (!updated) {
    await createTableRecord("Relationships", payload);
  }
}

async function upsertFamilyUnit(
  familyGroupKey: string,
  personA: string,
  personB: string,
) {
  const familyUnitId = makeFamilyUnitId(familyGroupKey, personA, personB);
  const [husband, wife] = [personA, personB].sort();
  const payload: Record<string, string> = {
    family_group_key: familyGroupKey,
    household_id: familyUnitId,
    husband_person_id: husband,
    wife_person_id: wife,
  };
  const updated = await updateTableRecordById("Households", familyUnitId, payload, "household_id", familyGroupKey);
  if (!updated) {
    await createTableRecord("Households", payload, familyGroupKey);
  }
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

  try {
    const payload = await request.json().catch(() => null);
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
    }

  const patriarchFullName = parsed.data.patriarchFullName.trim() || buildFullName(
    parsed.data.patriarchFirstName,
    parsed.data.patriarchMiddleName,
    parsed.data.patriarchLastName,
  );
  const matriarchFullName = parsed.data.matriarchFullName.trim() || buildFullName(
    parsed.data.matriarchFirstName,
    parsed.data.matriarchMiddleName,
    parsed.data.matriarchLastName,
  );
  const maidenPart = normalizeFamilyNamePart(parsed.data.matriarchMaidenName);
  const patriarchLastName = normalizeFamilyNamePart(
    parsed.data.patriarchLastName?.trim() || extractLastName(patriarchFullName),
  );
  const generatedFamilyGroupKey = `${maidenPart}${patriarchLastName}`;
  const familyGroupKey = normalizeFamilyGroupKey(parsed.data.familyGroupKey ?? parsed.data.tenantKey ?? generatedFamilyGroupKey);
  const familyGroupName =
    parsed.data.familyGroupName ??
    parsed.data.tenantName ??
    `${titleCaseWord(maidenPart)}-${titleCaseWord(patriarchLastName)} Family`;
  if (!familyGroupName.trim()) {
    return NextResponse.json({ error: "invalid_payload", issues: "familyGroupName could not be generated." }, { status: 400 });
  }
  if (familyGroupKey.length < 4) {
    return NextResponse.json(
      {
        error: "invalid_family_group_key",
        issues: "Family group key must follow maiden+partner-last-name pattern, letters only (example: SnowEstes).",
      },
      { status: 400 },
    );
  }

  const sourceFamilyGroupKey = (parsed.data.sourceFamilyGroupKey ?? context.tenantKey).trim().toLowerCase();
  const sourceAccess = context.tenants.find((entry) => entry.tenantKey.trim().toLowerCase() === sourceFamilyGroupKey);
  if (!sourceAccess) {
    return NextResponse.json(
      { error: "invalid_source_family", issues: "You do not have access to the selected source family group." },
      { status: 403 },
    );
  }
  if (sourceAccess.role !== "ADMIN") {
    return NextResponse.json(
      { error: "forbidden", issues: "Only admins can create a new family group from this source family." },
      { status: 403 },
    );
  }

  const sourcePeopleRows = await getPeople(sourceFamilyGroupKey).catch(() => []);
  const globalPeopleRows = await getPeople().catch(() => []);
  const sourcePeopleById = new Map<string, Record<string, string>>();
  for (const row of sourcePeopleRows) {
    const personId = row.personId.trim();
    if (!personId || sourcePeopleById.has(personId)) {
      continue;
    }
    sourcePeopleById.set(personId, {
      person_id: row.personId,
      display_name: row.displayName,
      first_name: row.firstName ?? "",
      middle_name: row.middleName ?? "",
      last_name: row.lastName ?? "",
      nick_name: row.nickName ?? "",
      birth_date: row.birthDate,
      gender: row.gender ?? "unspecified",
      phones: row.phones,
      address: row.address,
      hobbies: row.hobbies,
      notes: row.notes,
      photo_file_id: row.photoFileId,
      is_pinned: row.isPinned ? "TRUE" : "FALSE",
      relationships: row.relationships.join(","),
    });
  }
  const globalPeopleById = new Map<string, Record<string, string>>();
  for (const row of globalPeopleRows) {
    const personId = row.personId.trim();
    if (!personId || globalPeopleById.has(personId)) {
      continue;
    }
    globalPeopleById.set(personId, {
      person_id: row.personId,
      display_name: row.displayName,
      first_name: row.firstName ?? "",
      middle_name: row.middleName ?? "",
      last_name: row.lastName ?? "",
      nick_name: row.nickName ?? "",
      birth_date: row.birthDate,
      gender: row.gender ?? "unspecified",
      phones: row.phones,
      address: row.address,
      hobbies: row.hobbies,
      notes: row.notes,
      photo_file_id: row.photoFileId,
      is_pinned: row.isPinned ? "TRUE" : "FALSE",
      relationships: row.relationships.join(","),
    });
  }

  const photosFolderId = await ensureTenantPhotosFolder(familyGroupKey, familyGroupName);
  await ensureTenantScaffold({
    tenantKey: familyGroupKey,
    tenantName: familyGroupName,
    photosFolderId,
  });

  const targetPeopleRows = await getTableRecords("People", familyGroupKey);
  const existingInTarget = new Set(targetPeopleRows.map((row) => (row.data.person_id ?? "").trim()).filter(Boolean));

  const existingPatriarchPersonId = (parsed.data.existingPatriarchPersonId ?? "").trim();
  const patriarchPersonId = existingPatriarchPersonId ||
    buildPersonId(patriarchFullName, parsed.data.patriarchBirthDate ?? "") ||
    buildSeedPersonId(familyGroupKey, "patriarch", patriarchFullName);
  if (existingPatriarchPersonId && !globalPeopleById.has(existingPatriarchPersonId)) {
    return NextResponse.json(
      { error: "invalid_existing_patriarch", issues: "Selected existing patriarch was not found in global people." },
      { status: 400 },
    );
  }
  if (!existingInTarget.has(patriarchPersonId)) {
    if (existingPatriarchPersonId) {
      const source = globalPeopleById.get(existingPatriarchPersonId)!;
      await createTableRecord(
        "People",
        {
          person_id: existingPatriarchPersonId,
          display_name: source.display_name ?? "",
          first_name: source.first_name ?? "",
          middle_name: source.middle_name ?? "",
          last_name: source.last_name ?? "",
          nick_name: source.nick_name ?? "",
          birth_date: source.birth_date ?? "",
          gender: source.gender || "male",
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
    } else {
      await createTableRecord(
        "People",
        {
          person_id: patriarchPersonId,
          display_name: patriarchFullName,
          first_name: parsed.data.patriarchFirstName ?? "",
          middle_name: parsed.data.patriarchMiddleName ?? "",
          last_name: parsed.data.patriarchLastName ?? "",
          nick_name: parsed.data.patriarchNickName ?? "",
          birth_date: parsed.data.patriarchBirthDate ?? "",
          gender: "male",
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
    }
    existingInTarget.add(patriarchPersonId);
  }
  await ensurePersonFamilyGroupMembership(patriarchPersonId, familyGroupKey, true);

  const existingMatriarchPersonId = (parsed.data.existingMatriarchPersonId ?? "").trim();
  const matriarchPersonId = existingMatriarchPersonId ||
    buildPersonId(matriarchFullName, parsed.data.matriarchBirthDate ?? "") ||
    buildSeedPersonId(familyGroupKey, "matriarch", matriarchFullName);
  if (existingMatriarchPersonId && !globalPeopleById.has(existingMatriarchPersonId)) {
    return NextResponse.json(
      { error: "invalid_existing_matriarch", issues: "Selected existing matriarch was not found in global people." },
      { status: 400 },
    );
  }
  if (!existingInTarget.has(matriarchPersonId)) {
    if (existingMatriarchPersonId) {
      const source = globalPeopleById.get(existingMatriarchPersonId)!;
      await createTableRecord(
        "People",
        {
          person_id: existingMatriarchPersonId,
          display_name: source.display_name ?? "",
          first_name: source.first_name ?? "",
          middle_name: source.middle_name ?? "",
          last_name: source.last_name ?? "",
          nick_name: source.nick_name ?? "",
          birth_date: source.birth_date ?? "",
          gender: source.gender || "female",
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
    } else {
      await createTableRecord(
        "People",
        {
          person_id: matriarchPersonId,
          display_name: matriarchFullName,
          first_name: parsed.data.matriarchFirstName ?? "",
          middle_name: parsed.data.matriarchMiddleName ?? "",
          last_name: parsed.data.matriarchLastName ?? "",
          nick_name: parsed.data.matriarchNickName ?? "",
          birth_date: parsed.data.matriarchBirthDate ?? "",
          gender: "female",
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
    }
    existingInTarget.add(matriarchPersonId);
  }
  await ensurePersonFamilyGroupMembership(matriarchPersonId, familyGroupKey, true);

  const requestedMemberIds = Array.from(
    new Set([parsed.data.initialAdminPersonId, ...parsed.data.memberPersonIds.map((value) => value.trim()).filter(Boolean)]),
  );
  if (!sourcePeopleById.has(parsed.data.initialAdminPersonId)) {
    return NextResponse.json(
      { error: "invalid_initial_admin", issues: "Initial admin must be an existing person from the selected source family group." },
      { status: 400 },
    );
  }

  let copiedPeopleCount = 0;
  for (const personId of requestedMemberIds) {
    if (existingInTarget.has(personId)) {
      await ensurePersonFamilyGroupMembership(personId, familyGroupKey, true);
      continue;
    }
    const source = sourcePeopleById.get(personId);
    if (!source) {
      continue;
    }
    await createTableRecord(
      "People",
      {
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
    await ensurePersonFamilyGroupMembership(personId, familyGroupKey, true);
    copiedPeopleCount += 1;
  }

  const accessRows = await getTableRecords("UserFamilyGroups").catch(() => []);
  const importedAccessKeys = new Set<string>();
  let importedAccessCount = 0;
  for (const row of accessRows) {
    const personId = (row.data.person_id ?? "").trim();
    const userEmail = (row.data.user_email ?? "").trim().toLowerCase();
    const rowFamilyGroupKey = readValue(row.data, "family_group_key", "tenant_key").toLowerCase();
    if (!personId || !userEmail || !requestedMemberIds.includes(personId)) {
      continue;
    }
    if (rowFamilyGroupKey !== sourceFamilyGroupKey) {
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

  await upsertFamilyUnit(familyGroupKey, patriarchPersonId, matriarchPersonId);
  if (parsed.data.parentsAreInitialAdminParents) {
    await upsertParentRelation(patriarchPersonId, parsed.data.initialAdminPersonId);
    await upsertParentRelation(matriarchPersonId, parsed.data.initialAdminPersonId);
  }

  let householdImportCandidates: Array<{ personId: string; displayName: string }> = [];
  let autoImportedPeopleCount = 0;
  let autoImportedAccessCount = 0;
  let autoImportedHouseholdCandidates = false;
  if (parsed.data.includeHouseholdCandidates) {
    const households = await getTableRecords("Households", sourceFamilyGroupKey).catch(() => []);
    const relationships = await getTableRecords("Relationships").catch(() => []);
    const candidateIds = new Set<string>();
    const spouseIds = new Set<string>();
    for (const row of households) {
      const partner1 = readValue(row.data, "husband_person_id");
      const partner2 = readValue(row.data, "wife_person_id");
      if (partner1 === parsed.data.initialAdminPersonId && partner2) {
        candidateIds.add(partner2);
        spouseIds.add(partner2);
      }
      if (partner2 === parsed.data.initialAdminPersonId && partner1) {
        candidateIds.add(partner1);
        spouseIds.add(partner1);
      }
    }
    for (const row of relationships) {
      const relType = readValue(row.data, "rel_type").toLowerCase();
      const fromPersonId = readValue(row.data, "from_person_id");
      const toPersonId = readValue(row.data, "to_person_id");
      if (
        relType === "parent" &&
        toPersonId &&
        (fromPersonId === parsed.data.initialAdminPersonId || spouseIds.has(fromPersonId))
      ) {
        candidateIds.add(toPersonId);
      }
    }
    const selectedCandidateIds = new Set(
      parsed.data.householdCandidatePersonIds.map((value) => value.trim()).filter(Boolean),
    );
    if (selectedCandidateIds.size > 0) {
      for (const candidateId of Array.from(candidateIds)) {
        if (!selectedCandidateIds.has(candidateId)) {
          candidateIds.delete(candidateId);
        }
      }
    }
    candidateIds.delete(parsed.data.initialAdminPersonId);
    candidateIds.delete(patriarchPersonId);
    candidateIds.delete(matriarchPersonId);
    householdImportCandidates = Array.from(candidateIds)
      .map((personId) => {
        const source = sourcePeopleById.get(personId);
        if (!source) return null;
        return {
          personId,
          displayName: (source.display_name ?? "").trim() || personId,
        };
      })
      .filter((item): item is { personId: string; displayName: string } => Boolean(item))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    const candidatePersonIds = householdImportCandidates.map((item) => item.personId);
    if (candidatePersonIds.length > 0) {
      autoImportedHouseholdCandidates = true;
      for (const personId of candidatePersonIds) {
        if (existingInTarget.has(personId)) {
          await ensurePersonFamilyGroupMembership(personId, familyGroupKey, true);
          continue;
        }
        const source = sourcePeopleById.get(personId);
        if (!source) {
          continue;
        }
        await createTableRecord(
          "People",
          {
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
        await ensurePersonFamilyGroupMembership(personId, familyGroupKey, true);
        autoImportedPeopleCount += 1;
      }

      for (const row of accessRows) {
        const personId = (row.data.person_id ?? "").trim();
        const userEmail = (row.data.user_email ?? "").trim().toLowerCase();
        const rowFamilyGroupKey = readValue(row.data, "family_group_key", "tenant_key").toLowerCase();
        if (!personId || !userEmail || !candidatePersonIds.includes(personId)) {
          continue;
        }
        if (rowFamilyGroupKey !== sourceFamilyGroupKey) {
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
          role: (row.data.role ?? "USER").trim().toUpperCase() === "ADMIN" ? "ADMIN" : "USER",
          personId,
          isEnabled: parsed.data.isEnabled,
        });
        importedAccessCount += 1;
        autoImportedAccessCount += 1;
      }
    }
  }

    return NextResponse.json({
      ok: true,
      photosFolderId,
      familyGroupKey,
      familyGroupName,
      sourceFamilyGroupKey,
      createdPeople: {
        patriarchPersonId,
        matriarchPersonId,
        importedExistingPeopleCount: copiedPeopleCount,
      },
      parentsLinkedToInitialAdmin: parsed.data.parentsAreInitialAdminParents,
      householdImportCandidates,
      importedAccessCount,
      autoImportedHouseholdCandidates,
      autoImportedPeopleCount,
      autoImportedAccessCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: "provision_failed",
        message,
      },
      { status: 500 },
    );
  }
}
