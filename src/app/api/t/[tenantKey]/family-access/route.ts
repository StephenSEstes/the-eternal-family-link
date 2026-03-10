import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantAdmin } from "@/lib/family-group/guard";
import {
  appendAuditLog,
  ensurePersonFamilyGroupMembership,
  getPeople,
  getTableRecords,
} from "@/lib/data/runtime";

type RouteProps = {
  params: Promise<{ tenantKey: string }>;
};

const patchSchema = z.object({
  personId: z.string().trim().min(1),
  isEnabled: z.boolean(),
});

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function parseBool(value: string | undefined) {
  const raw = normalize(value);
  return raw === "true" || raw === "1" || raw === "yes";
}

export async function GET(_: Request, { params }: RouteProps) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }
  const familyGroupKey = normalize(resolved.tenant.tenantKey);

  const [people, personFamilyRows] = await Promise.all([
    getPeople(),
    getTableRecords("PersonFamilyGroups").catch(() => []),
  ]);
  const peopleById = new Map(people.map((person) => [person.personId, person]));

  const rows = personFamilyRows
    .map((row) => {
      const rowKey = normalize(
        row.data.family_group_key || row.data.tenant_key,
      );
      if (rowKey !== familyGroupKey) {
        return null;
      }
      const personId = String(row.data.person_id ?? "").trim();
      if (!personId) {
        return null;
      }
      const person = peopleById.get(personId);
      return {
        personId,
        displayName: person?.displayName || personId,
        isEnabled: parseBool(row.data.is_enabled || "TRUE"),
      };
    })
    .filter((item): item is { personId: string; displayName: string; isEnabled: boolean } => Boolean(item))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    rows,
  });
}

export async function PATCH(request: Request, { params }: RouteProps) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  await ensurePersonFamilyGroupMembership(
    parsed.data.personId,
    resolved.tenant.tenantKey,
    parsed.data.isEnabled,
  );

  await appendAuditLog({
    actorEmail: resolved.session.user?.email ?? "",
    actorPersonId: resolved.session.user?.person_id ?? "",
    action: "UPDATE",
    entityType: "PERSON_FAMILY_ACCESS",
    entityId: parsed.data.personId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `is_enabled=${String(parsed.data.isEnabled)}`,
  }).catch(() => undefined);

  return NextResponse.json({ ok: true });
}

