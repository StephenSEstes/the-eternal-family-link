import "server-only";

import { z } from "zod";
import { getOpenAiClient, getOpenAiPhotoIntelligenceModel, isOpenAiConfigured } from "@/lib/ai/openai";
import type { PhotoIntelligenceCaptionRefinement, PhotoVisionInsight } from "@/lib/media/photo-intelligence";

type RefinePhotoCaptionInput = {
  tenantName: string;
  fileName: string;
  linkedPeople: string[];
  vision: PhotoVisionInsight;
  fallbackLabel: string;
  fallbackDescription: string;
};

const photoCaptionSchema = z.object({
  labelSuggestion: z.string().trim().max(80).default(""),
  descriptionSuggestion: z.string().trim().max(180).default(""),
  reasoning: z.string().trim().max(280).default(""),
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
        }
      }
    }
  }
  return parts.join("\n").trim();
}

function buildInstructions(input: RefinePhotoCaptionInput) {
  return [
    "You produce reviewed photo caption suggestions for The Eternal Family Link.",
    `Family group: ${input.tenantName}.`,
    "Use only the supplied signals. Do not invent names, places, dates, or events.",
    "The title should be a short human-friendly caption of about 3 to 10 words.",
    "The description should be one concise sentence or phrase, no more than 180 characters.",
    "If the signals are too weak for a better caption, return empty strings.",
    "Prefer grounded family-memory phrasing over generic AI wording.",
    "Return JSON only. No markdown fences.",
    "JSON shape:",
    '{"labelSuggestion":"","descriptionSuggestion":"","reasoning":""}',
    "",
    `File name: ${input.fileName}`,
    `Linked people: ${input.linkedPeople.length > 0 ? input.linkedPeople.join(", ") : "none"}`,
    `Vision labels: ${input.vision.labels.map((item) => item.name).join(", ") || "none"}`,
    `Vision objects: ${input.vision.objects.map((item) => item.name).join(", ") || "none"}`,
    `Detected faces: ${String(input.vision.faceCount)}`,
    `Fallback title: ${input.fallbackLabel}`,
    `Fallback description: ${input.fallbackDescription}`,
  ].join("\n");
}

function cleanSuggestion(value: string, fallback: string, max: number) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return fallback;
  }
  return normalized.length <= max ? normalized : normalized.slice(0, max).trim();
}

export async function refinePhotoCaptionWithOpenAi(
  input: RefinePhotoCaptionInput,
): Promise<PhotoIntelligenceCaptionRefinement | null> {
  if (!isOpenAiConfigured()) {
    return null;
  }

  const hasVisionSignal = input.vision.labels.length > 0 || input.vision.objects.length > 0 || input.vision.faceCount > 0;
  if (!hasVisionSignal) {
    return null;
  }

  const model = getOpenAiPhotoIntelligenceModel();
  const client = getOpenAiClient();
  const response = await client.responses.create({
    model,
    instructions: buildInstructions(input),
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: "Refine the photo title and description using the supplied vision signals." }],
      },
    ],
    max_output_tokens: 300,
  });

  const outputText = stripMarkdownFence(extractResponseText(response));
  if (!outputText) {
    return null;
  }

  try {
    const parsed = photoCaptionSchema.safeParse(JSON.parse(outputText) as unknown);
    if (!parsed.success) {
      return null;
    }

    const refinedLabel = cleanSuggestion(parsed.data.labelSuggestion, input.fallbackLabel, 80);
    const refinedDescription = cleanSuggestion(parsed.data.descriptionSuggestion, input.fallbackDescription, 180);
    const reasoning = normalizeWhitespace(parsed.data.reasoning);
    return {
      labelSuggestion: refinedLabel,
      descriptionSuggestion: refinedDescription,
      source: "openai_vision",
      model,
      notes: reasoning ? `Caption refined with OpenAI from Vision signals. ${reasoning}` : "Caption refined with OpenAI from Vision signals.",
    };
  } catch {
    return null;
  }
}
