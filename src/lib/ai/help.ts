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

type HelpRule = {
  keywords: string[];
  answer: string;
};

const ADMIN_ONLY_HELP_RULES: HelpRule[] = [
  {
    keywords: ["invite", "invitation", "invite link", "invite user", "invite someone"],
    answer:
      "Inviting someone is an admin-only task. Ask your family-group admin to open Admin -> Users & Access -> User Directory -> Manage User -> Invite for that person.",
  },
  {
    keywords: ["audit", "audit log", "login history", "change history", "who changed"],
    answer:
      "The audit log is an admin-only tool. Ask your family-group admin to open Admin -> Users & Access -> Audit if you need login or change history.",
  },
  {
    keywords: ["family access", "user access", "manage users", "password policy", "local user"],
    answer:
      "That is an admin-only access-management task. Ask your family-group admin to use the Admin area for user access, family access, or password policy changes.",
  },
  {
    keywords: ["integrity", "orphan media", "merge duplicate", "duplicate merge", "import csv", "attribute definitions"],
    answer:
      "That tool is available only in the Admin area. Ask your family-group admin to handle that task from Admin.",
  },
  {
    keywords: ["create family", "add family", "delete family", "family group settings"],
    answer:
      "Family-group creation, delete, and settings changes are admin-only tasks. Ask your family-group admin to handle that in Admin.",
  },
];

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

function normalizeQuestion(value: string) {
  return value.trim().toLowerCase();
}

function getRoleGuardAnswer(input: AnswerHelpQuestionInput) {
  if (input.role !== "USER") {
    return null;
  }

  const lastUserMessage = [...input.messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const normalized = normalizeQuestion(lastUserMessage);
  if (!normalized) {
    return null;
  }

  for (const rule of ADMIN_ONLY_HELP_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return rule.answer;
    }
  }
  return null;
}

export async function answerHelpQuestion(input: AnswerHelpQuestionInput) {
  if (!isOpenAiConfigured()) {
    throw new Error("AI help is not configured.");
  }

  const guardedAnswer = getRoleGuardAnswer(input);
  if (guardedAnswer) {
    return {
      answer: guardedAnswer,
      model: "role-policy",
    };
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
