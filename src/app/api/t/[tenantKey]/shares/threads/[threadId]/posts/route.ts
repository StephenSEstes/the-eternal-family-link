import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { getPeople } from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { getOciDirectObjectUrlFactory } from "@/lib/oci/object-storage";
import {
  createOciNotificationOutboxEntries,
  getOciShareConversationById,
  getOciShareConversationMember,
  createOciSharePost,
  getOciShareThreadMember,
  getOciSharePostsForThread,
  listOciShareThreadMembers,
  upsertOciShareConversationMember,
} from "@/lib/oci/tables";
import { resolveAccessibleShareThread } from "@/lib/shares/thread-access";

type RouteProps = {
  params: Promise<{ tenantKey: string; threadId: string }>;
};

const createPostSchema = z.object({
  conversationId: z.string().trim().max(128).optional().default(""),
  caption: z.string().trim().max(4000).optional().default(""),
  fileId: z.string().trim().max(512).optional().default(""),
});

function buildPostId() {
  return `spost-${randomUUID().replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
}

function buildNotificationId() {
  return `nout-${randomUUID().replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
}

function buildConversationMemberId(conversationId: string, personId: string) {
  const c = conversationId.trim().replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "conv";
  const p = personId.trim().replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "person";
  return `scm-${c}-${p}-${randomUUID().replace(/[^a-zA-Z0-9]/g, "").slice(0, 6)}`;
}

export async function GET(request: Request, { params }: RouteProps) {
  const { tenantKey, threadId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const actorPersonId = String(resolved.session.user?.person_id ?? resolved.tenant.personId ?? "").trim();
  if (!actorPersonId) {
    return NextResponse.json({ error: "missing_actor_person_id" }, { status: 400 });
  }

  const thread = await resolveAccessibleShareThread({
    threadId,
    tenant: resolved.tenant,
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

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? "60");
  const requestedConversationId = String(url.searchParams.get("conversationId") ?? "").trim();
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, Math.trunc(rawLimit))) : 60;
  if (requestedConversationId) {
    const conversation = await getOciShareConversationById({
      familyGroupKey: thread.familyGroupKey,
      threadId: thread.threadId,
      conversationId: requestedConversationId,
    });
    if (!conversation) {
      return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });
    }
    const conversationMember = await getOciShareConversationMember({
      familyGroupKey: thread.familyGroupKey,
      conversationId: conversation.conversationId,
      personId: actorPersonId,
    });
    if (!conversationMember || !conversationMember.isActive) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }
  const posts = await getOciSharePostsForThread({
    familyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    conversationId: requestedConversationId,
    limit,
  });
  const members = await listOciShareThreadMembers({
    familyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
  });
  const people = await getPeople(thread.familyGroupKey).catch(() => []);
  const peopleById = new Map(
    people
      .map((person) => [person.personId.trim(), person.displayName.trim() || person.personId.trim()] as const)
      .filter(([personId]) => Boolean(personId)),
  );
  const directObjectUrlFactory = await getOciDirectObjectUrlFactory().catch(() => null);

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    threadFamilyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    conversationId: requestedConversationId,
    count: posts.length,
    members: members.map((entry) => ({
      personId: entry.personId,
      displayName: peopleById.get(entry.personId) ?? entry.personId,
      memberRole: entry.memberRole,
      joinedAt: entry.joinedAt,
    })),
    posts: posts.map((post) => ({
      postId: post.postId,
      threadId: post.threadId,
      conversationId: post.conversationId,
      familyGroupKey: post.familyGroupKey,
      fileId: post.fileId,
      caption: post.captionText,
      authorPersonId: post.authorPersonId,
      authorDisplayName: post.authorDisplayName,
      authorEmail: post.authorEmail,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      postStatus: post.postStatus,
      media: {
        mediaId: post.mediaId,
        mediaKind: post.mediaKind,
        label: post.mediaLabel,
        description: post.mediaDescription,
        photoDate: post.mediaPhotoDate,
        sourceProvider: post.sourceProvider,
        originalObjectKey: post.originalObjectKey,
        thumbnailObjectKey: post.thumbnailObjectKey,
        previewUrl:
          directObjectUrlFactory && post.thumbnailObjectKey
            ? directObjectUrlFactory(post.thumbnailObjectKey)
            : "",
        originalUrl:
          directObjectUrlFactory && post.originalObjectKey
            ? directObjectUrlFactory(post.originalObjectKey)
            : "",
      },
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
  const actorEmail = String(resolved.session.user?.email ?? "").trim().toLowerCase();
  const actorDisplayName = String(resolved.session.user?.name ?? actorEmail).trim();
  if (!actorPersonId) {
    return NextResponse.json({ error: "missing_actor_person_id" }, { status: 400 });
  }

  const thread = await resolveAccessibleShareThread({
    threadId,
    tenant: resolved.tenant,
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

  const parsed = createPostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }
  const conversationId = parsed.data.conversationId.trim();
  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id_required" }, { status: 400 });
  }
  const conversation = await getOciShareConversationById({
    familyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    conversationId,
  });
  if (!conversation) {
    return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });
  }
  const nowIso = new Date().toISOString();
  const conversationMember = await getOciShareConversationMember({
    familyGroupKey: thread.familyGroupKey,
    conversationId: conversation.conversationId,
    personId: actorPersonId,
  });
  if (!conversationMember || !conversationMember.isActive) {
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
  if (!parsed.data.caption && !parsed.data.fileId) {
    return NextResponse.json({ error: "caption_or_file_required" }, { status: 400 });
  }
  const post = await createOciSharePost({
    postId: buildPostId(),
    threadId: thread.threadId,
    conversationId: conversation.conversationId,
    familyGroupKey: thread.familyGroupKey,
    fileId: parsed.data.fileId,
    captionText: parsed.data.caption,
    authorPersonId: actorPersonId,
    authorDisplayName: actorDisplayName,
    authorEmail: actorEmail,
    createdAt: nowIso,
    updatedAt: nowIso,
    postStatus: "active",
  });

  const members = await listOciShareThreadMembers({
    familyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
  });
  const outboxRows = members
    .filter((entry) => entry.personId && entry.personId !== actorPersonId)
    .map((entry) => ({
      notificationId: buildNotificationId(),
      familyGroupKey: thread.familyGroupKey,
      personId: entry.personId,
      channel: "webpush",
      eventType: "share_post_created",
      entityType: "share_post",
      entityId: post.postId,
      payloadJson: JSON.stringify({
        threadId: thread.threadId,
        conversationId: conversation.conversationId,
        postId: post.postId,
        caption: post.captionText,
        fileId: post.fileId,
      }),
      status: "pending",
      attemptCount: 0,
      createdAt: nowIso,
    }));
  if (outboxRows.length > 0) {
    await createOciNotificationOutboxEntries(outboxRows);
  }

  await appendSessionAuditLog(resolved.session, {
    action: "CREATE",
    entityType: "SHARE_POST",
    entityId: post.postId,
    familyGroupKey: thread.familyGroupKey,
    status: "SUCCESS",
    details: `Created share post thread=${thread.threadId} file=${post.fileId || "none"}.`,
  });

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    threadFamilyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    conversationId: conversation.conversationId,
    post: {
      postId: post.postId,
      threadId: post.threadId,
      conversationId: post.conversationId,
      fileId: post.fileId,
      caption: post.captionText,
      authorPersonId: post.authorPersonId,
      authorDisplayName: post.authorDisplayName,
      authorEmail: post.authorEmail,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      postStatus: post.postStatus,
    },
    notificationOutboxCount: outboxRows.length,
  });
}
