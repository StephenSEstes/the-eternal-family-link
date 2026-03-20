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
const STORY_DETAIL_MAX_CHARS = 180;

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

function safeParseJsonObject(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_parse_error";
    console.warn("[ai/story-import] unable to parse model JSON payload; falling back to primary story draft", message);
    return null;
  }
}

function firstSentence(value: string) {
  const normalized = normalizeWhitespace(value).replace(/\s+/g, " ");
  if (!normalized) return "";
  const match = normalized.match(/^[^.!?]+[.!?]?/);
  return (match?.[0] ?? normalized).trim();
}

function buildConciseStoryDetail(value: string) {
  const sentence = firstSentence(value);
  return clampText(sentence || value, STORY_DETAIL_MAX_CHARS);
}

function buildStoryLabel(value: string) {
  const sentence = firstSentence(value).replace(/[.!?]+$/, "");
  const words = sentence
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(" ");
  return clampText(words || sentence || "Life Story", 120);
}

function extractDateFromStoryText(value: string) {
  const text = normalizeWhitespace(value);
  if (!text) return "";
  const iso = text.match(/\b(19|20)\d{2}-\d{2}-\d{2}\b/);
  if (iso) return iso[0];

  const slash = text.match(/\b(0?[1-9]|1[0-2])\/([0-2]?[0-9]|3[0-1])\/((19|20)\d{2})\b/);
  if (slash) {
    const [, mm, dd, yyyy] = slash;
    return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }

  const monthName = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-2]?[0-9]|3[0-1]),\s*((19|20)\d{2})\b/i,
  );
  if (monthName) {
    const parsed = new Date(`${monthName[1]} ${monthName[2]}, ${monthName[3]}`);
    if (!Number.isNaN(parsed.getTime())) {
      const year = parsed.getUTCFullYear();
      const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
      const day = String(parsed.getUTCDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
  }
  return "";
}

function buildPrimaryStoryNotes(sourceText: string, existingNotes: string) {
  const normalizedSource = normalizeWhitespace(sourceText);
  const normalizedExisting = normalizeWhitespace(existingNotes);
  const pieces: string[] = [];
  if (normalizedExisting) {
    pieces.push(normalizedExisting);
  }
  if (normalizedSource) {
    const alreadyContainsSource =
      normalizedExisting.length > 0 &&
      normalizedSource.length > 0 &&
      normalizedExisting.includes(normalizedSource.slice(0, Math.min(normalizedSource.length, 120)));
    if (!alreadyContainsSource) {
      pieces.push(`Original narrative:\n${normalizedSource}`);
    }
  }
  return clampText(pieces.join("\n\n").trim(), 4000);
}

function normalizePrimaryStoryProposalFromSource(proposal: AiStoryImportProposal, sourceText: string): AiStoryImportProposal {
  const normalizedSource = normalizeWhitespace(sourceText);
  const detailSource = proposal.attributeDetail || proposal.label || normalizedSource;
  const detail = buildConciseStoryDetail(detailSource);
  const label = buildStoryLabel(proposal.label || detail || normalizedSource);
  const attributeDate = proposal.attributeDate.trim() || extractDateFromStoryText(normalizedSource);
  return {
    ...proposal,
    label,
    attributeDetail: detail,
    attributeNotes: buildPrimaryStoryNotes(normalizedSource, proposal.attributeNotes || proposal.sourceExcerpt || ""),
    attributeDate: clampText(attributeDate, 32),
    sourceExcerpt: clampText(normalizedSource, 1000),
    rationale: clampText(proposal.rationale || "Primary narrative story captured from the original text.", 500),
  };
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
    "Extract dates when explicitly present in the story text (for example YYYY-MM-DD, MM/DD/YYYY, or Month Day, Year).",
    "If a date is missing or uncertain, leave attributeDate empty. Do not invent dates.",
    "Keep each supporting proposal focused on one distinct fact.",
    "label should be a short human-readable title (about 3-8 words).",
    "attributeDetail should be a brief one-sentence summary, not the full narrative body.",
    "For the primary story proposal, keep attributeNotes concise. Do not copy the entire source narrative into model output.",
    "For supporting proposals, attributeNotes may hold extra context.",
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
  const label = buildStoryLabel(normalized || "Life Story");
  const detail = buildConciseStoryDetail(normalized || "Life Story");
  const notes = buildPrimaryStoryNotes(normalized, "");
  return {
    proposalId,
    attributeKind: "event",
    attributeType: "life_event",
    attributeTypeCategory: "story",
    attributeDate: extractDateFromStoryText(normalized),
    endDate: "",
    dateIsEstimated: false,
    label,
    attributeDetail: detail,
    attributeNotes: notes,
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

  const parsedJson = safeParseJsonObject(outputText);
  const parsed = parsedJson == null
    ? aiStoryImportResponseSchema.safeParse({ proposals: [] })
    : aiStoryImportResponseSchema.safeParse(parsedJson);
  const modelProposals = parsed.success ? parsed.data.proposals : [];
  if (!parsed.success) {
    console.warn("[ai/story-import] model payload did not match schema; falling back to primary story draft", parsed.error.flatten());
  }

  const normalizedProposals = modelProposals
    .map((proposal, index) => normalizeProposal(proposal, allowed, index))
    .filter((proposal): proposal is AiStoryImportProposal => Boolean(proposal))
    .filter((proposal) => proposal.attributeDetail.trim().length > 0)
    .filter((proposal) => !looksFragmentarySupportingProposal(proposal));

  const primaryFromModel = normalizedProposals.find((proposal) => isPrimaryStoryProposal(proposal)) ?? null;
  const primaryStory = normalizePrimaryStoryProposalFromSource(
    primaryFromModel ?? buildPrimaryStoryProposalFromSource(sourceText),
    sourceText,
  );
  const supporting = normalizedProposals.filter((proposal) => !isPrimaryStoryProposal(proposal));
  const proposals = dedupeProposals([primaryStory, ...supporting]).slice(0, MAX_STORY_IMPORT_PROPOSALS);

  return {
    proposals,
    model: getOpenAiStoryImportModel(),
  };
}
