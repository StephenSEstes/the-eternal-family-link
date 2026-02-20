import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { getTenantContext, hasTenantAccess, normalizeTenantRouteKey, type TenantContext } from "@/lib/tenant/context";
export {
  TENANT_GUARD_CHECKLIST,
  buildTenantGuardChecklistState,
  isTenantGuardChecklistPassing,
  isTenantScopedValueAllowed,
  assertTenantScopedValue,
} from "@/lib/tenant/guard-core";

function normalizeTenant(value?: string) {
  return normalizeTenantRouteKey(value);
}

type TenantAccessResult =
  | { session: Session; tenant: TenantContext }
  | { error: NextResponse<{ error: string }> };

export async function requireTenantAccess(tenantKey: string): Promise<TenantAccessResult> {
  const session = await getAppSession();
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const normalizedTenantKey = normalizeTenant(tenantKey);
  if (!hasTenantAccess(session, normalizedTenantKey)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  return { session, tenant: getTenantContext(session, normalizedTenantKey) };
}

export async function requireTenantAdmin(tenantKey: string): Promise<TenantAccessResult> {
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved;
  }
  if (resolved.tenant.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return resolved;
}
