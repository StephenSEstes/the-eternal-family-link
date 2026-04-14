import "server-only";

import { randomUUID } from "node:crypto";
import { mergeWithSystemShareDefaults } from "@/lib/access/defaults";
import {
  buildFamilyGraph,
  computeRelativeHitsForViewer,
  listPeopleLite,
  listRelationshipsLite,
  serializeRelationshipHitMap,
} from "@/lib/family/store";
import {
  listAllShareDefaults,
  listAllSharePersonExceptions,
  listSubscriptionDefaults,
  listSubscriptionPersonExceptions,
} from "@/lib/access/store";
import type {
  AccessCatalogPayload,
  AccessPreview,
  DefaultLineageSelection,
  PreviewScopeKey,
  PreviewScopeResult,
  ProfileSubscriptionMapRow,
  ProfileVisibilityMapRow,
  ShareDefaultRule,
  SharePersonException,
  SubscriptionDefaultRule,
  SubscriptionPersonException,
} from "@/lib/access/types";
import type { LineageSide, RelationshipCategory } from "@/lib/model/relationships";

type HitMap = Map<RelationshipCategory, Set<LineageSide>>;

type ComputationState = {
  people: Awaited<ReturnType<typeof listPeopleLite>>;
  graph: ReturnType<typeof buildFamilyGraph>;
  viewerHits: Map<string, HitMap>;
  subscriptionDefaults: SubscriptionDefaultRule[];
  subscriptionPersonExceptions: SubscriptionPersonException[];
  ownerDefaultsByOwner: Map<string, ShareDefaultRule[]>;
  ownerExceptionsByOwner: Map<string, SharePersonException[]>;
};

type ComputedTargetAccess = {
  preview: AccessPreview;
  visibilityRow: Omit<ProfileVisibilityMapRow, "mapId">;
  subscriptionRow: Omit<ProfileSubscriptionMapRow, "mapId">;
};

export type ComputedViewerMaps = {
  visibilityRows: Array<Omit<ProfileVisibilityMapRow, "mapId">>;
  subscriptionRows: Array<Omit<ProfileSubscriptionMapRow, "mapId">>;
  mapVersion: string;
  computedAt: string;
};

function normalize(value?: string) {
  return String(value ?? "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function sideMatches(selection: DefaultLineageSelection, sides: Set<LineageSide>) {
  if (selection === "none") return false;
  if (selection === "both") return sides.has("both") || sides.has("maternal") || sides.has("paternal");
  if (selection === "not_applicable") return sides.has("not_applicable");
  if (sides.has("both")) return true;
  return sides.has(selection);
}

function evaluateSubscriptionDefault(
  rules: SubscriptionDefaultRule[],
  targetHits: HitMap | undefined,
): PreviewScopeResult {
  if (!targetHits) {
    return { allowed: false, source: "not_visible_in_tree" };
  }

  const matchedRules = rules.filter((rule) => {
    const sides = targetHits.get(rule.relationshipCategory);
    if (!sides) return false;
    return sideMatches(rule.lineageSelection, sides);
  });

  if (!matchedRules.length) {
    return { allowed: false, source: "no_matching_subscription_rule" };
  }

  return { allowed: true, source: "subscription_default_allow" };
}

function readExceptionScope(row: SharePersonException, scope: PreviewScopeKey) {
  if (scope === "vitals") return row.shareVitals;
  if (scope === "stories") return row.shareStories;
  if (scope === "media") return row.shareMedia;
  return row.shareConversations;
}

function appliesToScope(row: SharePersonException, scope: PreviewScopeKey) {
  const value = readExceptionScope(row, scope);
  return value === null || value === true;
}

function evaluateShareDefaultScope(
  rules: ShareDefaultRule[],
  viewerHitsFromOwner: HitMap | undefined,
  scope: PreviewScopeKey,
): PreviewScopeResult {
  if (!viewerHitsFromOwner) {
    return { allowed: false, source: "not_visible_to_owner" };
  }

  const matchedRules = rules.filter((rule) => {
    const sides = viewerHitsFromOwner.get(rule.relationshipCategory);
    if (!sides) return false;
    return sideMatches(rule.lineageSelection, sides);
  });

  if (!matchedRules.length) {
    return { allowed: false, source: "no_matching_share_rule" };
  }

  const allowed = matchedRules.some((rule) => {
    if (scope === "vitals") return rule.shareVitals;
    if (scope === "stories") return rule.shareStories;
    if (scope === "media") return rule.shareMedia;
    return rule.shareConversations;
  });

  return {
    allowed,
    source: allowed ? "share_default_allow" : "share_default_deny",
  };
}

function evaluateSharingScopes(input: {
  viewerPersonId: string;
  ownerPersonId: string;
  ownerDefaults: ShareDefaultRule[];
  ownerPersonExceptions: SharePersonException[];
  viewerHitsFromOwner: HitMap | undefined;
}): Record<PreviewScopeKey, PreviewScopeResult> {
  const personExceptions = input.ownerPersonExceptions.filter(
    (row) => normalize(row.targetPersonId) === normalize(input.viewerPersonId),
  );
  const effectiveOwnerDefaults = mergeWithSystemShareDefaults(input.ownerPersonId, input.ownerDefaults);

  const scopes: PreviewScopeKey[] = ["vitals", "stories", "media", "conversations"];
  const out = {} as Record<PreviewScopeKey, PreviewScopeResult>;
  for (const scope of scopes) {
    const denied = personExceptions.some((row) => row.effect === "deny" && appliesToScope(row, scope));
    if (denied) {
      out[scope] = { allowed: false, source: "share_person_exception_deny" };
      continue;
    }

    const allowed = personExceptions.some((row) => row.effect === "allow" && appliesToScope(row, scope));
    if (allowed) {
        out[scope] = { allowed: true, source: "share_person_exception_allow" };
        continue;
      }

    out[scope] = evaluateShareDefaultScope(effectiveOwnerDefaults, input.viewerHitsFromOwner, scope);
  }

  return out;
}

function buildState(input: {
  people: Awaited<ReturnType<typeof listPeopleLite>>;
  relationships: Awaited<ReturnType<typeof listRelationshipsLite>>;
  subscriptionDefaults: SubscriptionDefaultRule[];
  subscriptionPersonExceptions: SubscriptionPersonException[];
  shareDefaults: ShareDefaultRule[];
  sharePersonExceptions: SharePersonException[];
  viewerPersonId: string;
}): ComputationState {
  const graph = buildFamilyGraph(input.people, input.relationships);
  const ownerDefaultsByOwner = new Map<string, ShareDefaultRule[]>();
  for (const row of input.shareDefaults) {
    const ownerPersonId = normalize(row.ownerPersonId);
    const current = ownerDefaultsByOwner.get(ownerPersonId) ?? [];
    current.push(row);
    ownerDefaultsByOwner.set(ownerPersonId, current);
  }

  const ownerExceptionsByOwner = new Map<string, SharePersonException[]>();
  for (const row of input.sharePersonExceptions) {
    const ownerPersonId = normalize(row.ownerPersonId);
    const current = ownerExceptionsByOwner.get(ownerPersonId) ?? [];
    current.push(row);
    ownerExceptionsByOwner.set(ownerPersonId, current);
  }

  return {
    people: input.people,
    graph,
    viewerHits: computeRelativeHitsForViewer(input.viewerPersonId, graph),
    subscriptionDefaults: input.subscriptionDefaults,
    subscriptionPersonExceptions: input.subscriptionPersonExceptions,
    ownerDefaultsByOwner,
    ownerExceptionsByOwner,
  };
}

function buildSelfSharingScopes(): Record<PreviewScopeKey, PreviewScopeResult> {
  return {
    vitals: { allowed: true, source: "self" },
    stories: { allowed: true, source: "self" },
    media: { allowed: true, source: "self" },
    conversations: { allowed: true, source: "self" },
  };
}

function computeTargetAccess(input: {
  viewerPersonId: string;
  targetPersonId: string;
  state: ComputationState;
  computedAt: string;
  mapVersion: string;
}): ComputedTargetAccess {
  const viewerId = normalize(input.viewerPersonId);
  const targetId = normalize(input.targetPersonId);
  const targetPerson = input.state.people.find((person) => normalize(person.personId) === targetId);
  const targetHits = computeRelativeHitsForViewer(targetId, input.state.graph);

  const viewerToTargetRelationships = serializeRelationshipHitMap(input.state.viewerHits.get(targetId));
  const targetToViewerRelationships = serializeRelationshipHitMap(targetHits.get(viewerId));
  const visibleByNameAndRelationship = targetId === viewerId || viewerToTargetRelationships.length > 0;

  let subscription = evaluateSubscriptionDefault(input.state.subscriptionDefaults, input.state.viewerHits.get(targetId));
  const subscriptionException = input.state.subscriptionPersonExceptions.find(
    (row) => normalize(row.targetPersonId) === targetId,
  );
  if (targetId === viewerId) {
    subscription = { allowed: true, source: "self" };
  } else if (subscriptionException?.effect === "allow") {
    subscription = { allowed: true, source: "subscription_person_exception_allow" };
  } else if (subscriptionException?.effect === "deny") {
    subscription = { allowed: false, source: "subscription_person_exception_deny" };
  }

  const sharingScopes =
    targetId === viewerId
      ? buildSelfSharingScopes()
      : evaluateSharingScopes({
          viewerPersonId: viewerId,
          ownerPersonId: targetId,
          ownerDefaults: input.state.ownerDefaultsByOwner.get(targetId) ?? [],
          ownerPersonExceptions: input.state.ownerExceptionsByOwner.get(targetId) ?? [],
          viewerHitsFromOwner: targetHits.get(viewerId),
        });

  const anyShared = Object.values(sharingScopes).some((scope) => scope.allowed);
  const placeholderOnly = visibleByNameAndRelationship && !anyShared;
  const sharingReason = Object.entries(sharingScopes)
    .map(([scope, result]) => `${scope}:${result.source}`)
    .join("|");

  const preview: AccessPreview = {
    viewerPersonId: viewerId,
    targetPersonId: targetId,
    targetDisplayName: targetPerson?.displayName ?? targetId,
    tree: {
      visibleByNameAndRelationship,
      source: visibleByNameAndRelationship ? "relationship_graph" : "not_supported_relative",
    },
    viewerToTargetRelationships,
    targetToViewerRelationships,
    subscription: {
      isSubscribed: subscription.allowed,
      source: subscription.source,
    },
    sharing: {
      anyShared,
      placeholderOnly,
      scopes: sharingScopes,
    },
  };

  return {
    preview,
    visibilityRow: {
      viewerPersonId: viewerId,
      targetPersonId: targetId,
      treeVisible: visibleByNameAndRelationship,
      canVitals: sharingScopes.vitals.allowed,
      canStories: sharingScopes.stories.allowed,
      canMedia: sharingScopes.media.allowed,
      canConversations: sharingScopes.conversations.allowed,
      placeholderOnly,
      reasonCode: `tree:${preview.tree.source}|${sharingReason}`,
      mapVersion: input.mapVersion,
      computedAt: input.computedAt,
    },
    subscriptionRow: {
      viewerPersonId: viewerId,
      targetPersonId: targetId,
      isSubscribed: subscription.allowed,
      reasonCode: `subscription:${subscription.source}`,
      mapVersion: input.mapVersion,
      computedAt: input.computedAt,
    },
  };
}

export async function buildAccessCatalog(viewerPersonId: string): Promise<AccessCatalogPayload> {
  const [people, relationships] = await Promise.all([listPeopleLite(), listRelationshipsLite()]);
  const graph = buildFamilyGraph(people, relationships);
  const viewerHits = computeRelativeHitsForViewer(viewerPersonId, graph);
  const viewerId = normalize(viewerPersonId);
  const viewer = people.find((person) => normalize(person.personId) === viewerId);

  const relatedPeople = Array.from(viewerHits.entries())
    .filter(([personId]) => personId !== viewerId)
    .map(([personId, hits]) => {
      const person = people.find((row) => normalize(row.personId) === personId);
      return {
        personId,
        displayName: person?.displayName ?? personId,
        relationships: serializeRelationshipHitMap(hits),
      };
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" }));

  return {
    viewerPersonId: viewerId,
    viewerDisplayName: viewer?.displayName ?? viewerId,
    people: relatedPeople,
  };
}

async function loadComputationState(viewerPersonId: string) {
  const [people, relationships, subscriptionDefaults, subscriptionPersonExceptions, shareDefaults, sharePersonExceptions] =
    await Promise.all([
      listPeopleLite(),
      listRelationshipsLite(),
      listSubscriptionDefaults(viewerPersonId),
      listSubscriptionPersonExceptions(viewerPersonId),
      listAllShareDefaults(),
      listAllSharePersonExceptions(),
    ]);

  return buildState({
    people,
    relationships,
    subscriptionDefaults,
    subscriptionPersonExceptions,
    shareDefaults,
    sharePersonExceptions,
    viewerPersonId,
  });
}

export async function buildAccessPreview(viewerPersonId: string, targetPersonId: string): Promise<AccessPreview | null> {
  const viewerId = normalize(viewerPersonId);
  const targetId = normalize(targetPersonId);
  if (!viewerId || !targetId) return null;

  const state = await loadComputationState(viewerId);
  const computed = computeTargetAccess({
    viewerPersonId: viewerId,
    targetPersonId: targetId,
    state,
    computedAt: nowIso(),
    mapVersion: `fm-live-${randomUUID()}`,
  });
  return computed.preview;
}

export async function computeDerivedMapsForViewer(viewerPersonId: string): Promise<ComputedViewerMaps> {
  const viewerId = normalize(viewerPersonId);
  const state = await loadComputationState(viewerId);
  const computedAt = nowIso();
  const mapVersion = `fm-map-${randomUUID()}`;

  const targetIds = Array.from(state.viewerHits.keys()).sort((left, right) => left.localeCompare(right));
  const visibilityRows: Array<Omit<ProfileVisibilityMapRow, "mapId">> = [];
  const subscriptionRows: Array<Omit<ProfileSubscriptionMapRow, "mapId">> = [];

  for (const targetPersonId of targetIds) {
    const computed = computeTargetAccess({
      viewerPersonId: viewerId,
      targetPersonId,
      state,
      computedAt,
      mapVersion,
    });
    visibilityRows.push(computed.visibilityRow);
    subscriptionRows.push(computed.subscriptionRow);
  }

  return {
    visibilityRows,
    subscriptionRows,
    mapVersion,
    computedAt,
  };
}
