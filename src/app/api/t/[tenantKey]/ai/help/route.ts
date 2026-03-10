import { NextResponse } from "next/server";
import { z } from "zod";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { answerHelpQuestion, type HelpChatMessage } from "@/lib/ai/help";
import { AI_HELP_SUGGESTIONS } from "@/lib/ai/help-guide";
import { isOpenAiConfigured } from "@/lib/ai/openai";
import { requireTenantAccess } from "@/lib/family-group/guard";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000),
});

const payloadSchema = z.object({
  messages: z.array(messageSchema).min(1).max(12),
});

export async function POST(request: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  if (!isOpenAiConfigured()) {
    return NextResponse.json(
      {
        error: "ai_help_unavailable",
        message: "AI help is not configured yet.",
        suggestions: AI_HELP_SUGGESTIONS,
      },
      { status: 503 },
    );
  }

  const messages = parsed.data.messages.map((message) => ({
    role: message.role,
    content: message.content.trim(),
  })) satisfies HelpChatMessage[];
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";

  try {
    const result = await answerHelpQuestion({
      tenantName: resolved.tenant.tenantName,
      role: resolved.tenant.role,
      messages,
    });

    await appendSessionAuditLog(resolved.session, {
      action: "ASK",
      entityType: "AI_HELP",
      entityId: resolved.tenant.tenantKey,
      familyGroupKey: resolved.tenant.tenantKey,
      status: "SUCCESS",
      details: `AI help question answered; chars=${String(lastUserMessage.length)}.`,
    });

    return NextResponse.json({
      ok: true,
      tenantKey: resolved.tenant.tenantKey,
      answer: result.answer,
      model: result.model,
      suggestions: AI_HELP_SUGGESTIONS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI help failed.";
    await appendSessionAuditLog(resolved.session, {
      action: "ASK",
      entityType: "AI_HELP",
      entityId: resolved.tenant.tenantKey,
      familyGroupKey: resolved.tenant.tenantKey,
      status: "FAILURE",
      details: `AI help failed; chars=${String(lastUserMessage.length)}; message=${message.slice(0, 180)}.`,
    });
    return NextResponse.json({ error: "ai_help_failed", message }, { status: 500 });
  }
}
