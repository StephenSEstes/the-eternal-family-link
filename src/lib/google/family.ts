import "server-only";

import type { HouseholdRecord, RelationshipRecord } from "@/lib/google/types";
import { getTableRecords } from "@/lib/google/sheets";

function readCell(record: Record<string, string>, ...keys: string[]) {
  const lowered = new Map(Object.entries(record).map(([k, v]) => [k.trim().toLowerCase(), v]));
  for (const key of keys) {
    const value = lowered.get(key.trim().toLowerCase());
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export async function getRelationships(tenantKey?: string): Promise<RelationshipRecord[]> {
  const rows = await getTableRecords("Relationships");
  const normalizedTenantKey = (tenantKey ?? "").trim().toLowerCase();
  return rows
    .map((row, idx) => {
      const data = row.data;
      return {
        id: readCell(data, "rel_id", "relationship_id", "id") || `rel-${idx + 2}`,
        tenantKey: readCell(data, "family_group_key", "tenant_key") || normalizedTenantKey,
        fromPersonId: readCell(data, "from_person_id", "source_person_id", "person_id"),
        toPersonId: readCell(data, "to_person_id", "target_person_id", "related_person_id"),
        relationshipType: readCell(data, "rel_type", "relationship_type", "type") || "related",
      } satisfies RelationshipRecord;
    })
    .filter((row) => row.fromPersonId && row.toPersonId);
}

export async function getHouseholds(tenantKey: string): Promise<HouseholdRecord[]> {
  const rows = await getTableRecords("Households", tenantKey);
  return rows
    .map((row, idx) => {
      const data = row.data;
      const rowTenant = readCell(data, "family_group_key", "tenant_key") || tenantKey;
      return {
        id: readCell(data, "household_id", "id") || `fu-${idx + 2}`,
        tenantKey: rowTenant,
        partner1PersonId: readCell(data, "husband_person_id"),
        partner2PersonId: readCell(data, "wife_person_id"),
        label: readCell(data, "family_label", "label", "family_name"),
        notes: readCell(data, "notes", "family_notes"),
      } satisfies HouseholdRecord;
    })
    .filter((row) => row.partner1PersonId && row.partner2PersonId)
    .filter((row) => row.tenantKey.toLowerCase() === tenantKey.toLowerCase());
}
