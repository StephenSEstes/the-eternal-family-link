import { z } from "zod";
import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { buildEntityId } from "@/lib/entity-id";
import {
  createTableRecord,
  createTableRecords,
  deleteTableRecordById,
  deleteTableRows,
  ensurePersonFamilyGroupMembership,
  getTableRecords,
  updateTableRecordById,
} from "@/lib/data/runtime";
import {
  deriveExpectedFamilyGroupRelationshipTypes,
  isAnchorFamilyGroupRelationshipType,
  isFounderFamilyGroupRelationshipType,
  normalizeFamilyGroupRelationshipType,
  reconcileFamilyGroupRelationshipTypes,
  toRelationshipLike,
} from "@/lib/family-group/relationship-type";
import { hasTenantAccess, normalizeTenantRouteKey } from "@/lib/family-group/context";
import { upsertOciUserFamilyGroupAccess } from "@/lib/oci/tables";

const payloadSchema = z.object({
  personId: z.string().trim().min(1),
  parentIds: z.array(z.string().trim().min(1)).default([]),
  childIds: z.array(z.string().trim().min(1)).default([]),
  spouseId: z.string().trim().optional().default(""),
  spouseAction: z.enum(["link", "divorce"]).optional().default("link"),
  familyChanged: z.boolean().optional().default(true),
});

const MARRIAGE_SYNC_NOTE_PREFIX = "[system] household_marriage_sync:";

function makeRelId(fromPersonId: string, toPersonId: string, relType: string) {
  return buildEntityId("rel", `${fromPersonId}|${toPersonId}|${relType}`);
}

function makeParentEdgeKey(fromPersonId: string, toPersonId: string) {
  return `${fromPersonId}=>${toPersonId}=>parent`.toLowerCase();
}

function makeRelationEdgeKey(fromPersonId: string, toPersonId: string, relType: string) {
  return `${fromPersonId}=>${toPersonId}=>${relType}`.toLowerCase();
}

function readField(record: Record<string, string>, ...keys: string[]) {
  const lowered = new Map(Object.entries(record).map(([k, v]) => [k.trim().toLowerCase(), v]));
  for (const key of keys) {
    const value = lowered.get(key.toLowerCase());
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function relationPayload(
  tenantKey: string,
  fromPersonId: string,
  toPersonId: string,
  relType: string,
): Record<string, string> {
  const relId = makeRelId(fromPersonId, toPersonId, relType);
  return {
    family_group_key: tenantKey,
    rel_id: relId,
    relationship_id: relId,
    id: relId,
    from_person_id: fromPersonId,
    to_person_id: toPersonId,
    rel_type: relType,
  };
}

function makeFamilyUnitId(tenantKey: string, personA: string, personB: string) {
  const pair = [personA, personB].sort().join("|").toLowerCase();
  return buildEntityId("h", `${tenantKey}|${pair}`);
}

function makeSingleParentFamilyUnitId(tenantKey: string, personId: string) {
  return buildEntityId("h", `${tenantKey}|single|${personId}`.toLowerCase());
}

function normalizeNamePart(value: string) {
  const cleaned = value.trim().replace(/[^a-zA-Z\s'-]/g, " ").replace(/\s+/g, " ");
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function buildHouseholdLabel(wifeLastName: string, husbandLastName: string) {
  const wife = normalizeNamePart(wifeLastName);
  const husband = normalizeNamePart(husbandLastName);
  if (wife && husband) {
    return `${wife}-${husband} Family`;
  }
  if (wife) {
    return `${wife} Family`;
  }
  if (husband) {
    return `${husband} Family`;
  }
  return "Family";
}

function removeEnabledGroup(
  enabledGroupsByPerson: Map<string, Set<string>>,
  personId: string,
  familyGroupKey: string,
) {
  const normalizedPersonId = personId.trim();
  const normalizedFamilyGroupKey = familyGroupKey.trim().toLowerCase();
  if (!normalizedPersonId || !normalizedFamilyGroupKey) {
    return;
  }
  const current = enabledGroupsByPerson.get(normalizedPersonId);
  if (!current) {
    return;
  }
  current.delete(normalizedFamilyGroupKey);
  if (current.size === 0) {
    enabledGroupsByPerson.delete(normalizedPersonId);
    return;
  }
  enabledGroupsByPerson.set(normalizedPersonId, current);
}

function parseEnabledMembership(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

function parseDate(value?: string) {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch;
    const parsed = new Date(Number(y), Number(m) - 1, Number(d));
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function isAtLeastAge(value: string | undefined, minYears = 19) {
  const parsed = parseDate(value);
  if (!parsed) return false;
  const now = new Date();
  let years = now.getFullYear() - parsed.getFullYear();
  const beforeBirthday =
    now.getMonth() < parsed.getMonth() ||
    (now.getMonth() === parsed.getMonth() && now.getDate() < parsed.getDate());
  if (beforeBirthday) years -= 1;
  return years >= minYears;
}

function toMembershipLike(record: Record<string, string>) {
  return {
    personId: readField(record, "person_id"),
    familyGroupKey: readField(record, "family_group_key"),
    isEnabled: readField(record, "is_enabled"),
    familyGroupRelationshipType: readField(record, "family_group_relationship_type"),
  };
}

function addEnabledGroup(
  enabledGroupsByPerson: Map<string, Set<string>>,
  personId: string,
  familyGroupKey: string,
) {
  if (!personId.trim() || !familyGroupKey.trim()) {
    return;
  }
  const key = familyGroupKey.trim().toLowerCase();
  const groups = enabledGroupsByPerson.get(personId) ?? new Set<string>();
  groups.add(key);
  enabledGroupsByPerson.set(personId, groups);
}

function hasSpouseFamilyLink(
  relationships: ReturnType<typeof toRelationshipLike>[],
  personA: string,
  personB: string,
) {
  const normalizedPersonA = personA.trim();
  const normalizedPersonB = personB.trim();
  if (!normalizedPersonA || !normalizedPersonB) {
    return false;
  }
  return relationships.some((relationship) => {
    const relType = relationship.relType.trim().toLowerCase();
    if (relType !== "spouse" && relType !== "family") {
      return false;
    }
    const fromPersonId = relationship.fromPersonId.trim();
    const toPersonId = relationship.toPersonId.trim();
    return (
      (fromPersonId === normalizedPersonA && toPersonId === normalizedPersonB) ||
      (fromPersonId === normalizedPersonB && toPersonId === normalizedPersonA)
    );
  });
}

async function inheritEnabledGroupsFromPeople(
  targetPersonId: string,
  sourcePersonIds: string[],
  enabledGroupsByPerson: Map<string, Set<string>>,
) {
  const inheritedGroups = new Set<string>();
  for (const sourcePersonId of sourcePersonIds) {
    const groups = enabledGroupsByPerson.get(sourcePersonId.trim());
    if (!groups) {
      continue;
    }
    groups.forEach((groupKey) => inheritedGroups.add(groupKey));
  }
  for (const familyGroupKey of inheritedGroups) {
    await ensurePersonFamilyGroupMembership(targetPersonId, familyGroupKey, true);
    addEnabledGroup(enabledGroupsByPerson, targetPersonId, familyGroupKey);
  }
  return inheritedGroups;
}

async function createFamilyUnit(
  tenantKey: string,
  personA: string,
  personB: string,
  peopleById: Map<string, { gender: string; lastName: string }>,
) {
  const familyUnitId = makeFamilyUnitId(tenantKey, personA, personB);
  const personAData = peopleById.get(personA) ?? { gender: "", lastName: "" };
  const personBData = peopleById.get(personB) ?? { gender: "", lastName: "" };
  const personAGender = personAData.gender.toLowerCase();
  const personBGender = personBData.gender.toLowerCase();

  let husband = personA;
  let wife = personB;
  if (personAGender === "female" && personBGender === "male") {
    husband = personB;
    wife = personA;
  } else if (personAGender === "male" && personBGender === "female") {
    husband = personA;
    wife = personB;
  } else {
    // Deterministic fallback when genders are missing/unspecified.
    const sorted = [personA, personB].sort();
    husband = sorted[0];
    wife = sorted[1];
  }

  const wifeLastName = (peopleById.get(wife)?.lastName ?? "").trim();
  const husbandLastName = (peopleById.get(husband)?.lastName ?? "").trim();
  const payload: Record<string, string> = {
    household_id: familyUnitId,
    husband_person_id: husband,
    wife_person_id: wife,
    label: buildHouseholdLabel(wifeLastName, husbandLastName),
    family_group_key: tenantKey,
  };
  await createTableRecord("Households", payload, tenantKey);
}

function resolveSingleParentHouseholdRoles(
  personId: string,
  peopleById: Map<string, { gender: string; lastName: string }>,
) {
  const gender = (peopleById.get(personId)?.gender ?? "").trim().toLowerCase();
  if (gender === "female") {
    return { husbandPersonId: "", wifePersonId: personId };
  }
  return { husbandPersonId: personId, wifePersonId: "" };
}

function buildSingleParentHouseholdPayload(
  tenantKey: string,
  householdId: string,
  personId: string,
  peopleById: Map<string, { gender: string; lastName: string }>,
  existing?: Record<string, string>,
) {
  const roles = resolveSingleParentHouseholdRoles(personId, peopleById);
  const personLastName = (peopleById.get(personId)?.lastName ?? "").trim();
  return {
    family_group_key: tenantKey,
    household_id: householdId,
    husband_person_id: roles.husbandPersonId,
    wife_person_id: roles.wifePersonId,
    label: existing && readField(existing, "label") ? readField(existing, "label") : buildHouseholdLabel(personLastName, ""),
    notes: existing ? readField(existing, "notes") : "",
    wedding_photo_file_id: existing ? readField(existing, "wedding_photo_file_id") : "",
    married_date: "",
    address: existing ? readField(existing, "address") : "",
    city: existing ? readField(existing, "city") : "",
    state: existing ? readField(existing, "state") : "",
    zip: existing ? readField(existing, "zip") : "",
  };
}

function getHouseholdOccupants(record: Record<string, string>) {
  const husbandPersonId = readField(record, "husband_person_id");
  const wifePersonId = readField(record, "wife_person_id");
  const memberIds = [husbandPersonId, wifePersonId].filter(Boolean);
  return {
    husbandPersonId,
    wifePersonId,
    memberIds,
  };
}

function isHouseholdMatchForPair(record: Record<string, string>, personA: string, personB: string) {
  const { memberIds } = getHouseholdOccupants(record);
  if (memberIds.length !== 2) {
    return false;
  }
  const normalizedPair = [personA.trim(), personB.trim()].filter(Boolean).sort().join("|");
  return memberIds.slice().sort().join("|") === normalizedPair;
}

function isSingleParentHouseholdForPerson(record: Record<string, string>, personId: string) {
  const { memberIds } = getHouseholdOccupants(record);
  return memberIds.length === 1 && memberIds[0] === personId.trim();
}

function mergeHouseholdPayload(
  target: Record<string, string>,
  source: Record<string, string>,
) {
  return {
    label: readField(target, "label") || readField(source, "label"),
    notes: readField(target, "notes") || readField(source, "notes"),
    wedding_photo_file_id: readField(target, "wedding_photo_file_id") || readField(source, "wedding_photo_file_id"),
    address: readField(target, "address") || readField(source, "address"),
    city: readField(target, "city") || readField(source, "city"),
    state: readField(target, "state") || readField(source, "state"),
    zip: readField(target, "zip") || readField(source, "zip"),
  };
}

async function moveHouseholdLinkedRows(
  tenantKey: string,
  sourceHouseholdId: string,
  targetHouseholdId: string,
) {
  if (!sourceHouseholdId.trim() || !targetHouseholdId.trim() || sourceHouseholdId === targetHouseholdId) {
    return;
  }
  const [attributeRows, mediaLinkRows] = await Promise.all([
    getTableRecords("Attributes", tenantKey).catch(() => []),
    getTableRecords("MediaLinks", tenantKey).catch(() => []),
  ]);

  for (const row of attributeRows) {
    const attributeId = readField(row.data, "attribute_id");
    if (!attributeId) {
      continue;
    }
    if (readField(row.data, "entity_type").trim().toLowerCase() !== "household") {
      continue;
    }
    if (readField(row.data, "entity_id") !== sourceHouseholdId) {
      continue;
    }
    await updateTableRecordById("Attributes", attributeId, { entity_id: targetHouseholdId }, "attribute_id", tenantKey);
  }

  for (const row of mediaLinkRows) {
    const linkId = readField(row.data, "link_id", "id");
    if (!linkId) {
      continue;
    }
    if (readField(row.data, "entity_type").trim().toLowerCase() !== "household") {
      continue;
    }
    if (readField(row.data, "entity_id") !== sourceHouseholdId) {
      continue;
    }
    await updateTableRecordById("MediaLinks", linkId, { entity_id: targetHouseholdId }, "link_id", tenantKey);
  }
}

async function deleteSyncedHouseholdMarriageAttributes(
  tenantKey: string,
  householdIds: string[],
) {
  const markers = new Set(
    householdIds
      .map((householdId) => householdId.trim())
      .filter(Boolean)
      .map((householdId) => `${MARRIAGE_SYNC_NOTE_PREFIX}${householdId}`),
  );
  if (markers.size === 0) {
    return;
  }
  const attributeRows = await getTableRecords("Attributes", tenantKey).catch(() => []);
  for (const row of attributeRows) {
    const attributeId = readField(row.data, "attribute_id");
    if (!attributeId) {
      continue;
    }
    if (readField(row.data, "entity_type").toLowerCase() !== "person") {
      continue;
    }
    if (readField(row.data, "attribute_type").toLowerCase() !== "family_relationship") {
      continue;
    }
    if (readField(row.data, "attribute_type_category").toLowerCase() !== "married") {
      continue;
    }
    const notes = readField(row.data, "attribute_notes", "notes");
    if (!markers.has(notes)) {
      continue;
    }
    await deleteTableRecordById("Attributes", attributeId, "attribute_id", tenantKey);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const session = await getAppSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { tenantKey } = await params;
  const normalizedTenantKey = normalizeTenantRouteKey(tenantKey);
  if (!hasTenantAccess(session, normalizedTenantKey)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }
  const debugContext = {
    phase: "start",
    personId: parsed.data.personId,
    parentCount: parsed.data.parentIds.length,
    childCount: parsed.data.childIds.length,
    spouseId: parsed.data.spouseId ?? "",
    spouseAction: parsed.data.spouseAction,
    familyChanged: parsed.data.familyChanged,
  };
  try {
    debugContext.phase = "prepare";
    const parentIds = Array.from(new Set(parsed.data.parentIds.filter((id) => id !== parsed.data.personId)));
    const childIds = Array.from(new Set(parsed.data.childIds.filter((id) => id !== parsed.data.personId)));
    const spouseAction = parsed.data.spouseAction === "divorce" ? "divorce" : "link";
    const spouseId = parsed.data.spouseId && parsed.data.spouseId !== parsed.data.personId ? parsed.data.spouseId : "";
    if (!parsed.data.familyChanged) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "family_not_changed",
        personId: parsed.data.personId,
      });
    }
    if (spouseAction === "divorce" && !spouseId) {
      return NextResponse.json(
        {
          error: "invalid_divorce_target",
          message: "Divorce requires the current spouse ID.",
        },
        { status: 400 },
      );
    }

    debugContext.phase = "load_relationships";
    const existing = await getTableRecords("Relationships", normalizedTenantKey);
    const people = await getTableRecords("People", normalizedTenantKey);
    const personFamilyRows = await getTableRecords("PersonFamilyGroups").catch(() => []);
    const userFamilyRows = await getTableRecords("UserFamilyGroups").catch(() => []);
    const existingRelationshipsLike = existing.map((row) => toRelationshipLike(row.data));
    const peopleById = new Map<string, { gender: string; lastName: string; birthDate: string }>();
    for (const row of people) {
      const personId = readField(row.data, "person_id", "id");
      if (!personId) continue;
      peopleById.set(personId, {
        gender: readField(row.data, "gender"),
        lastName: readField(row.data, "last_name"),
        birthDate: readField(row.data, "birth_date"),
      });
    }
    const enabledGroupsByPerson = new Map<string, Set<string>>();
    for (const row of personFamilyRows) {
      const personId = readField(row.data, "person_id");
      const familyGroupKey = readField(row.data, "family_group_key");
      const isEnabled = parseEnabledMembership(readField(row.data, "is_enabled"));
      if (!personId || !familyGroupKey || !isEnabled) {
        continue;
      }
      addEnabledGroup(enabledGroupsByPerson, personId, familyGroupKey);
    }
    const enabledUserFamilyGroupsByPerson = new Map<string, Set<string>>();
    for (const row of userFamilyRows) {
      const personId = readField(row.data, "person_id");
      const familyGroupKey = readField(row.data, "family_group_key", "tenant_key");
      const isEnabled = parseEnabledMembership(readField(row.data, "is_enabled"));
      if (!personId || !familyGroupKey || !isEnabled) {
        continue;
      }
      addEnabledGroup(enabledUserFamilyGroupsByPerson, personId, familyGroupKey);
    }
    const currentRelationshipTypes = deriveExpectedFamilyGroupRelationshipTypes({
      familyGroupKey: normalizedTenantKey,
      relationships: existingRelationshipsLike,
      memberships: personFamilyRows.map((row) => toMembershipLike(row.data)),
    });
    const currentPersonRelationshipType =
      currentRelationshipTypes.get(parsed.data.personId) ??
      normalizeFamilyGroupRelationshipType(
        personFamilyRows.find(
          (row) =>
            readField(row.data, "person_id") === parsed.data.personId &&
            readField(row.data, "family_group_key").trim().toLowerCase() === normalizedTenantKey,
        )?.data.family_group_relationship_type,
      );
    if (isFounderFamilyGroupRelationshipType(currentPersonRelationshipType) && parentIds.length > 0) {
      return NextResponse.json(
        {
          error: "founder_cannot_have_parents",
          message: "Founders anchor the family and cannot have parents assigned in this family group.",
        },
        { status: 409 },
      );
    }
    const anchorParentIds = parentIds.filter((parentId) =>
      isAnchorFamilyGroupRelationshipType(currentRelationshipTypes.get(parentId)),
    );
    if (parentIds.length > 0 && anchorParentIds.length === 0) {
      return NextResponse.json(
        {
          error: "invalid_parent_placement",
          message: "At least one parent in this family must already be a founder or direct member.",
          invalidParentIds: parentIds,
        },
        { status: 409 },
      );
    }
    const invalidParentIds = parentIds.filter((parentId) => {
      if (anchorParentIds.includes(parentId)) {
        return false;
      }
      if (normalizeFamilyGroupRelationshipType(currentRelationshipTypes.get(parentId)) !== "in_law") {
        return true;
      }
      return !anchorParentIds.some((anchorParentId) =>
        hasSpouseFamilyLink(existingRelationshipsLike, parentId, anchorParentId),
      );
    });
    if (invalidParentIds.length > 0) {
      return NextResponse.json(
        {
          error: "invalid_parent_placement",
          message: "Additional parents in this family must already be spouse-linked to a founder or direct member.",
          invalidParentIds,
        },
        { status: 409 },
      );
    }
    const nextPersonWillBeAnchor =
      isFounderFamilyGroupRelationshipType(currentPersonRelationshipType) || parentIds.length > 0;
    if (
      spouseAction !== "divorce" &&
      spouseId &&
      !nextPersonWillBeAnchor &&
      !isAnchorFamilyGroupRelationshipType(currentRelationshipTypes.get(spouseId))
    ) {
      return NextResponse.json(
        {
          error: "invalid_spouse_placement",
          message: "A spouse link in this family group must connect to a founder or direct member.",
          spouseId,
        },
        { status: 409 },
      );
    }
    if (spouseAction !== "divorce" && spouseId && parentIds.includes(spouseId)) {
      return NextResponse.json(
        {
          error: "invalid_spouse_parent_overlap",
          message: "A parent cannot also be selected as spouse.",
          spouseId,
        },
        { status: 409 },
      );
    }
    const currentPersonBirthDate = peopleById.get(parsed.data.personId)?.birthDate ?? "";
    const spouseBirthDate = spouseId ? peopleById.get(spouseId)?.birthDate ?? "" : "";
    if (
      spouseAction !== "divorce" &&
      spouseId &&
      (!isAtLeastAge(currentPersonBirthDate, 19) || !isAtLeastAge(spouseBirthDate, 19))
    ) {
      return NextResponse.json(
        {
          error: "invalid_spouse_age",
          message: "Spouse links require both people to be at least 19 years old.",
          spouseId,
        },
        { status: 409 },
      );
    }
    const desiredParentEdgeKeys = new Set<string>();
    parentIds.forEach((parentId) =>
      desiredParentEdgeKeys.add(makeParentEdgeKey(parentId, parsed.data.personId)),
    );
    childIds.forEach((childId) =>
      desiredParentEdgeKeys.add(makeParentEdgeKey(parsed.data.personId, childId)),
    );

    const existingParentEdgeKeys = new Set<string>();
    const relationshipRowNumbersToDelete: number[] = [];
    for (const row of existing) {
      const relId = readField(row.data, "rel_id", "relationship_id", "id");
      const relType = readField(row.data, "rel_type");
      const fromPersonId = readField(row.data, "from_person_id");
      const toPersonId = readField(row.data, "to_person_id");
      if (relType.toLowerCase() !== "parent" || !relId) {
        continue;
      }
      const isParentEdge = toPersonId === parsed.data.personId;
      const isChildEdge = fromPersonId === parsed.data.personId;
      if (!isParentEdge && !isChildEdge) {
        continue;
      }
      existingParentEdgeKeys.add(makeParentEdgeKey(fromPersonId, toPersonId));
    }

    debugContext.phase = "prune_existing_relationships";
    for (const row of existing) {
      const relId = readField(row.data, "rel_id", "relationship_id", "id");
      const relType = readField(row.data, "rel_type");
      const fromPersonId = readField(row.data, "from_person_id");
      const toPersonId = readField(row.data, "to_person_id");
      if (relType.toLowerCase() !== "parent" || !relId) {
        continue;
      }

      const isParentEdge = toPersonId === parsed.data.personId;
      const isChildEdge = fromPersonId === parsed.data.personId;
      if (!isParentEdge && !isChildEdge) {
        continue;
      }
      if (desiredParentEdgeKeys.has(makeParentEdgeKey(fromPersonId, toPersonId))) {
        continue;
      }
      relationshipRowNumbersToDelete.push(row.rowNumber);
    }
    if (relationshipRowNumbersToDelete.length > 0) {
      await deleteTableRows("Relationships", relationshipRowNumbersToDelete, normalizedTenantKey);
    }

    debugContext.phase = "upsert_parent_edges";
    const relationsToCreate: Record<string, string>[] = [];
    for (const parentId of parentIds) {
      const edgeKey = makeParentEdgeKey(parentId, parsed.data.personId);
      if (!existingParentEdgeKeys.has(edgeKey)) {
        relationsToCreate.push(relationPayload(normalizedTenantKey, parentId, parsed.data.personId, "parent"));
      }
    }
    debugContext.phase = "upsert_child_edges";
    for (const childId of childIds) {
      const edgeKey = makeParentEdgeKey(parsed.data.personId, childId);
      if (!existingParentEdgeKeys.has(edgeKey)) {
        relationsToCreate.push(relationPayload(normalizedTenantKey, parsed.data.personId, childId, "parent"));
      }
    }
    if (relationsToCreate.length > 0) {
      await createTableRecords("Relationships", relationsToCreate, normalizedTenantKey);
    }

    debugContext.phase = "propagate_lineage_memberships";
    if (parentIds.length > 0) {
      await inheritEnabledGroupsFromPeople(parsed.data.personId, parentIds, enabledGroupsByPerson);
    }
    if (childIds.length > 0) {
      for (const childId of childIds) {
        await inheritEnabledGroupsFromPeople(childId, [parsed.data.personId], enabledGroupsByPerson);
      }
    }

    debugContext.phase = "upsert_spouse_edges";
    const allRelationships = await getTableRecords("Relationships", normalizedTenantKey);
    const spouseRelationshipRowNumbersToDelete: number[] = [];
    const existingSpouseEdgeKeys = new Set<string>();
    for (const row of allRelationships) {
      const relId = readField(row.data, "rel_id", "relationship_id", "id");
      const relType = readField(row.data, "rel_type").toLowerCase();
      const fromPersonId = readField(row.data, "from_person_id");
      const toPersonId = readField(row.data, "to_person_id");
      if (!relId || (relType !== "spouse" && relType !== "family")) {
        continue;
      }
      if (fromPersonId !== parsed.data.personId && toPersonId !== parsed.data.personId) {
        continue;
      }
      const isDesired =
        spouseAction !== "divorce" &&
        spouseId &&
        ((fromPersonId === parsed.data.personId && toPersonId === spouseId) ||
          (toPersonId === parsed.data.personId && fromPersonId === spouseId));
      if (!isDesired) {
        spouseRelationshipRowNumbersToDelete.push(row.rowNumber);
        continue;
      }
      existingSpouseEdgeKeys.add(makeRelationEdgeKey(fromPersonId, toPersonId, relType));
    }
    if (spouseRelationshipRowNumbersToDelete.length > 0) {
      await deleteTableRows("Relationships", spouseRelationshipRowNumbersToDelete, normalizedTenantKey);
    }
    if (spouseAction !== "divorce" && spouseId) {
      const desiredSpouseEdges = [
        relationPayload(normalizedTenantKey, parsed.data.personId, spouseId, "spouse"),
        relationPayload(normalizedTenantKey, spouseId, parsed.data.personId, "spouse"),
        relationPayload(normalizedTenantKey, parsed.data.personId, spouseId, "family"),
        relationPayload(normalizedTenantKey, spouseId, parsed.data.personId, "family"),
      ].filter((payload) => {
        const fromPersonId = payload.from_person_id;
        const toPersonId = payload.to_person_id;
        const relType = payload.rel_type;
        return !existingSpouseEdgeKeys.has(makeRelationEdgeKey(fromPersonId, toPersonId, relType));
      });
      if (desiredSpouseEdges.length > 0) {
        await createTableRecords("Relationships", desiredSpouseEdges, normalizedTenantKey);
      }
    }

    debugContext.phase = "load_households";
    const households = await getTableRecords("Households", normalizedTenantKey);
    const spouseConflict = spouseAction !== "divorce" && spouseId
      ? households.find((row) => {
          const { memberIds } = getHouseholdOccupants(row.data);
          const rowTenantKey = readField(row.data, "family_group_key", "tenant_key") || normalizedTenantKey;
          if (rowTenantKey !== normalizedTenantKey) {
            return false;
          }
          if (!memberIds.includes(spouseId) || memberIds.length < 2) {
            return false;
          }
          return !memberIds.includes(parsed.data.personId);
        })
      : null;

    if (spouseConflict) {
      const partner1 = readField(spouseConflict.data, "husband_person_id");
      const partner2 = readField(spouseConflict.data, "wife_person_id");
      const otherPartner = partner1 === spouseId ? partner2 : partner1;
      return NextResponse.json(
        {
          error: "spouse_unavailable",
          spouseId,
          currentSpouseId: otherPartner || null,
        },
        { status: 409 },
      );
    }

    debugContext.phase = "upsert_household";
    const propagationFamilyGroups = new Set<string>([normalizedTenantKey]);
    const discoveredParentIds = new Set<string>(parentIds);
    for (const row of existing) {
      const relType = readField(row.data, "rel_type").toLowerCase();
      const fromPersonId = readField(row.data, "from_person_id");
      const toPersonId = readField(row.data, "to_person_id");
      if (relType === "parent" && toPersonId === parsed.data.personId && fromPersonId) {
        discoveredParentIds.add(fromPersonId);
      }
    }
    for (const parentId of discoveredParentIds) {
      const parentGroups = enabledGroupsByPerson.get(parentId);
      if (!parentGroups) continue;
      parentGroups.forEach((groupKey) => propagationFamilyGroups.add(groupKey));
    }
    const personGroups = enabledGroupsByPerson.get(parsed.data.personId);
    if (personGroups) {
      personGroups.forEach((groupKey) => propagationFamilyGroups.add(groupKey));
    }
    if (spouseId) {
      const spouseGroups = enabledGroupsByPerson.get(spouseId);
      if (spouseGroups) {
        spouseGroups.forEach((groupKey) => propagationFamilyGroups.add(groupKey));
      }
    }
    if (spouseAction !== "divorce" && spouseId) {
      for (const familyGroupKey of propagationFamilyGroups) {
        await ensurePersonFamilyGroupMembership(parsed.data.personId, familyGroupKey, true);
        await ensurePersonFamilyGroupMembership(spouseId, familyGroupKey, true);
        addEnabledGroup(enabledGroupsByPerson, parsed.data.personId, familyGroupKey);
        addEnabledGroup(enabledGroupsByPerson, spouseId, familyGroupKey);
      }
    }
    const sortedPropagationGroups = Array.from(propagationFamilyGroups).sort((left, right) => {
      if (left === normalizedTenantKey && right !== normalizedTenantKey) return -1;
      if (right === normalizedTenantKey && left !== normalizedTenantKey) return 1;
      return left.localeCompare(right);
    });
    const spouseAccessDisabledGroups = new Set<string>();
    if (!spouseId) {
      for (const familyGroupKey of sortedPropagationGroups) {
        const scopedHouseholds = await getTableRecords("Households", familyGroupKey).catch(() => []);
        const removedHouseholdIds: string[] = [];
        for (const row of scopedHouseholds) {
          const unitId = readField(row.data, "household_id");
          const rowTenantKey = (readField(row.data, "family_group_key", "tenant_key") || familyGroupKey).toLowerCase();
          if (!unitId || rowTenantKey !== familyGroupKey) {
            continue;
          }
          if (!getHouseholdOccupants(row.data).memberIds.includes(parsed.data.personId)) {
            continue;
          }
          removedHouseholdIds.push(unitId);
          await deleteTableRecordById("Households", unitId, "household_id", familyGroupKey);
        }
        await deleteSyncedHouseholdMarriageAttributes(familyGroupKey, removedHouseholdIds);
      }
    } else {
      for (const familyGroupKey of sortedPropagationGroups) {
        const scopedHouseholds = await getTableRecords("Households", familyGroupKey).catch(() => []);
        const rowsForGroup = scopedHouseholds.filter((row) => {
          const rowTenantKey = (readField(row.data, "family_group_key", "tenant_key") || familyGroupKey).toLowerCase();
          return rowTenantKey === familyGroupKey;
        });
        if (spouseAction !== "divorce") {
          const spouseConflictInGroup = rowsForGroup.find((row) => {
            const { memberIds } = getHouseholdOccupants(row.data);
            if (!memberIds.includes(spouseId) || memberIds.length < 2) {
              return false;
            }
            return !memberIds.includes(parsed.data.personId);
          });
          if (spouseConflictInGroup) {
            continue;
          }

          for (const row of rowsForGroup) {
            const unitId = readField(row.data, "household_id");
            const { memberIds } = getHouseholdOccupants(row.data);
            if (!unitId || !memberIds.includes(parsed.data.personId)) {
              continue;
            }
            if (isHouseholdMatchForPair(row.data, parsed.data.personId, spouseId)) {
              continue;
            }
            await deleteTableRecordById("Households", unitId, "household_id", familyGroupKey);
          }

          const hasDesiredUnit = rowsForGroup.some((row) =>
            isHouseholdMatchForPair(row.data, parsed.data.personId, spouseId),
          );
          if (!hasDesiredUnit) {
            await createFamilyUnit(familyGroupKey, parsed.data.personId, spouseId, peopleById);
          }
          continue;
        }

        const directPersonEnabled = (enabledGroupsByPerson.get(parsed.data.personId) ?? new Set<string>()).has(familyGroupKey);
        const pairRows = rowsForGroup.filter((row) => isHouseholdMatchForPair(row.data, parsed.data.personId, spouseId));
        await deleteSyncedHouseholdMarriageAttributes(
          familyGroupKey,
          pairRows.map((row) => readField(row.data, "household_id")).filter(Boolean),
        );
        let targetSingleRow = rowsForGroup.find((row) => isSingleParentHouseholdForPerson(row.data, parsed.data.personId)) ?? null;
        let targetHouseholdId = targetSingleRow ? readField(targetSingleRow.data, "household_id") : "";

        if (directPersonEnabled) {
          if (targetSingleRow) {
            for (const row of pairRows) {
              const sourceHouseholdId = readField(row.data, "household_id");
              if (!sourceHouseholdId || sourceHouseholdId === targetHouseholdId) {
                continue;
              }
              const mergedPayload = mergeHouseholdPayload(targetSingleRow.data, row.data);
              await updateTableRecordById("Households", targetHouseholdId, mergedPayload, "household_id", familyGroupKey);
              await moveHouseholdLinkedRows(familyGroupKey, sourceHouseholdId, targetHouseholdId);
              await deleteTableRecordById("Households", sourceHouseholdId, "household_id", familyGroupKey);
              targetSingleRow = { ...targetSingleRow, data: { ...targetSingleRow.data, ...mergedPayload } };
            }
          } else if (pairRows.length > 0) {
            const [firstPairRow, ...extraPairRows] = pairRows;
            targetHouseholdId = readField(firstPairRow.data, "household_id");
            const payload = buildSingleParentHouseholdPayload(
              familyGroupKey,
              targetHouseholdId,
              parsed.data.personId,
              peopleById,
              firstPairRow.data,
            );
            await updateTableRecordById("Households", targetHouseholdId, payload, "household_id", familyGroupKey);
            targetSingleRow = { ...firstPairRow, data: { ...firstPairRow.data, ...payload } };
            for (const row of extraPairRows) {
              const sourceHouseholdId = readField(row.data, "household_id");
              if (!sourceHouseholdId || sourceHouseholdId === targetHouseholdId) {
                continue;
              }
              await moveHouseholdLinkedRows(familyGroupKey, sourceHouseholdId, targetHouseholdId);
              await deleteTableRecordById("Households", sourceHouseholdId, "household_id", familyGroupKey);
            }
          } else {
            targetHouseholdId = makeSingleParentFamilyUnitId(familyGroupKey, parsed.data.personId);
            const existingTarget = rowsForGroup.find((row) => readField(row.data, "household_id") === targetHouseholdId);
            const payload = buildSingleParentHouseholdPayload(
              familyGroupKey,
              targetHouseholdId,
              parsed.data.personId,
              peopleById,
              existingTarget?.data,
            );
            if (existingTarget) {
              await updateTableRecordById("Households", targetHouseholdId, payload, "household_id", familyGroupKey);
            } else {
              await createTableRecord("Households", payload, familyGroupKey);
            }
          }
        } else {
          for (const row of pairRows) {
            const sourceHouseholdId = readField(row.data, "household_id");
            if (!sourceHouseholdId) {
              continue;
            }
            await deleteTableRecordById("Households", sourceHouseholdId, "household_id", familyGroupKey);
          }
        }

        const relationshipsForGroup = await getTableRecords("Relationships", familyGroupKey).catch(() => []);
        const expectedTypes = deriveExpectedFamilyGroupRelationshipTypes({
          familyGroupKey,
          relationships: relationshipsForGroup.map((row) => toRelationshipLike(row.data)),
          memberships: personFamilyRows.map((row) => toMembershipLike(row.data)),
        });
        if ((enabledGroupsByPerson.get(spouseId) ?? new Set<string>()).has(familyGroupKey) && expectedTypes.get(spouseId) === "undeclared") {
          await ensurePersonFamilyGroupMembership(spouseId, familyGroupKey, false);
          removeEnabledGroup(enabledGroupsByPerson, spouseId, familyGroupKey);
          spouseAccessDisabledGroups.add(familyGroupKey);
          const existingUserFamilyRow = userFamilyRows.find(
            (row) =>
              readField(row.data, "person_id") === spouseId &&
              (readField(row.data, "family_group_key", "tenant_key") || "").trim().toLowerCase() === familyGroupKey,
          );
          if (existingUserFamilyRow) {
            await upsertOciUserFamilyGroupAccess({
              userEmail: readField(existingUserFamilyRow.data, "user_email").toLowerCase(),
              tenantKey: familyGroupKey,
              tenantName: readField(existingUserFamilyRow.data, "family_group_name") || familyGroupKey,
              role: readField(existingUserFamilyRow.data, "role") || "USER",
              personId: spouseId,
              isEnabled: false,
            });
            removeEnabledGroup(enabledUserFamilyGroupsByPerson, spouseId, familyGroupKey);
          }
        }
      }
    }
    if (spouseAction === "divorce" && spouseId && (enabledUserFamilyGroupsByPerson.get(spouseId)?.size ?? 0) === 0) {
      await updateTableRecordById("UserAccess", spouseId, { is_enabled: "FALSE" }, "person_id");
    }

    debugContext.phase = "reconcile_relationship_types";
    const finalRelationships = await getTableRecords("Relationships", normalizedTenantKey);
    const affectedPersonIds = new Set<string>([
      parsed.data.personId,
      ...parentIds,
      ...childIds,
    ]);
    if (spouseId) {
      affectedPersonIds.add(spouseId);
    }
    for (const row of existing) {
      const relType = readField(row.data, "rel_type").toLowerCase();
      if (relType !== "parent" && relType !== "spouse" && relType !== "family") {
        continue;
      }
      const fromPersonId = readField(row.data, "from_person_id");
      const toPersonId = readField(row.data, "to_person_id");
      if (fromPersonId === parsed.data.personId && toPersonId) {
        affectedPersonIds.add(toPersonId);
      }
      if (toPersonId === parsed.data.personId && fromPersonId) {
        affectedPersonIds.add(fromPersonId);
      }
    }
    for (const row of finalRelationships) {
      const relType = readField(row.data, "rel_type").toLowerCase();
      if (relType !== "parent" && relType !== "spouse" && relType !== "family") {
        continue;
      }
      const fromPersonId = readField(row.data, "from_person_id");
      const toPersonId = readField(row.data, "to_person_id");
      if (fromPersonId === parsed.data.personId && toPersonId) {
        affectedPersonIds.add(toPersonId);
      }
      if (toPersonId === parsed.data.personId && fromPersonId) {
        affectedPersonIds.add(fromPersonId);
      }
    }
    const affectedFamilyGroups = new Set<string>([normalizedTenantKey]);
    for (const affectedPersonId of affectedPersonIds) {
      const groups = enabledGroupsByPerson.get(affectedPersonId);
      if (!groups) continue;
      groups.forEach((groupKey) => affectedFamilyGroups.add(groupKey));
    }
    spouseAccessDisabledGroups.forEach((groupKey) => affectedFamilyGroups.add(groupKey));
    for (const familyGroupKey of affectedFamilyGroups) {
      await reconcileFamilyGroupRelationshipTypes(familyGroupKey);
    }

    debugContext.phase = "done";
    return NextResponse.json({
      ok: true,
      personId: parsed.data.personId,
      parentCount: parentIds.length,
      childCount: childIds.length,
      spouseId: spouseAction === "divorce" ? null : spouseId || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    const lower = message.toLowerCase();
    const isQuota = lower.includes("quota") || lower.includes("rate limit") || lower.includes("read requests per minute");
    return NextResponse.json(
      {
        error: isQuota ? "relationship_save_quota_exceeded" : "relationship_save_failed",
        message,
        debug: debugContext,
        hint: isQuota ? "Close the workbook if open, wait 60-90 seconds, and retry." : undefined,
      },
      { status: isQuota ? 429 : 500 },
    );
  }
}
