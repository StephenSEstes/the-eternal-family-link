import type { EffectType, RelationshipCategory, RelationshipHit } from "@/lib/model/relationships";

export const DEFAULT_LINEAGE_SELECTIONS = ["none", "not_applicable", "both", "maternal", "paternal"] as const;
export type DefaultLineageSelection = (typeof DEFAULT_LINEAGE_SELECTIONS)[number];
export const DEFAULT_LINEAGE_SELECTION_LABELS: Record<DefaultLineageSelection, string> = {
  none: "None",
  not_applicable: "Not Side-Specific",
  both: "Both Sides",
  maternal: "Maternal",
  paternal: "Paternal",
};

export type SubscriptionDefaultRule = {
  ruleId: string;
  viewerPersonId: string;
  relationshipCategory: RelationshipCategory;
  lineageSelection: DefaultLineageSelection;
  createdAt: string;
  updatedAt: string;
};

export type SubscriptionPersonException = {
  exceptionId: string;
  viewerPersonId: string;
  targetPersonId: string;
  effect: EffectType;
  createdAt: string;
  updatedAt: string;
};

export type ShareDefaultRule = {
  ruleId: string;
  ownerPersonId: string;
  relationshipCategory: RelationshipCategory;
  lineageSelection: DefaultLineageSelection;
  shareVitals: boolean;
  shareStories: boolean;
  shareMedia: boolean;
  shareConversations: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SharePersonException = {
  exceptionId: string;
  ownerPersonId: string;
  targetPersonId: string;
  effect: EffectType;
  shareVitals: boolean | null;
  shareStories: boolean | null;
  shareMedia: boolean | null;
  shareConversations: boolean | null;
  createdAt: string;
  updatedAt: string;
};

export type AccessCatalogPerson = {
  personId: string;
  displayName: string;
  relationships: RelationshipHit[];
};

export type AccessCatalogPayload = {
  viewerPersonId: string;
  viewerDisplayName: string;
  people: AccessCatalogPerson[];
};

export type PreviewScopeKey = "vitals" | "stories" | "media" | "conversations";

export type PreviewScopeResult = {
  allowed: boolean;
  source: string;
};

export type AccessPreview = {
  viewerPersonId: string;
  targetPersonId: string;
  targetDisplayName: string;
  tree: {
    visibleByNameAndRelationship: boolean;
    source: string;
  };
  viewerToTargetRelationships: RelationshipHit[];
  targetToViewerRelationships: RelationshipHit[];
  subscription: {
    isSubscribed: boolean;
    source: string;
  };
  sharing: {
    anyShared: boolean;
    placeholderOnly: boolean;
    scopes: Record<PreviewScopeKey, PreviewScopeResult>;
  };
};

export type ProfileVisibilityMapRow = {
  mapId: string;
  viewerPersonId: string;
  targetPersonId: string;
  treeVisible: boolean;
  canVitals: boolean;
  canStories: boolean;
  canMedia: boolean;
  canConversations: boolean;
  placeholderOnly: boolean;
  reasonCode: string;
  mapVersion: string;
  computedAt: string;
};

export type ProfileSubscriptionMapRow = {
  mapId: string;
  viewerPersonId: string;
  targetPersonId: string;
  isSubscribed: boolean;
  reasonCode: string;
  mapVersion: string;
  computedAt: string;
};

export type AccessRecomputeJob = {
  jobId: string;
  viewerPersonId: string;
  reason: string;
  status: "queued" | "running" | "completed" | "failed";
  dedupeKey: string;
  requestedAt: string;
  startedAt: string;
  completedAt: string;
  errorMessage: string;
};

export type AccessRecomputeRun = {
  runId: string;
  jobId: string;
  viewerPersonId: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt: string;
  processedCount: number;
  changedCount: number;
  errorMessage: string;
};

export type AccessDerivedSummary = {
  visibilityRowCount: number;
  subscriptionRowCount: number;
  subscribedCount: number;
  sharedCount: number;
  placeholderOnlyCount: number;
  lastComputedAt: string;
  mapVersion: string;
};

export type AccessRecomputeStatus = {
  latestJob: AccessRecomputeJob | null;
  latestRun: AccessRecomputeRun | null;
  summary: AccessDerivedSummary | null;
};
