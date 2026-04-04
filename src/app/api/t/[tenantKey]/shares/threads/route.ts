import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { getPeople } from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";
import {
  createOciShareGroup,
  createOciShareThread,
  getOciShareGroupBySignature,
  getOciShareThreadByGroupId,
  getOciShareThreadByAudience,
  listOciShareThreadsForPerson,
  updateOciShareThreadGroup,
  upsertOciShareGroupMember,
  upsertOciShareThreadMember,
} from "@/lib/oci/tables";
import { resolveShareAudience, type ShareAudienceType } from "@/lib/shares/audience";
import { getAccessibleFamilyGroupKeys } from "@/lib/shares/thread-access";

type RouteProps = {
  params: Promise<{ tenantKey: string }>;
};

const createSchema = z.object({
  audienceType: z.enum(["siblings", "household", "entire_family", "family_group", "custom_group"]),
  targetFamilyGroupKey: z.string().trim().max(80).optional().default(""),
  customLabel: z.string().trim().max(160).optional().default(""),
  memberPersonIds: z.array(z.string().trim().max(128)).optional().default([]),
});

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function buildThreadId() {
  return `shr-${randomUUID().replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
}

function buildGroupId() {
  return `sgrp-${randomUUID().replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
}

function parseSortableTimestamp(value: string) {
  const parsed = Date.parse(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildGroupMemberId(groupId: string, personId: string) {
  const seed = `${groupId.trim().toLowerCase()}|${personId.trim().toLowerCase()}`;
  return `sgm-${createHash("sha1").update(seed).digest("hex").slice(0, 24)}`;
}

function buildThreadMemberId(threadId: string, personId: string) {
  const seed = `${threadId.trim().toLowerCase()}|${personId.trim().toLowerCase()}`;
  return `stm-${createHash("sha1").update(seed).digest("hex").slice(0, 24)}`;
}

function uniquePersonIds(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function buildCustomAudienceKey(personIds: string[]) {
  const seed = personIds
    .map((value) => value.trim())
    .filter(Boolean)
    .sort()
    .join("|");
  return `custom_group:${createHash("sha1").update(seed).digest("hex").slice(0, 40)}`;
}

function toClientThread(thread: Awaited<ReturnType<typeof listOciShareThreadsForPerson>>[number]) {
  return {
    threadId: thread.threadId,
    familyGroupKey: thread.familyGroupKey,
    groupId: thread.groupId,
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

  const familyGroupKeys = getAccessibleFamilyGroupKeys(resolved.tenant);
  const groupedThreads = await Promise.all(
    familyGroupKeys.map((familyGroupKey) =>
      listOciShareThreadsForPerson({
        familyGroupKey,
        personId: actorPersonId,
        limit,
      }).catch(() => []),
    ),
  );
  const deduped = new Map<string, Awaited<ReturnType<typeof listOciShareThreadsForPerson>>[number]>();
  for (const bucket of groupedThreads) {
    for (const thread of bucket) {
      if (!deduped.has(thread.threadId)) {
        deduped.set(thread.threadId, thread);
      }
    }
  }
  const threads = Array.from(deduped.values())
    .sort(
      (left, right) =>
        parseSortableTimestamp(right.lastPostAt || right.createdAt) -
        parseSortableTimestamp(left.lastPostAt || left.createdAt),
    )
    .slice(0, limit);

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
  const nowIso = new Date().toISOString();

  const allowedFamilyGroupKeys = resolved.tenant.tenants.map((entry) => normalize(entry.tenantKey)).filter(Boolean);
  let resolution: {
    familyGroupKey: string;
    audienceType: string;
    audienceKey: string;
    audienceLabel: string;
    recipients: Array<{ personId: string; displayName: string }>;
    groupId?: string;
  };

  if (parsed.data.audienceType === "custom_group") {
    const familyGroupKey = normalize(parsed.data.targetFamilyGroupKey) || resolved.tenant.tenantKey;
    const allowed = new Set(allowedFamilyGroupKeys);
    allowed.add(normalize(resolved.tenant.tenantKey));
    if (!allowed.has(familyGroupKey)) {
      return NextResponse.json({ error: "target_family_group_not_allowed" }, { status: 403 });
    }

    const people = await getPeople(familyGroupKey);
    const peopleById = new Map(
      people
        .map((person) => [person.personId.trim(), person.displayName.trim() || person.personId.trim()] as const)
        .filter(([personId]) => Boolean(personId)),
    );
    if (!peopleById.has(actorPersonId)) {
      return NextResponse.json({ error: "actor_not_in_family_group" }, { status: 400 });
    }

    const memberIds = uniquePersonIds([...parsed.data.memberPersonIds, actorPersonId]).filter((personId) =>
      peopleById.has(personId),
    );
    if (memberIds.length < 2) {
      return NextResponse.json(
        { error: "custom_group_requires_two_members", message: "Select at least one additional member." },
        { status: 400 },
      );
    }

    const recipients = memberIds
      .map((personId) => ({ personId, displayName: peopleById.get(personId) ?? personId }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));

    const canonicalMemberIds = recipients.map((entry) => entry.personId).sort();
    const memberSignature = buildCustomAudienceKey(canonicalMemberIds);
    let group = await getOciShareGroupBySignature({
      familyGroupKey,
      memberSignature,
    });
    if (!group) {
      group = await createOciShareGroup({
        groupId: buildGroupId(),
        familyGroupKey,
        groupType: "custom_group",
        memberSignature,
        displayLabel: parsed.data.customLabel || `Group (${recipients.length})`,
        ownerPersonId: actorPersonId,
        createdByPersonId: actorPersonId,
        createdByEmail: actorEmail,
        createdAt: nowIso,
        updatedAt: nowIso,
        groupStatus: "active",
      });
    }
    for (const recipient of recipients) {
      await upsertOciShareGroupMember({
        groupMemberId: buildGroupMemberId(group.groupId, recipient.personId),
        groupId: group.groupId,
        familyGroupKey,
        personId: recipient.personId,
        memberRole: recipient.personId === actorPersonId ? "owner" : "member",
        joinedAt: nowIso,
        isActive: true,
      });
    }

    resolution = {
      familyGroupKey,
      audienceType: "custom_group",
      audienceKey: memberSignature,
      audienceLabel: parsed.data.customLabel || group.displayLabel || `Group (${recipients.length})`,
      recipients,
      groupId: group.groupId,
    };
  } else {
    const baseResolution = await resolveShareAudience({
      tenantKey: resolved.tenant.tenantKey,
      audienceType: parsed.data.audienceType as ShareAudienceType,
      actorPersonId,
      targetFamilyGroupKey: parsed.data.targetFamilyGroupKey,
      allowedFamilyGroupKeys,
    });
    resolution = {
      ...baseResolution,
      audienceType: baseResolution.audienceType,
    };
  }

  let thread =
    resolution.groupId
      ? await getOciShareThreadByGroupId({
          familyGroupKey: resolution.familyGroupKey,
          groupId: resolution.groupId,
        })
      : null;
  if (!thread) {
    thread =
      (await getOciShareThreadByAudience({
        familyGroupKey: resolution.familyGroupKey,
        audienceType: resolution.audienceType,
        audienceKey: resolution.audienceKey,
      })) ?? null;
  }
  if (thread && resolution.groupId && !thread.groupId) {
    await updateOciShareThreadGroup({
      familyGroupKey: thread.familyGroupKey,
      threadId: thread.threadId,
      groupId: resolution.groupId,
      updatedAt: nowIso,
    });
    thread = { ...thread, groupId: resolution.groupId };
  }
  const existingThread = Boolean(thread);

  if (!thread) {
    thread = await createOciShareThread({
      threadId: buildThreadId(),
      familyGroupKey: resolution.familyGroupKey,
      groupId: resolution.groupId,
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
    existingThread,
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
