import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantAccess } from "@/lib/family-group/guard";
import {
  getOciShareConversationById,
  getOciShareThreadMember,
  updateOciShareConversationStatus,
  updateOciShareConversationTitle,
} from "@/lib/oci/tables";
import { resolveAccessibleShareThread } from "@/lib/shares/thread-access";

type RouteProps = {
  params: Promise<{ tenantKey: string; threadId: string; conversationId: string }>;
};

const updateConversationSchema = z.object({
  title: z.string().trim().min(1).max(220),
});

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function isConversationCreator(createdByPersonId: string, actorPersonId: string) {
  return normalize(createdByPersonId) === normalize(actorPersonId);
}

export async function PATCH(request: Request, { params }: RouteProps) {
  const { tenantKey, threadId, conversationId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const actorPersonId = normalize(resolved.session.user?.person_id ?? resolved.tenant.personId);
  if (!actorPersonId) {
    return NextResponse.json({ error: "missing_actor_person_id" }, { status: 400 });
  }

  const parsed = updateConversationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const thread = await resolveAccessibleShareThread({
    threadId: normalize(threadId),
    tenant: resolved.tenant,
    actorPersonId,
  });
  if (!thread) {
    return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
  }

  const member = await getOciShareThreadMember({
    familyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    personId: actorPersonId,
  });
  if (!member || !member.isActive) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const conversation = await getOciShareConversationById({
    familyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    conversationId: normalize(conversationId),
  });
  if (!conversation || normalize(conversation.conversationStatus).toLowerCase() === "archived") {
    return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });
  }

  if (!isConversationCreator(conversation.createdByPersonId, actorPersonId)) {
    return NextResponse.json({ error: "creator_required" }, { status: 403 });
  }

  const nowIso = new Date().toISOString();
  const updated = await updateOciShareConversationTitle({
    familyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    conversationId: conversation.conversationId,
    title: parsed.data.title,
    updatedAt: nowIso,
  });
  if (!updated) {
    return NextResponse.json({ error: "conversation_update_failed" }, { status: 500 });
  }

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    threadFamilyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    conversation: {
      conversationId: updated.conversationId,
      threadId: updated.threadId,
      familyGroupKey: updated.familyGroupKey,
      title: updated.title,
      conversationKind: updated.conversationKind || "topic",
      ownerPersonId: updated.ownerPersonId,
      createdByPersonId: updated.createdByPersonId,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      lastActivityAt: updated.lastActivityAt,
    },
  });
}

export async function DELETE(_: Request, { params }: RouteProps) {
  const { tenantKey, threadId, conversationId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const actorPersonId = normalize(resolved.session.user?.person_id ?? resolved.tenant.personId);
  if (!actorPersonId) {
    return NextResponse.json({ error: "missing_actor_person_id" }, { status: 400 });
  }

  const thread = await resolveAccessibleShareThread({
    threadId: normalize(threadId),
    tenant: resolved.tenant,
    actorPersonId,
  });
  if (!thread) {
    return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
  }

  const member = await getOciShareThreadMember({
    familyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    personId: actorPersonId,
  });
  if (!member || !member.isActive) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const conversation = await getOciShareConversationById({
    familyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    conversationId: normalize(conversationId),
  });
  if (!conversation) {
    return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });
  }

  if (!isConversationCreator(conversation.createdByPersonId, actorPersonId)) {
    return NextResponse.json({ error: "creator_required" }, { status: 403 });
  }

  if (normalize(conversation.conversationStatus).toLowerCase() === "archived") {
    return NextResponse.json({
      tenantKey: resolved.tenant.tenantKey,
      threadFamilyGroupKey: thread.familyGroupKey,
      threadId: thread.threadId,
      conversationId: conversation.conversationId,
      deleted: true,
      alreadyDeleted: true,
    });
  }

  const nowIso = new Date().toISOString();
  const updated = await updateOciShareConversationStatus({
    familyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    conversationId: conversation.conversationId,
    conversationStatus: "archived",
    updatedAt: nowIso,
    lastActivityAt: nowIso,
  });
  if (!updated) {
    return NextResponse.json({ error: "conversation_delete_failed" }, { status: 500 });
  }

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    threadFamilyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    conversationId: conversation.conversationId,
    deleted: true,
  });
}
