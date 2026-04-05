import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantAccess } from "@/lib/family-group/guard";
import {
  getOciSharePostById,
  getOciSharePostCommentById,
  getOciShareThreadMember,
  updateOciSharePostCommentById,
} from "@/lib/oci/tables";
import { resolveAccessibleShareThread } from "@/lib/shares/thread-access";

type RouteProps = {
  params: Promise<{ tenantKey: string; threadId: string; postId: string; commentId: string }>;
};

const editCommentSchema = z.object({
  commentText: z.string().trim().min(1).max(4000),
});

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeLower(value: unknown) {
  return normalize(value).toLowerCase();
}

function isCreator(input: {
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
  comment: NonNullable<Awaited<ReturnType<typeof getOciSharePostCommentById>>>;
  actorPersonId: string;
  actorEmail: string;
}) {
  const authorPersonId = normalize(input.comment.authorPersonId);
  const authorEmail = normalizeLower(input.comment.authorEmail);
  const canMutate = isCreator({
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

export async function PATCH(request: Request, { params }: RouteProps) {
  const { tenantKey, threadId, postId, commentId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const actorPersonId = normalize(resolved.session.user?.person_id ?? resolved.tenant.personId);
  const actorEmail = normalizeLower(resolved.session.user?.email);
  if (!actorPersonId) {
    return NextResponse.json({ error: "missing_actor_person_id" }, { status: 400 });
  }

  const parsed = editCommentSchema.safeParse(await request.json().catch(() => null));
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

  const post = await getOciSharePostById({
    familyGroupKey: thread.familyGroupKey,
    postId: normalize(postId),
  });
  if (!post || post.threadId !== thread.threadId) {
    return NextResponse.json({ error: "post_not_found" }, { status: 404 });
  }

  const comment = await getOciSharePostCommentById({
    familyGroupKey: thread.familyGroupKey,
    commentId: normalize(commentId),
  });
  if (!comment || comment.postId !== post.postId || comment.threadId !== thread.threadId) {
    return NextResponse.json({ error: "comment_not_found" }, { status: 404 });
  }

  if (normalizeLower(comment.commentStatus) === "deleted") {
    return NextResponse.json({ error: "comment_not_found" }, { status: 404 });
  }

  const canEdit = isCreator({
    actorPersonId,
    actorEmail,
    authorPersonId: normalize(comment.authorPersonId),
    authorEmail: normalizeLower(comment.authorEmail),
  });
  if (!canEdit) {
    return NextResponse.json({ error: "creator_required" }, { status: 403 });
  }

  const nowIso = new Date().toISOString();
  const updated = await updateOciSharePostCommentById({
    familyGroupKey: thread.familyGroupKey,
    commentId: comment.commentId,
    commentText: parsed.data.commentText,
    updatedAt: nowIso,
  });
  if (!updated) {
    return NextResponse.json({ error: "comment_update_failed" }, { status: 500 });
  }

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    threadFamilyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    postId: post.postId,
    comment: toClientComment({ comment: updated, actorPersonId, actorEmail }),
  });
}

export async function DELETE(_: Request, { params }: RouteProps) {
  const { tenantKey, threadId, postId, commentId } = await params;
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

  const comment = await getOciSharePostCommentById({
    familyGroupKey: thread.familyGroupKey,
    commentId: normalize(commentId),
  });
  if (!comment || comment.postId !== post.postId || comment.threadId !== thread.threadId) {
    return NextResponse.json({ error: "comment_not_found" }, { status: 404 });
  }

  if (normalizeLower(comment.commentStatus) === "deleted") {
    return NextResponse.json({
      tenantKey: resolved.tenant.tenantKey,
      threadFamilyGroupKey: thread.familyGroupKey,
      threadId: thread.threadId,
      postId: post.postId,
      commentId: comment.commentId,
      deleted: true,
      alreadyDeleted: true,
    });
  }

  const canDelete = isCreator({
    actorPersonId,
    actorEmail,
    authorPersonId: normalize(comment.authorPersonId),
    authorEmail: normalizeLower(comment.authorEmail),
  });
  if (!canDelete) {
    return NextResponse.json({ error: "creator_required" }, { status: 403 });
  }

  const nowIso = new Date().toISOString();
  const updated = await updateOciSharePostCommentById({
    familyGroupKey: thread.familyGroupKey,
    commentId: comment.commentId,
    commentStatus: "deleted",
    deletedAt: nowIso,
    updatedAt: nowIso,
  });
  if (!updated) {
    return NextResponse.json({ error: "comment_delete_failed" }, { status: 500 });
  }

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    threadFamilyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    postId: post.postId,
    commentId: comment.commentId,
    deleted: true,
  });
}
