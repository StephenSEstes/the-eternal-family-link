export const TENANT_GUARD_CHECKLIST = [
  "session_required",
  "tenant_membership_required",
  "tenant_context_resolved",
  "tenant_row_scope_enforced",
] as const;

export type TenantGuardChecklistItem = (typeof TENANT_GUARD_CHECKLIST)[number];

export type TenantGuardChecklistState = Record<TenantGuardChecklistItem, boolean>;

export function buildTenantGuardChecklistState(state: Partial<TenantGuardChecklistState>): TenantGuardChecklistState {
  return {
    session_required: state.session_required ?? false,
    tenant_membership_required: state.tenant_membership_required ?? false,
    tenant_context_resolved: state.tenant_context_resolved ?? false,
    tenant_row_scope_enforced: state.tenant_row_scope_enforced ?? false,
  };
}

export function isTenantGuardChecklistPassing(state: TenantGuardChecklistState) {
  return TENANT_GUARD_CHECKLIST.every((item) => state[item]);
}

export function isTenantScopedValueAllowed(candidate: string | undefined, tenantKey: string) {
  const normalizedTenant = normalizeTenant(tenantKey);
  const rowTenant = normalizeTenant(candidate);
  return !candidate || rowTenant === normalizedTenant;
}

export function assertTenantScopedValue(
  candidate: string | undefined,
  tenantKey: string,
  details = "cross_tenant_row_blocked",
) {
  if (!isTenantScopedValueAllowed(candidate, tenantKey)) {
    throw new Error(details);
  }
}

function normalizeTenant(value?: string) {
  const raw = (value ?? "default").trim().toLowerCase();
  return raw || "default";
}
