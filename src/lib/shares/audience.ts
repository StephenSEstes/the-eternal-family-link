import "server-only";

import { getPeople, getTableRecords } from "@/lib/data/runtime";
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

function pushDistinct(set: Set<string>, value: string) {
  const normalized = value.trim();
  if (normalized) {
    set.add(normalized);
  }
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
    for (const row of householdRows) {
      const husbandId = readCell(row.data, "husband_person_id");
      const wifeId = readCell(row.data, "wife_person_id");
      const members = new Set<string>();
      pushDistinct(members, husbandId);
      pushDistinct(members, wifeId);
      const parentIds = [husbandId, wifeId].map((entry) => entry.trim()).filter(Boolean);
      for (const parentId of parentIds) {
        const children = parentToChildren.get(parentId) ?? new Set<string>();
        for (const childId of children) {
          members.add(childId);
        }
      }
      if (members.has(actorPersonId)) {
        for (const personId of members) {
          if (peopleById.has(personId)) {
            recipientIds.add(personId);
          }
        }
      }
    }
    audienceKey = `household:${actorPersonId}`;
    audienceLabel = "My Household";
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
