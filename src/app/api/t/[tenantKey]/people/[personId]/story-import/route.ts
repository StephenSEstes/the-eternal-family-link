import { NextResponse } from "next/server";
import { z } from "zod";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { generateStoryImportProposals } from "@/lib/ai/story-import";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { getPersonById } from "@/lib/data/runtime";
import { isOpenAiConfigured } from "@/lib/ai/openai";

const payloadSchema = z.object({
  sourceText: z.string().trim().min(1).max(20000),
  hints: z
    .object({
      titleHint: z.string().trim().max(120).default(""),
      startDate: z.string().trim().max(32).default(""),
      endDate: z.string().trim().max(32).default(""),
      attributeType: z.string().trim().max(120).default(""),
      attributeTypeCategory: z.string().trim().max(120).default(""),
      extractionMode: z.enum(["story", "balanced", "resume"]).optional(),
      refinementPrompt: z.string().trim().max(1200).optional(),
    })
    .optional(),
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
      { error: "ai_story_import_unavailable", message: "AI story import is not configured yet." },
      { status: 503 },
    );
  }

  const sourceLength = parsed.data.sourceText.trim().length;

  try {
    const result = await generateStoryImportProposals({
      tenantKey: resolved.tenant.tenantKey,
      tenantName: resolved.tenant.tenantName,
      personDisplayName: person.displayName || personId,
      sourceText: parsed.data.sourceText,
      hints: parsed.data.hints,
    });

    await appendSessionAuditLog(resolved.session, {
      action: "IMPORT",
      entityType: "AI_STORY_IMPORT",
      entityId: personId,
      familyGroupKey: resolved.tenant.tenantKey,
      status: "SUCCESS",
      details: `Generated ${String(result.proposals.length)} AI story import proposals; chars=${String(sourceLength)}.`,
    });

    return NextResponse.json({
      ok: true,
      tenantKey: resolved.tenant.tenantKey,
      personId,
      model: result.model,
      proposals: result.proposals,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI story import failed.";
    await appendSessionAuditLog(resolved.session, {
      action: "IMPORT",
      entityType: "AI_STORY_IMPORT",
      entityId: personId,
      familyGroupKey: resolved.tenant.tenantKey,
      status: "FAILURE",
      details: `AI story import failed; chars=${String(sourceLength)}; message=${message.slice(0, 180)}.`,
    });
    return NextResponse.json({ error: "ai_story_import_failed", message }, { status: 500 });
  }
}
