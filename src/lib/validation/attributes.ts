import { z } from "zod";
import {
  inferAttributeKindFromTypeKey,
  normalizeAttributeKind,
  normalizeAttributeTypeKey,
} from "@/lib/attributes/definition-defaults";

const ENTITY_TYPES = ["person", "household"] as const;
const CATEGORIES = ["descriptor", "event"] as const;

const baseSchema = z.object({
  entityType: z.enum(ENTITY_TYPES).optional(),
  entityId: z.string().trim().min(1).max(80).optional(),
  category: z.enum(CATEGORIES).optional(),
  attributeKind: z.enum(CATEGORIES).optional(),
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
    const normalizedAttributeType = normalizeAttributeTypeKey(input.attributeType || input.typeKey);
    const typeKey = normalizedAttributeType;
    const explicitKind = normalizeAttributeKind(input.attributeKind ?? input.category);
    const inferredKind = inferAttributeKindFromTypeKey(normalizedAttributeType, input.attributeDate || input.dateStart);
    const category = explicitKind ?? (input.isDateRelated ? "event" : inferredKind);
    const isDateRelated = input.isDateRelated ?? category === "event";
    return {
      ...input,
      isDateRelated,
      attributeKind: category,
      attributeType: normalizedAttributeType,
      typeKey,
      category,
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
    const attributeType = input.attributeType ? normalizeAttributeTypeKey(input.attributeType) : undefined;
    const typeKey = input.typeKey ? normalizeAttributeTypeKey(input.typeKey) : undefined;
    const normalizedType = attributeType ?? typeKey;
    const explicitKind = normalizeAttributeKind(input.attributeKind ?? input.category);
    const category = explicitKind ?? (normalizedType ? inferAttributeKindFromTypeKey(normalizedType, input.attributeDate || input.dateStart || "") : undefined);
    return {
      ...input,
      attributeType,
      attributeKind: category,
      typeKey,
      category,
    };
  });

export const attributeMediaPatchSchema = z.object({
  removeMediaLinkId: z.string().trim().min(1).max(120),
});
