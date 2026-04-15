import type {
  DefaultLineageSelection,
  ShareDefaultRule,
  SubscriptionDefaultRule,
} from "@/lib/access/types";
import type { RelationshipCategory } from "@/lib/model/relationships";

export const SIDE_SPECIFIC_CATEGORIES = new Set<RelationshipCategory>([
  "parents",
  "parents_in_law",
  "grandparents",
  "grandparents_in_law",
  "siblings",
  "siblings_in_law",
  "aunts_uncles",
  "nieces_nephews",
  "nieces_nephews_in_law",
  "cousins",
  "cousins_children",
]);

export const EDITABLE_CATEGORIES: RelationshipCategory[] = [
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

export function isSideSpecificCategory(relationshipCategory: RelationshipCategory) {
  return SIDE_SPECIFIC_CATEGORIES.has(relationshipCategory);
}

export function defaultInclusiveLineageSelectionForCategory(
  relationshipCategory: RelationshipCategory,
): DefaultLineageSelection {
  return isSideSpecificCategory(relationshipCategory) ? "both" : "not_applicable";
}

export function buildSystemSubscriptionDefaults(viewerPersonId: string): SubscriptionDefaultRule[] {
  return EDITABLE_CATEGORIES.map((relationshipCategory) => ({
    ruleId: "",
    viewerPersonId,
    relationshipCategory,
    lineageSelection: defaultInclusiveLineageSelectionForCategory(relationshipCategory),
    createdAt: "",
    updatedAt: "",
  }));
}

export function mergeWithSystemSubscriptionDefaults(
  viewerPersonId: string,
  rows: SubscriptionDefaultRule[],
): SubscriptionDefaultRule[] {
  const byCategory = new Map(rows.map((row) => [row.relationshipCategory, row]));
  return buildSystemSubscriptionDefaults(viewerPersonId).map(
    (defaultRow) => byCategory.get(defaultRow.relationshipCategory) ?? defaultRow,
  );
}

export function buildSystemShareDefaults(ownerPersonId: string): ShareDefaultRule[] {
  return EDITABLE_CATEGORIES.map((relationshipCategory) => ({
    ruleId: "",
    ownerPersonId,
    relationshipCategory,
    lineageSelection: defaultInclusiveLineageSelectionForCategory(relationshipCategory),
    shareVitals: true,
    shareStories: true,
    shareMedia: true,
    shareConversations: true,
    createdAt: "",
    updatedAt: "",
  }));
}

export function mergeWithSystemShareDefaults(ownerPersonId: string, rows: ShareDefaultRule[]): ShareDefaultRule[] {
  const byCategory = new Map(rows.map((row) => [row.relationshipCategory, row]));
  return buildSystemShareDefaults(ownerPersonId).map(
    (defaultRow) => byCategory.get(defaultRow.relationshipCategory) ?? defaultRow,
  );
}
