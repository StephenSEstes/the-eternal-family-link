import "server-only";

import oracledb from "oracledb";
import type { ProfileVisibilityMapRow } from "@/lib/access/types";
import { listPersonConversationSummaries, type PersonConversationSummary } from "@/lib/conversations/store";
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

export type PersonVitals = {
  personId: string;
  displayName: string;
  firstName: string;
  middleName: string;
  lastName: string;
  maidenName: string;
  nickName: string;
  birthDate: string;
  deathDate: string;
  age: string;
  gender: string;
  phones: string;
  email: string;
  address: string;
  occupation: string;
};

export type PersonMediaItem = {
  personId: string;
  familyGroupKey: string;
  linkId: string;
  mediaId: string;
  fileId: string;
  mediaKind: string;
  label: string;
  description: string;
  photoDate: string;
  fileName: string;
  mimeType: string;
  sourceProvider: string;
  originalObjectKey: string;
  thumbnailObjectKey: string;
  previewUrl: string;
  createdAt: string;
};

export type PersonContent = {
  vitals: PersonVitals | null;
  media: PersonMediaItem[];
  conversations: PersonConversationSummary[];
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

function uniqueNormalized(values: Iterable<string>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalize(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function bindList(prefix: string, values: string[], binds: Record<string, string>) {
  return values
    .map((value, index) => {
      const key = `${prefix}${index}`;
      binds[key] = value;
      return `:${key}`;
    })
    .join(", ");
}

function parseFlexibleDate(value?: string) {
  const raw = normalize(value);
  const match = raw.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2] ?? "1", 10);
  const day = Number.parseInt(match[3] ?? "1", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function calculateAge(birthDate: string, deathDate = "") {
  const birth = parseFlexibleDate(birthDate);
  if (!birth) return "";
  const end = parseFlexibleDate(deathDate) ?? new Date();
  let age = end.getUTCFullYear() - birth.getUTCFullYear();
  const endMonth = end.getUTCMonth();
  const birthMonth = birth.getUTCMonth();
  if (endMonth < birthMonth || (endMonth === birthMonth && end.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  if (age < 0) return "";
  if (!deathDate && age > 125) return "";
  return String(age);
}

function encodeObjectKeyPath(objectKey: string) {
  return objectKey
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function buildPublicMediaUrl(objectKey: string) {
  const key = normalize(objectKey);
  if (!key) return "";
  const baseUrl = normalize(process.env.FAMAILINK_MEDIA_PUBLIC_BASE_URL) || normalize(process.env.OCI_OBJECT_PUBLIC_BASE_URL);
  if (!baseUrl) return "";
  return `${baseUrl.replace(/\/+$/, "")}/${encodeObjectKeyPath(key)}`;
}

function buildDriveThumbnailUrl(sourceProvider: string, fileId: string) {
  const provider = normalizeLower(sourceProvider);
  const normalizedFileId = normalize(fileId);
  if (!normalizedFileId || (!provider.includes("google") && !provider.includes("drive"))) return "";
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(normalizedFileId)}&sz=w1000`;
}

function buildMediaPreviewUrl(input: {
  sourceProvider: string;
  fileId: string;
  thumbnailObjectKey: string;
  originalObjectKey: string;
}) {
  return (
    buildPublicMediaUrl(input.thumbnailObjectKey) ||
    buildPublicMediaUrl(input.originalObjectKey) ||
    buildDriveThumbnailUrl(input.sourceProvider, input.fileId)
  );
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

  const spouseSideSiblingSideMap = new Map<string, Set<LineageSide>>();
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
        const sides = spouseSideSiblingSideMap.get(siblingInLawId) ?? new Set<LineageSide>();
        sides.add(side);
        spouseSideSiblingSideMap.set(siblingInLawId, sides);
      }
    }
  }

  for (const [siblingInLawId, sides] of spouseSideSiblingSideMap.entries()) {
    const siblingInLawHouseholdParentIds = new Set<string>([siblingInLawId]);
    for (const siblingInLawSpouseId of graph.spousesByPerson.get(siblingInLawId) ?? []) {
      if (siblingInLawSpouseId === viewerId || viewerSpouseIds.has(siblingInLawSpouseId)) continue;
      siblingInLawHouseholdParentIds.add(siblingInLawSpouseId);
      for (const side of sides) addHit(hits, siblingInLawSpouseId, "siblings_in_law", side);
    }
    const nieceNephewInLawIds = new Set<string>();
    for (const parentId of siblingInLawHouseholdParentIds) {
      for (const childId of graph.childrenByParent.get(parentId) ?? []) {
        if (childId === viewerId || viewerSpouseIds.has(childId)) continue;
        nieceNephewInLawIds.add(childId);
      }
    }
    for (const nieceNephewInLawId of nieceNephewInLawIds) {
      for (const side of sides) addHit(hits, nieceNephewInLawId, "nieces_nephews_in_law", side);
      for (const nieceNephewSpouseId of graph.spousesByPerson.get(nieceNephewInLawId) ?? []) {
        if (nieceNephewSpouseId === viewerId || viewerSpouseIds.has(nieceNephewSpouseId)) continue;
        for (const side of sides) addHit(hits, nieceNephewSpouseId, "nieces_nephews_in_law", side);
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

async function listPersonVitalsForIds(personIds: string[]): Promise<Map<string, PersonVitals>> {
  const ids = uniqueNormalized(personIds);
  const byPerson = new Map<string, PersonVitals>();
  if (!ids.length) return byPerson;

  return withConnection(async (connection) => {
    const binds: Record<string, string> = {};
    const inList = bindList("person", ids, binds);
    const peopleResult = await connection.execute(
      `SELECT person_id,
              COALESCE(NULLIF(TRIM(display_name), ''), TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), person_id) AS display_name,
              TRIM(NVL(first_name, '')) AS first_name,
              TRIM(NVL(middle_name, '')) AS middle_name,
              TRIM(NVL(last_name, '')) AS last_name,
              TRIM(NVL(maiden_name, '')) AS maiden_name,
              TRIM(NVL(nick_name, '')) AS nick_name,
              TRIM(NVL(birth_date, '')) AS birth_date,
              LOWER(TRIM(NVL(gender, ''))) AS gender,
              TRIM(NVL(phones, '')) AS phones,
              TRIM(NVL(email, '')) AS email,
              TRIM(NVL(address, '')) AS address
         FROM people
        WHERE TRIM(person_id) IN (${inList})
        ORDER BY display_name`,
      binds,
      OUT_FORMAT,
    );
    const peopleRows = (peopleResult.rows ?? []) as Record<string, unknown>[];
    for (const row of peopleRows) {
      const personId = getCell(row, "PERSON_ID");
      if (!personId) continue;
      byPerson.set(personId, {
        personId,
        displayName: getCell(row, "DISPLAY_NAME"),
        firstName: getCell(row, "FIRST_NAME"),
        middleName: getCell(row, "MIDDLE_NAME"),
        lastName: getCell(row, "LAST_NAME"),
        maidenName: getCell(row, "MAIDEN_NAME"),
        nickName: getCell(row, "NICK_NAME"),
        birthDate: getCell(row, "BIRTH_DATE"),
        deathDate: "",
        age: "",
        gender: getCell(row, "GENDER"),
        phones: getCell(row, "PHONES"),
        email: getCell(row, "EMAIL"),
        address: getCell(row, "ADDRESS"),
        occupation: "",
      });
    }

    const attributeResult = await connection.execute(
      `SELECT entity_id,
              LOWER(TRIM(NVL(attribute_type, ''))) AS attribute_type,
              LOWER(TRIM(NVL(attribute_type_category, ''))) AS attribute_type_category,
              TRIM(NVL(attribute_date, '')) AS attribute_date,
              TRIM(NVL(attribute_detail, '')) AS attribute_detail,
              TRIM(NVL(attribute_notes, '')) AS attribute_notes,
              TRIM(NVL(end_date, '')) AS end_date,
              TRIM(NVL(updated_at, '')) AS updated_at,
              TRIM(NVL(created_at, '')) AS created_at
         FROM attributes
        WHERE LOWER(TRIM(entity_type)) = 'person'
          AND TRIM(entity_id) IN (${inList})
          AND (
            LOWER(TRIM(NVL(attribute_type, ''))) IN ('occupation','profession','career','job','jobs','employment','hired','promotion','work','death','died')
            OR LOWER(TRIM(NVL(attribute_type_category, ''))) IN ('occupation','profession','career','job','jobs','employment','work','death')
          )
        ORDER BY entity_id,
                 CASE WHEN TRIM(NVL(attribute_date, '')) IS NULL THEN 1 ELSE 0 END,
                 attribute_date DESC,
                 updated_at DESC,
                 created_at DESC`,
      binds,
      OUT_FORMAT,
    );
    const attributeRows = (attributeResult.rows ?? []) as Record<string, unknown>[];
    const occupationTypes = new Set(["occupation", "profession", "career", "job", "jobs", "employment", "hired", "promotion", "work"]);
    for (const row of attributeRows) {
      const personId = getCell(row, "ENTITY_ID");
      const current = byPerson.get(personId);
      if (!current) continue;
      const type = normalizeLower(getCell(row, "ATTRIBUTE_TYPE"));
      const category = normalizeLower(getCell(row, "ATTRIBUTE_TYPE_CATEGORY"));
      const detail = getCell(row, "ATTRIBUTE_DETAIL") || getCell(row, "ATTRIBUTE_NOTES");
      const attributeDate = getCell(row, "ATTRIBUTE_DATE");
      if ((type === "death" || type === "died" || category === "death") && !current.deathDate) {
        current.deathDate = attributeDate || detail;
      }
      if ((occupationTypes.has(type) || occupationTypes.has(category)) && detail && !current.occupation) {
        current.occupation = detail;
      }
    }

    for (const row of byPerson.values()) {
      row.age = calculateAge(row.birthDate, row.deathDate);
    }

    return byPerson;
  });
}

async function listPersonMediaForIds(personIds: string[]): Promise<Map<string, PersonMediaItem[]>> {
  const ids = uniqueNormalized(personIds);
  const byPerson = new Map<string, PersonMediaItem[]>();
  if (!ids.length) return byPerson;

  return withConnection(async (connection) => {
    const binds: Record<string, string> = {};
    const inList = bindList("person", ids, binds);
    const result = await connection.execute(
      `SELECT l.family_group_key,
              l.link_id,
              l.media_id,
              l.entity_id,
              l.is_primary,
              l.sort_order,
              a.file_id,
              a.file_name,
              a.media_kind,
              a.label,
              a.description,
              a.photo_date,
              a.created_at,
              a.source_provider,
              a.original_object_key,
              a.thumbnail_object_key,
              a.mime_type
         FROM media_links l
         INNER JOIN media_assets a
            ON TRIM(a.media_id) = TRIM(l.media_id)
        WHERE LOWER(TRIM(l.entity_type)) = 'person'
          AND TRIM(l.entity_id) IN (${inList})
          AND LOWER(TRIM(NVL(l.usage_type, 'media'))) <> 'share'
        ORDER BY l.entity_id,
                 CASE WHEN LOWER(TRIM(NVL(l.is_primary, 'FALSE'))) = 'true' THEN 0 ELSE 1 END,
                 CASE
                   WHEN REGEXP_LIKE(TRIM(NVL(l.sort_order, '')), '^[+-]?[0-9]+([.][0-9]+)?$')
                     THEN TO_NUMBER(TRIM(l.sort_order))
                   ELSE 0
                 END,
                 a.photo_date DESC,
                 a.created_at DESC,
                 a.file_id`,
      binds,
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    const seenByPerson = new Map<string, Set<string>>();
    for (const row of rows) {
      const personId = getCell(row, "ENTITY_ID");
      if (!personId) continue;
      const mediaId = getCell(row, "MEDIA_ID");
      const fileId = getCell(row, "FILE_ID");
      const dedupeKey = mediaId || fileId || getCell(row, "LINK_ID");
      const seen = seenByPerson.get(personId) ?? new Set<string>();
      if (dedupeKey && seen.has(dedupeKey)) continue;
      if (dedupeKey) seen.add(dedupeKey);
      seenByPerson.set(personId, seen);

      const sourceProvider = getCell(row, "SOURCE_PROVIDER");
      const thumbnailObjectKey = getCell(row, "THUMBNAIL_OBJECT_KEY");
      const originalObjectKey = getCell(row, "ORIGINAL_OBJECT_KEY");
      const mimeType = getCell(row, "MIME_TYPE");
      const mediaKind = normalizeLower(getCell(row, "MEDIA_KIND")) || (mimeType.startsWith("image/") ? "image" : "");
      const item: PersonMediaItem = {
        personId,
        familyGroupKey: getCell(row, "FAMILY_GROUP_KEY"),
        linkId: getCell(row, "LINK_ID"),
        mediaId,
        fileId,
        mediaKind,
        label: getCell(row, "LABEL"),
        description: getCell(row, "DESCRIPTION"),
        photoDate: getCell(row, "PHOTO_DATE"),
        fileName: getCell(row, "FILE_NAME"),
        mimeType,
        sourceProvider,
        originalObjectKey,
        thumbnailObjectKey,
        previewUrl: buildMediaPreviewUrl({
          sourceProvider,
          fileId,
          thumbnailObjectKey,
          originalObjectKey,
        }),
        createdAt: getCell(row, "CREATED_AT"),
      };
      const current = byPerson.get(personId) ?? [];
      current.push(item);
      byPerson.set(personId, current);
    }
    return byPerson;
  });
}

export async function buildPersonContentForAccess(input: {
  viewerPersonId: string;
  personIds: string[];
  visibilityRows: ProfileVisibilityMapRow[];
}): Promise<Record<string, PersonContent>> {
  const viewerPersonId = normalize(input.viewerPersonId);
  const personIds = uniqueNormalized(input.personIds);
  const visibilityByTarget = new Map(input.visibilityRows.map((row) => [normalize(row.targetPersonId), row]));
  const vitalsPersonIds = personIds.filter((personId) => personId === viewerPersonId || visibilityByTarget.get(personId)?.canVitals);
  const mediaPersonIds = personIds.filter((personId) => personId === viewerPersonId || visibilityByTarget.get(personId)?.canMedia);
  const conversationPersonIds = personIds.filter(
    (personId) => personId === viewerPersonId || visibilityByTarget.get(personId)?.canConversations,
  );
  const [vitalsByPerson, mediaByPerson, conversationsByPerson] = await Promise.all([
    listPersonVitalsForIds(vitalsPersonIds),
    listPersonMediaForIds(mediaPersonIds),
    listPersonConversationSummaries({
      viewerPersonId,
      targetPersonIds: conversationPersonIds,
    }),
  ]);

  const out: Record<string, PersonContent> = {};
  for (const personId of personIds) {
    const visibilityRow = visibilityByTarget.get(personId);
    const canSeeVitals = personId === viewerPersonId || Boolean(visibilityRow?.canVitals);
    const canSeeMedia = personId === viewerPersonId || Boolean(visibilityRow?.canMedia);
    const canSeeConversations = personId === viewerPersonId || Boolean(visibilityRow?.canConversations);
    out[personId] = {
      vitals: canSeeVitals ? (vitalsByPerson.get(personId) ?? null) : null,
      media: canSeeMedia ? (mediaByPerson.get(personId) ?? []) : [],
      conversations: canSeeConversations ? (conversationsByPerson[personId] ?? []) : [],
    };
  }
  return out;
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
