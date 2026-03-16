import { z } from "zod";
import { NextResponse } from "next/server";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { getLocalUsers, getTenantSecurityPolicy, upsertLocalUser } from "@/lib/auth/local-users";
import { getTenantConfig } from "@/lib/data/runtime";
import {
  deriveInheritedFamilyGroupAccessGrants,
  getProvisionableUserIdentities,
  loadFamilyGroupAccessInheritanceSnapshot,
} from "@/lib/family-group/access-inheritance";
import { requireTenantAdmin } from "@/lib/family-group/guard";
import { upsertOciUserFamilyGroupAccess } from "@/lib/oci/tables";
import { validatePasswordComplexity } from "@/lib/security/password";

const createUserSchema = z.object({
  username: z.string().trim().min(3).max(80),
  password: z.string().min(1).max(256),
  role: z.enum(["ADMIN", "USER"]),
  personId: z.string().trim().min(1).max(120),
  isEnabled: z.boolean().optional().default(true),
});

export async function GET(_: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const users = await getLocalUsers(resolved.tenant.tenantKey);
  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    users: users.map((user) => ({
      username: user.username,
      role: user.role,
      personId: user.personId,
      isEnabled: user.isEnabled,
      failedAttempts: user.failedAttempts,
      lockedUntil: user.lockedUntil,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: user.lastLoginAt,
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const parsed = createUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const policy = await getTenantSecurityPolicy(resolved.tenant.tenantKey);
  const complexityError = validatePasswordComplexity(parsed.data.password, policy);
  if (complexityError) {
    return NextResponse.json({ error: "password_policy_failed", message: complexityError }, { status: 400 });
  }

  const normalizedUsername = parsed.data.username.trim().toLowerCase();
  const tenantConfig = await getTenantConfig(resolved.tenant.tenantKey);

  await upsertLocalUser({
    tenantKey: resolved.tenant.tenantKey,
    username: normalizedUsername,
    password: parsed.data.password,
    role: parsed.data.role,
    personId: parsed.data.personId,
    isEnabled: parsed.data.isEnabled ?? true,
  });
  await upsertOciUserFamilyGroupAccess({
    userEmail: `${parsed.data.personId.trim()}@local`,
    tenantKey: resolved.tenant.tenantKey,
    tenantName: tenantConfig.tenantName,
    role: parsed.data.role,
    personId: parsed.data.personId,
    isEnabled: parsed.data.isEnabled ?? true,
  });

  let inheritedAccessCount = 0;
  if (parsed.data.isEnabled ?? true) {
    const inheritanceSnapshot = await loadFamilyGroupAccessInheritanceSnapshot();
    const localIdentity = getProvisionableUserIdentities(parsed.data.personId, inheritanceSnapshot).find(
      (identity) => identity.kind === "local",
    );
    const inheritedFamilies = deriveInheritedFamilyGroupAccessGrants(parsed.data.personId, inheritanceSnapshot, {
      excludeTenantKeys: [resolved.tenant.tenantKey],
    });
    if (localIdentity) {
      for (const family of inheritedFamilies) {
        await upsertOciUserFamilyGroupAccess({
          userEmail: localIdentity.userEmail,
          tenantKey: family.tenantKey,
          tenantName: family.tenantName,
          role: "USER",
          personId: parsed.data.personId,
          isEnabled: true,
        });
        inheritedAccessCount += 1;
      }
    }
  }

  await appendSessionAuditLog(resolved.session, {
    action: "CREATE",
    entityType: "LOCAL_USER",
    entityId: parsed.data.personId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `Created local access username=${normalizedUsername}, enabled=${String(parsed.data.isEnabled ?? true)}, role=${parsed.data.role}, inherited_family_groups=${inheritedAccessCount}.`,
  });

  return NextResponse.json({ ok: true, tenantKey: resolved.tenant.tenantKey, inheritedAccessCount });
}
