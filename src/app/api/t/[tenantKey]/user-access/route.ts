import { z } from "zod";
import { NextResponse } from "next/server";
import { appendAuditLog, getTenantConfig, getTenantUserAccessList, upsertTenantAccess } from "@/lib/data/runtime";
import {
  deriveInheritedFamilyGroupAccessGrants,
  loadFamilyGroupAccessInheritanceSnapshot,
} from "@/lib/family-group/access-inheritance";
import { requireTenantAdmin } from "@/lib/family-group/guard";

const upsertSchema = z.object({
  userEmail: z.string().email(),
  role: z.enum(["ADMIN", "USER"]),
  personId: z.string().trim().min(1),
  isEnabled: z.boolean().optional().default(true),
});

async function resolveAdmin(requestedTenantKey: string) {
  const resolved = await requireTenantAdmin(requestedTenantKey);
  if ("error" in resolved) {
    return resolved;
  }
  return { tenant: resolved.tenant, session: resolved.session } as const;
}

export async function GET(_: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const resolved = await resolveAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const items = await getTenantUserAccessList(resolved.tenant.tenantKey);
  return NextResponse.json({ tenantKey: resolved.tenant.tenantKey, items });
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const resolved = await resolveAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const parsed = upsertSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const config = await getTenantConfig(resolved.tenant.tenantKey);
  const result = await upsertTenantAccess({
    userEmail: parsed.data.userEmail,
    tenantKey: resolved.tenant.tenantKey,
    tenantName: config.tenantName,
    role: parsed.data.role,
    personId: parsed.data.personId,
    isEnabled: parsed.data.isEnabled ?? true,
  });

  let inheritedAccessCount = 0;
  if (parsed.data.isEnabled ?? true) {
    const inheritanceSnapshot = await loadFamilyGroupAccessInheritanceSnapshot();
    const inheritedFamilies = deriveInheritedFamilyGroupAccessGrants(parsed.data.personId, inheritanceSnapshot, {
      excludeTenantKeys: [resolved.tenant.tenantKey],
    });
    for (const family of inheritedFamilies) {
      await upsertTenantAccess({
        userEmail: parsed.data.userEmail,
        tenantKey: family.tenantKey,
        tenantName: family.tenantName,
        role: "USER",
        personId: parsed.data.personId,
        isEnabled: true,
      });
      inheritedAccessCount += 1;
    }
  }
  await appendAuditLog({
    actorEmail: resolved.session.user?.email ?? "",
    actorPersonId: resolved.session.user?.person_id ?? "",
    action: "UPSERT",
    entityType: "USER_ACCESS",
    entityId: parsed.data.personId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `role=${parsed.data.role}, email=${parsed.data.userEmail.toLowerCase()}, enabled=${String(parsed.data.isEnabled ?? true)}, inherited_family_groups=${inheritedAccessCount}`,
  }).catch(() => undefined);

  return NextResponse.json({ ok: true, inheritedAccessCount, ...result });
}
