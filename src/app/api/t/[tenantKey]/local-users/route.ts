import { z } from "zod";
import { NextResponse } from "next/server";
import { getLocalUsers, getTenantSecurityPolicy, upsertLocalUser } from "@/lib/auth/local-users";
import { requireTenantAdmin } from "@/lib/tenant/guard";
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

  await upsertLocalUser({
    tenantKey: resolved.tenant.tenantKey,
    username: parsed.data.username,
    password: parsed.data.password,
    role: parsed.data.role,
    personId: parsed.data.personId,
    isEnabled: parsed.data.isEnabled ?? true,
  });

  return NextResponse.json({ ok: true, tenantKey: resolved.tenant.tenantKey });
}
