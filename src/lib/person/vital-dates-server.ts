import "server-only";

import { getTableRecords } from "@/lib/data/runtime";
import { getDeathDateFromAttributes } from "@/lib/person/vital-dates";

function readCell(row: Record<string, string>, ...keys: string[]) {
  const lowered = new Map(Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value]));
  for (const key of keys) {
    const value = lowered.get(key.trim().toLowerCase());
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export async function getPersonDeathDateMapForTenant(tenantKey: string, personIds?: Iterable<string>) {
  const rows = await getTableRecords("Attributes", tenantKey).catch(() => []);
  const allowedIds = personIds ? new Set(Array.from(personIds).map((value) => value.trim()).filter(Boolean)) : null;
  const attributeRowsByPersonId = new Map<string, Array<{
    category: string;
    attributeType: string;
    typeKey: string;
    attributeTypeCategory: string;
    attributeDate: string;
    dateStart: string;
    endDate: string;
    dateEnd: string;
    createdAt: string;
    updatedAt: string;
  }>>();

  rows.forEach((row) => {
    const entityType = normalize(readCell(row.data, "entity_type"));
    const entityId = readCell(row.data, "entity_id", "person_id");
    if (entityType && entityType !== "person") {
      return;
    }
    if (!entityId || (allowedIds && !allowedIds.has(entityId))) {
      return;
    }
    const bucket = attributeRowsByPersonId.get(entityId) ?? [];
    bucket.push({
      category: readCell(row.data, "attribute_kind", "category"),
      attributeType: readCell(row.data, "attribute_type"),
      typeKey: readCell(row.data, "type_key", "attribute_type"),
      attributeTypeCategory: readCell(row.data, "attribute_type_category", "type_category"),
      attributeDate: readCell(row.data, "attribute_date", "date", "date_start"),
      dateStart: readCell(row.data, "date_start", "attribute_date"),
      endDate: readCell(row.data, "end_date", "date_end"),
      dateEnd: readCell(row.data, "date_end", "end_date"),
      createdAt: readCell(row.data, "created_at"),
      updatedAt: readCell(row.data, "updated_at"),
    });
    attributeRowsByPersonId.set(entityId, bucket);
  });

  const deathDatesByPersonId = new Map<string, string>();
  attributeRowsByPersonId.forEach((attributes, personId) => {
    const deathDate = getDeathDateFromAttributes(attributes);
    if (deathDate) {
      deathDatesByPersonId.set(personId, deathDate);
    }
  });

  return deathDatesByPersonId;
}
