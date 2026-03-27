import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import {
  getTenantContext,
  getTenantAccesses,
  hasTenantAccess,
  normalizeTenantRouteKey,
  type TenantContext,
} from "@/lib/family-group/context";
import { getEnv } from "@/lib/env";
import { getEnabledUserAccessList, getEnabledUserAccessListByPersonId } from "@/lib/data/store";
export {
  TENANT_GUARD_CHECKLIST,
  buildTenantGuardChecklistState,
  isTenantGuardChecklistPassing,
  isTenantScopedValueAllowed,
  assertTenantScopedValue,
} from "@/lib/family-group/guard-core";

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
  const tenants = getTenantAccesses(session);
  if (!hasTenantAccess(session, normalizedTenantKey)) {
    if (getEnv().ENABLE_MULTI_TENANT_SESSION === "true") {
      const refreshed =
        (session.user.person_id
          ? await getEnabledUserAccessListByPersonId(session.user.person_id).catch(() => [])
          : await getEnabledUserAccessList(session.user.email ?? "").catch(() => [])) || [];
      if (!refreshed.some((entry) => normalizeTenant(entry.tenantKey) === normalizedTenantKey)) {
        return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
      }
      return { session, tenant: getTenantContext(session, normalizedTenantKey, refreshed) };
    }
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  return { session, tenant: getTenantContext(session, normalizedTenantKey, tenants) };
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

