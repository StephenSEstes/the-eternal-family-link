import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { requireTenantAccess } from "@/lib/family-group/guard";
import {
  createOciNotificationOutboxEntries,
  createOciSharePostComment,
  getOciSharePostById,
  getOciSharePostCommentsForPost,
  getOciShareThreadMember,
  listOciShareThreadMembers,
} from "@/lib/oci/tables";
import { resolveAccessibleShareThread } from "@/lib/shares/thread-access";

type RouteProps = {
  params: Promise<{ tenantKey: string; threadId: string; postId: string }>;
};

const createCommentSchema = z.object({
  commentText: z.string().trim().min(1).max(4000),
  parentCommentId: z.string().trim().max(128).optional().default(""),
});

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeLower(value: unknown) {
  return normalize(value).toLowerCase();
}

function buildCommentId() {
  return `spc-${randomUUID().replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
}

function buildNotificationId() {
  return `nout-${randomUUID().replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
}

function canMutateComment(input: {
  actorPersonId: string;
  actorEmail: string;
  authorPersonId: string;
  authorEmail: string;
}) {
  if (input.actorPersonId && input.actorPersonId === input.authorPersonId) return true;
  if (input.actorEmail && input.actorEmail === input.authorEmail) return true;
  return false;
}

function toClientComment(input: {
  comment: Awaited<ReturnType<typeof getOciSharePostCommentsForPost>>[number];
  actorPersonId: string;
  actorEmail: string;
}) {
  const authorPersonId = normalize(input.comment.authorPersonId);
  const authorEmail = normalizeLower(input.comment.authorEmail);
  const canMutate = canMutateComment({
    actorPersonId: input.actorPersonId,
    actorEmail: input.actorEmail,
    authorPersonId,
    authorEmail,
  });
  return {
    commentId: input.comment.commentId,
    postId: input.comment.postId,
    threadId: input.comment.threadId,
    parentCommentId: input.comment.parentCommentId,
    author: {
      personId: authorPersonId,
      displayName: normalize(input.comment.authorDisplayName) || authorEmail || "Unknown",
      email: authorEmail,
    },
    commentText: input.comment.commentText,
    commentStatus: normalizeLower(input.comment.commentStatus) || "active",
    createdAt: input.comment.createdAt,
    updatedAt: input.comment.updatedAt,
    deletedAt: input.comment.deletedAt,
    canEdit: canMutate,
    canDelete: canMutate,
  };
}

export async function GET(_: Request, { params }: RouteProps) {
  const { tenantKey, threadId, postId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const actorPersonId = normalize(resolved.session.user?.person_id ?? resolved.tenant.personId);
  const actorEmail = normalizeLower(resolved.session.user?.email);
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

  const post = await getOciSharePostById({
    familyGroupKey: thread.familyGroupKey,
    postId: normalize(postId),
  });
  if (!post || post.threadId !== thread.threadId) {
    return NextResponse.json({ error: "post_not_found" }, { status: 404 });
  }

  const comments = await getOciSharePostCommentsForPost({
    familyGroupKey: thread.familyGroupKey,
    postId: post.postId,
  });

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    threadFamilyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    postId: post.postId,
    comments: comments.map((comment) =>
      toClientComment({
        comment,
        actorPersonId,
        actorEmail,
      }),
    ),
  });
}

export async function POST(request: Request, { params }: RouteProps) {
  const { tenantKey, threadId, postId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const actorPersonId = normalize(resolved.session.user?.person_id ?? resolved.tenant.personId);
  const actorEmail = normalizeLower(resolved.session.user?.email);
  const actorDisplayName = normalize(resolved.session.user?.name) || actorEmail;
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

  const post = await getOciSharePostById({
    familyGroupKey: thread.familyGroupKey,
    postId: normalize(postId),
  });
  if (!post || post.threadId !== thread.threadId) {
    return NextResponse.json({ error: "post_not_found" }, { status: 404 });
  }

  const parsed = createCommentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const parentCommentId = normalize(parsed.data.parentCommentId);
  const existingComments = await getOciSharePostCommentsForPost({
    familyGroupKey: thread.familyGroupKey,
    postId: post.postId,
  });
  if (parentCommentId && !existingComments.some((entry) => entry.commentId === parentCommentId)) {
    return NextResponse.json({ error: "parent_comment_not_found" }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const createdComment = await createOciSharePostComment({
    commentId: buildCommentId(),
    postId: post.postId,
    threadId: thread.threadId,
    conversationId: post.conversationId,
    familyGroupKey: thread.familyGroupKey,
    parentCommentId,
    authorPersonId: actorPersonId,
    authorDisplayName: actorDisplayName,
    authorEmail: actorEmail,
    commentText: parsed.data.commentText,
    commentStatus: "active",
    createdAt: nowIso,
    updatedAt: nowIso,
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
      eventType: "share_comment_created",
      entityType: "share_post_comment",
      entityId: createdComment.commentId,
      payloadJson: JSON.stringify({
        threadId: thread.threadId,
        conversationId: post.conversationId,
        postId: post.postId,
        commentId: createdComment.commentId,
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
    entityType: "SHARE_POST_COMMENT",
    entityId: createdComment.commentId,
    familyGroupKey: thread.familyGroupKey,
    status: "SUCCESS",
    details: `Created share post comment thread=${thread.threadId} post=${post.postId}.`,
  });

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    threadFamilyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    conversationId: post.conversationId,
    postId: post.postId,
      comment: toClientComment({
        comment: createdComment,
        actorPersonId,
        actorEmail,
      }),
    notificationOutboxCount: outboxRows.length,
  });
}
