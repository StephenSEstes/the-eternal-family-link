import { z } from "zod";

const ENTITY_TYPES = ["person", "household"] as const;
const CATEGORIES = ["descriptor", "event"] as const;
const DESCRIPTOR_TYPES = ["hobbies", "likes", "blood_type", "allergies", "hair_color", "height", "health"] as const;
const EVENT_TYPES = ["graduation", "missions", "religious_event", "injuries", "accomplishments", "stories", "lived_in", "jobs"] as const;
const EVENT_END_DATE_TYPES = new Set<string>(["missions", "lived_in", "jobs"]);

function normalizeTypeKey(value: string) {
  const raw = value.trim().toLowerCase();
  return raw.replace(/[^a-z0-9_-]/g, "_");
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
    const typeKey = normalizeTypeKey(input.typeKey);
    return {
      ...input,
      typeKey,
      category: input.category ?? inferCategory(typeKey),
    };
  })
  .superRefine((input, ctx) => {
    const isEvent = input.category === "event";
    const requiresDate = isEvent && input.typeKey !== "stories";
    if (input.category === "descriptor" && !input.valueText.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "value_text is required for descriptor attributes", path: ["valueText"] });
    }
    if (requiresDate && !input.dateStart.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "date_start is required for this event type", path: ["dateStart"] });
    }
    if (!EVENT_END_DATE_TYPES.has(input.typeKey) && input.dateEnd.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "date_end is allowed only for missions, lived_in, jobs", path: ["dateEnd"] });
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
