import "server-only";

import oracledb from "oracledb";
import { withConnection } from "@/lib/oci/client";
import {
  RELATIONSHIP_CATEGORIES,
  RELATIONSHIP_LABELS,
  type LineageSide,
  type RelationshipCategory,
  type RelationshipHit,
} from "@/lib/model/relationships";

const OUT_FORMAT = { outFormat: oracledb.OUT_FORMAT_OBJECT };

export const CATEGORY_ORDER = RELATIONSHIP_CATEGORIES;
export const CATEGORY_LABELS = RELATIONSHIP_LABELS;
export type { LineageSide, RelationshipCategory, RelationshipHit };

type UserLoginRow = {
  personId: string;
  username: string;
  userEmail: string;
  passwordHash: string;
};

export type PersonLite = {
  personId: string;
  displayName: string;
  gender: string;
  birthDate: string;
};

export type RelationshipLite = {
  fromPersonId: string;
  toPersonId: string;
  relType: string;
};

export type HouseholdLite = {
  householdId: string;
  husbandPersonId: string;
  wifePersonId: string;
  label: string;
};

export type FamilyGraph = {
  peopleById: Map<string, PersonLite>;
  parentsByChild: Map<string, Set<string>>;
  childrenByParent: Map<string, Set<string>>;
  spousesByPerson: Map<string, Set<string>>;
};

export type FamilyBucketPerson = PersonLite & {
  lineageSides: LineageSide[];
};

export type TreeLabSnapshot = {
  viewer: PersonLite;
  buckets: Record<RelationshipCategory, FamilyBucketPerson[]>;
  people: PersonLite[];
  relationships: RelationshipLite[];
  households: HouseholdLite[];
  peopleCount: number;
  relationshipCount: number;
  relatedCount: number;
};

export type RelatedFamilyPerson = PersonLite & {
  relationships: RelationshipHit[];
};

function normalize(value?: string) {
  return String(value ?? "").trim();
}

function normalizeLower(value?: string) {
  return normalize(value).toLowerCase();
}

function getCell(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function addSetValue(map: Map<string, Set<string>>, key: string, value: string) {
  if (!key || !value) return;
  const current = map.get(key);
  if (current) {
    current.add(value);
    return;
  }
  map.set(key, new Set([value]));
}

function isParentEdge(rel: RelationshipLite) {
  return normalizeLower(rel.relType) === "parent";
}

function isSpouseEdge(rel: RelationshipLite) {
  const type = normalizeLower(rel.relType);
  return type === "spouse" || type === "family";
}

export function buildFamilyGraph(people: PersonLite[], relationships: RelationshipLite[]): FamilyGraph {
  const peopleById = new Map<string, PersonLite>();
  for (const person of people) {
    const personId = normalize(person.personId);
    if (!personId || peopleById.has(personId)) continue;
    peopleById.set(personId, person);
  }

  const parentsByChild = new Map<string, Set<string>>();
  const childrenByParent = new Map<string, Set<string>>();
  const spousesByPerson = new Map<string, Set<string>>();

  for (const relationship of relationships) {
    const fromPersonId = normalize(relationship.fromPersonId);
    const toPersonId = normalize(relationship.toPersonId);
    if (!fromPersonId || !toPersonId) continue;
    if (isParentEdge(relationship)) {
      addSetValue(parentsByChild, toPersonId, fromPersonId);
      addSetValue(childrenByParent, fromPersonId, toPersonId);
      continue;
    }
    if (isSpouseEdge(relationship)) {
      addSetValue(spousesByPerson, fromPersonId, toPersonId);
      addSetValue(spousesByPerson, toPersonId, fromPersonId);
    }
  }

  return { peopleById, parentsByChild, childrenByParent, spousesByPerson };
}

function parentLineageSide(person: PersonLite | null): LineageSide {
  const gender = normalizeLower(person?.gender);
  if (gender === "female") return "maternal";
  if (gender === "male") return "paternal";
  return "both";
}

function addHit(
  hits: Map<string, Map<RelationshipCategory, Set<LineageSide>>>,
  targetPersonId: string,
  category: RelationshipCategory,
  side: LineageSide,
) {
  const target = normalize(targetPersonId);
  if (!target) return;
  const byCategory = hits.get(target) ?? new Map<RelationshipCategory, Set<LineageSide>>();
  const sides = byCategory.get(category) ?? new Set<LineageSide>();
  sides.add(side);
  byCategory.set(category, sides);
  hits.set(target, byCategory);
}

export function computeRelativeHitsForViewer(viewerPersonId: string, graph: FamilyGraph) {
  const viewerId = normalize(viewerPersonId);
  const hits = new Map<string, Map<RelationshipCategory, Set<LineageSide>>>();
  if (!viewerId) return hits;

  addHit(hits, viewerId, "self", "not_applicable");
  const viewerSpouseIds = graph.spousesByPerson.get(viewerId) ?? new Set<string>();

  const parentSideMap = new Map<string, Set<LineageSide>>();
  for (const parentId of graph.parentsByChild.get(viewerId) ?? []) {
    const side = parentLineageSide(graph.peopleById.get(parentId) ?? null);
    const sides = parentSideMap.get(parentId) ?? new Set<LineageSide>();
    sides.add(side);
    parentSideMap.set(parentId, sides);
    for (const sideValue of sides) addHit(hits, parentId, "parents", sideValue);
  }

  for (const spouseId of viewerSpouseIds) {
    addHit(hits, spouseId, "spouse", "not_applicable");
  }

  for (const spouseId of viewerSpouseIds) {
    for (const parentId of graph.parentsByChild.get(spouseId) ?? []) {
      const side = parentLineageSide(graph.peopleById.get(parentId) ?? null);
      addHit(hits, parentId, "parents_in_law", side);
      for (const grandparentId of graph.parentsByChild.get(parentId) ?? []) {
        addHit(hits, grandparentId, "grandparents_in_law", side);
      }
      for (const siblingInLawId of graph.childrenByParent.get(parentId) ?? []) {
        if (siblingInLawId === spouseId || siblingInLawId === viewerId) continue;
        addHit(hits, siblingInLawId, "siblings_in_law", side);
      }
    }
  }

  const childIds = new Set<string>();
  for (const childId of graph.childrenByParent.get(viewerId) ?? []) {
    childIds.add(childId);
    addHit(hits, childId, "children", "not_applicable");
  }

  for (const childId of childIds) {
    for (const childInLawId of graph.spousesByPerson.get(childId) ?? []) {
      if (childInLawId === viewerId) continue;
      addHit(hits, childInLawId, "children_in_law", "not_applicable");
    }
  }

  const siblingSideMap = new Map<string, Set<LineageSide>>();
  for (const [parentId, sides] of parentSideMap.entries()) {
    for (const siblingId of graph.childrenByParent.get(parentId) ?? []) {
      if (siblingId === viewerId) continue;
      const set = siblingSideMap.get(siblingId) ?? new Set<LineageSide>();
      for (const side of sides) set.add(side);
      siblingSideMap.set(siblingId, set);
    }
  }
  for (const [siblingId, sides] of siblingSideMap.entries()) {
    for (const side of sides) addHit(hits, siblingId, "siblings", side);
  }

  for (const [siblingId, sides] of siblingSideMap.entries()) {
    for (const siblingInLawId of graph.spousesByPerson.get(siblingId) ?? []) {
      if (siblingInLawId === viewerId) continue;
      for (const side of sides) addHit(hits, siblingInLawId, "siblings_in_law", side);
    }
  }

  const grandparentSideMap = new Map<string, Set<LineageSide>>();
  for (const [parentId, sides] of parentSideMap.entries()) {
    for (const grandparentId of graph.parentsByChild.get(parentId) ?? []) {
      const set = grandparentSideMap.get(grandparentId) ?? new Set<LineageSide>();
      for (const side of sides) set.add(side);
      grandparentSideMap.set(grandparentId, set);
    }
  }
  for (const [grandparentId, sides] of grandparentSideMap.entries()) {
    for (const side of sides) addHit(hits, grandparentId, "grandparents", side);
  }

  const auntUncleSideMap = new Map<string, Set<LineageSide>>();
  for (const [parentId, sides] of parentSideMap.entries()) {
    for (const grandparentId of graph.parentsByChild.get(parentId) ?? []) {
      for (const auntUncleId of graph.childrenByParent.get(grandparentId) ?? []) {
        if (auntUncleId === parentId) continue;
        const set = auntUncleSideMap.get(auntUncleId) ?? new Set<LineageSide>();
        for (const side of sides) set.add(side);
        auntUncleSideMap.set(auntUncleId, set);
      }
    }
  }
  for (const [auntUncleId, sides] of auntUncleSideMap.entries()) {
    for (const side of sides) addHit(hits, auntUncleId, "aunts_uncles", side);
  }

  const cousinSideMap = new Map<string, Set<LineageSide>>();
  for (const [auntUncleId, sides] of auntUncleSideMap.entries()) {
    for (const cousinId of graph.childrenByParent.get(auntUncleId) ?? []) {
      const set = cousinSideMap.get(cousinId) ?? new Set<LineageSide>();
      for (const side of sides) set.add(side);
      cousinSideMap.set(cousinId, set);
    }
  }
  for (const [cousinId, sides] of cousinSideMap.entries()) {
    for (const side of sides) addHit(hits, cousinId, "cousins", side);
  }

  for (const [cousinId, sides] of cousinSideMap.entries()) {
    for (const cousinChildId of graph.childrenByParent.get(cousinId) ?? []) {
      for (const side of sides) addHit(hits, cousinChildId, "cousins_children", side);
    }
  }

  const nieceNephewIds = new Set<string>();
  const nieceNephewSideMap = new Map<string, Set<LineageSide>>();
  for (const [siblingId, sides] of siblingSideMap.entries()) {
    for (const nieceNephewId of graph.childrenByParent.get(siblingId) ?? []) {
      nieceNephewIds.add(nieceNephewId);
      const set = nieceNephewSideMap.get(nieceNephewId) ?? new Set<LineageSide>();
      for (const side of sides) {
        set.add(side);
        addHit(hits, nieceNephewId, "nieces_nephews", side);
      }
      nieceNephewSideMap.set(nieceNephewId, set);
    }
  }

  for (const nieceNephewId of nieceNephewIds) {
    for (const inLawId of graph.spousesByPerson.get(nieceNephewId) ?? []) {
      if (inLawId === viewerId) continue;
      for (const side of nieceNephewSideMap.get(nieceNephewId) ?? []) {
        addHit(hits, inLawId, "nieces_nephews_in_law", side);
      }
    }
  }

  const grandchildren = new Set<string>();
  for (const childId of childIds) {
    for (const grandchildId of graph.childrenByParent.get(childId) ?? []) {
      grandchildren.add(grandchildId);
      addHit(hits, grandchildId, "grandchildren", "not_applicable");
    }
  }

  return hits;
}

function emptyBuckets(): Record<RelationshipCategory, FamilyBucketPerson[]> {
  return {
    self: [],
    spouse: [],
    parents: [],
    parents_in_law: [],
    grandparents: [],
    grandparents_in_law: [],
    children: [],
    children_in_law: [],
    grandchildren: [],
    siblings: [],
    siblings_in_law: [],
    aunts_uncles: [],
    nieces_nephews: [],
    nieces_nephews_in_law: [],
    cousins: [],
    cousins_children: [],
  };
}

function comparePeople(left: FamilyBucketPerson, right: FamilyBucketPerson) {
  return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" });
}

function compareRelatedPeople(left: RelatedFamilyPerson, right: RelatedFamilyPerson) {
  return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" });
}

const LINEAGE_ORDER: LineageSide[] = ["not_applicable", "both", "maternal", "paternal"];

export function serializeRelationshipHitMap(
  categories?: Map<RelationshipCategory, Set<LineageSide>>,
): RelationshipHit[] {
  if (!categories) return [];

  return CATEGORY_ORDER.flatMap((category) => {
    const sides = categories.get(category);
    if (!sides || !sides.size) return [];
    const orderedSides = LINEAGE_ORDER.filter((side) => sides.has(side));
    return [
      {
        category,
        lineageSides: orderedSides,
      },
    ];
  });
}

export async function listLocalUsersByUsername(username: string): Promise<UserLoginRow[]> {
  const normalized = normalizeLower(username);
  if (!normalized) return [];

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT person_id, username, user_email, password_hash
         FROM user_access
        WHERE LOWER(TRIM(username)) = :username
          AND (LOWER(TRIM(NVL(local_access, 'TRUE'))) IN ('y','yes','true','1'))
          AND (LOWER(TRIM(NVL(is_enabled, 'TRUE'))) IN ('y','yes','true','1'))
          AND TRIM(password_hash) IS NOT NULL
        ORDER BY person_id`,
      { username: normalized },
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      personId: getCell(row, "PERSON_ID"),
      username: getCell(row, "USERNAME"),
      userEmail: getCell(row, "USER_EMAIL"),
      passwordHash: getCell(row, "PASSWORD_HASH"),
    }));
  });
}

export async function resolveLocalUserByCredentials(
  username: string,
  verify: (passwordHash: string) => boolean,
): Promise<UserLoginRow | null> {
  const rows = await listLocalUsersByUsername(username);
  for (const row of rows) {
    if (verify(row.passwordHash)) {
      return row;
    }
  }
  return null;
}

export async function listPeopleLite(): Promise<PersonLite[]> {
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT person_id,
              COALESCE(NULLIF(TRIM(display_name), ''), TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), person_id) AS display_name,
              LOWER(TRIM(NVL(gender, ''))) AS gender,
              TRIM(NVL(birth_date, '')) AS birth_date
         FROM people
        WHERE TRIM(person_id) IS NOT NULL
        ORDER BY display_name`,
      {},
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      personId: getCell(row, "PERSON_ID"),
      displayName: getCell(row, "DISPLAY_NAME"),
      gender: getCell(row, "GENDER"),
      birthDate: getCell(row, "BIRTH_DATE"),
    }));
  });
}

export async function listRelationshipsLite(): Promise<RelationshipLite[]> {
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT from_person_id, to_person_id, LOWER(TRIM(rel_type)) AS rel_type
         FROM relationships
        WHERE TRIM(from_person_id) IS NOT NULL
          AND TRIM(to_person_id) IS NOT NULL
          AND TRIM(rel_type) IS NOT NULL`,
      {},
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      fromPersonId: getCell(row, "FROM_PERSON_ID"),
      toPersonId: getCell(row, "TO_PERSON_ID"),
      relType: getCell(row, "REL_TYPE"),
    }));
  });
}

export async function listHouseholdsLite(): Promise<HouseholdLite[]> {
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT household_id,
              husband_person_id,
              wife_person_id,
              COALESCE(NULLIF(TRIM(label), ''), household_id) AS label
         FROM households
        WHERE TRIM(household_id) IS NOT NULL
        ORDER BY household_id`,
      {},
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      householdId: getCell(row, "HOUSEHOLD_ID"),
      husbandPersonId: getCell(row, "HUSBAND_PERSON_ID"),
      wifePersonId: getCell(row, "WIFE_PERSON_ID"),
      label: getCell(row, "LABEL"),
    }));
  });
}

export async function listRelatedFamilyPeople(viewerPersonId: string): Promise<RelatedFamilyPerson[]> {
  const [people, relationships] = await Promise.all([listPeopleLite(), listRelationshipsLite()]);
  const graph = buildFamilyGraph(people, relationships);
  const hits = computeRelativeHitsForViewer(viewerPersonId, graph);
  const viewerId = normalize(viewerPersonId);

  const out: RelatedFamilyPerson[] = [];
  for (const [personId, categories] of hits.entries()) {
    if (personId === viewerId) continue;
    const person =
      graph.peopleById.get(personId) ??
      ({
        personId,
        displayName: personId,
        gender: "",
        birthDate: "",
      } satisfies PersonLite);

    out.push({
      ...person,
      relationships: serializeRelationshipHitMap(categories),
    });
  }

  return out.sort(compareRelatedPeople);
}

export async function buildTreeLabSnapshot(viewerPersonId: string): Promise<TreeLabSnapshot> {
  const [people, relationships, households] = await Promise.all([
    listPeopleLite(),
    listRelationshipsLite(),
    listHouseholdsLite(),
  ]);
  const graph = buildFamilyGraph(people, relationships);
  const hits = computeRelativeHitsForViewer(viewerPersonId, graph);
  const buckets = emptyBuckets();
  const viewer =
    graph.peopleById.get(normalize(viewerPersonId)) ??
    ({
      personId: normalize(viewerPersonId),
      displayName: normalize(viewerPersonId),
      gender: "",
      birthDate: "",
    } satisfies PersonLite);

  for (const [personId, categories] of hits.entries()) {
    const person =
      graph.peopleById.get(personId) ??
      ({
        personId,
        displayName: personId,
        gender: "",
        birthDate: "",
      } satisfies PersonLite);

    for (const category of CATEGORY_ORDER) {
      const sides = categories.get(category);
      if (!sides) continue;
      buckets[category].push({
        ...person,
        lineageSides: Array.from(sides),
      });
    }
  }

  for (const category of CATEGORY_ORDER) {
    buckets[category].sort(comparePeople);
  }

  const relatedPeople = new Set<string>();
  for (const category of CATEGORY_ORDER) {
    for (const person of buckets[category]) {
      if (category === "self") continue;
      relatedPeople.add(person.personId);
    }
  }

  return {
    viewer,
    buckets,
    people,
    relationships,
    households,
    peopleCount: people.length,
    relationshipCount: relationships.length,
    relatedCount: relatedPeople.size,
  };
}
