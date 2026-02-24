export {
  ACTIVE_FAMILY_GROUP_COOKIE,
  ACTIVE_TENANT_COOKIE,
  DEFAULT_FAMILY_GROUP_KEY,
  DEFAULT_FAMILY_GROUP_NAME,
  DEFAULT_TENANT_KEY,
  DEFAULT_TENANT_NAME,
  getFamilyGroupAccesses,
  getFamilyGroupBasePath,
  getFamilyGroupContext,
  getRequestFamilyGroupContext,
  hasFamilyGroupAccess,
  normalizeFamilyGroupRouteKey,
} from "@/lib/tenant/context";

export {
  getTenantAccesses,
  getTenantBasePath,
  getTenantContext,
  getRequestTenantContext,
  hasTenantAccess,
  normalizeTenantRouteKey,
} from "@/lib/tenant/context";

export type { TenantContext as FamilyGroupContext, TenantContext } from "@/lib/tenant/context";
