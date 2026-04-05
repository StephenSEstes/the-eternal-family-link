import { NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { updateOciShareThreadStatus } from "@/lib/oci/tables";
import { resolveAccessibleShareThread } from "@/lib/shares/thread-access";

type RouteProps = {
  params: Promise<{ tenantKey: string; threadId: string }>;
};

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

export async function DELETE(_: Request, { params }: RouteProps) {
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
    actorPersonId,
  });
  if (!thread) {
    return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
  }

  const isCreator = [normalize(thread.ownerPersonId), normalize(thread.createdByPersonId)].includes(actorPersonId);
  if (!isCreator) {
    return NextResponse.json({ error: "creator_required" }, { status: 403 });
  }

  if (normalize(thread.threadStatus).toLowerCase() === "archived") {
    return NextResponse.json({
      tenantKey: resolved.tenant.tenantKey,
      threadFamilyGroupKey: thread.familyGroupKey,
      threadId: thread.threadId,
      deleted: true,
      alreadyDeleted: true,
    });
  }

  const nowIso = new Date().toISOString();
  const updated = await updateOciShareThreadStatus({
    familyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    threadStatus: "archived",
    updatedAt: nowIso,
  });
  if (!updated) {
    return NextResponse.json({ error: "thread_delete_failed" }, { status: 500 });
  }

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    threadFamilyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    deleted: true,
  });
}

