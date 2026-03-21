import type { AttributeCategory } from "@/lib/attributes/types";
import type { AttributeEventDefinitions } from "@/lib/attributes/event-definitions-types";

export const DEFAULT_ATTRIBUTE_DEFINITIONS_VERSION = 3;

export const LEGACY_ATTRIBUTE_TYPE_KEY_MAP: Record<string, string> = {
  graduation: "education",
  missions: "religious",
  religious_event: "religious",
  injuries: "injury_health",
  accomplishments: "accomplishment",
  stories: "life_event",
  lived_in: "moved",
  jobs: "employment",
  hobbies: "hobbies_interests",
  likes: "hobbies_interests",
  allergies: "physical_attribute",
  blood_type: "physical_attribute",
  hair_color: "physical_attribute",
  height: "physical_attribute",
  health: "physical_attribute",
};

export function normalizeAttributeTypeKey(value: string) {
  const key = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  return LEGACY_ATTRIBUTE_TYPE_KEY_MAP[key] ?? key;
}

export function normalizeAttributeKind(value: string | undefined): AttributeCategory | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "event" || normalized === "descriptor") {
    return normalized;
  }
  return null;
}

export function makeAttributeDefinitionCategoryId(kind: AttributeCategory, categoryKey: string) {
  return `${kind}:${normalizeAttributeTypeKey(categoryKey)}`;
}

export function makeAttributeDefinitionTypeId(kind: AttributeCategory, categoryKey: string, typeKey: string) {
  return `${kind}:${normalizeAttributeTypeKey(categoryKey)}:${normalizeAttributeTypeKey(typeKey)}`;
}

export function defaultAttributeDefinitions(): AttributeEventDefinitions {
  return {
    version: DEFAULT_ATTRIBUTE_DEFINITIONS_VERSION,
    categories: [
      { categoryKey: "physical_attribute", categoryLabel: "Physical Attribute", categoryColor: "#dbeafe", description: "", sortOrder: 10, isEnabled: true, kind: "descriptor" },
      { categoryKey: "hobbies_interests", categoryLabel: "Hobbies & Interests", categoryColor: "#dcfce7", description: "", sortOrder: 20, isEnabled: true, kind: "descriptor" },
      { categoryKey: "talent", categoryLabel: "Talent", categoryColor: "#fef3c7", description: "", sortOrder: 30, isEnabled: true, kind: "descriptor" },
      { categoryKey: "other", categoryLabel: "Other Attribute", categoryColor: "#e5e7eb", description: "", sortOrder: 40, isEnabled: true, kind: "descriptor" },
      { categoryKey: "birth", categoryLabel: "Birth", categoryColor: "#f3f4f6", description: "", sortOrder: 110, isEnabled: true, kind: "event" },
      { categoryKey: "death", categoryLabel: "Death", categoryColor: "#e5e7eb", description: "", sortOrder: 115, isEnabled: true, kind: "event" },
      { categoryKey: "education", categoryLabel: "Education", categoryColor: "#dbeafe", description: "", sortOrder: 120, isEnabled: true, kind: "event" },
      { categoryKey: "religious", categoryLabel: "Religious", categoryColor: "#ede9fe", description: "", sortOrder: 130, isEnabled: true, kind: "event" },
      { categoryKey: "accomplishment", categoryLabel: "Accomplishment", categoryColor: "#dcfce7", description: "", sortOrder: 140, isEnabled: true, kind: "event" },
      { categoryKey: "injury_health", categoryLabel: "Injury/Health", categoryColor: "#fee2e2", description: "", sortOrder: 150, isEnabled: true, kind: "event" },
      { categoryKey: "life_event", categoryLabel: "Life Event", categoryColor: "#ffedd5", description: "", sortOrder: 160, isEnabled: true, kind: "event" },
      { categoryKey: "moved", categoryLabel: "Moved", categoryColor: "#e0f2fe", description: "", sortOrder: 170, isEnabled: true, kind: "event" },
      { categoryKey: "employment", categoryLabel: "Employment", categoryColor: "#fef3c7", description: "", sortOrder: 180, isEnabled: true, kind: "event" },
      { categoryKey: "family_relationship", categoryLabel: "Family/Relationship", categoryColor: "#fce7f3", description: "", sortOrder: 190, isEnabled: true, kind: "event" },
      { categoryKey: "pet", categoryLabel: "Pet", categoryColor: "#dcfce7", description: "", sortOrder: 200, isEnabled: true, kind: "event" },
      { categoryKey: "travel", categoryLabel: "Travel", categoryColor: "#cffafe", description: "", sortOrder: 210, isEnabled: true, kind: "event" },
      { categoryKey: "other", categoryLabel: "Other Event", categoryColor: "#e5e7eb", description: "", sortOrder: 220, isEnabled: true, kind: "event" },
    ],
    types: [
      { typeKey: "eyes", categoryKey: "physical_attribute", typeLabel: "Eyes", detailLabel: "Eye Color / Detail", dateMode: "none", askEndDate: false, sortOrder: 10, isEnabled: true, kind: "descriptor" },
      { typeKey: "height", categoryKey: "physical_attribute", typeLabel: "Height", detailLabel: "Height", dateMode: "none", askEndDate: false, sortOrder: 20, isEnabled: true, kind: "descriptor" },
      { typeKey: "blood_type", categoryKey: "physical_attribute", typeLabel: "Blood Type", detailLabel: "Blood Type", dateMode: "none", askEndDate: false, sortOrder: 30, isEnabled: true, kind: "descriptor" },
      { typeKey: "allergy", categoryKey: "physical_attribute", typeLabel: "Allergy", detailLabel: "Allergy Detail", dateMode: "none", askEndDate: false, sortOrder: 40, isEnabled: true, kind: "descriptor" },
      { typeKey: "other", categoryKey: "physical_attribute", typeLabel: "Other", detailLabel: "Attribute Detail", dateMode: "none", askEndDate: false, sortOrder: 50, isEnabled: true, kind: "descriptor" },
      { typeKey: "enrolled", categoryKey: "education", typeLabel: "Enrolled", detailLabel: "School Name", dateMode: "single", askEndDate: false, sortOrder: 10, isEnabled: true, kind: "event" },
      { typeKey: "awarded", categoryKey: "education", typeLabel: "Awarded", detailLabel: "Award Name", dateMode: "single", askEndDate: false, sortOrder: 20, isEnabled: true, kind: "event" },
      { typeKey: "exam_test", categoryKey: "education", typeLabel: "Exam/Test", detailLabel: "Score", dateMode: "single", askEndDate: false, sortOrder: 30, isEnabled: true, kind: "event" },
      { typeKey: "grade", categoryKey: "education", typeLabel: "Grade", detailLabel: "Grade Detail", dateMode: "single", askEndDate: false, sortOrder: 40, isEnabled: true, kind: "event" },
      { typeKey: "baptism", categoryKey: "religious", typeLabel: "Baptism", detailLabel: "Details", dateMode: "single", askEndDate: false, sortOrder: 10, isEnabled: true, kind: "event" },
      { typeKey: "ordinance", categoryKey: "religious", typeLabel: "Ordinance", detailLabel: "Details", dateMode: "single", askEndDate: false, sortOrder: 20, isEnabled: true, kind: "event" },
      { typeKey: "mission", categoryKey: "religious", typeLabel: "Mission", detailLabel: "Mission Name", dateMode: "range", askEndDate: true, sortOrder: 30, isEnabled: true, kind: "event" },
      { typeKey: "calling", categoryKey: "religious", typeLabel: "Calling", detailLabel: "Calling Name", dateMode: "range", askEndDate: true, sortOrder: 40, isEnabled: true, kind: "event" },
      { typeKey: "hired", categoryKey: "employment", typeLabel: "Hired", detailLabel: "Employer", dateMode: "single", askEndDate: false, sortOrder: 10, isEnabled: true, kind: "event" },
      { typeKey: "departed", categoryKey: "employment", typeLabel: "Departed", detailLabel: "Employer", dateMode: "single", askEndDate: false, sortOrder: 20, isEnabled: true, kind: "event" },
      { typeKey: "promotion", categoryKey: "employment", typeLabel: "Promotion", detailLabel: "Promotion Detail", dateMode: "single", askEndDate: false, sortOrder: 30, isEnabled: true, kind: "event" },
      { typeKey: "awarded", categoryKey: "employment", typeLabel: "Awarded", detailLabel: "Award Name", dateMode: "single", askEndDate: false, sortOrder: 40, isEnabled: true, kind: "event" },
      { typeKey: "married", categoryKey: "family_relationship", typeLabel: "Married", detailLabel: "Spouse Name", dateMode: "single", askEndDate: false, sortOrder: 10, isEnabled: true, kind: "event" },
      { typeKey: "divorced", categoryKey: "family_relationship", typeLabel: "Divorced", detailLabel: "Details", dateMode: "single", askEndDate: false, sortOrder: 20, isEnabled: true, kind: "event" },
      { typeKey: "adopted", categoryKey: "family_relationship", typeLabel: "Adopted", detailLabel: "Details", dateMode: "single", askEndDate: false, sortOrder: 30, isEnabled: true, kind: "event" },
      { typeKey: "story", categoryKey: "life_event", typeLabel: "Story", detailLabel: "Story", dateMode: "single", askEndDate: false, sortOrder: 10, isEnabled: true, kind: "event" },
    ],
  };
}

export function inferAttributeKindFromTypeKey(typeKey: string, attributeDate = ""): AttributeCategory {
  const normalizedType = normalizeAttributeTypeKey(typeKey);
  if (normalizedType === "other") {
    return attributeDate.trim() ? "event" : "descriptor";
  }

  const matchingKinds = new Set(
    defaultAttributeDefinitions().categories
      .filter((row) => normalizeAttributeTypeKey(row.categoryKey) === normalizedType)
      .map((row) => row.kind),
  );

  if (matchingKinds.has("event") && !matchingKinds.has("descriptor")) {
    return "event";
  }
  if (matchingKinds.has("descriptor") && !matchingKinds.has("event")) {
    return "descriptor";
  }
  return attributeDate.trim() ? "event" : "descriptor";
}
