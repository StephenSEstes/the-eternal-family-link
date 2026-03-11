import "server-only";

import OpenAI from "openai";

let client: OpenAI | null = null;

export function isOpenAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function getOpenAiHelpModel() {
  return process.env.OPENAI_HELP_MODEL?.trim() || "gpt-5-mini";
}

export function getOpenAiStoryImportModel() {
  return process.env.OPENAI_STORY_IMPORT_MODEL?.trim() || getOpenAiHelpModel();
}

export function getOpenAiClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OpenAI help is not configured.");
  }
  if (!client) {
    client = new OpenAI({ apiKey });
  }
  return client;
}
