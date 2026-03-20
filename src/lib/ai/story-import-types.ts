import { z } from "zod";

function normalizeEstimatedTo(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "month" || normalized === "year") {
    return normalized;
  }
  return undefined;
}

function normalizeAttributeKind(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "descriptor") {
    return "descriptor";
  }
  return "event";
}

export const aiStoryImportProposalSchema = z.object({
  proposalId: z.string().trim().max(80).optional().default(""),
  attributeKind: z.preprocess(normalizeAttributeKind, z.enum(["descriptor", "event"])).optional().default("event"),
  attributeType: z.string().trim().max(120).optional().default("life_event"),
  attributeTypeCategory: z.string().trim().max(120).default(""),
  attributeDate: z.string().trim().max(32).default(""),
  endDate: z.string().trim().max(32).default(""),
  dateIsEstimated: z.boolean().default(false),
  estimatedTo: z.preprocess(normalizeEstimatedTo, z.enum(["month", "year"]).optional()).optional(),
  label: z.string().trim().max(120).default(""),
  attributeDetail: z.string().trim().max(2000).optional().default(""),
  attributeNotes: z.string().trim().max(4000).default(""),
  sourceExcerpt: z.string().trim().max(1000).default(""),
  rationale: z.string().trim().max(500).default(""),
});

export const aiStoryImportResponseSchema = z.object({
  proposals: z.array(aiStoryImportProposalSchema).max(40),
});

export type AiStoryImportProposal = z.infer<typeof aiStoryImportProposalSchema>;
export type AiStoryImportResponse = z.infer<typeof aiStoryImportResponseSchema>;
