import type { Session } from "next-auth";
import { cookies } from "next/headers";
import type { TenantAccess } from "@/lib/google/types";

export const DEFAULT_TENANT_KEY = "default";
export const DEFAULT_TENANT_NAME = "The Eternal Family Link";
export const ACTIVE_TENANT_COOKIE = "active_tenant";

type SessionTenantShape = Session & {
  tenantKey?: string;
  tenantName?: string;
  user?: {
    tenantAccesses?: TenantAccess[];
  };
};

export type TenantContext = {
  tenantKey: string;
  tenantName: string;
  role: "ADMIN" | "USER";
  personId: string;
  tenants: TenantAccess[];
};

function normalizeTenantKey(tenantKey?: string) {
  const raw = (tenantKey ?? DEFAULT_TENANT_KEY).trim().toLowerCase();
  return raw || DEFAULT_TENANT_KEY;
}

export function normalizeTenantRouteKey(tenantKey?: string) {
  return normalizeTenantKey(tenantKey);
}

export function getTenantBasePath(tenantKey?: string) {
  const key = normalizeTenantKey(tenantKey);
  return key === DEFAULT_TENANT_KEY ? "" : `/t/${encodeURIComponent(key)}`;
}

export function getTenantAccesses(session: Session | null): TenantAccess[] {
  const tenantSession = session as SessionTenantShape | null;
  const accesses = tenantSession?.user?.tenantAccesses ?? [];
  if (accesses.length > 0) {
    return accesses;
  }

  return [
    {
      tenantKey: tenantSession?.tenantKey ?? DEFAULT_TENANT_KEY,
      tenantName: tenantSession?.tenantName ?? DEFAULT_TENANT_NAME,
      role: (session?.user?.role as "ADMIN" | "USER" | undefined) ?? "USER",
      personId: session?.user?.person_id ?? "",
    },
  ];
}

export function getTenantContext(session: Session | null, requestedTenantKey?: string): TenantContext {
  const tenantSession = session as SessionTenantShape | null;
  const tenants = getTenantAccesses(session);
  const selectedKey = normalizeTenantKey(requestedTenantKey);
  const selected = tenants.find((entry) => normalizeTenantKey(entry.tenantKey) === selectedKey) ?? tenants[0];

  return {
    tenantKey: selected?.tenantKey ?? tenantSession?.tenantKey ?? DEFAULT_TENANT_KEY,
    tenantName: selected?.tenantName ?? tenantSession?.tenantName ?? DEFAULT_TENANT_NAME,
    role: selected?.role ?? (session?.user?.role as "ADMIN" | "USER" | undefined) ?? "USER",
    personId: selected?.personId ?? session?.user?.person_id ?? "",
    tenants,
  };
}

export function hasTenantAccess(session: Session | null, tenantKey?: string) {
  const key = normalizeTenantKey(tenantKey);
  return getTenantAccesses(session).some((entry) => normalizeTenantKey(entry.tenantKey) === key);
}

export async function getRequestTenantContext(session: Session | null) {
  const cookieStore = await cookies();
  const requested = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;
  return getTenantContext(session, requested);
}
