import "server-only";

import { buildEntityId } from "@/lib/entity-id";
import {
  createTableRecord,
  deleteTableRecordById,
  getTableRecords,
  updateTableRecordById,
} from "@/lib/data/runtime";
import { deleteOciMediaLink, ensureOciAttributesTable, getOciMediaLinksForEntity } from "@/lib/oci/tables";
import type { AttributeEntityType, AttributeMediaLink, AttributeRecord } from "@/lib/attributes/types";

export const ATTRIBUTES_TAB = "Attributes";
let attributesStorageReady = false;

function readCell(row: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

const EVENT_TYPE_KEYS = new Set(["graduation", "missions", "religious_event", "injuries", "accomplishments", "stories", "lived_in", "jobs"]);
const CANONICAL_TYPE_KEY_MAP: Record<string, string> = {
  graduation: "education",
  missions: "religious",
  religious_event: "religious",
  injuries: "injury_health",
  accomplishments: "accomplishment",
  stories: "life_event",
  lived_in: "moved",
  jobs: "employment",
  hobbies: "hobbies_interests",
  likes: "hobbies_interests",
  allergies: "physical_attribute",
  blood_type: "physical_attribute",
  hair_color: "physical_attribute",
  height: "physical_attribute",
  health: "physical_attribute",
};

function inferCategoryFromTypeKey(typeKey: string) {
  const normalized = (CANONICAL_TYPE_KEY_MAP[typeKey.trim().toLowerCase()] ?? typeKey.trim().toLowerCase());
  if (
    [
      "birth",
      "education",
      "religious",
      "accomplishment",
      "injury_health",
      "life_event",
      "moved",
      "employment",
      "family_relationship",
      "pet",
      "travel",
      "other",
    ].includes(normalized)
  ) {
    return "event";
  }
  return EVENT_TYPE_KEYS.has(normalized) ? "event" : "descriptor";
}

async function ensureAttributesStorage(tenantKey: string) {
  void tenantKey;
  if (attributesStorageReady) return;
  await ensureOciAttributesTable();
  attributesStorageReady = true;
}

function toAttributeRecord(row: Record<string, string>): AttributeRecord {
  const rawType = readCell(row, "attribute_type", "type_key");
  const typeKey = CANONICAL_TYPE_KEY_MAP[rawType.trim().toLowerCase()] ?? rawType;
  const entityType = (readCell(row, "entity_type") ||
    (readCell(row, "person_id") ? "person" : readCell(row, "household_id") ? "household" : "person")) as AttributeEntityType;
  const entityId = readCell(row, "entity_id", "person_id", "household_id");
  const category = inferCategoryFromTypeKey(typeKey) as "descriptor" | "event";
  const attributeTypeCategory = readCell(row, "attribute_type_category", "type_category");
  const attributeDate = readCell(row, "attribute_date", "date", "date_start", "start_date");
  const attributeDetail = readCell(row, "attribute_detail", "value_text");
  const attributeNotes = readCell(row, "attribute_notes", "notes");
  const endDate = readCell(row, "end_date", "date_end");
  return {
    attributeId: readCell(row, "attribute_id"),
    entityType,
    entityId,
    category,
    attributeType: typeKey,
    attributeTypeCategory,
    attributeDate,
    dateIsEstimated: normalize(readCell(row, "date_is_estimated")) === "true",
    estimatedTo: ((): "" | "month" | "year" => {
      const value = normalize(readCell(row, "estimated_to"));
      if (value === "month" || value === "year") return value;
      return "";
    })(),
    attributeDetail,
    attributeNotes,
    endDate,
    typeKey,
    label: readCell(row, "label") || typeKey,
    valueText: attributeDetail,
    dateStart: attributeDate,
    dateEnd: endDate,
    location: "",
    notes: attributeNotes,
    createdAt: readCell(row, "created_at"),
    updatedAt: readCell(row, "updated_at"),
  };
}

export async function getAttributesForEntity(tenantKey: string, entityType: AttributeEntityType, entityId: string) {
  await ensureAttributesStorage(tenantKey);
  const rows = await getTableRecords(ATTRIBUTES_TAB, tenantKey).catch(() => []);
  return rows
    .map((row) => toAttributeRecord(row.data))
    .filter((row) => normalize(row.entityType) === normalize(entityType) && row.entityId === entityId)
    .sort((a, b) => {
      if (a.typeKey !== b.typeKey) return a.typeKey.localeCompare(b.typeKey);
      return (b.dateStart || "").localeCompare(a.dateStart || "") || a.attributeId.localeCompare(b.attributeId);
    });
}

export async function getAttributeById(tenantKey: string, attributeId: string) {
  await ensureAttributesStorage(tenantKey);
  const rows = await getTableRecords(ATTRIBUTES_TAB, tenantKey).catch(() => []);
  const row = rows.find((item) => readCell(item.data, "attribute_id") === attributeId);
  return row ? toAttributeRecord(row.data) : null;
}

export async function createAttribute(
  tenantKey: string,
  input: Omit<AttributeRecord, "attributeId" | "createdAt" | "updatedAt" | "label"> & { label?: string },
) {
  await ensureAttributesStorage(tenantKey);
  const now = new Date().toISOString();
  const attributeId = buildEntityId("attr", `${tenantKey}|${input.entityType}|${input.entityId}|${input.typeKey}|${Date.now()}`);
  const payload: Record<string, string> = {
    attribute_id: attributeId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    attribute_type: input.attributeType || input.typeKey,
    attribute_type_category: input.attributeTypeCategory,
    attribute_date: input.attributeDate || input.dateStart,
    date_is_estimated: input.dateIsEstimated ? "TRUE" : "FALSE",
    estimated_to: input.estimatedTo || "",
    attribute_detail: input.attributeDetail || input.valueText,
    attribute_notes: input.attributeNotes || input.notes,
    end_date: input.endDate || input.dateEnd,
    created_at: now,
    updated_at: now,
  };
  const created = await createTableRecord(ATTRIBUTES_TAB, payload, tenantKey);
  return toAttributeRecord(created.data);
}

export async function updateAttribute(
  tenantKey: string,
  attributeId: string,
  patch: Partial<Omit<AttributeRecord, "attributeId" | "entityType" | "entityId" | "createdAt" | "updatedAt">>,
) {
  await ensureAttributesStorage(tenantKey);
  const payload: Record<string, string> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.typeKey !== undefined) payload.attribute_type = patch.typeKey;
  if (patch.attributeType !== undefined) payload.attribute_type = patch.attributeType;
  if (patch.attributeTypeCategory !== undefined) payload.attribute_type_category = patch.attributeTypeCategory;
  if (patch.valueText !== undefined) payload.attribute_detail = patch.valueText;
  if (patch.attributeDetail !== undefined) payload.attribute_detail = patch.attributeDetail;
  if (patch.dateStart !== undefined) payload.attribute_date = patch.dateStart;
  if (patch.attributeDate !== undefined) payload.attribute_date = patch.attributeDate;
  if (patch.endDate !== undefined) payload.end_date = patch.endDate;
  if (patch.dateIsEstimated !== undefined) payload.date_is_estimated = patch.dateIsEstimated ? "TRUE" : "FALSE";
  if (patch.estimatedTo !== undefined) payload.estimated_to = patch.estimatedTo;
  if (patch.notes !== undefined) payload.attribute_notes = patch.notes;
  if (patch.attributeNotes !== undefined) payload.attribute_notes = patch.attributeNotes;
  const updated = await updateTableRecordById(ATTRIBUTES_TAB, attributeId, payload, "attribute_id", tenantKey);
  return updated ? toAttributeRecord(updated.data) : null;
}

export async function deleteAttribute(tenantKey: string, attributeId: string) {
  await ensureAttributesStorage(tenantKey);
  const existing = await getAttributeById(tenantKey, attributeId);
  if (!existing) return false;
  const deleted = await deleteTableRecordById(ATTRIBUTES_TAB, attributeId, "attribute_id", tenantKey);
  if (!deleted) return false;
  const links = await getOciMediaLinksForEntity({
    familyGroupKey: tenantKey,
    entityType: "attribute",
    entityId: attributeId,
  });
  await Promise.all(links.map((item) => deleteOciMediaLink(item.linkId)));
  return true;
}

export async function getAttributeMediaLinks(tenantKey: string, attributeId: string): Promise<AttributeMediaLink[]> {
  const links = await getOciMediaLinksForEntity({
    familyGroupKey: tenantKey,
    entityType: "attribute",
    entityId: attributeId,
  });
  return links.map((item) => ({
    linkId: item.linkId,
    fileId: item.fileId,
    label: item.label,
    description: item.description,
    photoDate: item.photoDate,
    isPrimary: item.isPrimary,
    mediaMetadata: item.mediaMetadata,
    createdAt: item.createdAt,
  }));
}

export async function removeAttributeMediaLink(tenantKey: string, attributeId: string, linkId: string) {
  void attributeId;
  void tenantKey;
  const count = await deleteOciMediaLink(linkId);
  return count > 0;
}
