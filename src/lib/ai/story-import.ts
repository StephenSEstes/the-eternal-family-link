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
  hints?: {
    titleHint?: string;
    startDate?: string;
    endDate?: string;
    attributeType?: string;
    attributeTypeCategory?: string;
  };
};

type AllowedDefinitionMap = {
  categories: Set<string>;
  types: Map<string, Set<string>>;
  summary: string;
};

const MAX_STORY_IMPORT_PROPOSALS = 10;
const STORY_DETAIL_MAX_CHARS = 180;
const MONTH_INDEX: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function normalizeWhitespace(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

function sanitizeStoryImportHints(input?: StoryImportInput["hints"]) {
  return {
    titleHint: clampText(String(input?.titleHint ?? "").trim(), 120),
    startDate: clampText(String(input?.startDate ?? "").trim(), 32),
    endDate: clampText(String(input?.endDate ?? "").trim(), 32),
    attributeType: clampText(normalizeAttributeTypeKey(String(input?.attributeType ?? "").trim()), 120),
    attributeTypeCategory: clampText(normalizeAttributeTypeKey(String(input?.attributeTypeCategory ?? "").trim()), 120),
  };
}

function stripLeadingNarrativeDescriptor(value: string) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return "";
  const lines = normalized.split("\n");
  const first = lines[0]?.trim() ?? "";
  const isTopLevelDescriptor =
    /^top-level\b/i.test(first) &&
    /\b(matriarch|patriarch|ancestor|founder)\b/i.test(first);
  if (!isTopLevelDescriptor) {
    return normalized;
  }
  const remaining = lines.slice(1).join("\n").trim();
  return remaining || normalized;
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

function sanitizeTitleText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/[“”"]/g, "")
    .replace(/\s*[:;,.!?]+\s*$/g, "")
    .trim();
}

function collapseRepeatedLead(value: string) {
  const normalized = sanitizeTitleText(value);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 6) return normalized;
  for (let size = 5; size >= 2; size -= 1) {
    const first = words.slice(0, size).join(" ").toLowerCase();
    const second = words.slice(size, size * 2).join(" ").toLowerCase();
    if (first && second && first === second) {
      return [words.slice(0, size).join(" "), words.slice(size * 2).join(" ")].join(" ").trim();
    }
  }
  return normalized;
}

function looksSentenceLikeTitle(value: string) {
  const normalized = sanitizeTitleText(value);
  if (!normalized) return true;
  if (/[.!?]$/.test(normalized)) return true;
  if (/,/.test(normalized)) return true;
  if (/\b(the place of|was located|it was|she was|he was|on\s+\w+\s+\d{1,2},\s*(19|20)\d{2})\b/i.test(normalized)) return true;
  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length > 14;
}

function titleFromClauseStart(value: string) {
  const normalized = collapseRepeatedLead(value);
  if (!normalized) return "";
  const atComma = normalized.split(",")[0]?.trim() ?? "";
  const candidate = atComma || normalized;
  return buildDetailTitle(candidate);
}

function buildDetailTitle(value: string) {
  const clean = collapseRepeatedLead(value);
  if (!clean) return "";
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length <= 12) {
    return clampText(clean, STORY_DETAIL_MAX_CHARS);
  }
  return clampText(words.slice(0, 12).join(" "), STORY_DETAIL_MAX_CHARS);
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

function isWeakStoryLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  const weakLabels = new Set(["life story", "story", "short title", "proposal 1", "proposal_1"]);
  return weakLabels.has(normalized) || normalized.startsWith("top-level");
}

function toIsoDate(month: number, day: number, year: number) {
  if (!Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(year)) return "";
  if (year < 1800 || year > 2100) return "";
  if (month < 1 || month > 12) return "";
  if (day < 1 || day > 31) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDateTokenToIso(value: string) {
  const token = value.trim().replace(/[.,;]+$/g, "");
  if (!token) return "";
  const iso = token.match(/^((19|20)\d{2})-(\d{2})-(\d{2})$/);
  if (iso) return iso[1] + token.slice(4);

  const slash = token.match(/^(0?[1-9]|1[0-2])\/([0-2]?[0-9]|3[0-1])\/((19|20)\d{2})$/);
  if (slash) {
    const [, mm, dd, yyyy] = slash;
    return toIsoDate(Number(mm), Number(dd), Number(yyyy));
  }

  const monthDayYear = token.match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-2]?[0-9]|3[0-1]),\s*((19|20)\d{2})$/i,
  );
  if (monthDayYear) {
    const month = MONTH_INDEX[monthDayYear[1].toLowerCase()] ?? 0;
    return toIsoDate(month, Number(monthDayYear[2]), Number(monthDayYear[3]));
  }

  const yearOnly = token.match(/^((19|20)\d{2})$/);
  if (yearOnly) {
    return `${yearOnly[1]}-01-01`;
  }
  return "";
}

function deriveStoryTitleFromSource(value: string) {
  const normalized = normalizeWhitespace(value).replace(/\s+/g, " ");
  if (!normalized) return "";
  const birthPlaceName = normalized.match(
    /([A-Z][A-Za-z'.&\-\s]{2,90}?)\s*,\s*the place of my birth\b/i,
  );
  if (birthPlaceName?.[1]) {
    return clampText(`${birthPlaceName[1].trim()} where I was born`, 120);
  }
  const namedPlace = normalized.match(/([A-Z][A-Za-z'.&\-\s]{2,90}Maternity Home)\b/i);
  if (namedPlace?.[1]) {
    return clampText(namedPlace[1].trim(), 120);
  }
  return "";
}

function extractStoryDateRangeFromText(value: string) {
  const text = normalizeWhitespace(value).replace(/\s+/g, " ");
  if (!text) return null;
  const rangeMatch = text.match(
    /\bfrom\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*(?:19|20)\d{2}|(?:19|20)\d{2}|(?:0?[1-9]|1[0-2])\/(?:[0-2]?[0-9]|3[0-1])\/(?:19|20)\d{2})[^.]{0,120}?\b(?:until|through|to)\b[^.]{0,40}?\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*(?:19|20)\d{2}|(?:19|20)\d{2}|(?:0?[1-9]|1[0-2])\/(?:[0-2]?[0-9]|3[0-1])\/(?:19|20)\d{2})/i,
  );
  if (!rangeMatch) return null;
  const startDate = parseDateTokenToIso(rangeMatch[1]);
  const endDate = parseDateTokenToIso(rangeMatch[2]);
  if (!startDate && !endDate) return null;
  return { startDate, endDate };
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
  const preferredSourceTitle = deriveStoryTitleFromSource(normalizedSource);
  const aiLabel = clampText(proposal.label || "", 120);
  const label = isWeakStoryLabel(aiLabel)
    ? (preferredSourceTitle || buildStoryLabel(proposal.attributeDetail || normalizedSource))
    : aiLabel;
  const aiDetail = buildDetailTitle(proposal.attributeDetail || "");
  const labelAsDetail = buildDetailTitle(label);
  const sourceAsDetail = titleFromClauseStart(detailSource);
  const preferredAsDetail = buildDetailTitle(preferredSourceTitle || "");
  const detail =
    (aiDetail && !looksSentenceLikeTitle(aiDetail) ? aiDetail : "") ||
    (labelAsDetail && !looksSentenceLikeTitle(labelAsDetail) ? labelAsDetail : "") ||
    (preferredAsDetail && !looksSentenceLikeTitle(preferredAsDetail) ? preferredAsDetail : "") ||
    sourceAsDetail ||
    buildConciseStoryDetail(detailSource);
  const inferredRange = extractStoryDateRangeFromText(normalizedSource);
  const attributeDate = clampText(
    (inferredRange?.startDate || proposal.attributeDate.trim() || extractDateFromStoryText(normalizedSource)),
    32,
  );
  const endDate = clampText(
    (inferredRange?.endDate || proposal.endDate.trim()),
    32,
  );
  return {
    ...proposal,
    label,
    attributeDetail: detail,
    attributeNotes: buildPrimaryStoryNotes(normalizedSource, proposal.attributeNotes || proposal.sourceExcerpt || ""),
    attributeDate,
    endDate,
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
  hints: ReturnType<typeof sanitizeStoryImportHints>;
}) {
  const hintLines = [
    input.hints.titleHint ? `Preferred title hint from user: ${input.hints.titleHint}` : "",
    input.hints.startDate ? `Preferred start date hint from user: ${input.hints.startDate}` : "",
    input.hints.endDate ? `Preferred end date hint from user: ${input.hints.endDate}` : "",
    input.hints.attributeType ? `Preferred attributeType hint from user: ${input.hints.attributeType}` : "",
    input.hints.attributeTypeCategory ? `Preferred attributeTypeCategory hint from user: ${input.hints.attributeTypeCategory}` : "",
  ].filter(Boolean);
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
    "If source text includes an operation/range phrase (for example 'from ... until ...'), prefer that range over publication/article dates.",
    "If a date is missing or uncertain, leave attributeDate empty. Do not invent dates.",
    "Keep each supporting proposal focused on one distinct fact.",
    "label should be a short human-readable summary title (about 3-10 words) describing the core story, not the source article headline/date.",
    "attributeDetail should be a descriptive title phrase (about 4-12 words), not a sentence body.",
    "Do not repeat leading words or copy/paste the first sentence fragment into attributeDetail.",
    "For the primary story proposal, keep attributeNotes concise. Do not copy the entire source narrative into model output.",
    "For supporting proposals, attributeNotes may hold extra context.",
    "Use only the allowed category/type combinations listed below.",
    ...(hintLines.length > 0
      ? [
          "",
          "User-provided refinement hints (use when consistent with source text and allowed definitions):",
          ...hintLines,
        ]
      : []),
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

  const sourceText = stripLeadingNarrativeDescriptor(input.sourceText);
  if (!sourceText) {
    throw new Error("Story text is required.");
  }

  const definitions = await getAttributeEventDefinitions(input.tenantKey);
  const allowed = buildAllowedDefinitionsSummary(definitions);
  const hints = sanitizeStoryImportHints(input.hints);
  const client = getOpenAiClient();
  const response = await client.responses.create({
    model: getOpenAiStoryImportModel(),
    instructions: buildInstructions({
      tenantName: input.tenantName,
      personDisplayName: input.personDisplayName,
      definitionSummary: allowed.summary,
      hints,
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
  let primaryStory = normalizePrimaryStoryProposalFromSource(
    primaryFromModel ?? buildPrimaryStoryProposalFromSource(sourceText),
    sourceText,
  );
  if (hints.titleHint) {
    const titleHint = clampText(hints.titleHint, 120);
    primaryStory = {
      ...primaryStory,
      label: titleHint,
      attributeDetail: buildDetailTitle(titleHint) || primaryStory.attributeDetail,
    };
  }
  if (hints.startDate || hints.endDate) {
    primaryStory = {
      ...primaryStory,
      attributeDate: hints.startDate || primaryStory.attributeDate,
      endDate: hints.endDate || primaryStory.endDate,
    };
  }
  const supporting = normalizedProposals.filter((proposal) => !isPrimaryStoryProposal(proposal));
  const proposals = dedupeProposals([primaryStory, ...supporting]).slice(0, MAX_STORY_IMPORT_PROPOSALS);

  return {
    proposals,
    model: getOpenAiStoryImportModel(),
  };
}
