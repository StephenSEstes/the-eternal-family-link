import "server-only";

import { deleteAttribute } from "@/lib/attributes/store";
import { getTableRecords, setPersonFamilyGroupRelationshipType } from "@/lib/data/runtime";

export const FAMILY_GROUP_RELATIONSHIP_TYPES = ["founder", "direct", "in_law", "undeclared"] as const;

export type FamilyGroupRelationshipType = (typeof FAMILY_GROUP_RELATIONSHIP_TYPES)[number];

type RelationshipLike = {
  relType: string;
  fromPersonId: string;
  toPersonId: string;
};

type MembershipLike = {
  personId: string;
  familyGroupKey: string;
  isEnabled: string;
  familyGroupRelationshipType: string;
};

type LegacyInLawAttributeLike = {
  attributeId: string;
  entityType: string;
  entityId: string;
  attributeType: string;
};

type FamilyGroupRelationshipTypeAuditCounts = {
  checkedPeople: number;
  founderCount: number;
  mismatchedPeople: number;
  invalidMembershipRows: number;
  founderOverflowPeople: number;
  legacyAttributeRows: number;
  createdRows: number;
  updatedRows: number;
  deletedRows: number;
};

type FamilyGroupRelationshipTypeAuditResult = {
  ok: true;
  familyGroupKey: string;
  mode: "audit" | "repair";
  counts: FamilyGroupRelationshipTypeAuditCounts;
  samplePeople: {
    mismatched: string[];
    invalidMembership: string[];
    founderOverflow: string[];
    legacyAttributes: string[];
  };
};

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

export function parseFamilyGroupRelationshipType(value: string | undefined): FamilyGroupRelationshipType | null {
  const normalized = normalize(value);
  if (normalized === "founder" || normalized === "direct" || normalized === "in_law" || normalized === "undeclared") {
    return normalized;
  }
  return null;
}

export function normalizeFamilyGroupRelationshipType(value: string | undefined): FamilyGroupRelationshipType {
  return parseFamilyGroupRelationshipType(value) ?? "undeclared";
}

export function isFounderFamilyGroupRelationshipType(value: string | undefined) {
  return normalizeFamilyGroupRelationshipType(value) === "founder";
}

export function isAnchorFamilyGroupRelationshipType(value: string | undefined) {
  const normalized = normalizeFamilyGroupRelationshipType(value);
  return normalized === "founder" || normalized === "direct";
}

export function isTreePlacedFamilyGroupRelationshipType(value: string | undefined) {
  return normalizeFamilyGroupRelationshipType(value) !== "undeclared";
}

export function isLegacyInLawAttributeType(value: string | undefined) {
  return normalize(value) === "in_law";
}

export function toRelationshipLike(record: Record<string, string>): RelationshipLike {
  return {
    relType: readField(record, "rel_type"),
    fromPersonId: readField(record, "from_person_id"),
    toPersonId: readField(record, "to_person_id"),
  };
}

function toMembershipLike(record: Record<string, string>): MembershipLike {
  return {
    personId: readField(record, "person_id"),
    familyGroupKey: readField(record, "family_group_key"),
    isEnabled: readField(record, "is_enabled"),
    familyGroupRelationshipType: readField(
      record,
      "family_group_relationship_type",
      "relationship_type",
    ),
  };
}

export function deriveExpectedFamilyGroupRelationshipTypes(input: {
  familyGroupKey: string;
  relationships: RelationshipLike[];
  memberships: MembershipLike[];
}) {
  const familyGroupKey = normalize(input.familyGroupKey);
  const enabledMemberships = input.memberships.filter(
    (row) => normalize(row.familyGroupKey) === familyGroupKey && isEnabledLike(row.isEnabled) && row.personId.trim(),
  );

  const memberIds = new Set(enabledMemberships.map((row) => row.personId.trim()));
  const expected = new Map<string, FamilyGroupRelationshipType>();
  const founders = Array.from(
    new Set(
      enabledMemberships
        .filter((row) => isFounderFamilyGroupRelationshipType(row.familyGroupRelationshipType))
        .map((row) => row.personId.trim()),
    ),
  );

  founders.forEach((personId) => expected.set(personId, "founder"));

  const parentEdgesByParent = new Map<string, Set<string>>();
  for (const relationship of input.relationships) {
    const relType = normalize(relationship.relType);
    const parentId = relationship.fromPersonId.trim();
    const childId = relationship.toPersonId.trim();
    if (relType !== "parent" || !parentId || !childId || !memberIds.has(childId) || !memberIds.has(parentId)) {
      continue;
    }
    const children = parentEdgesByParent.get(parentId) ?? new Set<string>();
    children.add(childId);
    parentEdgesByParent.set(parentId, children);
  }

  const queue = founders.slice();
  while (queue.length > 0) {
    const currentPersonId = queue.shift();
    if (!currentPersonId) continue;
    const children = Array.from(parentEdgesByParent.get(currentPersonId) ?? []);
    for (const childId of children) {
      if (expected.get(childId) === "founder" || expected.get(childId) === "direct") {
        continue;
      }
      expected.set(childId, "direct");
      queue.push(childId);
    }
  }

  for (const personId of memberIds) {
    if (expected.has(personId)) {
      continue;
    }
    const shouldBeInLaw = input.relationships.some((relationship) => {
      const relType = normalize(relationship.relType);
      if (relType !== "spouse" && relType !== "family") {
        return false;
      }
      const fromPersonId = relationship.fromPersonId.trim();
      const toPersonId = relationship.toPersonId.trim();
      if (!fromPersonId || !toPersonId || !memberIds.has(fromPersonId) || !memberIds.has(toPersonId)) {
        return false;
      }
      if (fromPersonId !== personId && toPersonId !== personId) {
        return false;
      }
      const relatedPersonId = fromPersonId === personId ? toPersonId : fromPersonId;
      return isAnchorFamilyGroupRelationshipType(expected.get(relatedPersonId));
    });
    expected.set(personId, shouldBeInLaw ? "in_law" : "undeclared");
  }

  return expected;
}

async function deleteLegacyInLawAttributes(
  familyGroupKey: string,
  attributes: LegacyInLawAttributeLike[],
) {
  let deletedRows = 0;
  for (const attribute of attributes) {
    if (await deleteAttribute(familyGroupKey, attribute.attributeId)) {
      deletedRows += 1;
    }
  }
  return deletedRows;
}

export async function auditOrRepairFamilyGroupRelationshipTypes(
  familyGroupKey: string,
  applyChanges: boolean,
): Promise<FamilyGroupRelationshipTypeAuditResult> {
  const normalizedFamilyGroupKey = normalize(familyGroupKey);
  const [relationshipRows, attributeRows, membershipRows] = await Promise.all([
    getTableRecords("Relationships").catch(() => []),
    getTableRecords("Attributes", familyGroupKey).catch(() => []),
    getTableRecords("PersonFamilyGroups").catch(() => []),
  ]);

  const relationships = relationshipRows.map((row) => toRelationshipLike(row.data));
  const memberships = membershipRows.map((row) => toMembershipLike(row.data));
  const enabledMemberships = memberships.filter(
    (row) => normalize(row.familyGroupKey) === normalizedFamilyGroupKey && isEnabledLike(row.isEnabled) && row.personId.trim(),
  );
  const expectedByPersonId = deriveExpectedFamilyGroupRelationshipTypes({
    familyGroupKey,
    relationships,
    memberships,
  });

  const legacyInLawAttributes = attributeRows
    .map((row) => ({
      attributeId: readField(row.data, "attribute_id"),
      entityType: readField(row.data, "entity_type"),
      entityId: readField(row.data, "entity_id", "person_id"),
      attributeType: readField(row.data, "attribute_type", "type_key"),
    }))
    .filter(
      (row) =>
        normalize(row.entityType) === "person" &&
        row.entityId.trim() &&
        isLegacyInLawAttributeType(row.attributeType),
    );

  const mismatched: string[] = [];
  const invalidMembership: string[] = [];
  const founderOverflow = Array.from(
    new Set(
      enabledMemberships
        .filter((row) => isFounderFamilyGroupRelationshipType(row.familyGroupRelationshipType))
        .map((row) => row.personId.trim()),
    ),
  );
  const legacyAttributes = Array.from(new Set(legacyInLawAttributes.map((row) => row.entityId.trim())));

  let invalidMembershipRows = 0;
  let mismatchedPeople = 0;
  let createdRows = 0;
  let updatedRows = 0;
  let deletedRows = 0;

  for (const membership of enabledMemberships) {
    const personId = membership.personId.trim();
    if (!personId) continue;
    const rawType = membership.familyGroupRelationshipType.trim();
    const parsedType = parseFamilyGroupRelationshipType(rawType);
    const expectedType = expectedByPersonId.get(personId) ?? "undeclared";
    const hasMismatch = parsedType !== expectedType;
    if (hasMismatch) {
      mismatchedPeople += 1;
      mismatched.push(personId);
    }
    if (rawType && !parsedType) {
      invalidMembershipRows += 1;
      invalidMembership.push(personId);
    }
    if (applyChanges && hasMismatch) {
      const action = await setPersonFamilyGroupRelationshipType(personId, familyGroupKey, expectedType);
      if (action === "created") createdRows += 1;
      if (action === "updated") updatedRows += 1;
    }
  }

  if (applyChanges && legacyInLawAttributes.length > 0) {
    deletedRows += await deleteLegacyInLawAttributes(familyGroupKey, legacyInLawAttributes);
  }

  return {
    ok: true,
    familyGroupKey,
    mode: applyChanges ? "repair" : "audit",
    counts: {
      checkedPeople: enabledMemberships.length,
      founderCount: founderOverflow.length,
      mismatchedPeople,
      invalidMembershipRows,
      founderOverflowPeople: founderOverflow.length > 2 ? founderOverflow.length - 2 : 0,
      legacyAttributeRows: legacyInLawAttributes.length,
      createdRows,
      updatedRows,
      deletedRows,
    },
    samplePeople: {
      mismatched: mismatched.slice(0, 25),
      invalidMembership: invalidMembership.slice(0, 25),
      founderOverflow: founderOverflow.slice(2, 27),
      legacyAttributes: legacyAttributes.slice(0, 25),
    },
  };
}

export async function reconcileFamilyGroupRelationshipTypes(familyGroupKey: string) {
  return auditOrRepairFamilyGroupRelationshipTypes(familyGroupKey, true);
}
