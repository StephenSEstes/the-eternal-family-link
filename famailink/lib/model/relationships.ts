export const RELATIONSHIP_CATEGORIES = [
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
] as const;

export type RelationshipCategory = (typeof RELATIONSHIP_CATEGORIES)[number];

export const RELATIONSHIP_LABELS: Record<RelationshipCategory, string> = {
  self: "You",
  spouse: "Spouse",
  parents: "Parents",
  parents_in_law: "Parents-In-Law",
  grandparents: "Grandparents",
  grandparents_in_law: "Grandparents-In-Law",
  children: "Children",
  children_in_law: "Children-In-Law",
  grandchildren: "Grandchildren",
  siblings: "Siblings",
  siblings_in_law: "Siblings-In-Law",
  aunts_uncles: "Aunts / Uncles",
  nieces_nephews: "Nieces / Nephews",
  nieces_nephews_in_law: "Nieces / Nephews-In-Law",
  cousins: "Cousins",
  cousins_children: "Cousins' Children",
};

export const LINEAGE_SIDES = ["not_applicable", "both", "maternal", "paternal"] as const;
export type LineageSide = (typeof LINEAGE_SIDES)[number];

export const LINEAGE_LABELS: Record<LineageSide, string> = {
  not_applicable: "Not Side-Specific",
  both: "Both Sides",
  maternal: "Maternal",
  paternal: "Paternal",
};

export const EFFECT_TYPES = ["allow", "deny"] as const;
export type EffectType = (typeof EFFECT_TYPES)[number];

export type RelationshipHit = {
  category: RelationshipCategory;
  lineageSides: LineageSide[];
};
