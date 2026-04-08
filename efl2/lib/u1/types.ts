export const U1_RELATIONSHIP_CATEGORIES = [
  "self",
  "spouse_partner",
  "parents",
  "grandparents",
  "great_grandparents",
  "children",
  "grandchildren",
  "great_grandchildren",
  "siblings",
  "aunts_uncles",
  "grand_aunts_uncles",
  "nieces_nephews",
  "cousins",
  "cousins_children",
  "manual_people",
] as const;

export type U1RelationshipCategory = (typeof U1_RELATIONSHIP_CATEGORIES)[number];

export const U1_LINEAGE_SIDES = ["both", "maternal", "paternal", "not_applicable"] as const;
export type U1LineageSide = (typeof U1_LINEAGE_SIDES)[number];

export const U1_EFFECT_TYPES = ["allow", "deny"] as const;
export type U1EffectType = (typeof U1_EFFECT_TYPES)[number];

export type U1SubscriptionDefaultRule = {
  ruleId: string;
  viewerPersonId: string;
  relationshipCategory: U1RelationshipCategory;
  lineageSide: U1LineageSide;
  isSubscribed: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type U1SubscriptionPersonException = {
  exceptionId: string;
  viewerPersonId: string;
  targetPersonId: string;
  effect: U1EffectType;
  createdAt: string;
  updatedAt: string;
};

export type U1OwnerShareDefaultRule = {
  ruleId: string;
  ownerPersonId: string;
  relationshipCategory: U1RelationshipCategory;
  lineageSide: U1LineageSide;
  shareVitals: boolean;
  shareStories: boolean;
  shareMedia: boolean;
  shareConversations: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type U1OwnerSharePersonException = {
  exceptionId: string;
  ownerPersonId: string;
  targetPersonId: string;
  effect: U1EffectType;
  shareVitals: boolean | null;
  shareStories: boolean | null;
  shareMedia: boolean | null;
  shareConversations: boolean | null;
  createdAt: string;
  updatedAt: string;
};

export type U1ProfileAccessMapRow = {
  mapId: string;
  viewerPersonId: string;
  targetPersonId: string;
  isSubscribed: boolean;
  isShared: boolean;
  canVitals: boolean;
  canStories: boolean;
  canMedia: boolean;
  canConversations: boolean;
  placeholderOnly: boolean;
  reasonCode: string;
  mapVersion: string;
  computedAt: string;
};

export type U1RecomputeJob = {
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

export type U1RecomputeRun = {
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

export type U1PersonLite = {
  personId: string;
  displayName: string;
  gender: string;
};

export type U1RelationshipLite = {
  fromPersonId: string;
  toPersonId: string;
  relType: string;
};

export type U1PreviewRow = U1ProfileAccessMapRow & {
  targetDisplayName: string;
};

