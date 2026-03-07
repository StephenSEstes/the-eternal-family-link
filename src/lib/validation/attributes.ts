import { z } from "zod";

const ENTITY_TYPES = ["person", "household"] as const;
const CATEGORIES = ["descriptor", "event"] as const;
const EVENT_TYPES = [
  "birth",
  "education",
  "religious",
  "accomplishment",
  "injury_health",
  "life_event",
  "moved",
  "employment",
  "family_relationship",
  "pet",
  "travel",
  "other",
] as const;
const DESCRIPTOR_TYPES = ["physical_attribute", "hobbies_interests", "talent", "other"] as const;

const LEGACY_TYPE_MAP: Record<string, string> = {
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

function normalizeTypeKey(value: string) {
  const raw = value.trim().toLowerCase();
  const normalized = raw.replace(/[^a-z0-9_-]/g, "_");
  return LEGACY_TYPE_MAP[normalized] ?? normalized;
}

function inferCategory(typeKey: string): "descriptor" | "event" {
  if ((DESCRIPTOR_TYPES as readonly string[]).includes(typeKey)) return "descriptor";
  if ((EVENT_TYPES as readonly string[]).includes(typeKey)) return "event";
  return "descriptor";
}

const baseSchema = z.object({
  entityType: z.enum(ENTITY_TYPES).optional(),
  entityId: z.string().trim().min(1).max(80).optional(),
  category: z.enum(CATEGORIES).optional(),
  isDateRelated: z.boolean().optional(),
  attributeType: z.string().trim().min(1).max(120).optional(),
  attributeTypeCategory: z.string().trim().max(120).optional().default(""),
  attributeDate: z.string().trim().max(32).optional().default(""),
  dateIsEstimated: z.boolean().optional().default(false),
  estimatedTo: z.enum(["month", "year"]).optional(),
  attributeDetail: z.string().trim().max(2000).optional().default(""),
  attributeNotes: z.string().trim().max(4000).optional().default(""),
  endDate: z.string().trim().max(32).optional().default(""),
  typeKey: z.string().trim().min(1).max(80),
  label: z.string().trim().max(120).optional().default(""),
  valueText: z.string().trim().max(2000).optional().default(""),
  dateStart: z.string().trim().max(32).optional().default(""),
  dateEnd: z.string().trim().max(32).optional().default(""),
  location: z.string().trim().max(240).optional().default(""),
  notes: z.string().trim().max(4000).optional().default(""),
});

export const attributeCreateSchema = baseSchema
  .extend({
    entityType: z.enum(ENTITY_TYPES),
    entityId: z.string().trim().min(1).max(80),
  })
  .transform((input) => {
    const normalizedAttributeType = normalizeTypeKey(input.attributeType || input.typeKey);
    const typeKey = normalizedAttributeType;
    const isDateRelated = input.isDateRelated ?? input.category === "event";
    return {
      ...input,
      isDateRelated,
      attributeType: normalizedAttributeType,
      typeKey,
      category: input.category ?? (isDateRelated ? "event" : inferCategory(typeKey)),
      attributeDate: input.attributeDate || input.dateStart,
      endDate: input.endDate || input.dateEnd,
      attributeDetail: input.attributeDetail || input.valueText,
      attributeNotes: input.attributeNotes || input.notes,
    };
  })
  .superRefine((input, ctx) => {
    const isEvent = input.category === "event";
    const requiresDate = isEvent;
    if (input.category === "descriptor" && !(input.attributeDetail || input.valueText).trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "value_text is required for descriptor attributes", path: ["valueText"] });
    }
    if (requiresDate && !(input.attributeDate || input.dateStart).trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "date_start is required for this event type", path: ["dateStart"] });
    }
    if (input.dateIsEstimated && !input.estimatedTo) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "estimated_to is required when date is estimated", path: ["estimatedTo"] });
    }
  });

export const attributeUpdateSchema = baseSchema
  .partial()
  .transform((input) => {
    const typeKey = input.typeKey ? normalizeTypeKey(input.typeKey) : undefined;
    const category = input.category ?? (typeKey ? inferCategory(typeKey) : undefined);
    return {
      ...input,
      typeKey,
      category,
    };
  });

export const attributeMediaPatchSchema = z.object({
  removeMediaLinkId: z.string().trim().min(1).max(120),
});
