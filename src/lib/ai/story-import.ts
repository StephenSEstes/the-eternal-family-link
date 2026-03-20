import "server-only";

import { getAttributeEventDefinitions } from "@/lib/attributes/event-definitions";
import {
  inferAttributeKindFromTypeKey,
  normalizeAttributeKind,
  normalizeAttributeTypeKey,
} from "@/lib/attributes/definition-defaults";
import type { AttributeCategory } from "@/lib/attributes/types";
import { aiStoryImportResponseSchema, type AiStoryImportProposal } from "@/lib/ai/story-import-types";
import { getOpenAiClient, getOpenAiStoryImportModel, isOpenAiConfigured } from "@/lib/ai/openai";

type StoryImportInput = {
  tenantKey: string;
  tenantName: string;
  personDisplayName: string;
  sourceText: string;
};

type AllowedDefinitionMap = {
  categories: Set<string>;
  types: Map<string, Set<string>>;
  summary: string;
};

const MAX_STORY_IMPORT_PROPOSALS = 10;

function normalizeWhitespace(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

function stripMarkdownFence(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function clampText(value: string, max: number) {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max).trim();
}

function buildAllowedDefinitionsSummary(definitions: Awaited<ReturnType<typeof getAttributeEventDefinitions>>): AllowedDefinitionMap {
  const enabledCategories = definitions.categories.filter((item) => item.isEnabled);
  const enabledTypes = definitions.types.filter((item) => item.isEnabled);
  const categories = new Set<string>();
  const types = new Map<string, Set<string>>();

  for (const item of enabledCategories) {
    categories.add(`${item.kind}:${normalizeAttributeTypeKey(item.categoryKey)}`);
  }
  for (const item of enabledTypes) {
    const categoryId = `${item.kind}:${normalizeAttributeTypeKey(item.categoryKey)}`;
    const next = types.get(categoryId) ?? new Set<string>();
    next.add(normalizeAttributeTypeKey(item.typeKey));
    types.set(categoryId, next);
  }

  const summary = enabledCategories
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.categoryLabel.localeCompare(b.categoryLabel))
    .map((category) => {
      const categoryId = `${category.kind}:${normalizeAttributeTypeKey(category.categoryKey)}`;
      const typeList = Array.from(types.get(categoryId) ?? []).sort();
      const typeText = typeList.length > 0 ? ` | subtypes: ${typeList.join(", ")}` : "";
      return `- ${category.kind} | ${normalizeAttributeTypeKey(category.categoryKey)} | ${category.categoryLabel}${typeText}`;
    })
    .join("\n");

  return { categories, types, summary };
}

function normalizeProposal(
  raw: AiStoryImportProposal,
  allowed: AllowedDefinitionMap,
  index: number,
): AiStoryImportProposal | null {
  const normalizedType = normalizeAttributeTypeKey(raw.attributeType);
  const normalizedDate = clampText(raw.attributeDate ?? "", 32);
  const explicitKind = normalizeAttributeKind(raw.attributeKind);
  const inferredKind =
    explicitKind ??
    inferAttributeKindFromTypeKey(normalizedType, normalizedDate);
  const normalizedKind = inferredKind as AttributeCategory;
  const categoryId = `${normalizedKind}:${normalizedType}`;
  if (!allowed.categories.has(categoryId)) {
    return null;
  }

  const rawTypeCategory = normalizeAttributeTypeKey(raw.attributeTypeCategory ?? "");
  const allowedTypes = allowed.types.get(categoryId) ?? new Set<string>();
  const normalizedTypeCategory = rawTypeCategory && allowedTypes.has(rawTypeCategory) ? rawTypeCategory : "";
  const dateIsEstimated = Boolean(raw.dateIsEstimated && raw.estimatedTo);

  return {
    proposalId: clampText(raw.proposalId || `proposal_${index + 1}`, 80) || `proposal_${index + 1}`,
    attributeKind: normalizedKind,
    attributeType: normalizedType,
    attributeTypeCategory: normalizedTypeCategory,
    attributeDate: normalizedDate,
    endDate: clampText(raw.endDate ?? "", 32),
    dateIsEstimated,
    estimatedTo: dateIsEstimated ? raw.estimatedTo : undefined,
    label: clampText(raw.label ?? "", 120),
    attributeDetail: clampText(raw.attributeDetail ?? "", 2000),
    attributeNotes: clampText(raw.attributeNotes ?? "", 4000),
    sourceExcerpt: clampText(raw.sourceExcerpt ?? "", 1000),
    rationale: clampText(raw.rationale ?? "", 500),
  };
}

function buildInstructions(input: {
  tenantName: string;
  personDisplayName: string;
  definitionSummary: string;
}) {
  return [
    "You extract canonical attribute drafts for The Eternal Family Link.",
    `Current family group: ${input.tenantName}.`,
    `Current person: ${input.personDisplayName}.`,
    "Return JSON only. Do not include markdown fences or commentary.",
    "Create ONE primary story proposal that preserves the overall narrative.",
    "The primary story must be: attributeKind=event, attributeType=life_event, attributeTypeCategory=story.",
    "Do NOT split a single narrative into sentence-level proposals.",
    "Add supporting proposals only for high-signal reusable facts (for example relationships, moves/addresses, major milestones).",
    "Supporting proposals must be non-duplicative and materially useful on their own.",
    "Return at most 10 proposals total including the one primary story.",
    "Do not invent facts, relationships, names, dates, or places.",
    "Use descriptor for timeless facts, hobbies, talents, physical details, and recurring personal facts.",
    "Use event for dated or time-bound milestones and for story vignettes.",
    "If sibling/family context is mentioned, prefer family_relationship event proposals only when a concrete relationship fact is present.",
    "If address/home location is mentioned, prefer moved event proposals for concrete move/location facts.",
    "If no subtype clearly matches an allowed subtype for a category, leave attributeTypeCategory empty.",
    "If a date is missing or uncertain, leave attributeDate empty. The user will review before saving.",
    "Keep each supporting proposal focused on one distinct fact.",
    "label should be a short human-readable title.",
    "attributeDetail should contain the main fact or story body.",
    "attributeNotes may hold supporting context that helps the reviewer.",
    "Use only the allowed category/type combinations listed below.",
    "",
    input.definitionSummary,
    "",
    "Return this exact JSON shape:",
    '{"proposals":[{"proposalId":"proposal_1","attributeKind":"event","attributeType":"life_event","attributeTypeCategory":"story","attributeDate":"","endDate":"","dateIsEstimated":false,"estimatedTo":"year","label":"Short title","attributeDetail":"Main detail text","attributeNotes":"","sourceExcerpt":"","rationale":""}]}',
  ].join("\n");
}

function countWords(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function isPrimaryStoryProposal(proposal: AiStoryImportProposal) {
  return (
    normalizeAttributeKind(proposal.attributeKind) === "event" &&
    normalizeAttributeTypeKey(proposal.attributeType) === "life_event" &&
    normalizeAttributeTypeKey(proposal.attributeTypeCategory) === "story"
  );
}

function looksFragmentarySupportingProposal(proposal: AiStoryImportProposal) {
  if (isPrimaryStoryProposal(proposal)) {
    return false;
  }
  const detail = proposal.attributeDetail.trim();
  const notes = proposal.attributeNotes.trim();
  const hasDate = proposal.attributeDate.trim().length > 0;
  const hasSubtype = proposal.attributeTypeCategory.trim().length > 0;
  const words = countWords(detail);
  return words < 6 && !hasDate && !hasSubtype && notes.length < 24;
}

function buildPrimaryStoryProposalFromSource(sourceText: string): AiStoryImportProposal {
  const normalized = normalizeWhitespace(sourceText);
  const proposalId = "proposal_story_1";
  const label = "Life Story";
  const detail = clampText(normalized, 2000);
  const remaining = normalized.slice(detail.length).trim();
  const suffix = remaining ? "\n\n[Original narrative truncated for length.]" : "";
  const notes = clampText(`${detail}${suffix}${remaining ? `\n${remaining}` : ""}`.trim(), 4000);
  return {
    proposalId,
    attributeKind: "event",
    attributeType: "life_event",
    attributeTypeCategory: "story",
    attributeDate: "",
    endDate: "",
    dateIsEstimated: false,
    label,
    attributeDetail: detail,
    attributeNotes: notes === detail ? "" : notes,
    sourceExcerpt: clampText(normalized, 1000),
    rationale: "Primary narrative story captured from the original text.",
  };
}

function dedupeProposals(proposals: AiStoryImportProposal[]) {
  const seen = new Set<string>();
  const output: AiStoryImportProposal[] = [];
  for (const proposal of proposals) {
    const key = [
      normalizeAttributeKind(proposal.attributeKind) ?? "",
      normalizeAttributeTypeKey(proposal.attributeType),
      normalizeAttributeTypeKey(proposal.attributeTypeCategory),
      proposal.attributeDate.trim(),
      proposal.endDate.trim(),
      proposal.attributeDetail.trim().toLowerCase(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(proposal);
  }
  return output;
}

export async function generateStoryImportProposals(input: StoryImportInput) {
  if (!isOpenAiConfigured()) {
    throw new Error("AI story import is not configured.");
  }

  const sourceText = normalizeWhitespace(input.sourceText);
  if (!sourceText) {
    throw new Error("Story text is required.");
  }

  const definitions = await getAttributeEventDefinitions(input.tenantKey);
  const allowed = buildAllowedDefinitionsSummary(definitions);
  const client = getOpenAiClient();
  const response = await client.responses.create({
    model: getOpenAiStoryImportModel(),
    instructions: buildInstructions({
      tenantName: input.tenantName,
      personDisplayName: input.personDisplayName,
      definitionSummary: allowed.summary,
    }),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: sourceText,
          },
        ],
      },
    ],
    max_output_tokens: 3200,
  });

  const outputText = stripMarkdownFence(response.output_text ?? "");
  if (!outputText) {
    throw new Error("AI story import returned no proposals.");
  }

  const parsedJson = JSON.parse(outputText) as unknown;
  const parsed = aiStoryImportResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error("AI story import returned an invalid proposal payload.");
  }

  const normalizedProposals = parsed.data.proposals
    .map((proposal, index) => normalizeProposal(proposal, allowed, index))
    .filter((proposal): proposal is AiStoryImportProposal => Boolean(proposal))
    .filter((proposal) => proposal.attributeDetail.trim().length > 0)
    .filter((proposal) => !looksFragmentarySupportingProposal(proposal));

  const primaryFromModel = normalizedProposals.find((proposal) => isPrimaryStoryProposal(proposal)) ?? null;
  const primaryStory = primaryFromModel ?? buildPrimaryStoryProposalFromSource(sourceText);
  const supporting = normalizedProposals.filter((proposal) => !isPrimaryStoryProposal(proposal));
  const proposals = dedupeProposals([primaryStory, ...supporting]).slice(0, MAX_STORY_IMPORT_PROPOSALS);

  return {
    proposals,
    model: getOpenAiStoryImportModel(),
  };
}
