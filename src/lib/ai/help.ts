import "server-only";

import { AI_HELP_GUIDE } from "@/lib/ai/help-guide";
import { getOpenAiClient, getOpenAiHelpModel, isOpenAiConfigured } from "@/lib/ai/openai";

export type HelpChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type AnswerHelpQuestionInput = {
  tenantName: string;
  role: "ADMIN" | "USER";
  messages: HelpChatMessage[];
};

function buildInstructions(input: { tenantName: string; role: "ADMIN" | "USER" }) {
  return [
    "You are The Eternal Family Link help assistant.",
    `Current family group context: ${input.tenantName}.`,
    `Current signed-in role: ${input.role}.`,
    "Answer only from the product guide below.",
    "If the guide does not support a claim, say you are not sure or that the feature is not live yet.",
    "Do not claim to have changed data or sent email.",
    "Keep answers practical, direct, and step-by-step when useful.",
    "",
    AI_HELP_GUIDE,
  ].join("\n");
}

export async function answerHelpQuestion(input: AnswerHelpQuestionInput) {
  if (!isOpenAiConfigured()) {
    throw new Error("AI help is not configured.");
  }

  const client = getOpenAiClient();
  const response = await client.responses.create({
    model: getOpenAiHelpModel(),
    instructions: buildInstructions({ tenantName: input.tenantName, role: input.role }),
    input: input.messages.map((message) => ({
      role: message.role,
      content: [{ type: "input_text", text: message.content.trim() }],
    })),
    max_output_tokens: 600,
  });

  const answer = response.output_text?.trim();
  if (!answer) {
    throw new Error("AI help returned no answer.");
  }
  return {
    answer,
    model: getOpenAiHelpModel(),
  };
}
