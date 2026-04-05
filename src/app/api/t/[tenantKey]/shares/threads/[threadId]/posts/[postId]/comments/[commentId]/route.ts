import { NextResponse } from "next/server";
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

