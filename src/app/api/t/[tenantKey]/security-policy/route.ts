import { z } from "zod";
import { NextResponse } from "next/server";
import {
  defaultTenantSecurityPolicy,
  getTenantSecurityPolicy,
  upsertTenantSecurityPolicy,
} from "@/lib/auth/local-users";
import { requireTenantAdmin } from "@/lib/tenant/guard";

const policySchema = z.object({
  minLength: z.number().int().min(4).max(128),
  requireNumber: z.boolean(),
  requireUppercase: z.boolean(),
  requireLowercase: z.boolean(),
  lockoutAttempts: z.number().int().min(1).max(50),
});

export async function GET(_: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const policy = await getTenantSecurityPolicy(resolved.tenant.tenantKey);
  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    policy: policy ?? defaultTenantSecurityPolicy(resolved.tenant.tenantKey),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const parsed = policySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  await upsertTenantSecurityPolicy(resolved.tenant.tenantKey, {
    tenantKey: resolved.tenant.tenantKey,
    ...parsed.data,
  });

  return NextResponse.json({ ok: true, tenantKey: resolved.tenant.tenantKey });
}
