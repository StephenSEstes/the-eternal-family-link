import "server-only";

import { getPeople, getTableRecords, getTenantUserAccessList } from "@/lib/data/runtime";
import { getOciHouseholdsForTenant } from "@/lib/oci/tables";

export type ShareAudienceType = "siblings" | "household" | "entire_family" | "family_group";

export type ShareAudienceResolution = {
  familyGroupKey: string;
  audienceType: ShareAudienceType;
  audienceKey: string;
  audienceLabel: string;
  recipients: Array<{ personId: string; displayName: string }>;
};

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function readCell(row: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export async function resolveShareAudience(input: {
  tenantKey: string;
  audienceType: ShareAudienceType;
  actorPersonId: string;
  targetFamilyGroupKey?: string;
  allowedFamilyGroupKeys?: string[];
}): Promise<ShareAudienceResolution> {
  const baseTenantKey = normalize(input.tenantKey);
  const actorPersonId = input.actorPersonId.trim();
  if (!baseTenantKey || !actorPersonId) {
    throw new Error("tenantKey and actorPersonId are required");
  }

  const allowedFamilyGroupKeys = new Set(
    (input.allowedFamilyGroupKeys ?? [])
      .map((entry) => normalize(entry))
      .filter(Boolean),
  );
  allowedFamilyGroupKeys.add(baseTenantKey);

  const resolvedFamilyGroupKey =
    input.audienceType === "family_group"
      ? normalize(input.targetFamilyGroupKey) || baseTenantKey
      : baseTenantKey;
  if (!allowedFamilyGroupKeys.has(resolvedFamilyGroupKey)) {
    throw new Error("target_family_group_not_allowed");
  }

  const people = await getPeople(resolvedFamilyGroupKey);
  const peopleById = new Map(
    people
      .map((person) => [person.personId.trim(), person.displayName.trim() || person.personId.trim()] as const)
      .filter(([personId]) => Boolean(personId)),
  );
  if (!peopleById.has(actorPersonId)) {
    throw new Error("actor_not_in_family_group");
  }

  const relationshipsRows = await getTableRecords("Relationships").catch(() => []);
  const parentToChildren = new Map<string, Set<string>>();
  const childToParents = new Map<string, Set<string>>();
  for (const row of relationshipsRows) {
    const fromPersonId = readCell(row.data, "from_person_id");
    const toPersonId = readCell(row.data, "to_person_id");
    const relType = normalize(readCell(row.data, "rel_type"));
    if (relType !== "parent") continue;
    if (!peopleById.has(fromPersonId) || !peopleById.has(toPersonId)) continue;
    if (!parentToChildren.has(fromPersonId)) parentToChildren.set(fromPersonId, new Set());
    if (!childToParents.has(toPersonId)) childToParents.set(toPersonId, new Set());
    parentToChildren.get(fromPersonId)!.add(toPersonId);
    childToParents.get(toPersonId)!.add(fromPersonId);
  }

  const recipientIds = new Set<string>();
  recipientIds.add(actorPersonId);
  let audienceKey = "";
  let audienceLabel = "";

  if (input.audienceType === "entire_family" || input.audienceType === "family_group") {
    for (const personId of peopleById.keys()) {
      recipientIds.add(personId);
    }
    audienceKey = `family_group:${resolvedFamilyGroupKey}`;
    audienceLabel = input.audienceType === "entire_family" ? "Entire Family" : `Family Group (${resolvedFamilyGroupKey})`;
  }

  if (input.audienceType === "siblings") {
    const parentIds = childToParents.get(actorPersonId) ?? new Set<string>();
    for (const parentId of parentIds) {
      const children = parentToChildren.get(parentId) ?? new Set<string>();
      for (const childId of children) {
        recipientIds.add(childId);
      }
    }
    audienceKey = `siblings:${actorPersonId}`;
    audienceLabel = "My Siblings";
  }

  if (input.audienceType === "household") {
    const householdRows = await getOciHouseholdsForTenant(resolvedFamilyGroupKey).catch(() => []);
    const spouseIds = new Set<string>();
    for (const row of householdRows) {
      const husbandId = readCell(row.data, "husband_person_id");
      const wifeId = readCell(row.data, "wife_person_id");
      if (actorPersonId === husbandId && wifeId && peopleById.has(wifeId)) {
        spouseIds.add(wifeId);
      }
      if (actorPersonId === wifeId && husbandId && peopleById.has(husbandId)) {
        spouseIds.add(husbandId);
      }
    }
    for (const spouseId of spouseIds) {
      recipientIds.add(spouseId);
    }

    const childCandidates = new Set<string>();
    for (const childId of parentToChildren.get(actorPersonId) ?? []) {
      if (peopleById.has(childId)) {
        childCandidates.add(childId);
      }
    }
    for (const spouseId of spouseIds) {
      for (const childId of parentToChildren.get(spouseId) ?? []) {
        if (peopleById.has(childId)) {
          childCandidates.add(childId);
        }
      }
    }

    const tenantUserAccessRows = await getTenantUserAccessList(resolvedFamilyGroupKey).catch(() => []);
    const enabledUserPersonIds = new Set(
      tenantUserAccessRows
        .filter((entry) => entry.isEnabled)
        .map((entry) => String(entry.personId ?? "").trim())
        .filter(Boolean),
    );
    const userChildren = Array.from(childCandidates).filter((personId) => enabledUserPersonIds.has(personId));

    if (userChildren.length > 0) {
      for (const childId of userChildren) {
        recipientIds.add(childId);
      }
    } else {
      const parentIds = childToParents.get(actorPersonId) ?? new Set<string>();
      for (const parentId of parentIds) {
        if (peopleById.has(parentId)) {
          recipientIds.add(parentId);
        }
        const siblings = parentToChildren.get(parentId) ?? new Set<string>();
        for (const siblingId of siblings) {
          if (peopleById.has(siblingId)) {
            recipientIds.add(siblingId);
          }
        }
      }
    }
    audienceKey = `household:${actorPersonId}`;
    audienceLabel = "Immediate Family";
  }

  const recipients = Array.from(recipientIds)
    .filter((personId) => peopleById.has(personId))
    .map((personId) => ({
      personId,
      displayName: peopleById.get(personId) ?? personId,
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));

  return {
    familyGroupKey: resolvedFamilyGroupKey,
    audienceType: input.audienceType,
    audienceKey,
    audienceLabel,
    recipients,
  };
}
