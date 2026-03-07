import "server-only";

import type { HouseholdRecord, RelationshipRecord } from "@/lib/google/types";
import { getPeople, getTableRecords } from "@/lib/google/sheets";
import { getOciRelationshipsForTenant } from "@/lib/oci/tables";

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

function isOciDataSource() {
  return (process.env.EFL_DATA_SOURCE ?? "").trim().toLowerCase() === "oci";
}

export async function getRelationships(tenantKey?: string): Promise<RelationshipRecord[]> {
  let rows = await getTableRecords("Relationships");
  if (tenantKey && isOciDataSource()) {
    try {
      const tenantRows = await getOciRelationshipsForTenant(tenantKey);
      if (tenantRows.length > 0) {
        rows = tenantRows;
      } else if (rows.length > 0) {
        console.warn(
          `[family:getRelationships] Tenant-scoped OCI relationships returned 0 rows for tenant '${tenantKey}'. Falling back to global relationships.`,
        );
      }
    } catch (error) {
      console.warn(
        `[family:getRelationships] Tenant-scoped OCI relationships failed for tenant '${tenantKey}'. Falling back to global relationships.`,
        error,
      );
    }
  }
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
  const [people, rows] = await Promise.all([
    getPeople(tenantKey),
    isOciDataSource()
      ? getTableRecords("Households").catch(() => [])
      : getTableRecords("Households", tenantKey),
  ]);
  const allowedPersonIds = new Set(people.map((person) => person.personId));
  const byHouseholdId = new Map<string, HouseholdRecord>();
  for (let idx = 0; idx < rows.length; idx += 1) {
    const data = rows[idx]?.data ?? {};
    const householdId = readCell(data, "household_id", "id") || `fu-${idx + 2}`;
    const partner1PersonId = readCell(data, "husband_person_id");
    const partner2PersonId = readCell(data, "wife_person_id");
    if (!partner1PersonId || !partner2PersonId) continue;
    if (!allowedPersonIds.has(partner1PersonId) || !allowedPersonIds.has(partner2PersonId)) continue;

    const incoming: HouseholdRecord = {
      id: householdId,
      tenantKey,
      partner1PersonId,
      partner2PersonId,
      label: readCell(data, "family_label", "label", "family_name"),
      notes: readCell(data, "notes", "family_notes"),
      address: readCell(data, "address", "household_address"),
      city: readCell(data, "city", "household_city"),
      state: readCell(data, "state", "household_state"),
      zip: readCell(data, "zip", "postal_code", "household_zip"),
    };

    const existing = byHouseholdId.get(householdId);
    if (!existing) {
      byHouseholdId.set(householdId, incoming);
      continue;
    }
    byHouseholdId.set(householdId, {
      ...existing,
      partner1PersonId: existing.partner1PersonId || incoming.partner1PersonId,
      partner2PersonId: existing.partner2PersonId || incoming.partner2PersonId,
      label: existing.label || incoming.label,
      notes: existing.notes || incoming.notes,
      address: existing.address || incoming.address,
      city: existing.city || incoming.city,
      state: existing.state || incoming.state,
      zip: existing.zip || incoming.zip,
    });
  }

  return Array.from(byHouseholdId.values()).sort((a, b) => a.id.localeCompare(b.id));
}
