import type { Session } from "next-auth";

export const DEFAULT_TENANT_KEY = "default";
export const DEFAULT_TENANT_NAME = "The Eternal Family Link";

type SessionTenantShape = Session & {
  tenantKey?: string;
  tenantName?: string;
};

export type TenantContext = {
  tenantKey: string;
  tenantName: string;
};

export function getTenantContext(session: Session | null): TenantContext {
  const tenantSession = session as SessionTenantShape | null;
  return {
    tenantKey: tenantSession?.tenantKey ?? DEFAULT_TENANT_KEY,
    tenantName: tenantSession?.tenantName ?? DEFAULT_TENANT_NAME,
  };
}
