export const RELATIONSHIP_CATEGORIES = [
  "self",
  "spouse",
  "parents",
  "grandparents",
  "children",
  "grandchildren",
  "siblings",
  "aunts_uncles",
  "nieces_nephews",
  "cousins",
  "cousins_children",
] as const;

export type RelationshipCategory = (typeof RELATIONSHIP_CATEGORIES)[number];

export const RELATIONSHIP_LABELS: Record<RelationshipCategory, string> = {
  self: "You",
  spouse: "Spouse",
  parents: "Parents",
  grandparents: "Grandparents",
  children: "Children",
  grandchildren: "Grandchildren",
  siblings: "Siblings",
  aunts_uncles: "Aunts / Uncles",
  nieces_nephews: "Nieces / Nephews",
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
