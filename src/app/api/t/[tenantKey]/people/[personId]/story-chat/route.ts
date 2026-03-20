import { NextResponse } from "next/server";
import { z } from "zod";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { answerStoryChat, type StoryChatMessage } from "@/lib/ai/story-chat";
import { isOpenAiConfigured } from "@/lib/ai/openai";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { getPersonById } from "@/lib/data/runtime";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000),
});

const payloadSchema = z.object({
  storyText: z.string().trim().min(1).max(20000),
  messages: z.array(messageSchema).min(1).max(20),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantKey: string; personId: string }> },
) {
  const { tenantKey, personId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const person = await getPersonById(personId, resolved.tenant.tenantKey);
  if (!person) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  if (!isOpenAiConfigured()) {
    return NextResponse.json(
      { error: "ai_story_chat_unavailable", message: "AI story chat is not configured yet." },
      { status: 503 },
    );
  }

  const messages = parsed.data.messages.map((message) => ({
    role: message.role,
    content: message.content.trim(),
  })) satisfies StoryChatMessage[];

  try {
    const result = await answerStoryChat({
      tenantKey: resolved.tenant.tenantKey,
      tenantName: resolved.tenant.tenantName,
      personDisplayName: person.displayName || personId,
      storyText: parsed.data.storyText,
      messages,
    });

    await appendSessionAuditLog(resolved.session, {
      action: "ASK",
      entityType: "AI_STORY_CHAT",
      entityId: personId,
      familyGroupKey: resolved.tenant.tenantKey,
      status: "SUCCESS",
      details: `AI story chat answered; chars=${String(parsed.data.storyText.length)}; messages=${String(messages.length)}.`,
    });

    return NextResponse.json({
      ok: true,
      tenantKey: resolved.tenant.tenantKey,
      personId,
      answer: result.answer,
      suggestion: result.suggestion,
      model: result.model,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI story chat failed.";
    await appendSessionAuditLog(resolved.session, {
      action: "ASK",
      entityType: "AI_STORY_CHAT",
      entityId: personId,
      familyGroupKey: resolved.tenant.tenantKey,
      status: "FAILURE",
      details: `AI story chat failed; chars=${String(parsed.data.storyText.length)}; message=${message.slice(0, 180)}.`,
    });
    return NextResponse.json({ error: "ai_story_chat_failed", message }, { status: 500 });
  }
}

