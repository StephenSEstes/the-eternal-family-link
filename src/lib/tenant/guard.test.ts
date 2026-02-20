import test from "node:test";
import assert from "node:assert/strict";
import {
  TENANT_GUARD_CHECKLIST,
  buildTenantGuardChecklistState,
  isTenantGuardChecklistPassing,
  isTenantScopedValueAllowed,
  assertTenantScopedValue,
} from "./guard-core.ts";

test("tenant guard checklist defaults to failing until all checks are true", () => {
  const state = buildTenantGuardChecklistState({});
  assert.equal(isTenantGuardChecklistPassing(state), false);
  assert.deepEqual(Object.keys(state).sort(), [...TENANT_GUARD_CHECKLIST].sort());
});

test("tenant guard checklist passes when all checks are true", () => {
  const state = buildTenantGuardChecklistState({
    session_required: true,
    tenant_membership_required: true,
    tenant_context_resolved: true,
    tenant_row_scope_enforced: true,
  });
  assert.equal(isTenantGuardChecklistPassing(state), true);
});

test("tenant scoped value allows empty or matching tenant values", () => {
  assert.equal(isTenantScopedValueAllowed(undefined, "tenant-a"), true);
  assert.equal(isTenantScopedValueAllowed("", "tenant-a"), true);
  assert.equal(isTenantScopedValueAllowed("tenant-a", "tenant-a"), true);
  assert.equal(isTenantScopedValueAllowed("TENANT-A", "tenant-a"), true);
  assert.equal(isTenantScopedValueAllowed("tenant-b", "tenant-a"), false);
});

test("tenant scoped assertion throws on cross-tenant value", () => {
  assert.throws(() => assertTenantScopedValue("tenant-b", "tenant-a"), /cross_tenant_row_blocked/);
  assert.doesNotThrow(() => assertTenantScopedValue("tenant-a", "tenant-a"));
});
