import "server-only";

import { randomUUID } from "node:crypto";
import {
  asPreviewRow,
  createRecomputeRun,
  enqueueRecomputeJob,
  getLatestRecomputeStatus,
  listAllOwnerShareDefaults,
  listAllOwnerShareHouseholdExceptions,
  listAllOwnerSharePersonExceptions,
  listHouseholdsLite,
  listPeopleLite,
  listProfileAccessMap,
  listRelationshipsLite,
  listSubscriptionDefaults,
  listSubscriptionHouseholdExceptions,
  listSubscriptionPersonExceptions,
  replaceProfileAccessMap,
  updateRecomputeJob,
} from "@/lib/u1/access-store";
import type {
  U1EffectType,
  U1LineageSide,
  U1OwnerShareDefaultRule,
  U1OwnerShareHouseholdException,
  U1OwnerSharePersonException,
  U1PersonLite,
  U1PreviewRow,
  U1ProfileAccessMapRow,
  U1RelationshipCategory,
  U1RelationshipLite,
  U1SubscriptionDefaultRule,
  U1SubscriptionHouseholdException,
} from "@/lib/u1/types";

type ScopeKey = "vitals" | "stories" | "media" | "conversations";

type Graph = {
  peopleById: Map<string, U1PersonLite>;
  parentsByChild: Map<string, Set<string>>;
  childrenByParent: Map<string, Set<string>>;
  spousesByPerson: Map<string, Set<string>>;
};

function normalize(value?: string) {
  return String(value ?? "").trim();
}

function normalizeLower(value?: string) {
  return normalize(value).toLowerCase();
}

function toIsoNow() {
  return new Date().toISOString();
}

function isParentEdge(rel: U1RelationshipLite) {
  return normalizeLower(rel.relType) === "parent";
}

function isSpouseEdge(rel: U1RelationshipLite) {
  const type = normalizeLower(rel.relType);
  return type === "spouse" || type === "family";
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

function buildGraph(people: U1PersonLite[], relationships: U1RelationshipLite[]): Graph {
  const peopleById = new Map<string, U1PersonLite>();
  for (const person of people) {
    const personId = normalize(person.personId);
    if (!personId) continue;
    if (peopleById.has(personId)) continue;
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
  return {
    peopleById,
    parentsByChild,
    childrenByParent,
    spousesByPerson,
  };
}

function parentLineageSide(person: U1PersonLite | null): U1LineageSide {
  const gender = normalizeLower(person?.gender);
  if (gender === "female") return "maternal";
  if (gender === "male") return "paternal";
  return "both";
}

function addHit(
  hits: Map<string, Map<U1RelationshipCategory, Set<U1LineageSide>>>,
  targetPersonId: string,
  category: U1RelationshipCategory,
  side: U1LineageSide,
) {
  const target = normalize(targetPersonId);
  if (!target) return;
  const currentByCategory = hits.get(target) ?? new Map<U1RelationshipCategory, Set<U1LineageSide>>();
  const currentSides = currentByCategory.get(category) ?? new Set<U1LineageSide>();
  currentSides.add(side);
  currentByCategory.set(category, currentSides);
  hits.set(target, currentByCategory);
}

function computeRelativeHitsForViewer(viewerPersonId: string, graph: Graph) {
  const viewerId = normalize(viewerPersonId);
  const hits = new Map<string, Map<U1RelationshipCategory, Set<U1LineageSide>>>();
  if (!viewerId || !graph.peopleById.has(viewerId)) {
    return hits;
  }

  addHit(hits, viewerId, "self", "not_applicable");

  const parentSideMap = new Map<string, Set<U1LineageSide>>();
  for (const parentId of graph.parentsByChild.get(viewerId) ?? []) {
    const side = parentLineageSide(graph.peopleById.get(parentId) ?? null);
    const sideSet = parentSideMap.get(parentId) ?? new Set<U1LineageSide>();
    sideSet.add(side);
    parentSideMap.set(parentId, sideSet);
    for (const sideValue of sideSet) {
      addHit(hits, parentId, "parents", sideValue);
    }
  }

  for (const spouseId of graph.spousesByPerson.get(viewerId) ?? []) {
    addHit(hits, spouseId, "spouse_partner", "not_applicable");
  }

  for (const childId of graph.childrenByParent.get(viewerId) ?? []) {
    addHit(hits, childId, "children", "not_applicable");
  }

  const siblingSideMap = new Map<string, Set<U1LineageSide>>();
  for (const [parentId, sides] of parentSideMap.entries()) {
    for (const siblingId of graph.childrenByParent.get(parentId) ?? []) {
      if (siblingId === viewerId) continue;
      const set = siblingSideMap.get(siblingId) ?? new Set<U1LineageSide>();
      for (const side of sides) set.add(side);
      siblingSideMap.set(siblingId, set);
    }
  }
  for (const [siblingId, sides] of siblingSideMap.entries()) {
    for (const side of sides) addHit(hits, siblingId, "siblings", side);
  }

  const grandparentSideMap = new Map<string, Set<U1LineageSide>>();
  for (const [parentId, sides] of parentSideMap.entries()) {
    for (const grandparentId of graph.parentsByChild.get(parentId) ?? []) {
      const set = grandparentSideMap.get(grandparentId) ?? new Set<U1LineageSide>();
      for (const side of sides) set.add(side);
      grandparentSideMap.set(grandparentId, set);
    }
  }
  for (const [grandparentId, sides] of grandparentSideMap.entries()) {
    for (const side of sides) addHit(hits, grandparentId, "grandparents", side);
  }

  const greatGrandparentSideMap = new Map<string, Set<U1LineageSide>>();
  for (const [grandparentId, sides] of grandparentSideMap.entries()) {
    for (const greatGrandparentId of graph.parentsByChild.get(grandparentId) ?? []) {
      const set = greatGrandparentSideMap.get(greatGrandparentId) ?? new Set<U1LineageSide>();
      for (const side of sides) set.add(side);
      greatGrandparentSideMap.set(greatGrandparentId, set);
    }
  }
  for (const [greatGrandparentId, sides] of greatGrandparentSideMap.entries()) {
    for (const side of sides) addHit(hits, greatGrandparentId, "great_grandparents", side);
  }

  const auntUncleSideMap = new Map<string, Set<U1LineageSide>>();
  for (const [parentId, sides] of parentSideMap.entries()) {
    for (const grandparentId of graph.parentsByChild.get(parentId) ?? []) {
      for (const auntUncleId of graph.childrenByParent.get(grandparentId) ?? []) {
        if (auntUncleId === parentId) continue;
        const set = auntUncleSideMap.get(auntUncleId) ?? new Set<U1LineageSide>();
        for (const side of sides) set.add(side);
        auntUncleSideMap.set(auntUncleId, set);
      }
    }
  }
  for (const [auntUncleId, sides] of auntUncleSideMap.entries()) {
    for (const side of sides) addHit(hits, auntUncleId, "aunts_uncles", side);
  }

  const grandAuntUncleSideMap = new Map<string, Set<U1LineageSide>>();
  for (const [grandparentId, sides] of grandparentSideMap.entries()) {
    for (const greatGrandparentId of graph.parentsByChild.get(grandparentId) ?? []) {
      for (const grandAuntUncleId of graph.childrenByParent.get(greatGrandparentId) ?? []) {
        if (grandAuntUncleId === grandparentId) continue;
        const set = grandAuntUncleSideMap.get(grandAuntUncleId) ?? new Set<U1LineageSide>();
        for (const side of sides) set.add(side);
        grandAuntUncleSideMap.set(grandAuntUncleId, set);
      }
    }
  }
  for (const [grandAuntUncleId, sides] of grandAuntUncleSideMap.entries()) {
    for (const side of sides) addHit(hits, grandAuntUncleId, "grand_aunts_uncles", side);
  }

  const cousinSideMap = new Map<string, Set<U1LineageSide>>();
  for (const [auntUncleId, sides] of auntUncleSideMap.entries()) {
    for (const cousinId of graph.childrenByParent.get(auntUncleId) ?? []) {
      const set = cousinSideMap.get(cousinId) ?? new Set<U1LineageSide>();
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

  for (const [siblingId, sides] of siblingSideMap.entries()) {
    for (const nieceNephewId of graph.childrenByParent.get(siblingId) ?? []) {
      for (const side of sides) addHit(hits, nieceNephewId, "nieces_nephews", side);
    }
  }

  const grandchildren = new Set<string>();
  for (const childId of graph.childrenByParent.get(viewerId) ?? []) {
    for (const grandchildId of graph.childrenByParent.get(childId) ?? []) {
      grandchildren.add(grandchildId);
      addHit(hits, grandchildId, "grandchildren", "not_applicable");
    }
  }
  for (const grandchildId of grandchildren) {
    for (const greatGrandchildId of graph.childrenByParent.get(grandchildId) ?? []) {
      addHit(hits, greatGrandchildId, "great_grandchildren", "not_applicable");
    }
  }

  return hits;
}

function sideMatches(ruleSide: U1LineageSide, sides: Set<U1LineageSide>) {
  if (ruleSide === "not_applicable") return true;
  if (sides.has("not_applicable")) return ruleSide === "both";
  if (ruleSide === "both") return true;
  if (ruleSide === "maternal") return sides.has("maternal") || sides.has("both");
  return sides.has("paternal") || sides.has("both");
}

function matchedSubscriptionDefault(
  rules: U1SubscriptionDefaultRule[],
  targetHits: Map<U1RelationshipCategory, Set<U1LineageSide>> | undefined,
) {
  if (!targetHits) return "none" as const;
  let allow = false;
  let deny = false;
  for (const rule of rules) {
    if (!rule.isActive) continue;
    const targetSides = targetHits.get(rule.relationshipCategory);
    if (!targetSides) continue;
    if (!sideMatches(rule.lineageSide, targetSides)) continue;
    if (rule.isSubscribed) allow = true;
    else deny = true;
  }
  if (deny) return "deny" as const;
  if (allow) return "allow" as const;
  return "none" as const;
}

function buildHouseholdMembersMap(
  households: ReturnType<typeof listHouseholdsLite> extends Promise<infer T> ? T : never,
  graph: Graph,
) {
  const out = new Map<string, Set<string>>();
  for (const household of households) {
    const householdId = normalize(household.householdId);
    if (!householdId) continue;
    const members = out.get(householdId) ?? new Set<string>();
    const husbandId = normalize(household.husbandPersonId);
    const wifeId = normalize(household.wifePersonId);
    if (husbandId) members.add(husbandId);
    if (wifeId) members.add(wifeId);
    for (const childId of graph.childrenByParent.get(husbandId) ?? []) members.add(childId);
    for (const childId of graph.childrenByParent.get(wifeId) ?? []) members.add(childId);
    out.set(householdId, members);
  }
  return out;
}

function buildTargetEffectMap(
  exceptions: Array<{ effect: U1EffectType; targetPersonId: string }>,
) {
  const effects = new Map<string, U1EffectType>();
  for (const row of exceptions) {
    const target = normalize(row.targetPersonId);
    if (!target) continue;
    const current = effects.get(target);
    if (row.effect === "deny" || current !== "deny") {
      effects.set(target, row.effect);
    }
  }
  return effects;
}

function buildHouseholdEffectMap(
  householdExceptions: U1SubscriptionHouseholdException[],
  householdMembersById: Map<string, Set<string>>,
) {
  const effects = new Map<string, U1EffectType>();
  for (const row of householdExceptions) {
    const householdId = normalize(row.householdId);
    if (!householdId) continue;
    for (const memberId of householdMembersById.get(householdId) ?? []) {
      const current = effects.get(memberId);
      if (row.effect === "deny" || current !== "deny") {
        effects.set(memberId, row.effect);
      }
    }
  }
  return effects;
}

function exceptionScopeApplies(
  effect: U1EffectType,
  scopeValue: boolean | null,
) {
  if (scopeValue === null) return true;
  return scopeValue;
}

type OwnerHouseholdEffectAccum = {
  allowAll: boolean;
  denyAll: boolean;
  allowScopes: Set<ScopeKey>;
  denyScopes: Set<ScopeKey>;
};

function toScopeValue(exceptionRow: U1OwnerSharePersonException | U1OwnerShareHouseholdException, scope: ScopeKey) {
  if (scope === "vitals") return exceptionRow.shareVitals;
  if (scope === "stories") return exceptionRow.shareStories;
  if (scope === "media") return exceptionRow.shareMedia;
  return exceptionRow.shareConversations;
}

function buildOwnerHouseholdEffectsByTarget(
  rows: U1OwnerShareHouseholdException[],
  householdMembersById: Map<string, Set<string>>,
) {
  const map = new Map<string, OwnerHouseholdEffectAccum>();
  for (const row of rows) {
    const householdId = normalize(row.householdId);
    if (!householdId) continue;
    const members = householdMembersById.get(householdId) ?? new Set<string>();
    for (const memberId of members) {
      const current = map.get(memberId) ?? {
        allowAll: false,
        denyAll: false,
        allowScopes: new Set<ScopeKey>(),
        denyScopes: new Set<ScopeKey>(),
      };
      for (const scope of ["vitals", "stories", "media", "conversations"] as ScopeKey[]) {
        const scopeValue = toScopeValue(row, scope);
        const applies = exceptionScopeApplies(row.effect, scopeValue);
        if (!applies) continue;
        if (row.effect === "deny") current.denyScopes.add(scope);
        if (row.effect === "allow") current.allowScopes.add(scope);
      }
      if (row.effect === "deny" && [row.shareVitals, row.shareStories, row.shareMedia, row.shareConversations].every((v) => v === null)) {
        current.denyAll = true;
      }
      if (row.effect === "allow" && [row.shareVitals, row.shareStories, row.shareMedia, row.shareConversations].every((v) => v === null)) {
        current.allowAll = true;
      }
      map.set(memberId, current);
    }
  }
  return map;
}

function deriveOwnerDefaultShareScope(
  rules: U1OwnerShareDefaultRule[],
  targetHits: Map<U1RelationshipCategory, Set<U1LineageSide>> | undefined,
  scope: ScopeKey,
) {
  if (!targetHits) return true;
  const matched = rules.filter((rule) => {
    if (!rule.isActive) return false;
    const targetSides = targetHits.get(rule.relationshipCategory);
    if (!targetSides) return false;
    return sideMatches(rule.lineageSide, targetSides);
  });
  if (!matched.length) return true;
  if (scope === "vitals") return matched.some((rule) => rule.shareVitals);
  if (scope === "stories") return matched.some((rule) => rule.shareStories);
  if (scope === "media") return matched.some((rule) => rule.shareMedia);
  return matched.some((rule) => rule.shareConversations);
}

type EffectiveScopeState = {
  vitals: boolean;
  stories: boolean;
  media: boolean;
  conversations: boolean;
};

function evaluateOwnerShareScopes(input: {
  ownerPersonId: string;
  viewerPersonId: string;
  ownerDefaults: U1OwnerShareDefaultRule[];
  ownerPersonExceptions: U1OwnerSharePersonException[];
  ownerHouseholdEffect: OwnerHouseholdEffectAccum | undefined;
  ownerHitsToViewer: Map<U1RelationshipCategory, Set<U1LineageSide>> | undefined;
}): { scopes: EffectiveScopeState; reason: string } {
  const personExceptions = input.ownerPersonExceptions.filter(
    (row) => normalize(row.targetPersonId) === normalize(input.viewerPersonId),
  );

  function resolveScope(scope: ScopeKey) {
    const personDeny = personExceptions.some(
      (row) => row.effect === "deny" && exceptionScopeApplies(row.effect, toScopeValue(row, scope)),
    );
    if (personDeny) return { allowed: false, reason: "OWNER_SHARE_DENY_PERSON" };

    const householdDeny = Boolean(
      input.ownerHouseholdEffect && (input.ownerHouseholdEffect.denyAll || input.ownerHouseholdEffect.denyScopes.has(scope)),
    );
    if (householdDeny) return { allowed: false, reason: "OWNER_SHARE_DENY_HOUSEHOLD" };

    const personAllow = personExceptions.some(
      (row) => row.effect === "allow" && exceptionScopeApplies(row.effect, toScopeValue(row, scope)),
    );
    if (personAllow) return { allowed: true, reason: "OWNER_SHARE_ALLOW_PERSON" };

    const householdAllow = Boolean(
      input.ownerHouseholdEffect && (input.ownerHouseholdEffect.allowAll || input.ownerHouseholdEffect.allowScopes.has(scope)),
    );
    if (householdAllow) return { allowed: true, reason: "OWNER_SHARE_ALLOW_HOUSEHOLD" };

    const defaultAllowed = deriveOwnerDefaultShareScope(input.ownerDefaults, input.ownerHitsToViewer, scope);
    return {
      allowed: defaultAllowed,
      reason: defaultAllowed ? "OWNER_SHARE_ALLOW_DEFAULT" : "OWNER_SHARE_DENY_DEFAULT",
    };
  }

  const vitals = resolveScope("vitals");
  const stories = resolveScope("stories");
  const media = resolveScope("media");
  const conversations = resolveScope("conversations");
  return {
    scopes: {
      vitals: vitals.allowed,
      stories: stories.allowed,
      media: media.allowed,
      conversations: conversations.allowed,
    },
    reason: [vitals.reason, stories.reason, media.reason, conversations.reason].join("|"),
  };
}

export async function computeProfileAccessRowsForViewer(viewerPersonId: string): Promise<Array<Omit<U1ProfileAccessMapRow, "mapId">>> {
  const normalizedViewer = normalize(viewerPersonId);
  if (!normalizedViewer) return [];

  const [
    people,
    relationships,
    households,
    subscriptionDefaults,
    subscriptionPersonExceptions,
    subscriptionHouseholdExceptions,
    allOwnerDefaults,
    allOwnerPersonExceptions,
    allOwnerHouseholdExceptions,
  ] = await Promise.all([
    listPeopleLite(),
    listRelationshipsLite(),
    listHouseholdsLite(),
    listSubscriptionDefaults(normalizedViewer),
    listSubscriptionPersonExceptions(normalizedViewer),
    listSubscriptionHouseholdExceptions(normalizedViewer),
    listAllOwnerShareDefaults(),
    listAllOwnerSharePersonExceptions(),
    listAllOwnerShareHouseholdExceptions(),
  ]);

  const graph = buildGraph(people, relationships);
  const viewerHits = computeRelativeHitsForViewer(normalizedViewer, graph);
  const householdMembersById = buildHouseholdMembersMap(households, graph);
  const personEffects = buildTargetEffectMap(subscriptionPersonExceptions);
  const householdEffects = buildHouseholdEffectMap(subscriptionHouseholdExceptions, householdMembersById);

  const ownerDefaultsByOwner = new Map<string, U1OwnerShareDefaultRule[]>();
  for (const row of allOwnerDefaults) {
    const key = normalize(row.ownerPersonId);
    if (!key) continue;
    const list = ownerDefaultsByOwner.get(key) ?? [];
    list.push(row);
    ownerDefaultsByOwner.set(key, list);
  }
  const ownerPersonExceptionsByOwner = new Map<string, U1OwnerSharePersonException[]>();
  for (const row of allOwnerPersonExceptions) {
    const key = normalize(row.ownerPersonId);
    if (!key) continue;
    const list = ownerPersonExceptionsByOwner.get(key) ?? [];
    list.push(row);
    ownerPersonExceptionsByOwner.set(key, list);
  }
  const ownerHouseholdExceptionsByOwner = new Map<string, U1OwnerShareHouseholdException[]>();
  for (const row of allOwnerHouseholdExceptions) {
    const key = normalize(row.ownerPersonId);
    if (!key) continue;
    const list = ownerHouseholdExceptionsByOwner.get(key) ?? [];
    list.push(row);
    ownerHouseholdExceptionsByOwner.set(key, list);
  }

  const ownerHitsCache = new Map<string, Map<string, Map<U1RelationshipCategory, Set<U1LineageSide>>>>();
  const ownerHouseholdEffectsCache = new Map<string, Map<string, OwnerHouseholdEffectAccum>>();
  const mapVersion = `u1-map-${randomUUID()}`;
  const computedAt = toIsoNow();

  const out: Array<Omit<U1ProfileAccessMapRow, "mapId">> = [];
  for (const target of people) {
    const targetPersonId = normalize(target.personId);
    if (!targetPersonId) continue;

    if (targetPersonId === normalizedViewer) {
      out.push({
        viewerPersonId: normalizedViewer,
        targetPersonId,
        isSubscribed: true,
        isShared: true,
        canVitals: true,
        canStories: true,
        canMedia: true,
        canConversations: true,
        placeholderOnly: false,
        reasonCode: "SELF_ALWAYS_ALLOWED",
        mapVersion,
        computedAt,
      });
      continue;
    }

    const personEffect = personEffects.get(targetPersonId) ?? null;
    const householdEffect = householdEffects.get(targetPersonId) ?? null;
    const defaultSubscription = matchedSubscriptionDefault(subscriptionDefaults, viewerHits.get(targetPersonId));
    let isSubscribed = false;
    let subscriptionReason = "SUBSCRIPTION_NONE";
    if (personEffect === "deny") {
      isSubscribed = false;
      subscriptionReason = "SUBSCRIPTION_DENY_PERSON";
    } else if (householdEffect === "deny") {
      isSubscribed = false;
      subscriptionReason = "SUBSCRIPTION_DENY_HOUSEHOLD";
    } else if (personEffect === "allow") {
      isSubscribed = true;
      subscriptionReason = "SUBSCRIPTION_ALLOW_PERSON";
    } else if (householdEffect === "allow") {
      isSubscribed = true;
      subscriptionReason = "SUBSCRIPTION_ALLOW_HOUSEHOLD";
    } else if (defaultSubscription === "allow") {
      isSubscribed = true;
      subscriptionReason = "SUBSCRIPTION_ALLOW_DEFAULT";
    } else if (defaultSubscription === "deny") {
      isSubscribed = false;
      subscriptionReason = "SUBSCRIPTION_DENY_DEFAULT";
    }

    if (!isSubscribed) {
      out.push({
        viewerPersonId: normalizedViewer,
        targetPersonId,
        isSubscribed: false,
        isShared: false,
        canVitals: false,
        canStories: false,
        canMedia: false,
        canConversations: false,
        placeholderOnly: false,
        reasonCode: subscriptionReason,
        mapVersion,
        computedAt,
      });
      continue;
    }

    let ownerHitsMap = ownerHitsCache.get(targetPersonId);
    if (!ownerHitsMap) {
      ownerHitsMap = computeRelativeHitsForViewer(targetPersonId, graph);
      ownerHitsCache.set(targetPersonId, ownerHitsMap);
    }
    let ownerHouseholdEffects = ownerHouseholdEffectsCache.get(targetPersonId);
    if (!ownerHouseholdEffects) {
      ownerHouseholdEffects = buildOwnerHouseholdEffectsByTarget(
        ownerHouseholdExceptionsByOwner.get(targetPersonId) ?? [],
        householdMembersById,
      );
      ownerHouseholdEffectsCache.set(targetPersonId, ownerHouseholdEffects);
    }

    const ownerShare = evaluateOwnerShareScopes({
      ownerPersonId: targetPersonId,
      viewerPersonId: normalizedViewer,
      ownerDefaults: ownerDefaultsByOwner.get(targetPersonId) ?? [],
      ownerPersonExceptions: ownerPersonExceptionsByOwner.get(targetPersonId) ?? [],
      ownerHouseholdEffect: ownerHouseholdEffects.get(normalizedViewer),
      ownerHitsToViewer: ownerHitsMap.get(normalizedViewer),
    });
    const isShared =
      ownerShare.scopes.vitals ||
      ownerShare.scopes.stories ||
      ownerShare.scopes.media ||
      ownerShare.scopes.conversations;
    out.push({
      viewerPersonId: normalizedViewer,
      targetPersonId,
      isSubscribed: true,
      isShared,
      canVitals: isShared && ownerShare.scopes.vitals,
      canStories: isShared && ownerShare.scopes.stories,
      canMedia: isShared && ownerShare.scopes.media,
      canConversations: isShared && ownerShare.scopes.conversations,
      placeholderOnly: !isShared,
      reasonCode: `${subscriptionReason}|${ownerShare.reason}`,
      mapVersion,
      computedAt,
    });
  }

  return out;
}

export async function runViewerRecompute(input: {
  viewerPersonId: string;
  reason: string;
  runAudit?: boolean;
}) {
  const viewerPersonId = normalize(input.viewerPersonId);
  if (!viewerPersonId) {
    throw new Error("viewer_person_id_required");
  }

  const dedupeKey = `${viewerPersonId}:${normalizeLower(input.reason) || "manual"}`;
  const queued = await enqueueRecomputeJob({
    viewerPersonId,
    reason: input.reason,
    dedupeKey,
  });

  if (queued.status === "running") {
    return {
      job: queued,
      run: null,
      mode: "already-running" as const,
    };
  }

  const start = toIsoNow();
  await updateRecomputeJob(queued.jobId, { status: "running", startedAt: start, errorMessage: "" });

  const runId = `u1-run-${randomUUID()}`;
  try {
    const previousRows = await listProfileAccessMap(viewerPersonId);
    const computedRows = await computeProfileAccessRowsForViewer(viewerPersonId);
    await replaceProfileAccessMap(viewerPersonId, computedRows);
    const completeTs = toIsoNow();

    const previousByTarget = new Map(previousRows.map((row) => [row.targetPersonId, row]));
    let changedCount = 0;
    for (const row of computedRows) {
      const prev = previousByTarget.get(row.targetPersonId);
      if (!prev) {
        changedCount += 1;
        continue;
      }
      const same =
        prev.isSubscribed === row.isSubscribed &&
        prev.isShared === row.isShared &&
        prev.canVitals === row.canVitals &&
        prev.canStories === row.canStories &&
        prev.canMedia === row.canMedia &&
        prev.canConversations === row.canConversations &&
        prev.placeholderOnly === row.placeholderOnly &&
        prev.reasonCode === row.reasonCode;
      if (!same) changedCount += 1;
    }
    await createRecomputeRun({
      runId,
      jobId: queued.jobId,
      viewerPersonId,
      status: "completed",
      startedAt: start,
      completedAt: completeTs,
      processedCount: computedRows.length,
      changedCount,
      overexposedCount: 0,
      underexposedCount: 0,
      staleCount: 0,
      errorMessage: "",
    });
    await updateRecomputeJob(queued.jobId, {
      status: "completed",
      completedAt: completeTs,
      errorMessage: "",
    });
    return {
      job: { ...queued, status: "completed", startedAt: start, completedAt: completeTs },
      run: {
        runId,
        jobId: queued.jobId,
        viewerPersonId,
        status: "completed" as const,
        startedAt: start,
        completedAt: completeTs,
        processedCount: computedRows.length,
        changedCount,
        overexposedCount: 0,
        underexposedCount: 0,
        staleCount: 0,
        errorMessage: "",
      },
      mode: input.runAudit ? "completed-with-audit" as const : "completed" as const,
    };
  } catch (error) {
    const completeTs = toIsoNow();
    const message = error instanceof Error ? error.message : "unknown_error";
    await createRecomputeRun({
      runId,
      jobId: queued.jobId,
      viewerPersonId,
      status: "failed",
      startedAt: start,
      completedAt: completeTs,
      processedCount: 0,
      changedCount: 0,
      overexposedCount: 0,
      underexposedCount: 0,
      staleCount: 0,
      errorMessage: message.slice(0, 3900),
    });
    await updateRecomputeJob(queued.jobId, {
      status: "failed",
      completedAt: completeTs,
      errorMessage: message.slice(0, 3900),
    });
    throw error;
  }
}

export async function previewAccessForTarget(viewerPersonId: string, targetPersonId: string): Promise<U1PreviewRow | null> {
  const viewerId = normalize(viewerPersonId);
  const targetId = normalize(targetPersonId);
  if (!viewerId || !targetId) return null;
  const rows = await computeProfileAccessRowsForViewer(viewerId);
  const people = await listPeopleLite();
  const target = rows.find((row) => row.targetPersonId === targetId);
  if (!target) return null;
  const displayName =
    people.find((person) => normalize(person.personId) === targetId)?.displayName ??
    targetId;
  return asPreviewRow(
    {
      mapId: "",
      ...target,
    },
    displayName,
  );
}

export async function getRecomputeStatus(viewerPersonId: string) {
  return getLatestRecomputeStatus(viewerPersonId);
}
