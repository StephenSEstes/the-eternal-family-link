import { NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { listOciShareConversationsLinkedToPerson } from "@/lib/oci/tables";
import { getAccessibleFamilyGroupKeys } from "@/lib/shares/thread-access";

type RouteProps = {
  params: Promise<{ tenantKey: string; personId: string }>;
};

function parseSortableTimestamp(value: string) {
  const parsed = Date.parse(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: Request, { params }: RouteProps) {
  const { tenantKey, personId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }
  const actorPersonId = String(resolved.session.user?.person_id ?? resolved.tenant.personId ?? "").trim();
  const targetPersonId = String(personId ?? "").trim();
  if (!actorPersonId) {
    return NextResponse.json({ error: "missing_actor_person_id" }, { status: 400 });
  }
  if (!targetPersonId) {
    return NextResponse.json({ error: "missing_target_person_id" }, { status: 400 });
  }

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? "120");
  const perFamilyLimit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(200, Math.trunc(rawLimit)))
    : 120;

  const familyGroupKeys = getAccessibleFamilyGroupKeys(resolved.tenant);
  const buckets = await Promise.all(
    familyGroupKeys.map((familyGroupKey) =>
      listOciShareConversationsLinkedToPerson({
        familyGroupKey,
        actorPersonId,
        targetPersonId,
        limit: perFamilyLimit,
      }).catch(() => []),
    ),
  );
  const deduped = new Map<string, (typeof buckets)[number][number]>();
  for (const bucket of buckets) {
    for (const item of bucket) {
      if (!deduped.has(item.conversationId)) {
        deduped.set(item.conversationId, item);
      }
    }
  }
  const items = Array.from(deduped.values())
    .sort(
      (a, b) =>
        parseSortableTimestamp(b.lastActivityAt || b.latestPostCreatedAt || b.createdAt) -
        parseSortableTimestamp(a.lastActivityAt || a.latestPostCreatedAt || a.createdAt),
    )
    .slice(0, perFamilyLimit);

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    personId: targetPersonId,
    count: items.length,
    items: items.map((item) => ({
      conversationId: item.conversationId,
      threadId: item.threadId,
      familyGroupKey: item.familyGroupKey,
      title: item.title,
      ownerPersonId: item.ownerPersonId,
      conversationKind: item.conversationKind,
      audienceType: item.audienceType,
      audienceLabel: item.audienceLabel,
      createdAt: item.createdAt,
      lastActivityAt: item.lastActivityAt,
      latestPostId: item.latestPostId,
      latestPostCreatedAt: item.latestPostCreatedAt,
    })),
  });
}
