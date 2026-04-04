import "server-only";

import type { TenantContext } from "@/lib/family-group/context";
import { getOciShareThreadById, type OciShareThreadRow } from "@/lib/oci/tables";

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
}): Promise<OciShareThreadRow | null> {
  const threadId = String(input.threadId ?? "").trim();
  if (!threadId) {
    return null;
  }
  const keys = getAccessibleFamilyGroupKeys(input.tenant);
  for (const familyGroupKey of keys) {
    const thread = await getOciShareThreadById({ familyGroupKey, threadId });
    if (thread) {
      return thread;
    }
  }
  return null;
}
