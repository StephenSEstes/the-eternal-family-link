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
    "Extract as many distinct attribute proposals as the source directly supports.",
    "Do not invent facts, relationships, names, dates, or places.",
    "Use descriptor for timeless facts, hobbies, talents, physical details, and recurring personal facts.",
    "Use event for dated or time-bound milestones and for story vignettes.",
    "For stories, use attributeType=life_event and attributeTypeCategory=story when the text is a narrative vignette or memory.",
    "If a date is missing or uncertain, leave attributeDate empty. The user will review before saving.",
    "Keep each proposal focused on one fact, event, anniversary source event, or story vignette.",
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

  const proposals = parsed.data.proposals
    .map((proposal, index) => normalizeProposal(proposal, allowed, index))
    .filter((proposal): proposal is AiStoryImportProposal => Boolean(proposal))
    .filter((proposal) => proposal.attributeDetail.trim().length > 0);

  return {
    proposals,
    model: getOpenAiStoryImportModel(),
  };
}
