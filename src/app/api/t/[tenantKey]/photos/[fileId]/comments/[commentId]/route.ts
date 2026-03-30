import { NextResponse } from "next/server";
import { z } from "zod";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { getPeople } from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";
import {
  getOciMediaCommentById,
  getOciMediaCommentsForFile,
  getOciMediaLinksForFile,
  getOciPersonMediaAttributeRowsForFile,
  updateOciMediaCommentById,
} from "@/lib/oci/tables";

type RouteProps = {
  params: Promise<{ tenantKey: string; fileId: string; commentId: string }>;
};

const patchCommentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function canMutateComment(input: {
  actorPersonId: string;
  actorEmail: string;
  role: string;
  authorPersonId: string;
  authorEmail: string;
}) {
  if (normalize(input.role).toUpperCase() === "ADMIN") {
    return true;
  }
  if (input.actorPersonId && input.actorPersonId === input.authorPersonId) {
    return true;
  }
  if (input.actorEmail && input.actorEmail === input.authorEmail) {
    return true;
  }
  return false;
}

async function canAccessFileInTenant(tenantKey: string, fileId: string) {
  const normalizedTenantKey = tenantKey.trim().toLowerCase();
  const normalizedFileId = fileId.trim();
  if (!normalizedTenantKey || !normalizedFileId) {
    return false;
  }
  const [mediaLinks, personMediaAttributes, people] = await Promise.all([
    getOciMediaLinksForFile({ familyGroupKey: normalizedTenantKey, fileId: normalizedFileId }).catch(() => []),
    getOciPersonMediaAttributeRowsForFile({ familyGroupKey: normalizedTenantKey, fileId: normalizedFileId }).catch(() => []),
    getPeople(normalizedTenantKey).catch(() => []),
  ]);
  if (mediaLinks.length > 0 || personMediaAttributes.length > 0) {
    return true;
  }
  return people.some((person) => normalize(person.photoFileId) === normalizedFileId);
}

export async function PATCH(request: Request, { params }: RouteProps) {
  const { tenantKey, fileId, commentId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const normalizedFileId = normalize(fileId);
  const normalizedCommentId = normalize(commentId);
  if (!normalizedFileId || !normalizedCommentId) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const hasAccess = await canAccessFileInTenant(resolved.tenant.tenantKey, normalizedFileId);
  if (!hasAccess) {
    return NextResponse.json({ error: "media_not_found" }, { status: 404 });
  }

  const comment = await getOciMediaCommentById({
    familyGroupKey: resolved.tenant.tenantKey,
    commentId: normalizedCommentId,
  });
  if (!comment || normalize(comment.fileId) !== normalizedFileId) {
    return NextResponse.json({ error: "comment_not_found" }, { status: 404 });
  }

  const actorPersonId = normalize(resolved.session.user?.person_id);
  const actorEmail = normalize(resolved.session.user?.email).toLowerCase();
  const allowed = canMutateComment({
    actorPersonId,
    actorEmail,
    role: resolved.tenant.role,
    authorPersonId: normalize(comment.authorPersonId),
    authorEmail: normalize(comment.authorEmail).toLowerCase(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (normalize(comment.commentStatus).toLowerCase() === "deleted") {
    return NextResponse.json({ error: "comment_deleted" }, { status: 400 });
  }

  const parsed = patchCommentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const updated = await updateOciMediaCommentById({
    familyGroupKey: resolved.tenant.tenantKey,
    commentId: normalizedCommentId,
    commentText: parsed.data.body,
    updatedAt: nowIso,
  });
  if (!updated) {
    return NextResponse.json({ error: "comment_not_found" }, { status: 404 });
  }

  await appendSessionAuditLog(resolved.session, {
    action: "UPDATE",
    entityType: "MEDIA_COMMENT",
    entityId: normalizedCommentId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `Updated media comment for file=${normalizedFileId}.`,
  });

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    fileId: normalizedFileId,
    comment: {
      commentId: updated.commentId,
      fileId: updated.fileId,
      parentCommentId: updated.parentCommentId,
      author: {
        personId: updated.authorPersonId,
        displayName: normalize(updated.authorDisplayName) || normalize(updated.authorEmail) || "Unknown",
        email: normalize(updated.authorEmail).toLowerCase(),
      },
      text: updated.commentText,
      status: normalize(updated.commentStatus).toLowerCase() || "active",
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      deletedAt: updated.deletedAt,
      canEdit: true,
      canDelete: true,
    },
  });
}

export async function DELETE(_: Request, { params }: RouteProps) {
  const { tenantKey, fileId, commentId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const normalizedFileId = normalize(fileId);
  const normalizedCommentId = normalize(commentId);
  if (!normalizedFileId || !normalizedCommentId) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const hasAccess = await canAccessFileInTenant(resolved.tenant.tenantKey, normalizedFileId);
  if (!hasAccess) {
    return NextResponse.json({ error: "media_not_found" }, { status: 404 });
  }

  const comment = await getOciMediaCommentById({
    familyGroupKey: resolved.tenant.tenantKey,
    commentId: normalizedCommentId,
  });
  if (!comment || normalize(comment.fileId) !== normalizedFileId) {
    return NextResponse.json({ error: "comment_not_found" }, { status: 404 });
  }

  const actorPersonId = normalize(resolved.session.user?.person_id);
  const actorEmail = normalize(resolved.session.user?.email).toLowerCase();
  const allowed = canMutateComment({
    actorPersonId,
    actorEmail,
    role: resolved.tenant.role,
    authorPersonId: normalize(comment.authorPersonId),
    authorEmail: normalize(comment.authorEmail).toLowerCase(),
  });
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const nowIso = new Date().toISOString();
  const updated = await updateOciMediaCommentById({
    familyGroupKey: resolved.tenant.tenantKey,
    commentId: normalizedCommentId,
    commentText: "",
    commentStatus: "deleted",
    updatedAt: nowIso,
    deletedAt: nowIso,
  });
  if (!updated) {
    return NextResponse.json({ error: "comment_not_found" }, { status: 404 });
  }

  await appendSessionAuditLog(resolved.session, {
    action: "DELETE",
    entityType: "MEDIA_COMMENT",
    entityId: normalizedCommentId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `Soft-deleted media comment for file=${normalizedFileId}.`,
  });

  const comments = await getOciMediaCommentsForFile({
    familyGroupKey: resolved.tenant.tenantKey,
    fileId: normalizedFileId,
  });

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    fileId: normalizedFileId,
    deletedCommentId: normalizedCommentId,
    count: comments.length,
  });
}
