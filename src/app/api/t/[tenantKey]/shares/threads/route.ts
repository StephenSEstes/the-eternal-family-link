import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { requireTenantAccess } from "@/lib/family-group/guard";
import {
  createOciShareThread,
  getOciShareThreadByAudience,
  listOciShareThreadsForPerson,
  upsertOciShareThreadMember,
} from "@/lib/oci/tables";
import { resolveShareAudience, type ShareAudienceType } from "@/lib/shares/audience";

type RouteProps = {
  params: Promise<{ tenantKey: string }>;
};

const createSchema = z.object({
  audienceType: z.enum(["siblings", "household", "entire_family", "family_group"]),
  targetFamilyGroupKey: z.string().trim().max(80).optional().default(""),
});

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function buildThreadId() {
  return `shr-${randomUUID().replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
}

function buildThreadMemberId(threadId: string, personId: string) {
  const seed = `${threadId.trim().toLowerCase()}|${personId.trim().toLowerCase()}`;
  return `stm-${createHash("sha1").update(seed).digest("hex").slice(0, 24)}`;
}

function toClientThread(thread: Awaited<ReturnType<typeof listOciShareThreadsForPerson>>[number]) {
  return {
    threadId: thread.threadId,
    familyGroupKey: thread.familyGroupKey,
    audienceType: thread.audienceType,
    audienceKey: thread.audienceKey,
    audienceLabel: thread.audienceLabel,
    ownerPersonId: thread.ownerPersonId,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastPostAt: thread.lastPostAt,
    unreadCount: thread.unreadCount,
    latestPost: thread.latestPostId
      ? {
          postId: thread.latestPostId,
          fileId: thread.latestPostFileId,
          caption: thread.latestPostCaption,
          createdAt: thread.latestPostCreatedAt,
          authorDisplayName: thread.latestPostAuthorDisplayName,
        }
      : null,
  };
}

export async function GET(request: Request, { params }: RouteProps) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const actorPersonId = String(resolved.session.user?.person_id ?? resolved.tenant.personId ?? "").trim();
  if (!actorPersonId) {
    return NextResponse.json({ error: "missing_actor_person_id" }, { status: 400 });
  }

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? "40");
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, Math.trunc(rawLimit))) : 40;

  const threads = await listOciShareThreadsForPerson({
    familyGroupKey: resolved.tenant.tenantKey,
    personId: actorPersonId,
    limit,
  });

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    actorPersonId,
    count: threads.length,
    threads: threads.map(toClientThread),
    availableFamilyGroups: resolved.tenant.tenants.map((entry) => ({
      familyGroupKey: normalize(entry.tenantKey),
      familyGroupName: entry.tenantName,
    })),
  });
}

export async function POST(request: Request, { params }: RouteProps) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const actorPersonId = String(resolved.session.user?.person_id ?? resolved.tenant.personId ?? "").trim();
  const actorEmail = String(resolved.session.user?.email ?? "").trim().toLowerCase();
  if (!actorPersonId) {
    return NextResponse.json({ error: "missing_actor_person_id" }, { status: 400 });
  }

  const resolution = await resolveShareAudience({
    tenantKey: resolved.tenant.tenantKey,
    audienceType: parsed.data.audienceType as ShareAudienceType,
    actorPersonId,
    targetFamilyGroupKey: parsed.data.targetFamilyGroupKey,
    allowedFamilyGroupKeys: resolved.tenant.tenants.map((entry) => normalize(entry.tenantKey)).filter(Boolean),
  });
  const nowIso = new Date().toISOString();

  let thread =
    (await getOciShareThreadByAudience({
      familyGroupKey: resolution.familyGroupKey,
      audienceType: resolution.audienceType,
      audienceKey: resolution.audienceKey,
    })) ?? null;

  if (!thread) {
    thread = await createOciShareThread({
      threadId: buildThreadId(),
      familyGroupKey: resolution.familyGroupKey,
      audienceType: resolution.audienceType,
      audienceKey: resolution.audienceKey,
      audienceLabel: resolution.audienceLabel,
      ownerPersonId: actorPersonId,
      createdByPersonId: actorPersonId,
      createdByEmail: actorEmail,
      createdAt: nowIso,
      updatedAt: nowIso,
      threadStatus: "active",
    });
  }

  for (const recipient of resolution.recipients) {
    await upsertOciShareThreadMember({
      threadMemberId: buildThreadMemberId(thread.threadId, recipient.personId),
      threadId: thread.threadId,
      familyGroupKey: thread.familyGroupKey,
      personId: recipient.personId,
      memberRole: recipient.personId === actorPersonId ? "owner" : "member",
      joinedAt: nowIso,
      isActive: true,
    });
  }

  await appendSessionAuditLog(resolved.session, {
    action: "CREATE",
    entityType: "SHARE_THREAD",
    entityId: thread.threadId,
    familyGroupKey: thread.familyGroupKey,
    status: "SUCCESS",
    details: `Create/reuse share thread audience=${resolution.audienceType} key=${resolution.audienceKey}.`,
  });

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    thread: toClientThread({
      ...thread,
      memberLastReadAt: "",
      unreadCount: 0,
      latestPostId: "",
      latestPostFileId: "",
      latestPostCaption: "",
      latestPostCreatedAt: "",
      latestPostAuthorDisplayName: "",
    }),
    recipientCount: resolution.recipients.length,
    recipients: resolution.recipients,
  });
}
