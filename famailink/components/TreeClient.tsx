"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { FamailinkChrome } from "@/components/FamailinkChrome";
import type {
  AccessRecomputeStatus,
  ProfileSubscriptionMapRow,
  ProfileVisibilityMapRow,
  SharePersonException,
  SubscriptionPersonException,
} from "@/lib/access/types";
import type { EffectType, LineageSide, RelationshipCategory } from "@/lib/model/relationships";
import { RELATIONSHIP_LABELS } from "@/lib/model/relationships";

const RELATION_PRIORITY: RelationshipCategory[] = [
  "self",
  "spouse",
  "parents",
  "parents_in_law",
  "grandparents",
  "grandparents_in_law",
  "children",
  "children_in_law",
  "grandchildren",
  "siblings",
  "siblings_in_law",
  "aunts_uncles",
  "nieces_nephews",
  "nieces_nephews_in_law",
  "cousins",
  "cousins_children",
];

type SessionInfo = {
  username: string;
  personId: string;
};

type SelectedRelative = {
  person: TreeBucketPerson;
  category: RelationshipCategory;
  visibilityRow?: ProfileVisibilityMapRow;
  subscriptionRow?: ProfileSubscriptionMapRow;
};

type PersonDetailTab = "overview" | "vitals" | "media" | "stories" | "conversations" | "rules";

type TreeBucketPerson = {
  personId: string;
  displayName: string;
  gender?: string;
  birthDate?: string;
  lineageSides: LineageSide[];
};

type TreePerson = {
  personId: string;
  displayName: string;
  gender: string;
  birthDate?: string;
};

type TreeRelationship = {
  fromPersonId: string;
  toPersonId: string;
  relType: string;
};

type TreeHousehold = {
  householdId: string;
  husbandPersonId: string;
  wifePersonId: string;
  label: string;
};

type TreeSnapshot = {
  viewer: {
    personId: string;
    displayName: string;
    gender?: string;
    birthDate?: string;
  };
  buckets: Record<RelationshipCategory, TreeBucketPerson[]>;
  people: TreePerson[];
  relationships: TreeRelationship[];
  households: TreeHousehold[];
  peopleCount: number;
  relationshipCount: number;
  relatedCount: number;
};

type PersonVitals = {
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

type PersonMediaItem = {
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

type PersonContent = {
  vitals: PersonVitals | null;
  media: PersonMediaItem[];
  conversations: PersonConversationSummary[];
};

type PersonConversationSummary = {
  targetPersonId: string;
  conversationId: string;
  circleId: string;
  circleTitle: string;
  title: string;
  lastActivityAt: string;
  unreadCount: number;
};

type HouseholdUnit = {
  householdId: string;
  label: string;
  parentIds: string[];
  childIds: string[];
  childPersonIds: string[];
  childHouseholdIds: string[];
  parentUnitIds: string[];
  generation: number;
  isSynthetic: boolean;
};

type FocusGroup = "household" | "parents" | "spouses" | "siblings" | "children";

type TreeGraphModel = {
  peopleById: Map<string, TreePerson>;
  relationByPersonId: Map<string, SelectedRelative>;
  visiblePersonIds: Set<string>;
  parentsByChild: Map<string, Set<string>>;
  childrenByParent: Map<string, Set<string>>;
  spousesByPerson: Map<string, Set<string>>;
  householdIdsByPerson: Map<string, string[]>;
  units: HouseholdUnit[];
  unitsById: Map<string, HouseholdUnit>;
  rows: Array<{ generation: number; label: string; units: HouseholdUnit[] }>;
  visiblePeople: TreePerson[];
};

type SharingScopeSettings = {
  shareVitals: boolean;
  shareStories: boolean;
  shareMedia: boolean;
  shareConversations: boolean;
};

type ModalSettings = {
  subscriptionException: SubscriptionPersonException | null;
  shareException: SharePersonException | null;
  subscriptionUseDefault: boolean;
  receiveUpdates: boolean;
  sharingUseDefault: boolean;
  sharingScopes: SharingScopeSettings;
};

type TargetSubscriptionExceptionPayload = {
  targetPersonId: string;
  effect: EffectType;
};

type TargetShareExceptionPayload = TargetSubscriptionExceptionPayload & SharingScopeSettings;

type TargetPersonSettingsState = {
  targetPersonId: string;
  subscriptionException: SubscriptionPersonException | null;
  shareException: SharePersonException | null;
  subscriptionRow: ProfileSubscriptionMapRow | null;
  visibilityRow: ProfileVisibilityMapRow | null;
};

type PersonSettingsSaveResponse = {
  state?: TargetPersonSettingsState;
};

const SHARING_SCOPE_OPTIONS: Array<{ field: keyof SharingScopeSettings; label: string }> = [
  { field: "shareVitals", label: "Vitals" },
  { field: "shareStories", label: "Stories" },
  { field: "shareMedia", label: "Media" },
  { field: "shareConversations", label: "Conversations" },
];

function PreferenceModeControl({
  label,
  useDefault,
  onChange,
}: {
  label: string;
  useDefault: boolean;
  onChange: (useDefault: boolean) => void;
}) {
  return (
    <div className="mode-segment" role="group" aria-label={label}>
      <button
        className={`mode-segment-button${useDefault ? " is-active" : ""}`}
        type="button"
        onClick={() => onChange(true)}
        aria-pressed={useDefault}
      >
        Default
      </button>
      <button
        className={`mode-segment-button${useDefault ? "" : " is-active"}`}
        type="button"
        onClick={() => onChange(false)}
        aria-pressed={!useDefault}
      >
        Custom
      </button>
    </div>
  );
}

function readSideLabel(side: LineageSide) {
  if (side === "maternal") return "Maternal";
  if (side === "paternal") return "Paternal";
  if (side === "both") return "Maternal & Paternal";
  return "";
}

function shareSummary(row: ProfileVisibilityMapRow | undefined) {
  if (!row) return { label: "Content Pending", badgeClass: "pending" };
  if (row.placeholderOnly) return { label: "Name Only", badgeClass: "placeholder" };
  if (row.canVitals || row.canStories || row.canMedia || row.canConversations) {
    return { label: "Content Available", badgeClass: "shared" };
  }
  return { label: "Name Only", badgeClass: "closed" };
}

function subscriptionSummary(row: ProfileSubscriptionMapRow | undefined) {
  if (!row) return { label: "Subscription Pending", badgeClass: "pending" };
  return row.isSubscribed
    ? { label: "Subscribed", badgeClass: "subscribed" }
    : { label: "Not Subscribed", badgeClass: "closed" };
}

function scopeList(row: ProfileVisibilityMapRow | undefined) {
  if (!row || row.placeholderOnly) return "";
  const allowed = [
    row.canVitals ? "Vitals" : "",
    row.canStories ? "Stories" : "",
    row.canMedia ? "Media" : "",
    row.canConversations ? "Conversations" : "",
  ].filter(Boolean);
  return allowed.join(", ");
}

function availableContentResult(row: ProfileVisibilityMapRow | undefined) {
  if (!row) return "Content availability pending";
  const scopes = scopeList(row);
  if (scopes) return `Available here: ${scopes}`;
  return "Name and relationship only";
}

function sharingScopesFromException(row: SharePersonException | undefined): SharingScopeSettings {
  if (!row) {
    return {
      shareVitals: true,
      shareStories: true,
      shareMedia: true,
      shareConversations: true,
    };
  }

  const hasScopedValues =
    row.shareVitals !== null ||
    row.shareStories !== null ||
    row.shareMedia !== null ||
    row.shareConversations !== null;

  if (!hasScopedValues) {
    const shareAll = row.effect === "allow";
    return {
      shareVitals: shareAll,
      shareStories: shareAll,
      shareMedia: shareAll,
      shareConversations: shareAll,
    };
  }

  return {
    shareVitals: row.shareVitals === true,
    shareStories: row.shareStories === true,
    shareMedia: row.shareMedia === true,
    shareConversations: row.shareConversations === true,
  };
}

function subscriptionPayloadFromException(row: SubscriptionPersonException | null): TargetSubscriptionExceptionPayload | null {
  if (!row) return null;
  return {
    targetPersonId: row.targetPersonId,
    effect: row.effect,
  };
}

function sharePayloadFromException(row: SharePersonException | null): TargetShareExceptionPayload | null {
  if (!row) return null;
  const scopes = sharingScopesFromException(row);
  return {
    targetPersonId: row.targetPersonId,
    effect: row.effect,
    ...scopes,
  };
}

function replaceTargetRow<T extends { targetPersonId: string }>(
  rows: T[],
  targetPersonId: string,
  replacement: T | null | undefined,
) {
  const filtered = rows.filter((row) => row.targetPersonId !== targetPersonId);
  return replacement ? [...filtered, replacement] : filtered;
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    credentials: "same-origin",
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(payload.error ?? payload.message ?? `Request failed (${response.status}).`));
  }
  return payload;
}

function normalize(value?: string) {
  return String(value ?? "").trim();
}

function normalizeLower(value?: string) {
  return normalize(value).toLowerCase();
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = normalize(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function addSetValue(map: Map<string, Set<string>>, key: string, value: string) {
  const normalizedKey = normalize(key);
  const normalizedValue = normalize(value);
  if (!normalizedKey || !normalizedValue) return;
  const current = map.get(normalizedKey);
  if (current) {
    current.add(normalizedValue);
    return;
  }
  map.set(normalizedKey, new Set([normalizedValue]));
}

function addMapArrayValue(map: Map<string, string[]>, key: string, value: string) {
  const normalizedKey = normalize(key);
  const normalizedValue = normalize(value);
  if (!normalizedKey || !normalizedValue) return;
  const current = map.get(normalizedKey) ?? [];
  if (!current.includes(normalizedValue)) current.push(normalizedValue);
  map.set(normalizedKey, current);
}

function pairKey(leftId: string, rightId: string) {
  return [leftId, rightId].sort().join("::");
}

function isParentRelationship(row: TreeRelationship) {
  return normalizeLower(row.relType) === "parent";
}

function isSpouseRelationship(row: TreeRelationship) {
  const type = normalizeLower(row.relType);
  return type === "spouse" || type === "family";
}

function generationLabel(generation: number) {
  if (generation <= -2) return "Grandparents";
  if (generation === -1) return "Parents";
  if (generation === 0) return "Your Generation";
  if (generation === 1) return "Children";
  if (generation === 2) return "Grandchildren";
  return generation < 0 ? `Older Generation ${Math.abs(generation)}` : `Younger Generation ${generation}`;
}

function compareTreePeople(left: TreePerson, right: TreePerson) {
  return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" });
}

function parseBirthSortValue(value?: string) {
  const raw = normalize(value);
  if (!raw) return Number.NaN;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function compareTreePeopleByBirth(left: TreePerson, right: TreePerson) {
  const leftBirth = parseBirthSortValue(left.birthDate);
  const rightBirth = parseBirthSortValue(right.birthDate);
  if (Number.isFinite(leftBirth) && Number.isFinite(rightBirth) && leftBirth !== rightBirth) {
    return leftBirth - rightBirth;
  }
  if (Number.isFinite(leftBirth) !== Number.isFinite(rightBirth)) {
    return Number.isFinite(leftBirth) ? -1 : 1;
  }
  return compareTreePeople(left, right);
}

function compareTreePersonIdsByBirth(leftId: string, rightId: string, peopleById: Map<string, TreePerson>) {
  const left = peopleById.get(leftId);
  const right = peopleById.get(rightId);
  if (left && right) return compareTreePeopleByBirth(left, right);
  return leftId.localeCompare(rightId, undefined, { sensitivity: "base" });
}

function sortPersonForHousehold(unit: HouseholdUnit | undefined, peopleById: Map<string, TreePerson>) {
  if (!unit) return null;
  return (
    unit.parentIds
      .map((personId) => peopleById.get(personId))
      .filter((person): person is TreePerson => Boolean(person))
      .sort(compareTreePeopleByBirth)[0] ?? null
  );
}

function compareHouseholdUnits(left: HouseholdUnit, right: HouseholdUnit, peopleById: Map<string, TreePerson>) {
  const leftPerson = sortPersonForHousehold(left, peopleById);
  const rightPerson = sortPersonForHousehold(right, peopleById);
  if (leftPerson && rightPerson) return compareTreePeopleByBirth(leftPerson, rightPerson);
  return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
}

function avatarUrlForPerson(person: { gender?: string }) {
  return normalizeLower(person.gender) === "female" ? "/placeholders/avatar-female.png" : "/placeholders/avatar-male.png";
}

function sortedVisiblePersonIds(values: Iterable<string>, peopleById: Map<string, TreePerson>) {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    const personId = normalize(value);
    if (!personId || seen.has(personId) || !peopleById.has(personId)) continue;
    seen.add(personId);
    ids.push(personId);
  }
  return ids.sort((left, right) => compareTreePersonIdsByBirth(left, right, peopleById));
}

function findOwnHouseholdUnits(graph: TreeGraphModel, personId: string) {
  return (graph.householdIdsByPerson.get(personId) ?? [])
    .map((householdId) => graph.unitsById.get(householdId))
    .filter((unit): unit is HouseholdUnit => {
      if (!unit) return false;
      return unit.parentIds.includes(personId);
    })
    .sort((left, right) => compareHouseholdUnits(left, right, graph.peopleById));
}

function findPrimaryOwnHouseholdUnit(graph: TreeGraphModel, personId: string, excludedHouseholdIds = new Set<string>()) {
  return findOwnHouseholdUnits(graph, personId).find((unit) => !excludedHouseholdIds.has(unit.householdId)) ?? null;
}

function findParentHouseholdUnit(graph: TreeGraphModel, personId: string) {
  const parentIds = Array.from(graph.parentsByChild.get(personId) ?? []);
  return (
    graph.units
      .filter((unit) => unit.childIds.includes(personId))
      .sort((left, right) => {
        const leftOverlap = left.parentIds.filter((parentId) => parentIds.includes(parentId)).length;
        const rightOverlap = right.parentIds.filter((parentId) => parentIds.includes(parentId)).length;
        if (leftOverlap !== rightOverlap) return rightOverlap - leftOverlap;
        return compareHouseholdUnits(left, right, graph.peopleById);
      })[0] ?? null
  );
}

function parentIdsForPerson(graph: TreeGraphModel, personId: string, parentUnit: HouseholdUnit | null) {
  return sortedVisiblePersonIds(parentUnit?.parentIds ?? graph.parentsByChild.get(personId) ?? [], graph.peopleById);
}

function siblingIdsForPerson(graph: TreeGraphModel, personId: string) {
  const ids = new Set<string>([personId]);
  for (const parentId of graph.parentsByChild.get(personId) ?? []) {
    for (const siblingId of graph.childrenByParent.get(parentId) ?? []) {
      ids.add(siblingId);
    }
  }
  return sortedVisiblePersonIds(ids, graph.peopleById);
}

function childIdsForPerson(graph: TreeGraphModel, personId: string, householdUnit: HouseholdUnit | null) {
  const ids = new Set<string>();
  for (const childId of householdUnit?.childIds ?? []) ids.add(childId);
  for (const childId of graph.childrenByParent.get(personId) ?? []) ids.add(childId);
  return sortedVisiblePersonIds(ids, graph.peopleById);
}

function childIdsForParents(graph: TreeGraphModel, parentIds: string[], parentUnit: HouseholdUnit | null) {
  const ids = new Set<string>();
  for (const childId of parentUnit?.childIds ?? []) ids.add(childId);
  for (const parentId of parentIds) {
    for (const childId of graph.childrenByParent.get(parentId) ?? []) ids.add(childId);
  }
  return sortedVisiblePersonIds(ids, graph.peopleById);
}

function buildHouseholdLabel(parentIds: string[], peopleById: Map<string, TreePerson>, fallback: string) {
  const names = parentIds.map((personId) => peopleById.get(personId)?.displayName ?? "").filter(Boolean);
  if (names.length === 0) return fallback;
  if (names.length === 1) return `${names[0]} Household`;
  return `${names.join(" & ")} Household`;
}

function buildTreeGraphModel(snapshot: TreeSnapshot): TreeGraphModel {
  const peopleById = new Map<string, TreePerson>();
  for (const person of snapshot.people) {
    if (!normalize(person.personId)) continue;
    peopleById.set(person.personId, person);
  }
  peopleById.set(snapshot.viewer.personId, {
    personId: snapshot.viewer.personId,
    displayName: snapshot.viewer.displayName,
    gender: normalize(snapshot.viewer.gender),
    birthDate: normalize(snapshot.viewer.birthDate),
  });

  const relationByPersonId = new Map<string, SelectedRelative>();
  for (const category of RELATION_PRIORITY) {
    for (const person of snapshot.buckets[category] ?? []) {
      if (!relationByPersonId.has(person.personId)) {
        relationByPersonId.set(person.personId, { person, category });
      }
      if (!peopleById.has(person.personId)) {
        peopleById.set(person.personId, {
          personId: person.personId,
          displayName: person.displayName,
          gender: normalize(person.gender),
          birthDate: normalize(person.birthDate),
        });
      }
    }
  }

  if (!relationByPersonId.has(snapshot.viewer.personId)) {
    relationByPersonId.set(snapshot.viewer.personId, {
      person: {
        personId: snapshot.viewer.personId,
        displayName: snapshot.viewer.displayName,
        gender: snapshot.viewer.gender,
        lineageSides: ["not_applicable"],
      },
      category: "self",
    });
  }

  const visiblePersonIds = new Set(relationByPersonId.keys());
  const parentsByChild = new Map<string, Set<string>>();
  const childrenByParent = new Map<string, Set<string>>();
  const spousesByPerson = new Map<string, Set<string>>();

  for (const relationship of snapshot.relationships) {
    const fromPersonId = normalize(relationship.fromPersonId);
    const toPersonId = normalize(relationship.toPersonId);
    if (!fromPersonId || !toPersonId) continue;
    if (!peopleById.has(fromPersonId) || !peopleById.has(toPersonId)) continue;
    if (!visiblePersonIds.has(fromPersonId) || !visiblePersonIds.has(toPersonId)) continue;

    if (isParentRelationship(relationship)) {
      addSetValue(parentsByChild, toPersonId, fromPersonId);
      addSetValue(childrenByParent, fromPersonId, toPersonId);
      continue;
    }
    if (isSpouseRelationship(relationship)) {
      addSetValue(spousesByPerson, fromPersonId, toPersonId);
      addSetValue(spousesByPerson, toPersonId, fromPersonId);
    }
  }

  const levels = new Map<string, number>();
  for (const personId of visiblePersonIds) levels.set(personId, 0);
  const roots = Array.from(visiblePersonIds).filter((personId) => {
    const visibleParents = Array.from(parentsByChild.get(personId) ?? []).filter((parentId) => visiblePersonIds.has(parentId));
    return visibleParents.length === 0;
  });
  const queue = roots.length ? [...roots] : [snapshot.viewer.personId];
  const seen = new Set<string>();
  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId || seen.has(currentId)) continue;
    seen.add(currentId);
    const currentLevel = levels.get(currentId) ?? 0;
    for (const childId of childrenByParent.get(currentId) ?? []) {
      if (!visiblePersonIds.has(childId)) continue;
      levels.set(childId, Math.max(levels.get(childId) ?? 0, currentLevel + 1));
      queue.push(childId);
    }
  }
  for (let pass = 0; pass < visiblePersonIds.size; pass += 1) {
    for (const [childId, parentIds] of parentsByChild.entries()) {
      if (!visiblePersonIds.has(childId)) continue;
      for (const parentId of parentIds) {
        if (!visiblePersonIds.has(parentId)) continue;
        levels.set(childId, Math.max(levels.get(childId) ?? 0, (levels.get(parentId) ?? 0) + 1));
      }
    }
  }

  const viewerLevel = levels.get(snapshot.viewer.personId) ?? 0;
  const units = new Map<string, HouseholdUnit>();
  const householdIdsByPerson = new Map<string, string[]>();
  const unitIdByPairKey = new Map<string, string>();
  const unitIdByCanonicalKey = new Map<string, string>();
  const unitIdsByParentId = new Map<string, string[]>();

  function registerUnit(input: { householdId: string; parentIds: string[]; label: string; isSynthetic: boolean }) {
    const parentIds = uniqueStrings(input.parentIds).filter((personId) => visiblePersonIds.has(personId));
    if (parentIds.length === 0 || units.has(input.householdId)) return "";
    const canonicalKey = parentIds.length >= 2 ? `pair:${pairKey(parentIds[0], parentIds[1])}` : `single:${parentIds[0]}`;
    const existingUnitId = unitIdByCanonicalKey.get(canonicalKey) ?? "";
    if (existingUnitId) {
      const existing = units.get(existingUnitId);
      if (existing && !input.isSynthetic && existing.isSynthetic) {
        existing.label = input.label || existing.label;
        existing.isSynthetic = false;
      }
      return existingUnitId;
    }
    const absoluteGeneration = Math.min(...parentIds.map((personId) => levels.get(personId) ?? viewerLevel));
    const unit: HouseholdUnit = {
      householdId: input.householdId,
      label: input.label || buildHouseholdLabel(parentIds, peopleById, input.householdId),
      parentIds,
      childIds: [],
      childPersonIds: [],
      childHouseholdIds: [],
      parentUnitIds: [],
      generation: absoluteGeneration - viewerLevel,
      isSynthetic: input.isSynthetic,
    };
    units.set(unit.householdId, unit);
    unitIdByCanonicalKey.set(canonicalKey, unit.householdId);
    for (const parentId of parentIds) {
      addMapArrayValue(householdIdsByPerson, parentId, unit.householdId);
      addMapArrayValue(unitIdsByParentId, parentId, unit.householdId);
    }
    if (parentIds.length >= 2) {
      unitIdByPairKey.set(pairKey(parentIds[0], parentIds[1]), unit.householdId);
    }
    return unit.householdId;
  }

  for (const household of snapshot.households) {
    registerUnit({
      householdId: household.householdId,
      parentIds: uniqueStrings([household.husbandPersonId, household.wifePersonId]),
      label: household.label,
      isSynthetic: false,
    });
  }

  for (const [personId, spouseIds] of spousesByPerson.entries()) {
    if (!visiblePersonIds.has(personId)) continue;
    for (const spouseId of spouseIds) {
      if (!visiblePersonIds.has(spouseId)) continue;
      const key = pairKey(personId, spouseId);
      if (unitIdByPairKey.has(key)) continue;
      registerUnit({
        householdId: `synthetic-household-${key}`,
        parentIds: [personId, spouseId],
        label: buildHouseholdLabel([personId, spouseId], peopleById, "Household"),
        isSynthetic: true,
      });
    }
  }

  for (const [parentId, childIds] of childrenByParent.entries()) {
    if (!visiblePersonIds.has(parentId)) continue;
    const hasVisibleChildren = Array.from(childIds).some((childId) => visiblePersonIds.has(childId));
    if (!hasVisibleChildren || (unitIdsByParentId.get(parentId) ?? []).length > 0) continue;
    registerUnit({
      householdId: `synthetic-household-${parentId}`,
      parentIds: [parentId],
      label: buildHouseholdLabel([parentId], peopleById, "Household"),
      isSynthetic: true,
    });
  }

  function bestParentUnitForChild(childId: string) {
    const parentIds = Array.from(parentsByChild.get(childId) ?? []).filter((parentId) => visiblePersonIds.has(parentId));
    let bestUnit: HouseholdUnit | null = null;
    let bestScore = 0;
    for (const unit of units.values()) {
      const overlap = unit.parentIds.filter((parentId) => parentIds.includes(parentId)).length;
      if (overlap > bestScore) {
        bestScore = overlap;
        bestUnit = unit;
      }
    }
    return bestScore > 0 ? bestUnit : null;
  }

  for (const childId of visiblePersonIds) {
    const unit = bestParentUnitForChild(childId);
    if (!unit || unit.parentIds.includes(childId)) continue;
    if (!unit.childIds.includes(childId)) unit.childIds.push(childId);
  }

  for (const unit of units.values()) {
    for (const childId of unit.childIds) {
      const childHouseholdId =
        (householdIdsByPerson.get(childId) ?? []).find((householdId) => householdId !== unit.householdId) ?? "";
      if (childHouseholdId) {
        if (!unit.childHouseholdIds.includes(childHouseholdId)) unit.childHouseholdIds.push(childHouseholdId);
        const childUnit = units.get(childHouseholdId);
        if (childUnit && !childUnit.parentUnitIds.includes(unit.householdId)) {
          childUnit.parentUnitIds.push(unit.householdId);
        }
      } else if (!unit.childPersonIds.includes(childId)) {
        unit.childPersonIds.push(childId);
      }
    }
  }

  for (const personId of visiblePersonIds) {
    const isParent = Array.from(units.values()).some((unit) => unit.parentIds.includes(personId));
    const isChild = Array.from(units.values()).some((unit) => unit.childPersonIds.includes(personId));
    if (isParent || isChild) continue;
    registerUnit({
      householdId: `person-unit-${personId}`,
      parentIds: [personId],
      label: buildHouseholdLabel([personId], peopleById, "Household"),
      isSynthetic: true,
    });
  }

  for (const unit of units.values()) {
    unit.parentIds.sort((left, right) => compareTreePeople(peopleById.get(left)!, peopleById.get(right)!));
    unit.childIds.sort((left, right) => compareTreePersonIdsByBirth(left, right, peopleById));
    unit.childPersonIds.sort((left, right) => compareTreePersonIdsByBirth(left, right, peopleById));
    unit.childHouseholdIds.sort((left, right) => {
      const leftUnit = units.get(left);
      const rightUnit = units.get(right);
      const leftChildId = unit.childIds.find((childId) => leftUnit?.parentIds.includes(childId)) ?? leftUnit?.parentIds[0] ?? left;
      const rightChildId = unit.childIds.find((childId) => rightUnit?.parentIds.includes(childId)) ?? rightUnit?.parentIds[0] ?? right;
      const byChildBirth = compareTreePersonIdsByBirth(leftChildId, rightChildId, peopleById);
      if (byChildBirth !== 0) return byChildBirth;
      return (leftUnit?.label ?? left).localeCompare(rightUnit?.label ?? right, undefined, { sensitivity: "base" });
    });
  }

  const rowMap = new Map<number, HouseholdUnit[]>();
  for (const unit of units.values()) {
    const current = rowMap.get(unit.generation) ?? [];
    current.push(unit);
    rowMap.set(unit.generation, current);
  }

  const rows = Array.from(rowMap.entries())
    .sort(([left], [right]) => left - right)
    .map(([generation, rowUnits]) => ({
      generation,
      label: generationLabel(generation),
      units: rowUnits.sort((left, right) => compareHouseholdUnits(left, right, peopleById)),
    }));

  return {
    peopleById,
    relationByPersonId,
    visiblePersonIds,
    parentsByChild,
    childrenByParent,
    spousesByPerson,
    householdIdsByPerson,
    units: Array.from(units.values()),
    unitsById: units,
    rows,
    visiblePeople: Array.from(visiblePersonIds)
      .map((personId) => peopleById.get(personId))
      .filter((person): person is TreePerson => Boolean(person))
      .sort(compareTreePeople),
  };
}

const PERSON_DETAIL_TABS: Array<{ id: PersonDetailTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "vitals", label: "Vitals" },
  { id: "media", label: "Media" },
  { id: "stories", label: "Stories" },
  { id: "conversations", label: "Conversations" },
  { id: "rules", label: "Updates & Sharing" },
];

function formatVitalValue(value: string, fallback = "Not listed") {
  return normalize(value) || fallback;
}

function displayGender(value: string) {
  const normalized = normalizeLower(value);
  if (normalized === "female") return "Female";
  if (normalized === "male") return "Male";
  return formatVitalValue(value);
}

function mailHref(value: string) {
  const email = normalize(value);
  return email ? `mailto:${email}` : "";
}

function VitalRow({ label, value, href }: { label: string; value: string; href?: string }) {
  const displayValue = normalize(value);
  return (
    <div className="vital-row">
      <dt>{label}</dt>
      <dd>
        {displayValue ? (
          href ? (
            <a href={href}>{displayValue}</a>
          ) : (
            displayValue
          )
        ) : (
          <span className="muted">Not listed</span>
        )}
      </dd>
    </div>
  );
}

function VitalsTab({ content }: { content: PersonContent }) {
  const vitals = content.vitals;
  if (!vitals) {
    return (
      <section className="modal-section compact">
        <p className="empty-state">Vitals are not available here.</p>
      </section>
    );
  }

  return (
    <div className="modal-sections">
      <div className="vitals-grid">
        <section className="modal-section compact">
          <div className="modal-section-head">
            <h3>Contact</h3>
          </div>
          <dl className="vitals-list">
            <VitalRow label="Phone" value={vitals.phones} />
            <VitalRow label="Email" value={vitals.email} href={mailHref(vitals.email)} />
            <VitalRow label="Address" value={vitals.address} />
          </dl>
        </section>

        <section className="modal-section compact">
          <div className="modal-section-head">
            <h3>Personal</h3>
          </div>
          <dl className="vitals-list">
            <VitalRow label="Age" value={vitals.age} />
            <VitalRow label="Occupation" value={vitals.occupation} />
            <VitalRow label="Birth Date" value={vitals.birthDate} />
            {vitals.deathDate ? <VitalRow label="Death Date" value={vitals.deathDate} /> : null}
            <VitalRow label="Gender" value={displayGender(vitals.gender)} />
          </dl>
        </section>
      </div>
    </div>
  );
}

function mediaTitle(media: PersonMediaItem) {
  return normalize(media.label) || normalize(media.fileName) || normalize(media.fileId) || "Untitled media";
}

function mediaDate(media: PersonMediaItem) {
  return normalize(media.photoDate) || normalize(media.createdAt);
}

function isImageMedia(media: PersonMediaItem) {
  return normalizeLower(media.mediaKind) === "image" || normalizeLower(media.mimeType).startsWith("image/");
}

function MediaTab({ content }: { content: PersonContent }) {
  if (!content.media.length) {
    return (
      <section className="modal-section compact">
        <p className="empty-state">No media is available here yet.</p>
      </section>
    );
  }

  return (
    <div className="person-media-grid">
      {content.media.map((media) => {
        const title = mediaTitle(media);
        const date = mediaDate(media);
        const imagePreview = isImageMedia(media) && media.previewUrl;
        return (
          <article key={media.linkId || media.mediaId || media.fileId} className="person-media-card">
            {imagePreview ? (
              <Image className="person-media-thumb" src={media.previewUrl} alt={title} width={420} height={315} unoptimized />
            ) : (
              <div className="person-media-placeholder">{formatVitalValue(media.mediaKind, "Media")}</div>
            )}
            <div className="person-media-copy">
              <h3>{title}</h3>
              {date ? <p className="person-media-date">{date}</p> : null}
              {media.description ? <p className="person-media-description">{media.description}</p> : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function formatConversationDate(value: string) {
  const raw = normalize(value);
  if (!raw) return "";
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(parsed));
}

function ConversationsTab({ content }: { content: PersonContent }) {
  if (!content.conversations.length) {
    return (
      <section className="modal-section compact">
        <p className="empty-state">No conversations are available here yet.</p>
      </section>
    );
  }

  return (
    <div className="person-conversation-list">
      {content.conversations.map((conversation) => (
        <Link
          key={`${conversation.circleId}:${conversation.conversationId}`}
          className="person-conversation-card"
          href={`/conversations?circleId=${encodeURIComponent(conversation.circleId)}&conversationId=${encodeURIComponent(conversation.conversationId)}`}
        >
          <span>
            <strong>{conversation.title}</strong>
            <small>{conversation.circleTitle}</small>
          </span>
          <span className="person-conversation-meta">
            {conversation.unreadCount > 0 ? <em>{conversation.unreadCount}</em> : null}
            {formatConversationDate(conversation.lastActivityAt)}
          </span>
        </Link>
      ))}
    </div>
  );
}

function DeferredContentTab({ label }: { label: "Stories" }) {
  return (
    <section className="modal-section compact">
      <p className="empty-state">{label} are not populated in this MVP pass.</p>
    </section>
  );
}

function RelativeModal({
  selected,
  personContent,
  settings,
  onClose,
  onSave,
  settingsLoading,
  saveBusy,
  modalError,
  setSettings,
}: {
  selected: SelectedRelative;
  personContent: PersonContent;
  settings: ModalSettings | null;
  onClose: () => void;
  onSave: () => Promise<void>;
  settingsLoading: boolean;
  saveBusy: boolean;
  modalError: string;
  setSettings: Dispatch<SetStateAction<ModalSettings | null>>;
}) {
  const [activeTab, setActiveTab] = useState<PersonDetailTab>("overview");
  const sharing = shareSummary(selected.visibilityRow);
  const subscription = subscriptionSummary(selected.subscriptionRow);
  const canEditPersonRules = selected.category !== "self";
  const relationshipLabel = RELATIONSHIP_LABELS[selected.category];
  const contentResult = availableContentResult(selected.visibilityRow);

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="relative-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">Person Details</p>
            <h2 id="relative-settings-title" className="bucket-title">
              {selected.person.displayName}
            </h2>
            <div className="person-meta modal-meta">
              <span className={`badge ${selected.category === "self" ? "self" : "side"}`}>
                {relationshipLabel}
              </span>
              {selected.person.lineageSides
                .filter((side) => side !== "not_applicable")
                .map((side) => (
                  <span key={`${selected.person.personId}:${side}`} className="badge side">
                    {readSideLabel(side)}
                  </span>
                ))}
              <span className={`badge state ${subscription.badgeClass}`}>{subscription.label}</span>
              <span className={`badge state ${sharing.badgeClass}`}>{sharing.label}</span>
            </div>
          </div>
          <button className="secondary-button modal-close-button" type="button" onClick={onClose} aria-label="Close">
            X
          </button>
        </div>

        <div className="modal-content">
          {modalError ? <p className="error-text modal-error">{modalError}</p> : null}
          {settingsLoading ? <p className="muted modal-loading">Loading person settings...</p> : null}

          {!settingsLoading && settings ? (
            <>
            <div className="person-detail-tabs" role="tablist" aria-label="Person detail tabs">
              {PERSON_DETAIL_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`person-detail-tab${activeTab === tab.id ? " is-active" : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="modal-tab-body">
              {activeTab === "overview" ? (
                <div className="modal-sections">
                  <div className="person-detail-grid">
                    <article className="stat-card">
                      <p className="stat-label">Person</p>
                      <p className="stat-value recompute-value">{selected.person.displayName}</p>
                    </article>
                    <article className="stat-card">
                      <p className="stat-label">Relationship</p>
                      <p className="stat-value recompute-value">{relationshipLabel}</p>
                    </article>
                    <article className="stat-card">
                      <p className="stat-label">Updates</p>
                      <p className="stat-value recompute-value">{subscription.label}</p>
                    </article>
                    <article className="stat-card">
                      <p className="stat-label">Available Content</p>
                      <p className="stat-value recompute-value">{contentResult}</p>
                    </article>
                  </div>
                </div>
              ) : null}

              {activeTab === "vitals" ? <VitalsTab content={personContent} /> : null}
              {activeTab === "media" ? <MediaTab content={personContent} /> : null}
              {activeTab === "stories" ? <DeferredContentTab label="Stories" /> : null}
              {activeTab === "conversations" ? <ConversationsTab content={personContent} /> : null}

              {activeTab === "rules" ? (
                <div className="modal-sections">
                  <div className="person-detail-grid compact">
                    <article className="stat-card">
                      <p className="stat-label">Updates</p>
                      <p className="stat-value recompute-value">{subscription.label}</p>
                    </article>
                    <article className="stat-card">
                      <p className="stat-label">Available Content</p>
                      <p className="stat-value recompute-value">{contentResult}</p>
                    </article>
                  </div>

                  <section className="modal-section compact">
                    {canEditPersonRules ? (
                      <div className="preference-stack">
                        <div className="preference-row">
                          <div className="preference-copy">
                            <span className="preference-title">Updates About This Person</span>
                            <span className="preference-detail">
                              {settings.subscriptionUseDefault
                                ? `Following default: ${subscription.label}`
                                : settings.receiveUpdates
                                  ? "Custom for this person: updates enabled"
                                  : "Custom for this person: updates muted"}
                            </span>
                          </div>
                          <div className="preference-controls">
                            <PreferenceModeControl
                              label="Updates mode"
                              useDefault={settings.subscriptionUseDefault}
                              onChange={(useDefault) =>
                                setSettings((current) =>
                                  current
                                    ? {
                                        ...current,
                                        subscriptionUseDefault: useDefault,
                                      }
                                    : current,
                                )
                              }
                            />
                            {!settings.subscriptionUseDefault ? (
                              <label className="compact-check">
                                <input
                                  type="checkbox"
                                  checked={settings.receiveUpdates}
                                  onChange={(event) =>
                                    setSettings((current) =>
                                      current
                                        ? {
                                            ...current,
                                            receiveUpdates: event.target.checked,
                                          }
                                        : current,
                                    )
                                  }
                                />
                                Get updates
                              </label>
                            ) : null}
                          </div>
                        </div>

                        <div className="preference-row is-sharing">
                          <div className="preference-copy">
                            <span className="preference-title">You Share With This Person</span>
                            <span className="preference-detail">
                              {settings.sharingUseDefault
                                ? "Following your default sharing"
                                : "Custom sharing to this person"}
                            </span>
                          </div>
                          <div className="preference-controls share-controls">
                            <PreferenceModeControl
                              label="Sharing mode"
                              useDefault={settings.sharingUseDefault}
                              onChange={(useDefault) =>
                                setSettings((current) =>
                                  current
                                    ? {
                                        ...current,
                                        sharingUseDefault: useDefault,
                                      }
                                    : current,
                                )
                              }
                            />
                            {!settings.sharingUseDefault ? (
                              <div className="scope-toggle-row">
                                {SHARING_SCOPE_OPTIONS.map(({ field, label }) => (
                                  <label key={field} className="compact-check scope-check">
                                    <input
                                      type="checkbox"
                                      checked={settings.sharingScopes[field]}
                                      onChange={(event) =>
                                        setSettings((current) =>
                                          current
                                            ? {
                                                ...current,
                                                sharingScopes: {
                                                  ...current.sharingScopes,
                                                  [field]: event.target.checked,
                                                },
                                              }
                                            : current,
                                        )
                                      }
                                    />
                                    {label}
                                  </label>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="muted">Your own profile is always visible and available to you.</p>
                    )}
                  </section>
                </div>
              ) : null}
            </div>
          </>
          ) : null}
        </div>

        {settings ? (
          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={onClose} disabled={saveBusy}>
              {canEditPersonRules ? "Cancel" : "Close"}
            </button>
            {canEditPersonRules ? (
              <button className="primary-button" type="button" onClick={() => void onSave()} disabled={saveBusy}>
                {saveBusy ? "Saving..." : "Save and Apply"}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

const TREE_CARD_WIDTH = 96;
const TREE_CARD_HEIGHT = 96;
const TREE_CARD_HALF_WIDTH = TREE_CARD_WIDTH / 2;
const TREE_CARD_HALF_HEIGHT = TREE_CARD_HEIGHT / 2;
const TREE_SPOUSE_GAP = -18;
const TREE_UNIT_GAP = 26;
const TREE_ROW_GAP = 154;
const TREE_LAYOUT_PADDING = 54;
const TREE_MIN_FIT_SCALE = 0.42;

type FocusedTreeNode = {
  personId: string;
  x: number;
  y: number;
  isFocused: boolean;
};

type FocusedTreeHousehold = {
  key: string;
  label: string;
  parentIds: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  isFocused: boolean;
};

type FocusedTreeLine = {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type FocusedTreeLayout = {
  width: number;
  height: number;
  nodes: FocusedTreeNode[];
  households: FocusedTreeHousehold[];
  lines: FocusedTreeLine[];
  anchor: { x: number; y: number; width: number; height: number };
  key: string;
};

function firstNameForTree(person: TreePerson) {
  return normalize(person.displayName).split(/\s+/)[0] || person.displayName;
}

function personNodeBounds(node: FocusedTreeNode) {
  return {
    minX: node.x - TREE_CARD_HALF_WIDTH,
    maxX: node.x + TREE_CARD_HALF_WIDTH,
    minY: node.y - TREE_CARD_HALF_HEIGHT,
    maxY: node.y + TREE_CARD_HALF_HEIGHT,
  };
}

function mapUnitWidth(personCount: number, gap: number) {
  if (personCount <= 0) return 0;
  return personCount * TREE_CARD_WIDTH + Math.max(0, personCount - 1) * gap;
}

function compactGapForCount(count: number) {
  if (count >= 8) return 8;
  if (count >= 6) return 12;
  if (count >= 4) return 18;
  return TREE_UNIT_GAP;
}

function buildFocusedTreeLayout(graph: TreeGraphModel, focusedPersonId: string, focusGroup: FocusGroup): FocusedTreeLayout | null {
  const focusedPerson = graph.peopleById.get(focusedPersonId);
  if (!focusedPerson) return null;

  const nodes = new Map<string, FocusedTreeNode>();
  const households: FocusedTreeHousehold[] = [];
  const lines: FocusedTreeLine[] = [];
  const focusedParentUnit = findParentHouseholdUnit(graph, focusedPersonId);
  const focusedParentIds = parentIdsForPerson(graph, focusedPersonId, focusedParentUnit);
  const ownHouseholdUnit = findPrimaryOwnHouseholdUnit(graph, focusedPersonId);
  const hasSpouse = (graph.spousesByPerson.get(focusedPersonId)?.size ?? 0) > 0;
  const shouldCenterParents = focusGroup === "parents" && focusedParentIds.length > 0;
  const shouldShowSiblingGeneration = focusGroup === "siblings";
  const parentIds = shouldCenterParents ? [] : focusedParentIds;
  const centerUnit = shouldCenterParents ? focusedParentUnit : shouldShowSiblingGeneration ? null : ownHouseholdUnit;
  const centerPersonIds = shouldCenterParents
    ? focusedParentIds
    : shouldShowSiblingGeneration
      ? siblingIdsForPerson(graph, focusedPersonId)
      : ownHouseholdUnit
        ? ownHouseholdUnit.parentIds
        : !hasSpouse
          ? siblingIdsForPerson(graph, focusedPersonId)
          : [focusedPersonId];
  const childIds = shouldCenterParents
    ? childIdsForParents(graph, focusedParentIds, focusedParentUnit)
    : shouldShowSiblingGeneration
      ? []
      : childIdsForPerson(graph, focusedPersonId, ownHouseholdUnit);
  const excludedHouseholdIds = new Set<string>(centerUnit ? [centerUnit.householdId] : []);
  const centerHouseholdKey = centerUnit?.householdId ?? (shouldCenterParents ? `parents-focus:${focusedPersonId}` : "");
  const hasParentRow = parentIds.length > 0;
  const parentY = 0;
  const centerY = hasParentRow ? TREE_ROW_GAP : 0;
  const childY = centerY + TREE_ROW_GAP;

  function addNode(personId: string, x: number, y: number) {
    if (!graph.peopleById.has(personId)) return;
    nodes.set(personId, {
      personId,
      x,
      y,
      isFocused: personId === focusedPersonId,
    });
  }

  function addHousehold(input: {
    key: string;
    label: string;
    parentIds: string[];
    centerX: number;
    centerY: number;
    gap?: number;
  }) {
    const parentIdsForUnit = sortedVisiblePersonIds(input.parentIds, graph.peopleById);
    if (!parentIdsForUnit.length) return;
    const gap = input.gap ?? TREE_SPOUSE_GAP;
    const width = Math.max(132, mapUnitWidth(parentIdsForUnit.length, gap) + 22);
    const nodeRowWidth = mapUnitWidth(parentIdsForUnit.length, gap);
    const firstX = input.centerX - nodeRowWidth / 2 + TREE_CARD_HALF_WIDTH;
    parentIdsForUnit.forEach((personId, index) => {
      addNode(personId, firstX + index * (TREE_CARD_WIDTH + gap), input.centerY);
    });
    households.push({
      key: input.key,
      label: input.label,
      parentIds: parentIdsForUnit,
      x: input.centerX,
      y: input.centerY,
      width,
      height: TREE_CARD_HEIGHT + 32,
      isFocused: parentIdsForUnit.includes(focusedPersonId),
    });
    if (parentIdsForUnit.length > 1) {
      for (let index = 1; index < parentIdsForUnit.length; index += 1) {
        const left = nodes.get(parentIdsForUnit[index - 1]);
        const right = nodes.get(parentIdsForUnit[index]);
        if (left && right) {
          lines.push({
            key: `spouse:${input.key}:${index}`,
            x1: left.x + TREE_CARD_HALF_WIDTH - 3,
            y1: left.y,
            x2: right.x - TREE_CARD_HALF_WIDTH + 3,
            y2: right.y,
          });
        }
      }
    }
  }

  function addStandaloneRow(personIds: string[], y: number) {
    const visibleIds = sortedVisiblePersonIds(personIds, graph.peopleById);
    const gap = compactGapForCount(visibleIds.length);
    const width = mapUnitWidth(visibleIds.length, gap);
    const firstX = -width / 2 + TREE_CARD_HALF_WIDTH;
    visibleIds.forEach((personId, index) => {
      addNode(personId, firstX + index * (TREE_CARD_WIDTH + gap), y);
    });
  }

  if (hasParentRow) {
    addHousehold({
      key: focusedParentUnit?.householdId ?? `parents:${focusedPersonId}`,
      label: focusedParentUnit?.label ?? buildHouseholdLabel(parentIds, graph.peopleById, "Parents"),
      parentIds,
      centerX: 0,
      centerY: parentY,
    });
  }

  if (centerUnit || shouldCenterParents) {
    addHousehold({
      key: centerHouseholdKey,
      label: centerUnit?.label ?? buildHouseholdLabel(centerPersonIds, graph.peopleById, "Parents"),
      parentIds: centerPersonIds,
      centerX: 0,
      centerY,
    });
  } else {
    addStandaloneRow(centerPersonIds, centerY);
  }

  const childUnits = childIds.map((childId) => {
    const childHouseholdUnit = findPrimaryOwnHouseholdUnit(graph, childId, excludedHouseholdIds);
    const parentIdsForUnit = childHouseholdUnit ? childHouseholdUnit.parentIds : [childId];
    return {
      childId,
      unit: childHouseholdUnit,
      parentIds: parentIdsForUnit,
      width: childHouseholdUnit
        ? Math.max(132, mapUnitWidth(parentIdsForUnit.length, TREE_SPOUSE_GAP) + 22)
        : TREE_CARD_WIDTH,
    };
  });

  if (childUnits.length > 0) {
    const childGap = compactGapForCount(childUnits.length);
    const totalChildWidth =
      childUnits.reduce((sum, unit) => sum + unit.width, 0) + Math.max(0, childUnits.length - 1) * childGap;
    let cursorX = -totalChildWidth / 2;
    childUnits.forEach((childUnit) => {
      const centerX = cursorX + childUnit.width / 2;
      if (childUnit.unit) {
        addHousehold({
          key: childUnit.unit.householdId,
          label: childUnit.unit.label,
          parentIds: childUnit.parentIds,
          centerX,
          centerY: childY,
        });
      } else {
        addNode(childUnit.childId, centerX, childY);
      }
      cursorX += childUnit.width + childGap;
    });
  }

  if (hasParentRow) {
    const targetIds = shouldShowSiblingGeneration ? centerPersonIds : [focusedPersonId];
    targetIds.forEach((targetId) => {
      const target = nodes.get(targetId);
      if (!target) return;
      parentIds.forEach((parentId) => {
        const parent = nodes.get(parentId);
        if (!parent) return;
        lines.push({
          key: `parent:${parentId}:${targetId}`,
          x1: parent.x,
          y1: parent.y + TREE_CARD_HALF_HEIGHT,
          x2: target.x,
          y2: target.y - TREE_CARD_HALF_HEIGHT,
        });
      });
    });
  }

  if (childUnits.length > 0) {
    const sourceIds = centerUnit ? centerUnit.parentIds : [focusedPersonId];
    childUnits.forEach((childUnit) => {
      const childNode = nodes.get(childUnit.childId);
      if (!childNode) return;
      sourceIds.forEach((sourceId) => {
        const parentNode = nodes.get(sourceId);
        if (!parentNode) return;
        lines.push({
          key: `child:${sourceId}:${childUnit.childId}`,
          x1: parentNode.x,
          y1: parentNode.y + TREE_CARD_HALF_HEIGHT,
          x2: childNode.x,
          y2: childNode.y - TREE_CARD_HALF_HEIGHT,
        });
      });
    });
  }

  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  function includeBounds(next: { minX: number; maxX: number; minY: number; maxY: number }) {
    bounds.minX = Math.min(bounds.minX, next.minX);
    bounds.maxX = Math.max(bounds.maxX, next.maxX);
    bounds.minY = Math.min(bounds.minY, next.minY);
    bounds.maxY = Math.max(bounds.maxY, next.maxY);
  }

  nodes.forEach((node) => {
    includeBounds(personNodeBounds(node));
  });
  households.forEach((household) => {
    includeBounds({
      minX: household.x - household.width / 2,
      maxX: household.x + household.width / 2,
      minY: household.y - household.height / 2,
      maxY: household.y + household.height / 2,
    });
  });
  lines.forEach((line) => {
    includeBounds({
      minX: Math.min(line.x1, line.x2),
      maxX: Math.max(line.x1, line.x2),
      minY: Math.min(line.y1, line.y2),
      maxY: Math.max(line.y1, line.y2),
    });
  });

  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.minY) || !Number.isFinite(bounds.maxY)) {
    return null;
  }
  const shiftX = TREE_LAYOUT_PADDING - bounds.minX;
  const shiftY = TREE_LAYOUT_PADDING - bounds.minY;
  const shiftedNodes = Array.from(nodes.values()).map((node) => ({ ...node, x: node.x + shiftX, y: node.y + shiftY }));
  const shiftedHouseholds = households.map((household) => ({ ...household, x: household.x + shiftX, y: household.y + shiftY }));
  const shiftedLines = lines.map((line) => ({
    ...line,
    x1: line.x1 + shiftX,
    y1: line.y1 + shiftY,
    x2: line.x2 + shiftX,
    y2: line.y2 + shiftY,
  }));
  const focusedNode = shiftedNodes.find((node) => node.personId === focusedPersonId);
  const focusedHousehold = shouldCenterParents
    ? shiftedHouseholds.find((household) => household.key === centerHouseholdKey)
    : shiftedHouseholds.find((household) => household.parentIds.includes(focusedPersonId));
  const anchor = shouldCenterParents && focusedHousehold
    ? {
        x: focusedHousehold.x - focusedHousehold.width / 2,
        y: focusedHousehold.y - focusedHousehold.height / 2,
        width: focusedHousehold.width,
        height: focusedHousehold.height,
      }
    : focusedNode
    ? { x: focusedNode.x - TREE_CARD_HALF_WIDTH, y: focusedNode.y - TREE_CARD_HALF_HEIGHT, width: TREE_CARD_WIDTH, height: TREE_CARD_HEIGHT }
    : focusedHousehold
      ? {
          x: focusedHousehold.x - focusedHousehold.width / 2,
          y: focusedHousehold.y - focusedHousehold.height / 2,
          width: focusedHousehold.width,
          height: focusedHousehold.height,
        }
      : { x: TREE_LAYOUT_PADDING, y: TREE_LAYOUT_PADDING, width: TREE_CARD_WIDTH, height: TREE_CARD_HEIGHT };

  return {
    width: Math.ceil(bounds.maxX - bounds.minX + TREE_LAYOUT_PADDING * 2),
    height: Math.ceil(bounds.maxY - bounds.minY + TREE_LAYOUT_PADDING * 2),
    nodes: shiftedNodes,
    households: shiftedHouseholds,
    lines: shiftedLines,
    anchor,
    key: `${focusedPersonId}:${focusGroup}:${childUnits.map((unit) => unit.childId).join(",")}`,
  };
}

function PersonTreeCard({
  person,
  relation,
  isFocused,
  onSelect,
}: {
  person: TreePerson;
  relation: SelectedRelative | undefined;
  isFocused: boolean;
  onSelect: (personId: string) => void;
}) {
  const relationshipLabel = relation ? RELATIONSHIP_LABELS[relation.category] : "Family";

  return (
    <button
      type="button"
      className={`family-person-card${isFocused ? " is-focused" : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => onSelect(person.personId)}
      aria-label={`${person.displayName}, ${relationshipLabel}`}
      title={person.displayName}
    >
      <Image className="family-person-avatar" src={avatarUrlForPerson(person)} alt="" width={42} height={42} aria-hidden="true" />
      <span className="family-person-copy">
        <span className="family-person-name">{firstNameForTree(person)}</span>
      </span>
    </button>
  );
}

function FocusedTreeMap({
  focusedPersonId,
  focusGroup,
  graph,
  zoom,
  fitNonce,
  onSelect,
}: {
  focusedPersonId: string;
  focusGroup: FocusGroup;
  graph: TreeGraphModel;
  zoom: number;
  fitNonce: number;
  onSelect: (personId: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const animationTimeoutRef = useRef<number | null>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  const fitScaleRef = useRef(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [fitScale, setFitScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [animateViewport, setAnimateViewport] = useState(false);
  const layout = useMemo(() => buildFocusedTreeLayout(graph, focusedPersonId, focusGroup), [focusGroup, focusedPersonId, graph]);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    fitScaleRef.current = fitScale;
  }, [fitScale]);

  useEffect(() => {
    return () => {
      if (animationTimeoutRef.current !== null) {
        window.clearTimeout(animationTimeoutRef.current);
      }
    };
  }, []);

  const applyOffset = useCallback((nextOffset: { x: number; y: number }, animate = false) => {
    offsetRef.current = nextOffset;
    setOffset(nextOffset);
    if (!animate) {
      setAnimateViewport(false);
      return;
    }
    setAnimateViewport(true);
    if (animationTimeoutRef.current !== null) {
      window.clearTimeout(animationTimeoutRef.current);
    }
    animationTimeoutRef.current = window.setTimeout(() => {
      setAnimateViewport(false);
      animationTimeoutRef.current = null;
    }, 320);
  }, []);

  const centerOnAnchor = useCallback(
    (animate = true) => {
      const viewport = viewportRef.current;
      if (!viewport || !layout) return;
      const rect = viewport.getBoundingClientRect();
      const viewportPadding = Math.min(34, Math.max(18, rect.width * 0.04));
      const availableWidth = Math.max(160, rect.width - viewportPadding * 2);
      const availableHeight = Math.max(180, rect.height - viewportPadding * 2);
      const nextFitScale = Math.min(
        1,
        Math.max(TREE_MIN_FIT_SCALE, Math.min(availableWidth / layout.width, availableHeight / layout.height)),
      );
      const nextScale = nextFitScale * zoomRef.current;
      const scaledWidth = layout.width * nextScale;
      const scaledHeight = layout.height * nextScale;
      const anchorCenterX = layout.anchor.x + layout.anchor.width / 2;
      const anchorCenterY = layout.anchor.y + layout.anchor.height / 2;
      const desiredX = rect.width / 2 - anchorCenterX * nextScale;
      const desiredY = rect.height * 0.46 - anchorCenterY * nextScale;
      const clampOffset = (desired: number, viewportSize: number, scaledSize: number) => {
        if (scaledSize <= viewportSize - viewportPadding * 2) {
          return (viewportSize - scaledSize) / 2;
        }
        const min = viewportSize - viewportPadding - scaledSize;
        const max = viewportPadding;
        return Math.min(max, Math.max(min, desired));
      };
      fitScaleRef.current = nextFitScale;
      setFitScale(nextFitScale);
      applyOffset(
        {
          x: clampOffset(desiredX, rect.width, scaledWidth),
          y: clampOffset(desiredY, rect.height, scaledHeight),
        },
        animate,
      );
    },
    [applyOffset, layout],
  );

  useEffect(() => {
    centerOnAnchor(true);
  }, [centerOnAnchor, fitNonce, layout?.key, zoom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => centerOnAnchor(false));
    });
    observer.observe(viewport);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [centerOnAnchor]);

  if (!layout) {
    return (
      <div ref={viewportRef} className="family-tree-viewport">
        <p className="family-empty-tree-note">Select a person to view their family context.</p>
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      className={`family-tree-viewport${isPanning ? " is-panning" : ""}`}
      onPointerDown={(event) => {
        if (event.pointerType !== "touch" && event.button !== 0) return;
        if (event.target instanceof Element && event.target.closest(".family-person-card")) return;
        setAnimateViewport(false);
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: offsetRef.current.x,
          originY: offsetRef.current.y,
        };
        setIsPanning(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
        applyOffset(
          {
            x: dragRef.current.originX + event.clientX - dragRef.current.startX,
            y: dragRef.current.originY + event.clientY - dragRef.current.startY,
          },
          false,
        );
      }}
      onPointerUp={(event) => {
        if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
        dragRef.current = null;
        setIsPanning(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={(event) => {
        dragRef.current = null;
        setIsPanning(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
    >
      <div
        className={`family-tree-board${animateViewport ? " is-animating" : ""}`}
        style={{
          width: `${layout.width}px`,
          height: `${layout.height}px`,
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${fitScale * zoom})`,
        }}
      >
        <svg
          className="family-map-lines"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          aria-hidden="true"
          style={{ width: `${layout.width}px`, height: `${layout.height}px` }}
        >
          {layout.lines.map((line) => (
            <line key={line.key} className="family-map-line" x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
          ))}
        </svg>
        {layout.households.map((household) => (
          <div
            key={household.key}
            className={`family-map-household-frame${household.isFocused ? " is-focused" : ""}`}
            style={{
              left: `${household.x}px`,
              top: `${household.y}px`,
              width: `${household.width}px`,
              height: `${household.height}px`,
            }}
            aria-hidden="true"
          >
            <span>{household.label}</span>
          </div>
        ))}
        {layout.nodes.map((node) => {
          const person = graph.peopleById.get(node.personId);
          if (!person) return null;
          return (
            <div key={node.personId} className="family-map-node" style={{ left: `${node.x}px`, top: `${node.y}px` }}>
              <PersonTreeCard
                person={person}
                relation={graph.relationByPersonId.get(node.personId)}
                isFocused={node.isFocused}
                onSelect={onSelect}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TreeClient({
  session,
  snapshot,
  visibilityRows,
  subscriptionRows,
  personContentById,
}: {
  session: SessionInfo;
  snapshot: TreeSnapshot;
  recomputeStatus: AccessRecomputeStatus;
  visibilityRows: ProfileVisibilityMapRow[];
  subscriptionRows: ProfileSubscriptionMapRow[];
  personContentById: Record<string, PersonContent>;
}) {
  const [focusedPersonId, setFocusedPersonId] = useState(snapshot.viewer.personId);
  const [focusGroup, setFocusGroup] = useState<FocusGroup>("household");
  const [selected, setSelected] = useState<SelectedRelative | null>(null);
  const [settings, setSettings] = useState<ModalSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [modalError, setModalError] = useState("");
  const [treeSearch, setTreeSearch] = useState("");
  const [zoom, setZoom] = useState(1);
  const [fitNonce, setFitNonce] = useState(0);
  const [localVisibilityRows, setLocalVisibilityRows] = useState(visibilityRows);
  const [localSubscriptionRows, setLocalSubscriptionRows] = useState(subscriptionRows);

  useEffect(() => {
    setLocalVisibilityRows(visibilityRows);
  }, [visibilityRows]);

  useEffect(() => {
    setLocalSubscriptionRows(subscriptionRows);
  }, [subscriptionRows]);

  const visibilityByTarget = useMemo(
    () => new Map(localVisibilityRows.map((row) => [row.targetPersonId, row])),
    [localVisibilityRows],
  );
  const subscriptionByTarget = useMemo(
    () => new Map(localSubscriptionRows.map((row) => [row.targetPersonId, row])),
    [localSubscriptionRows],
  );
  const graph = useMemo(() => buildTreeGraphModel(snapshot), [snapshot]);
  const effectiveFocusedPersonId = graph.visiblePersonIds.has(focusedPersonId) ? focusedPersonId : snapshot.viewer.personId;
  const focusedPerson =
    graph.peopleById.get(effectiveFocusedPersonId) ?? graph.peopleById.get(snapshot.viewer.personId) ?? null;
  const focusedRelation = focusedPerson ? graph.relationByPersonId.get(focusedPerson.personId) : undefined;
  const activeHouseholdIds = useMemo(
    () => graph.householdIdsByPerson.get(effectiveFocusedPersonId) ?? [],
    [effectiveFocusedPersonId, graph.householdIdsByPerson],
  );
  const activeHouseholdId = activeHouseholdIds[0] ?? "";
  const activeHousehold = graph.units.find((unit) => unit.householdId === activeHouseholdId) ?? null;
  const focusNavigation = useMemo(() => {
    if (!focusedPerson) {
      return {
        household: [] as TreePerson[],
        parents: [] as TreePerson[],
        spouses: [] as TreePerson[],
        siblings: [] as TreePerson[],
        children: [] as TreePerson[],
      };
    }
    const parents = Array.from(graph.parentsByChild.get(focusedPerson.personId) ?? [])
      .map((personId) => graph.peopleById.get(personId))
      .filter((person): person is TreePerson => Boolean(person))
      .sort(compareTreePeopleByBirth);
    const spouses = Array.from(graph.spousesByPerson.get(focusedPerson.personId) ?? [])
      .map((personId) => graph.peopleById.get(personId))
      .filter((person): person is TreePerson => Boolean(person))
      .sort(compareTreePeopleByBirth);
    const siblingIds = new Set<string>();
    for (const parent of parents) {
      for (const siblingId of graph.childrenByParent.get(parent.personId) ?? []) {
        if (siblingId !== focusedPerson.personId) siblingIds.add(siblingId);
      }
    }
    const siblings = Array.from(siblingIds)
      .map((personId) => graph.peopleById.get(personId))
      .filter((person): person is TreePerson => Boolean(person))
      .sort(compareTreePeopleByBirth);
    const children = Array.from(graph.childrenByParent.get(focusedPerson.personId) ?? [])
      .map((personId) => graph.peopleById.get(personId))
      .filter((person): person is TreePerson => Boolean(person))
      .sort(compareTreePeopleByBirth);
    const household = activeHousehold
      ? activeHousehold.parentIds
          .map((personId) => graph.peopleById.get(personId))
          .filter((person): person is TreePerson => Boolean(person))
          .sort(compareTreePeopleByBirth)
      : [focusedPerson];
    return { household, parents, spouses, siblings, children };
  }, [activeHousehold, focusedPerson, graph.childrenByParent, graph.parentsByChild, graph.peopleById, graph.spousesByPerson]);

  const searchResults = useMemo(() => {
    const query = treeSearch.trim().toLowerCase();
    if (!query) return [];
    return graph.visiblePeople.filter((person) => person.displayName.toLowerCase().includes(query)).slice(0, 8);
  }, [graph.visiblePeople, treeSearch]);

  const focusPeople = focusNavigation[focusGroup];

  function selectedRelativeForPerson(personId: string): SelectedRelative | null {
    const relation = graph.relationByPersonId.get(personId);
    if (!relation) return null;
    return {
      ...relation,
      visibilityRow: visibilityByTarget.get(personId),
      subscriptionRow: subscriptionByTarget.get(personId),
    };
  }

  function selectPerson(personId: string) {
    if (!graph.visiblePersonIds.has(personId)) return;
    const next = selectedRelativeForPerson(personId);
    if (!next) return;
    if (focusedPersonId === personId) {
      void openRelative(next);
      return;
    }
    setFocusedPersonId(personId);
    setFocusGroup("household");
    setTreeSearch("");
  }

  async function openRelative(selectedPerson: SelectedRelative) {
    const targetPersonId = selectedPerson.person.personId;
    setSelected(selectedPerson);
    setSettings(null);
    setModalError("");
    setSettingsLoading(true);

    try {
      const state = (await fetchJson(
        `/api/access/person-settings?targetPersonId=${encodeURIComponent(targetPersonId)}`,
      )) as TargetPersonSettingsState;
      const subscriptionException = state.subscriptionException ?? null;
      const shareException = state.shareException ?? null;
      const subscriptionRow = state.subscriptionRow ?? selectedPerson.subscriptionRow;

      setLocalVisibilityRows((current) => replaceTargetRow(current, targetPersonId, state.visibilityRow));
      setLocalSubscriptionRows((current) => replaceTargetRow(current, targetPersonId, state.subscriptionRow));
      setSelected((current) =>
        current && current.person.personId === targetPersonId
          ? {
              ...current,
              visibilityRow: state.visibilityRow ?? undefined,
              subscriptionRow: state.subscriptionRow ?? undefined,
            }
          : current,
      );

      setSettings({
        subscriptionException,
        shareException,
        subscriptionUseDefault: !subscriptionException,
        receiveUpdates: subscriptionException ? subscriptionException.effect === "allow" : (subscriptionRow?.isSubscribed ?? true),
        sharingUseDefault: !shareException,
        sharingScopes: sharingScopesFromException(shareException ?? undefined),
      });
    } catch (error) {
      setModalError(error instanceof Error ? error.message : "Failed to load settings.");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function saveSelectedRelative() {
    if (!selected || !settings) return;

    const targetPersonId = selected.person.personId;
    const nextSubscriptionException = settings.subscriptionUseDefault
      ? null
      : {
          targetPersonId,
          effect: settings.receiveUpdates ? ("allow" as const) : ("deny" as const),
        };
    const sharesAnyScope = Object.values(settings.sharingScopes).some(Boolean);
    const nextShareException = settings.sharingUseDefault
      ? null
      : {
          targetPersonId,
          effect: sharesAnyScope ? ("allow" as const) : ("deny" as const),
          shareVitals: settings.sharingScopes.shareVitals,
          shareStories: settings.sharingScopes.shareStories,
          shareMedia: settings.sharingScopes.shareMedia,
          shareConversations: settings.sharingScopes.shareConversations,
        };
    const originalSubscriptionException = subscriptionPayloadFromException(settings.subscriptionException);
    const originalShareException = sharePayloadFromException(settings.shareException);
    const savePayload: {
      targetPersonId: string;
      subscriptionException?: TargetSubscriptionExceptionPayload | null;
      shareException?: TargetShareExceptionPayload | null;
    } = { targetPersonId };

    if (JSON.stringify(originalSubscriptionException) !== JSON.stringify(nextSubscriptionException)) {
      savePayload.subscriptionException = nextSubscriptionException;
    }
    if (JSON.stringify(originalShareException) !== JSON.stringify(nextShareException)) {
      savePayload.shareException = nextShareException;
    }

    if (
      !Object.prototype.hasOwnProperty.call(savePayload, "subscriptionException") &&
      !Object.prototype.hasOwnProperty.call(savePayload, "shareException")
    ) {
      setSelected(null);
      setSettings(null);
      setModalError("");
      return;
    }

    setSaveBusy(true);
    setModalError("");
    try {
      const response = (await fetchJson("/api/access/person-settings", {
        method: "PUT",
        body: JSON.stringify(savePayload),
      })) as PersonSettingsSaveResponse;
      if (response.state) {
        setLocalVisibilityRows((current) =>
          replaceTargetRow(current, targetPersonId, response.state?.visibilityRow ?? null),
        );
        setLocalSubscriptionRows((current) =>
          replaceTargetRow(current, targetPersonId, response.state?.subscriptionRow ?? null),
        );
      }
      setSelected(null);
      setSettings(null);
    } catch (error) {
      setModalError(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <main className="shell">
      <FamailinkChrome active="tree" username={session.username} personId={session.personId} />

      <section className="family-tree-shell">
        <div className="family-tree-toolbar">
          <div className="family-tree-search">
            <label className="field-label" htmlFor="family-tree-search">
              Find a person
            </label>
            <input
              id="family-tree-search"
              className="input"
              type="search"
              value={treeSearch}
              onChange={(event) => setTreeSearch(event.target.value)}
              placeholder="Search this tree"
            />
            {searchResults.length > 0 ? (
              <div className="family-tree-search-results">
                {searchResults.map((person) => (
                  <button key={person.personId} type="button" onClick={() => selectPerson(person.personId)}>
                    {person.displayName}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="family-tree-controls" aria-label="Tree navigation controls">
            <button type="button" className="tree-control-btn" onClick={() => setZoom((current) => Math.min(1.45, current + 0.1))} aria-label="Zoom in">
              +
            </button>
            <button type="button" className="tree-control-btn" onClick={() => setZoom((current) => Math.max(0.72, current - 0.1))} aria-label="Zoom out">
              -
            </button>
            <button
              type="button"
              className="tree-control-btn"
              onClick={() => {
                setZoom(1);
                setFitNonce((current) => current + 1);
              }}
              aria-label="Reset zoom"
            >
              Fit
            </button>
            <button
              type="button"
              className="tree-control-btn"
              onClick={() => {
                setFocusedPersonId(snapshot.viewer.personId);
                setFocusGroup("household");
                setFitNonce((current) => current + 1);
              }}
              aria-label="Return to me"
            >
              Me
            </button>
          </div>
        </div>

        <div className="family-tree-main">
          <FocusedTreeMap
            focusedPersonId={effectiveFocusedPersonId}
            focusGroup={focusGroup}
            graph={graph}
            zoom={zoom}
            fitNonce={fitNonce}
            onSelect={selectPerson}
          />

          {focusedPerson ? (
            <aside className="family-focus-panel">
              <div className="family-focus-head">
                <Image
                  className="family-person-avatar large"
                  src={avatarUrlForPerson(focusedPerson)}
                  alt=""
                  width={56}
                  height={56}
                  aria-hidden="true"
                />
                <div>
                  <h2>{focusedPerson.displayName}</h2>
                  <p>{focusedRelation ? RELATIONSHIP_LABELS[focusedRelation.category] : "Family"}</p>
                </div>
              </div>
              <div className="family-focus-actions" aria-label="Focus navigation">
                <button
                  type="button"
                  className={`tree-focus-action-chip${focusGroup === "household" ? " is-active" : ""}`}
                  onClick={() => setFocusGroup("household")}
                >
                  Household
                </button>
                <button
                  type="button"
                  className={`tree-focus-action-chip${focusGroup === "parents" ? " is-active" : ""}`}
                  disabled={focusNavigation.parents.length === 0}
                  onClick={() => setFocusGroup("parents")}
                >
                  Parents {focusNavigation.parents.length || ""}
                </button>
                <button
                  type="button"
                  className={`tree-focus-action-chip${focusGroup === "spouses" ? " is-active" : ""}`}
                  disabled={focusNavigation.spouses.length === 0}
                  onClick={() => setFocusGroup("spouses")}
                >
                  Spouse {focusNavigation.spouses.length || ""}
                </button>
                <button
                  type="button"
                  className={`tree-focus-action-chip${focusGroup === "siblings" ? " is-active" : ""}`}
                  disabled={focusNavigation.siblings.length === 0}
                  onClick={() => setFocusGroup("siblings")}
                >
                  Siblings {focusNavigation.siblings.length || ""}
                </button>
                <button
                  type="button"
                  className={`tree-focus-action-chip${focusGroup === "children" ? " is-active" : ""}`}
                  disabled={focusNavigation.children.length === 0}
                  onClick={() => setFocusGroup("children")}
                >
                  Children {focusNavigation.children.length || ""}
                </button>
              </div>
              <div className="family-focus-chip-list">
                {focusPeople.length > 0 ? (
                  focusPeople.map((person) => (
                    <button
                      key={`${focusGroup}:${person.personId}`}
                      type="button"
                      className={person.personId === effectiveFocusedPersonId ? "is-selected" : ""}
                      onClick={() => selectPerson(person.personId)}
                    >
                      <Image
                        className="family-mini-avatar"
                        src={avatarUrlForPerson(person)}
                        alt=""
                        width={24}
                        height={24}
                        aria-hidden="true"
                      />
                      <span>{person.displayName}</span>
                    </button>
                  ))
                ) : (
                  <p className="muted">No people in this focus group.</p>
                )}
              </div>
              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  const next = selectedRelativeForPerson(focusedPerson.personId);
                  if (next) void openRelative(next);
                }}
              >
                Open Person Details
              </button>
            </aside>
          ) : null}
        </div>
      </section>

      {selected ? (
        <RelativeModal
          selected={selected}
          personContent={personContentById[selected.person.personId] ?? { vitals: null, media: [], conversations: [] }}
          settings={settings}
          onClose={() => {
            if (saveBusy) return;
            setSelected(null);
            setSettings(null);
            setModalError("");
          }}
          onSave={saveSelectedRelative}
          settingsLoading={settingsLoading}
          saveBusy={saveBusy}
          modalError={modalError}
          setSettings={setSettings}
        />
      ) : null}
    </main>
  );
}
