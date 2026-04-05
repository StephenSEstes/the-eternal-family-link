import { NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/family-group/guard";
import {
  getOciShareConversationById,
  getOciShareThreadMember,
  updateOciShareConversationStatus,
} from "@/lib/oci/tables";
import { resolveAccessibleShareThread } from "@/lib/shares/thread-access";

type RouteProps = {
  params: Promise<{ tenantKey: string; threadId: string; conversationId: string }>;
};

function normalize(value: unknown) {
  return String(value ?? "").trim();
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

  const isCreator = [normalize(conversation.ownerPersonId), normalize(conversation.createdByPersonId)].includes(actorPersonId);
  if (!isCreator) {
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

