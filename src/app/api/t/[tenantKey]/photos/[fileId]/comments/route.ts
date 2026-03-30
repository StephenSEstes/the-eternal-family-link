import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { getPeople } from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { resolvePersonDisplayName } from "@/lib/person/display-name";
import {
  createOciMediaComment,
  getOciMediaCommentsForFile,
  getOciMediaLinksForFile,
  getOciPersonMediaAttributeRowsForFile,
} from "@/lib/oci/tables";

type RouteProps = {
  params: Promise<{ tenantKey: string; fileId: string }>;
};

type MediaCommentItem = {
  commentId: string;
  fileId: string;
  parentCommentId: string;
  author: {
    personId: string;
    displayName: string;
    email: string;
  };
  text: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
  canEdit: boolean;
  canDelete: boolean;
};

const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  parentCommentId: z.string().trim().max(128).optional().default(""),
});

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function buildCommentId() {
  return `cmt-${randomUUID().replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
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

async function resolveActorDisplayName(input: {
  tenantKey: string;
  actorPersonId: string;
  fallbackName: string;
  fallbackEmail: string;
}) {
  if (input.actorPersonId) {
    const people = await getPeople(input.tenantKey).catch(() => []);
    const match = people.find((person) => normalize(person.personId) === input.actorPersonId);
    if (match) {
      return (
        resolvePersonDisplayName({
          personId: match.personId,
          displayName: match.displayName,
          firstName: match.firstName,
          middleName: match.middleName,
          lastName: match.lastName,
        }).trim() || input.fallbackEmail
      );
    }
  }
  return normalize(input.fallbackName) || input.fallbackEmail;
}

function toCommentItems(input: {
  comments: Awaited<ReturnType<typeof getOciMediaCommentsForFile>>;
  actorPersonId: string;
  actorEmail: string;
  role: string;
}): MediaCommentItem[] {
  return input.comments.map((comment) => {
    const authorPersonId = normalize(comment.authorPersonId);
    const authorEmail = normalize(comment.authorEmail).toLowerCase();
    const canMutate = canMutateComment({
      actorPersonId: input.actorPersonId,
      actorEmail: input.actorEmail,
      role: input.role,
      authorPersonId,
      authorEmail,
    });
    return {
      commentId: comment.commentId,
      fileId: comment.fileId,
      parentCommentId: comment.parentCommentId,
      author: {
        personId: authorPersonId,
        displayName: normalize(comment.authorDisplayName) || authorEmail || "Unknown",
        email: authorEmail,
      },
      text: comment.commentText,
      status: normalize(comment.commentStatus).toLowerCase() || "active",
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      deletedAt: comment.deletedAt,
      canEdit: canMutate && normalize(comment.commentStatus).toLowerCase() !== "deleted",
      canDelete: canMutate,
    };
  });
}

export async function GET(_: Request, { params }: RouteProps) {
  const { tenantKey, fileId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const normalizedFileId = normalize(fileId);
  if (!normalizedFileId) {
    return NextResponse.json({ error: "invalid_file_id" }, { status: 400 });
  }
  const hasAccess = await canAccessFileInTenant(resolved.tenant.tenantKey, normalizedFileId);
  if (!hasAccess) {
    return NextResponse.json({ error: "media_not_found" }, { status: 404 });
  }

  const comments = await getOciMediaCommentsForFile({
    familyGroupKey: resolved.tenant.tenantKey,
    fileId: normalizedFileId,
  });
  const actorPersonId = normalize(resolved.session.user?.person_id);
  const actorEmail = normalize(resolved.session.user?.email).toLowerCase();
  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    fileId: normalizedFileId,
    comments: toCommentItems({
      comments,
      actorPersonId,
      actorEmail,
      role: resolved.tenant.role,
    }),
  });
}

export async function POST(request: Request, { params }: RouteProps) {
  const { tenantKey, fileId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const normalizedFileId = normalize(fileId);
  if (!normalizedFileId) {
    return NextResponse.json({ error: "invalid_file_id" }, { status: 400 });
  }
  const hasAccess = await canAccessFileInTenant(resolved.tenant.tenantKey, normalizedFileId);
  if (!hasAccess) {
    return NextResponse.json({ error: "media_not_found" }, { status: 404 });
  }

  const parsed = createCommentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const actorPersonId = normalize(resolved.session.user?.person_id);
  const actorEmail = normalize(resolved.session.user?.email).toLowerCase();
  if (!actorEmail) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parentCommentId = normalize(parsed.data.parentCommentId);
  if (parentCommentId) {
    const comments = await getOciMediaCommentsForFile({
      familyGroupKey: resolved.tenant.tenantKey,
      fileId: normalizedFileId,
    });
    const parent = comments.find((comment) => normalize(comment.commentId) === parentCommentId);
    if (!parent) {
      return NextResponse.json({ error: "parent_comment_not_found" }, { status: 400 });
    }
  }

  const nowIso = new Date().toISOString();
  const actorDisplayName = await resolveActorDisplayName({
    tenantKey: resolved.tenant.tenantKey,
    actorPersonId,
    fallbackName: normalize(resolved.session.user?.name),
    fallbackEmail: actorEmail,
  });

  const created = await createOciMediaComment({
    familyGroupKey: resolved.tenant.tenantKey,
    commentId: buildCommentId(),
    fileId: normalizedFileId,
    parentCommentId,
    authorPersonId: actorPersonId,
    authorDisplayName: actorDisplayName,
    authorEmail: actorEmail,
    commentText: parsed.data.body,
    commentStatus: "active",
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  await appendSessionAuditLog(resolved.session, {
    action: "CREATE",
    entityType: "MEDIA_COMMENT",
    entityId: created.commentId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `Created media comment for file=${normalizedFileId}.`,
  });

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    fileId: normalizedFileId,
    comment: toCommentItems({
      comments: [created],
      actorPersonId,
      actorEmail,
      role: resolved.tenant.role,
    })[0],
  });
}
