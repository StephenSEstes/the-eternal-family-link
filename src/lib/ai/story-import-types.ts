import { z } from "zod";

export const aiStoryImportProposalSchema = z.object({
  proposalId: z.string().trim().min(1).max(80),
  attributeKind: z.enum(["descriptor", "event"]),
  attributeType: z.string().trim().min(1).max(120),
  attributeTypeCategory: z.string().trim().max(120).default(""),
  attributeDate: z.string().trim().max(32).default(""),
  endDate: z.string().trim().max(32).default(""),
  dateIsEstimated: z.boolean().default(false),
  estimatedTo: z.enum(["month", "year"]).optional(),
  label: z.string().trim().max(120).default(""),
  attributeDetail: z.string().trim().min(1).max(2000),
  attributeNotes: z.string().trim().max(4000).default(""),
  sourceExcerpt: z.string().trim().max(1000).default(""),
  rationale: z.string().trim().max(500).default(""),
});

export const aiStoryImportResponseSchema = z.object({
  proposals: z.array(aiStoryImportProposalSchema).max(40),
});

export type AiStoryImportProposal = z.infer<typeof aiStoryImportProposalSchema>;
export type AiStoryImportResponse = z.infer<typeof aiStoryImportResponseSchema>;
