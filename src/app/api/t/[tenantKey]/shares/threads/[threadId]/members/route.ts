import { NextResponse } from "next/server";
import { getPeople } from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { getOciShareThreadMember, listOciShareThreadMembers } from "@/lib/oci/tables";
import { resolveAccessibleShareThread } from "@/lib/shares/thread-access";

type RouteProps = {
  params: Promise<{ tenantKey: string; threadId: string }>;
};

export async function GET(_: Request, { params }: RouteProps) {
  const { tenantKey, threadId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const actorPersonId = String(resolved.session.user?.person_id ?? resolved.tenant.personId ?? "").trim();
  if (!actorPersonId) {
    return NextResponse.json({ error: "missing_actor_person_id" }, { status: 400 });
  }

  const thread = await resolveAccessibleShareThread({
    threadId,
    tenant: resolved.tenant,
    actorPersonId,
  });
  if (!thread) {
    return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
  }

  const actorMember = await getOciShareThreadMember({
    familyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    personId: actorPersonId,
  });
  if (!actorMember || !actorMember.isActive) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const [members, people] = await Promise.all([
    listOciShareThreadMembers({
      familyGroupKey: thread.familyGroupKey,
      threadId: thread.threadId,
    }),
    getPeople(thread.familyGroupKey).catch(() => []),
  ]);
  const peopleById = new Map(
    people
      .map((person) => [person.personId.trim(), person.displayName.trim() || person.personId.trim()] as const)
      .filter(([personId]) => Boolean(personId)),
  );

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    threadFamilyGroupKey: thread.familyGroupKey,
    threadId: thread.threadId,
    count: members.length,
    members: members.map((entry) => ({
      personId: entry.personId,
      displayName: peopleById.get(entry.personId) ?? entry.personId,
      memberRole: entry.memberRole,
      joinedAt: entry.joinedAt,
    })),
  });
}
