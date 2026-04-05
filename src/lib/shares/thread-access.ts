import "server-only";

import type { TenantContext } from "@/lib/family-group/context";
import { getOciShareThreadForPerson, type OciShareThreadRow } from "@/lib/oci/tables";

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export function getAccessibleFamilyGroupKeys(tenant: TenantContext): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const primary = normalize(tenant.tenantKey);
  if (primary) {
    seen.add(primary);
    ordered.push(primary);
  }
  for (const entry of tenant.tenants) {
    const key = normalize(entry.tenantKey);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    ordered.push(key);
  }
  return ordered;
}

export async function resolveAccessibleShareThread(input: {
  threadId: string;
  tenant: TenantContext;
  actorPersonId?: string;
}): Promise<OciShareThreadRow | null> {
  const threadId = String(input.threadId ?? "").trim();
  if (!threadId) {
    return null;
  }
  const actorPersonId = String(input.actorPersonId ?? input.tenant.personId ?? "").trim();
  if (!actorPersonId) {
    return null;
  }
  return getOciShareThreadForPerson({ threadId, personId: actorPersonId });
}
