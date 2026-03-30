import "server-only";

import { AI_HELP_GUIDE } from "@/lib/ai/help-guide";
import { getTenantBasePath } from "@/lib/family-group/context";
import { getOpenAiClient, getOpenAiHelpModel, isOpenAiConfigured } from "@/lib/ai/openai";

export type HelpChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type HelpAction = {
  label: string;
  href: string;
  kind: "link";
  description?: string;
  requiresRole?: "ADMIN" | "USER";
};

type AnswerHelpQuestionInput = {
  tenantKey: string;
  tenantName: string;
  role: "ADMIN" | "USER";
  personId?: string;
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

function includesAnyKeyword(input: string, keywords: string[]) {
  return keywords.some((keyword) => input.includes(keyword));
}

function appendQuery(path: string, params: Record<string, string | undefined>) {
  const url = new URL(path, "https://help.local");
  for (const [key, value] of Object.entries(params)) {
    const next = String(value ?? "").trim();
    if (!next) continue;
    url.searchParams.set(key, next);
  }
  const query = url.searchParams.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

type HelpLinkContext = {
  basePath: string;
  helpPath: string;
  peoplePath: string;
  myProfilePath: string;
  myProfileMediaPath: string;
  myProfileAddMediaPath: string;
  myProfileAttributesPath: string;
  myProfileAddAttributePath: string;
  settingsPath: string;
};

function buildHelpLinkContext(input: AnswerHelpQuestionInput): HelpLinkContext {
  const basePath = getTenantBasePath(input.tenantKey);
  const helpPath = `${basePath || ""}/help` || "/help";
  const peoplePath = `${basePath || ""}/people` || "/people";
  const settingsPath = `${basePath || ""}/settings` || "/settings";
  const personId = String(input.personId ?? "").trim();
  const myProfilePath = personId
    ? `${peoplePath}/${encodeURIComponent(personId)}?returnTo=${encodeURIComponent(helpPath)}`
    : peoplePath;
  const myProfileMediaPath = appendQuery(myProfilePath, { tab: "photos" });
  const myProfileAddMediaPath = appendQuery(myProfilePath, { tab: "photos", action: "add-media" });
  const myProfileAttributesPath = appendQuery(myProfilePath, { tab: "attributes" });
  const myProfileAddAttributePath = appendQuery(myProfilePath, { tab: "attributes", action: "add-attribute" });
  return {
    basePath,
    helpPath,
    peoplePath,
    myProfilePath,
    myProfileMediaPath,
    myProfileAddMediaPath,
    myProfileAttributesPath,
    myProfileAddAttributePath,
    settingsPath,
  };
}

function getRoleGuardAnswer(input: AnswerHelpQuestionInput, normalizedQuestion: string) {
  if (input.role !== "USER") {
    return null;
  }
  if (!normalizedQuestion) {
    return null;
  }

  for (const rule of ADMIN_ONLY_HELP_RULES) {
    if (includesAnyKeyword(normalizedQuestion, rule.keywords)) {
      return {
        answer: rule.answer,
        actions: [] as HelpAction[],
        model: "role-policy",
      };
    }
  }
  return null;
}

function getDeterministicPlaybookAnswer(input: AnswerHelpQuestionInput, normalizedQuestion: string) {
  if (!normalizedQuestion) {
    return null;
  }
  const links = buildHelpLinkContext(input);

  if (
    includesAnyKeyword(normalizedQuestion, [
      "add person",
      "create person",
      "new person",
      "add family member",
      "add someone",
    ])
  ) {
    return {
      answer:
        "Go to People, then use Add Person. Enter first name, last name, and birthday, then save. You can open that person afterward to add more details.",
      actions: [
        {
          label: "Open People",
          href: links.peoplePath,
          kind: "link" as const,
          description: "Go to People and use Add Person.",
        },
      ],
      model: "playbook:add_person",
    };
  }

  if (
    includesAnyKeyword(normalizedQuestion, [
      "add photo to my profile",
      "add media to my profile",
      "upload photo to my profile",
      "add picture to my profile",
      "my profile photo",
    ])
  ) {
    return {
      answer:
        "Open your profile, switch to Media, then choose Add Media. Select device/camera/library, then save links for the uploaded file.",
      actions: [
        {
          label: "Open My Profile",
          href: links.myProfilePath,
          kind: "link" as const,
        },
        {
          label: "Open My Media Tab",
          href: links.myProfileMediaPath,
          kind: "link" as const,
        },
        {
          label: "Add Media To My Profile",
          href: links.myProfileAddMediaPath,
          kind: "link" as const,
          description: "Opens profile in Media tab and starts add-media flow.",
        },
      ],
      model: "playbook:add_media_profile",
    };
  }

  if (
    includesAnyKeyword(normalizedQuestion, [
      "what is an attribute",
      "what are attributes",
      "define attribute",
      "attribute meaning",
    ])
  ) {
    return {
      answer:
        "An attribute is a structured fact, event, or story attached to a person or household. Use attributes for details like life events, descriptors, and stories so they stay organized and searchable.",
      actions: [
        {
          label: "Open My Attributes",
          href: links.myProfileAttributesPath,
          kind: "link" as const,
        },
      ],
      model: "playbook:what_is_attribute",
    };
  }

  if (
    includesAnyKeyword(normalizedQuestion, [
      "add attribute",
      "add event",
      "add story",
      "add memory",
      "create story",
      "create event",
    ])
  ) {
    return {
      answer:
        "Open your profile, go to Attributes, then add the new item and save. Use event/story types for timeline content and descriptor types for profile facts.",
      actions: [
        {
          label: "Open My Attributes Tab",
          href: links.myProfileAttributesPath,
          kind: "link" as const,
        },
        {
          label: "Add Attribute",
          href: links.myProfileAddAttributePath,
          kind: "link" as const,
          description: "Opens Attributes tab and starts add-attribute flow.",
        },
      ],
      model: "playbook:add_attribute_story",
    };
  }

  if (
    includesAnyKeyword(normalizedQuestion, [
      "invite",
      "invitation",
      "user access",
      "family access",
      "manage users",
      "local user",
      "password policy",
    ])
  ) {
    if (input.role === "ADMIN") {
      return {
        answer:
          "Open Admin Settings, then use Users & Access. In User Directory, choose Manage User for the person, then use the Invite tab for invite actions.",
        actions: [
          {
            label: "Open Admin Settings",
            href: links.settingsPath,
            kind: "link" as const,
            requiresRole: "ADMIN",
          },
        ],
        model: "playbook:invite_access_admin",
      };
    }
    return {
      answer:
        "Invite and user-access changes are admin-only. Ask a family-group admin to use Admin -> Users & Access -> User Directory -> Manage User -> Invite.",
      actions: [],
      model: "playbook:invite_access_user",
    };
  }

  return null;
}

export async function answerHelpQuestion(input: AnswerHelpQuestionInput) {
  if (!isOpenAiConfigured()) {
    throw new Error("AI help is not configured.");
  }

  const lastUserMessage = [...input.messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const normalizedQuestion = normalizeQuestion(lastUserMessage);

  const guardedAnswer = getRoleGuardAnswer(input, normalizedQuestion);
  if (guardedAnswer) {
    return guardedAnswer;
  }

  const playbookAnswer = getDeterministicPlaybookAnswer(input, normalizedQuestion);
  if (playbookAnswer) {
    return playbookAnswer;
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
    actions: [] as HelpAction[],
    model: getOpenAiHelpModel(),
  };
}
