import { z } from "zod";
import { NextResponse } from "next/server";
import { getTenantConfig, getTenantUserAccessList, upsertTenantAccess } from "@/lib/google/sheets";
import { requireTenantAdmin } from "@/lib/tenant/guard";

const upsertSchema = z.object({
  userEmail: z.string().email(),
  role: z.enum(["ADMIN", "USER"]),
  personId: z.string().optional().default(""),
  isEnabled: z.boolean().optional().default(true),
});

async function resolveAdmin(requestedTenantKey: string) {
  const resolved = await requireTenantAdmin(requestedTenantKey);
  if ("error" in resolved) {
    return resolved;
  }
  return { tenant: resolved.tenant } as const;
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
    personId: parsed.data.personId ?? "",
    isEnabled: parsed.data.isEnabled ?? true,
  });

  return NextResponse.json({ ok: true, ...result });
}
