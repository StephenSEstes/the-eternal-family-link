import { z } from "zod";

const shortText = z.string().trim().max(2000).optional().default("");

export const personAttributeCreateSchema = z
  .object({
    attributeType: z.string().trim().min(1).max(80),
    valueText: z.string().trim().min(1).max(4000),
    label: shortText,
    valueJson: shortText,
    isPrimary: z.boolean().optional().default(false),
    sortOrder: z.number().int().min(0).max(9999).optional().default(0),
    startDate: z.string().trim().max(32).optional().default(""),
    endDate: z.string().trim().max(32).optional().default(""),
    visibility: z.string().trim().max(32).optional().default("family"),
    notes: shortText,
  })
  .strict();

export const personAttributeUpdateSchema = personAttributeCreateSchema.partial().strict();
