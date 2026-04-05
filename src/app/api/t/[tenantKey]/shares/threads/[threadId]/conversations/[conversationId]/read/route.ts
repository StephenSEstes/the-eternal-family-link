import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantAccess } from "@/lib/family-group/guard";
import {
  getOciShareConversationById,
  getOciShareConversationMember,
  markOciShareConversationRead,
  upsertOciShareConversationMember,
} from "@/lib/oci/tables";
import { resolveAccessibleShareThread } from "@/lib/shares/thread-access";

type RouteProps = {
  params: Promise<{ tenantKey: string; threadId: string; conversationId: string }>;
};

const markReadSchema = z.object({
  lastReadAt: z.string().trim().optional().default(""),
});

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function buildConversationMemberId(conversationId: string, personId: string) {
  const c = conversationId.trim().replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "conv";
  const p = personId.trim().replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "person";
  return `scm-${c}-${p}-${randomUUID().replace(/[^a-zA-Z0-9]/g, "").slice(0, 6)}`;
}

export async function POST(request: Request, { params }: RouteProps) {
  const { tenantKey, threadId, conversationId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }
  const actorPersonId = normalize(resolved.session.user?.person_id ?? resolved.tenant.personId);
  if (!actorPersonId) {
    return NextResponse.json({ error: "missing_actor_person_id" }, { status: 400 });
  }
  const thread = await resolveAccessibleShareThread({ threadId: normalize(threadId), tenant: resolved.tenant });
  if (!thread) {
    return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
  }
  const conversation = await getOciShareConversationById({
    familyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    conversationId: normalize(conversationId),
  });
  if (!conversation) {
    return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });
  }

  const parsed = markReadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }
  const targetReadAt = normalize(parsed.data.lastReadAt) || new Date().toISOString();

  const member = await getOciShareConversationMember({
    familyGroupKey: thread.familyGroupKey,
    conversationId: conversation.conversationId,
    personId: actorPersonId,
  });
  if (!member || !member.isActive) {
    await upsertOciShareConversationMember({
      conversationMemberId: buildConversationMemberId(conversation.conversationId, actorPersonId),
      conversationId: conversation.conversationId,
      threadId: thread.threadId,
      familyGroupKey: thread.familyGroupKey,
      personId: actorPersonId,
      memberRole: "member",
      joinedAt: targetReadAt,
      lastReadAt: targetReadAt,
      isActive: true,
    });
    return NextResponse.json({
      tenantKey: resolved.tenant.tenantKey,
      threadFamilyGroupKey: thread.familyGroupKey,
      threadId: thread.threadId,
      conversationId: conversation.conversationId,
      personId: actorPersonId,
      markedRead: true,
      lastReadAt: targetReadAt,
    });
  }

  const updated = await markOciShareConversationRead({
    familyGroupKey: thread.familyGroupKey,
    conversationId: conversation.conversationId,
    personId: actorPersonId,
    lastReadAt: targetReadAt,
  });

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    threadFamilyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    conversationId: conversation.conversationId,
    personId: actorPersonId,
    markedRead: updated,
    lastReadAt: targetReadAt,
  });
}

