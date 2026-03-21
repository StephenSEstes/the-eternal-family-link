import "server-only";

import { z } from "zod";
import { getAttributeEventDefinitions } from "@/lib/attributes/event-definitions";
import { normalizeAttributeTypeKey } from "@/lib/attributes/definition-defaults";
import { getOpenAiClient, getOpenAiStoryImportModel, isOpenAiConfigured } from "@/lib/ai/openai";

export type StoryChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type StoryChatSuggestion = {
  titleHint: string;
  startDate: string;
  endDate: string;
  attributeKind: "event" | "descriptor";
  attributeType: string;
  attributeTypeCategory: string;
  reasoning: string;
};

type StoryChatInput = {
  tenantKey: string;
  tenantName: string;
  personDisplayName: string;
  storyText: string;
  messages: StoryChatMessage[];
};

type AllowedDefinitionMap = {
  categories: Set<string>;
  types: Map<string, Set<string>>;
  summary: string;
};

const suggestionSchema = z.object({
  titleHint: z.string().trim().max(120).default(""),
  startDate: z.string().trim().max(32).default(""),
  endDate: z.string().trim().max(32).default(""),
  attributeKind: z.enum(["event", "descriptor"]).default("event"),
  attributeType: z.string().trim().max(120).default("life_event"),
  attributeTypeCategory: z.string().trim().max(120).default(""),
  reasoning: z.string().trim().max(400).default(""),
});

const aiResponseSchema = z.object({
  assistantMessage: z.string().trim().min(1).max(2500),
  suggestion: suggestionSchema,
});

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

function extractResponseText(response: unknown) {
  const direct = String((response as { output_text?: string } | null)?.output_text ?? "").trim();
  if (direct) {
    return direct;
  }
  const output = (response as { output?: Array<{ content?: Array<Record<string, unknown>> }> } | null)?.output ?? [];
  const parts: string[] = [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const chunk of content) {
      const type = String(chunk?.type ?? "").trim().toLowerCase();
      if (type === "output_text" || type === "text") {
        const text = String(chunk?.text ?? "").trim();
        if (text) {
          parts.push(text);
          continue;
        }
      }
      if (type === "refusal") {
        const refusal = String(chunk?.refusal ?? "").trim();
        if (refusal) {
          parts.push(refusal);
        }
      }
    }
  }
  return parts.join("\n").trim();
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

function buildInstructions(input: {
  tenantName: string;
  personDisplayName: string;
  storyText: string;
  definitionSummary: string;
}) {
  return [
    "You are an expert personal history documentarian for The Eternal Family Link.",
    `Current family group: ${input.tenantName}.`,
    `Current person: ${input.personDisplayName}.`,
    "The user wants iterative guidance before regenerating attribute drafts.",
    "Use the STORY TEXT as the source of truth.",
    "Help determine if the text is a single story or multiple vignettes.",
    "If the user asks why two stories are not split, answer directly and state which two candidate stories should be separate.",
    "Help identify high-signal supporting attributes (events/descriptors) grounded in the story.",
    "If user guidance is vague, ask targeted follow-up questions in assistantMessage.",
    "Prefer operation/event ranges over publication dates when both exist.",
    "Provide one concise, descriptive title hint for the story (4-12 words).",
    "Suggest date range only when explicitly grounded in the story text.",
    "Use only the allowed category/type combinations below.",
    "If unsure, leave uncertain suggestion fields empty.",
    "Return JSON only. No markdown fences.",
    "JSON shape:",
    '{"assistantMessage":"plain answer","suggestion":{"titleHint":"","startDate":"","endDate":"","attributeKind":"event","attributeType":"life_event","attributeTypeCategory":"story","reasoning":""}}',
    "",
    "STORY TEXT:",
    input.storyText,
    "",
    "Allowed category/type combinations:",
    input.definitionSummary,
  ].join("\n");
}

function normalizeSuggestion(raw: z.infer<typeof suggestionSchema>, allowed: AllowedDefinitionMap): StoryChatSuggestion {
  const attributeKind = raw.attributeKind;
  const attributeType = normalizeAttributeTypeKey(raw.attributeType);
  const categoryId = `${attributeKind}:${attributeType}`;
  const hasCategory = allowed.categories.has(categoryId);
  const safeType = hasCategory ? attributeType : "";
  const rawTypeCategory = normalizeAttributeTypeKey(raw.attributeTypeCategory);
  const allowedTypeCategory = safeType ? allowed.types.get(`${attributeKind}:${safeType}`) ?? new Set<string>() : new Set<string>();
  const safeTypeCategory = rawTypeCategory && allowedTypeCategory.has(rawTypeCategory) ? rawTypeCategory : "";
  return {
    titleHint: clampText(raw.titleHint, 120),
    startDate: clampText(raw.startDate, 32),
    endDate: clampText(raw.endDate, 32),
    attributeKind,
    attributeType: safeType,
    attributeTypeCategory: safeTypeCategory,
    reasoning: clampText(raw.reasoning, 400),
  };
}

export async function answerStoryChat(input: StoryChatInput) {
  if (!isOpenAiConfigured()) {
    throw new Error("AI story chat is not configured.");
  }

  const storyText = normalizeWhitespace(input.storyText);
  if (!storyText) {
    throw new Error("Story text is required.");
  }

  const definitions = await getAttributeEventDefinitions(input.tenantKey);
  const allowed = buildAllowedDefinitionsSummary(definitions);
  const transcript = input.messages
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content.trim()}`)
    .filter((line) => line.length > 0)
    .join("\n");
  const client = getOpenAiClient();
  const response = await client.responses.create({
    model: getOpenAiStoryImportModel(),
    instructions: buildInstructions({
      tenantName: input.tenantName,
      personDisplayName: input.personDisplayName,
      storyText,
      definitionSummary: allowed.summary,
    }),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: transcript,
          },
        ],
      },
    ],
    max_output_tokens: 900,
  });

  const outputText = stripMarkdownFence(extractResponseText(response));
  if (!outputText) {
    throw new Error("AI story chat returned no answer.");
  }

  try {
    const parsed = aiResponseSchema.safeParse(JSON.parse(outputText) as unknown);
    if (parsed.success) {
      return {
        answer: parsed.data.assistantMessage,
        suggestion: normalizeSuggestion(parsed.data.suggestion, allowed),
        model: getOpenAiStoryImportModel(),
      };
    }
  } catch {
    // Fall back to plain text answer below.
  }

  return {
    answer: clampText(outputText, 2500),
    suggestion: {
      titleHint: "",
      startDate: "",
      endDate: "",
      attributeKind: "event",
      attributeType: "",
      attributeTypeCategory: "",
      reasoning: "",
    } satisfies StoryChatSuggestion,
    model: getOpenAiStoryImportModel(),
  };
}
