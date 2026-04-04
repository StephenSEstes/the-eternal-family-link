import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { getOciShareThreadMember, markOciShareThreadRead } from "@/lib/oci/tables";
import { resolveAccessibleShareThread } from "@/lib/shares/thread-access";

type RouteProps = {
  params: Promise<{ tenantKey: string; threadId: string }>;
};

const markReadSchema = z.object({
  lastReadAt: z.string().trim().optional().default(""),
});

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: Request, { params }: RouteProps) {
  const { tenantKey, threadId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const actorPersonId = normalize(resolved.session.user?.person_id ?? resolved.tenant.personId);
  if (!actorPersonId) {
    return NextResponse.json({ error: "missing_actor_person_id" }, { status: 400 });
  }

  const thread = await resolveAccessibleShareThread({
    threadId: normalize(threadId),
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

  const parsed = markReadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const targetReadAt = normalize(parsed.data.lastReadAt) || nowIso;
  const updated = await markOciShareThreadRead({
    familyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    personId: actorPersonId,
    lastReadAt: targetReadAt,
  });

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    threadFamilyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    personId: actorPersonId,
    markedRead: updated,
    lastReadAt: targetReadAt,
  });
}
