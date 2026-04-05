import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantAccess } from "@/lib/family-group/guard";
import {
  backfillOciSharePostsConversationIdForThread,
  createOciShareConversation,
  listOciShareConversationMembers,
  listOciShareConversationsForThread,
  listOciShareThreadMembers,
  upsertOciShareConversationMember,
} from "@/lib/oci/tables";
import { resolveAccessibleShareThread } from "@/lib/shares/thread-access";

type RouteProps = {
  params: Promise<{ tenantKey: string; threadId: string }>;
};

const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(220),
});

function buildConversationId() {
  return `sconv-${randomUUID().replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
}

function buildConversationMemberId(conversationId: string, personId: string) {
  const c = conversationId.trim().replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "conv";
  const p = personId.trim().replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "person";
  return `scm-${c}-${p}-${randomUUID().replace(/[^a-zA-Z0-9]/g, "").slice(0, 6)}`;
}

async function ensureConversationMembersFromThread(input: {
  familyGroupKey: string;
  threadId: string;
  conversationId: string;
  ownerPersonId: string;
  nowIso: string;
}) {
  const threadMembers = await listOciShareThreadMembers({
    familyGroupKey: input.familyGroupKey,
    threadId: input.threadId,
  });
  for (const member of threadMembers) {
    await upsertOciShareConversationMember({
      conversationMemberId: buildConversationMemberId(input.conversationId, member.personId),
      conversationId: input.conversationId,
      threadId: input.threadId,
      familyGroupKey: input.familyGroupKey,
      personId: member.personId,
      memberRole: member.personId === input.ownerPersonId ? "owner" : "member",
      joinedAt: input.nowIso,
      isActive: true,
    });
  }
}

export async function GET(_: Request, { params }: RouteProps) {
  const { tenantKey, threadId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }
  const actorPersonId = String(resolved.session.user?.person_id ?? resolved.tenant.personId ?? "").trim();
  if (!actorPersonId) {
    return NextResponse.json({ error: "missing_actor_person_id" }, { status: 400 });
  }
  const thread = await resolveAccessibleShareThread({ threadId, tenant: resolved.tenant, actorPersonId });
  if (!thread) {
    return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
  }
  const threadMember = (
    await listOciShareThreadMembers({
      familyGroupKey: thread.familyGroupKey,
      threadId: thread.threadId,
    })
  ).find((item) => item.personId === actorPersonId && item.isActive);
  if (!threadMember) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const nowIso = new Date().toISOString();
  let conversations = await listOciShareConversationsForThread({
    familyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    personId: actorPersonId,
    limit: 200,
  });
  let defaultConversation = conversations.find((item) => item.conversationKind === "general") ?? null;
  if (!defaultConversation) {
    defaultConversation = await createOciShareConversation({
      conversationId: buildConversationId(),
      threadId: thread.threadId,
      familyGroupKey: thread.familyGroupKey,
      title: "General",
      conversationKind: "general",
      ownerPersonId: actorPersonId,
      createdByPersonId: actorPersonId,
      createdByEmail: String(resolved.session.user?.email ?? "").trim().toLowerCase(),
      createdAt: nowIso,
      updatedAt: nowIso,
      lastActivityAt: nowIso,
      conversationStatus: "active",
    });
    await ensureConversationMembersFromThread({
      familyGroupKey: thread.familyGroupKey,
      threadId: thread.threadId,
      conversationId: defaultConversation.conversationId,
      ownerPersonId: actorPersonId,
      nowIso,
    });
    await backfillOciSharePostsConversationIdForThread({
      familyGroupKey: thread.familyGroupKey,
      threadId: thread.threadId,
      conversationId: defaultConversation.conversationId,
    });
    conversations = await listOciShareConversationsForThread({
      familyGroupKey: thread.familyGroupKey,
      threadId: thread.threadId,
      personId: actorPersonId,
      limit: 200,
    });
  }

  for (const conversation of conversations) {
    const members = await listOciShareConversationMembers({
      familyGroupKey: thread.familyGroupKey,
      conversationId: conversation.conversationId,
    });
    if (!members.some((item) => item.personId === actorPersonId && item.isActive)) {
      await upsertOciShareConversationMember({
        conversationMemberId: buildConversationMemberId(conversation.conversationId, actorPersonId),
        conversationId: conversation.conversationId,
        threadId: thread.threadId,
        familyGroupKey: thread.familyGroupKey,
        personId: actorPersonId,
        memberRole: "member",
        joinedAt: nowIso,
        isActive: true,
      });
    }
  }

  const finalConversations = await listOciShareConversationsForThread({
    familyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    personId: actorPersonId,
    limit: 200,
  });
  const sorted = finalConversations
    .slice()
    .sort(
      (a, b) =>
        Date.parse(String(b.lastActivityAt || b.createdAt)) -
        Date.parse(String(a.lastActivityAt || a.createdAt)),
    );
  const fallbackDefault = sorted.find((item) => item.conversationKind === "general") ?? sorted[0] ?? null;

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    threadFamilyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    defaultConversationId: fallbackDefault?.conversationId ?? "",
    conversations: sorted.map((item) => ({
      conversationId: item.conversationId,
      threadId: item.threadId,
      familyGroupKey: item.familyGroupKey,
      title: item.title,
      conversationKind: item.conversationKind,
      ownerPersonId: item.ownerPersonId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      lastActivityAt: item.lastActivityAt,
      unreadCount: item.unreadCount,
      latestPost: item.latestPostId
        ? {
            postId: item.latestPostId,
            fileId: item.latestPostFileId,
            caption: item.latestPostCaption,
            createdAt: item.latestPostCreatedAt,
            authorDisplayName: item.latestPostAuthorDisplayName,
          }
        : null,
    })),
  });
}

export async function POST(request: Request, { params }: RouteProps) {
  const { tenantKey, threadId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }
  const actorPersonId = String(resolved.session.user?.person_id ?? resolved.tenant.personId ?? "").trim();
  if (!actorPersonId) {
    return NextResponse.json({ error: "missing_actor_person_id" }, { status: 400 });
  }
  const thread = await resolveAccessibleShareThread({ threadId, tenant: resolved.tenant, actorPersonId });
  if (!thread) {
    return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
  }
  const threadMember = (
    await listOciShareThreadMembers({
      familyGroupKey: thread.familyGroupKey,
      threadId: thread.threadId,
    })
  ).find((item) => item.personId === actorPersonId && item.isActive);
  if (!threadMember) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = createConversationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const created = await createOciShareConversation({
    conversationId: buildConversationId(),
    threadId: thread.threadId,
    familyGroupKey: thread.familyGroupKey,
    title: parsed.data.title,
    conversationKind: "topic",
    ownerPersonId: actorPersonId,
    createdByPersonId: actorPersonId,
    createdByEmail: String(resolved.session.user?.email ?? "").trim().toLowerCase(),
    createdAt: nowIso,
    updatedAt: nowIso,
    lastActivityAt: nowIso,
    conversationStatus: "active",
  });
  await ensureConversationMembersFromThread({
    familyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    conversationId: created.conversationId,
    ownerPersonId: actorPersonId,
    nowIso,
  });

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    threadFamilyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    conversation: {
      conversationId: created.conversationId,
      threadId: created.threadId,
      familyGroupKey: created.familyGroupKey,
      title: created.title,
      conversationKind: created.conversationKind || "topic",
      ownerPersonId: created.ownerPersonId,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      lastActivityAt: created.lastActivityAt,
      unreadCount: 0,
      latestPost: null,
    },
  });
}
