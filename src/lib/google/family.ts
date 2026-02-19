import "server-only";

import type { FamilyUnitRecord, RelationshipRecord } from "@/lib/google/types";
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

export async function getRelationships(tenantKey: string): Promise<RelationshipRecord[]> {
  const rows = await getTableRecords("Relationships", tenantKey);
  return rows
    .map((row, idx) => {
      const data = row.data;
      const rowTenant = readCell(data, "tenant_key") || tenantKey;
      return {
        id: readCell(data, "rel_id", "relationship_id", "id") || `rel-${idx + 2}`,
        tenantKey: rowTenant,
        fromPersonId: readCell(data, "from_person_id", "source_person_id", "person_id"),
        toPersonId: readCell(data, "to_person_id", "target_person_id", "related_person_id"),
        relationshipType: readCell(data, "rel_type", "relationship_type", "type") || "related",
      } satisfies RelationshipRecord;
    })
    .filter((row) => row.fromPersonId && row.toPersonId)
    .filter((row) => row.tenantKey.toLowerCase() === tenantKey.toLowerCase());
}

export async function getFamilyUnits(tenantKey: string): Promise<FamilyUnitRecord[]> {
  const rows = await getTableRecords("FamilyUnits", tenantKey);
  return rows
    .map((row, idx) => {
      const data = row.data;
      const rowTenant = readCell(data, "tenant_key") || tenantKey;
      return {
        id: readCell(data, "family_unit_id", "id") || `fu-${idx + 2}`,
        tenantKey: rowTenant,
        partner1PersonId: readCell(data, "partner1_person_id", "partner_1_person_id", "parent1_person_id"),
        partner2PersonId: readCell(data, "partner2_person_id", "partner_2_person_id", "parent2_person_id"),
      } satisfies FamilyUnitRecord;
    })
    .filter((row) => row.partner1PersonId && row.partner2PersonId)
    .filter((row) => row.tenantKey.toLowerCase() === tenantKey.toLowerCase());
}
