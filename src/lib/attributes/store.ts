import "server-only";

import { buildEntityId } from "@/lib/entity-id";
import {
  createTableRecord,
  deleteTableRecordById,
  ensureResolvedTabColumns,
  getTableRecords,
  updateTableRecordById,
} from "@/lib/google/sheets";
import { deleteOciMediaLink, ensureOciAttributesTable, getOciMediaLinksForEntity } from "@/lib/oci/tables";
import type { AttributeEntityType, AttributeMediaLink, AttributeRecord } from "@/lib/attributes/types";

export const ATTRIBUTES_TAB = "Attributes";
let attributesStorageReady = false;

function isOciDataSource() {
  return (process.env.EFL_DATA_SOURCE ?? "").trim().toLowerCase() === "oci";
}

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

async function ensureAttributesStorage(tenantKey: string) {
  if (attributesStorageReady) return;
  if (isOciDataSource()) {
    await ensureOciAttributesTable();
    attributesStorageReady = true;
    return;
  }
  await ensureResolvedTabColumns(
    ATTRIBUTES_TAB,
    [
      "attribute_id",
      "entity_type",
      "entity_id",
      "category",
      "type_key",
      "label",
      "value_text",
      "date_start",
      "date_end",
      "location",
      "notes",
      "created_at",
      "updated_at",
    ],
    tenantKey,
  );
  attributesStorageReady = true;
}

function toAttributeRecord(row: Record<string, string>): AttributeRecord {
  const typeKey = readCell(row, "type_key");
  return {
    attributeId: readCell(row, "attribute_id"),
    entityType: (readCell(row, "entity_type") || "person") as AttributeEntityType,
    entityId: readCell(row, "entity_id"),
    category: (readCell(row, "category") || "descriptor") as "descriptor" | "event",
    typeKey,
    label: readCell(row, "label") || typeKey,
    valueText: readCell(row, "value_text"),
    dateStart: readCell(row, "date_start"),
    dateEnd: readCell(row, "date_end"),
    location: readCell(row, "location"),
    notes: readCell(row, "notes"),
    createdAt: readCell(row, "created_at"),
    updatedAt: readCell(row, "updated_at"),
  };
}

export async function getAttributesForEntity(tenantKey: string, entityType: AttributeEntityType, entityId: string) {
  await ensureAttributesStorage(tenantKey);
  const rows = await getTableRecords(ATTRIBUTES_TAB, tenantKey).catch(() => []);
  return rows
    .filter((row) => normalize(readCell(row.data, "entity_type")) === normalize(entityType) && readCell(row.data, "entity_id") === entityId)
    .map((row) => toAttributeRecord(row.data))
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
    category: input.category,
    type_key: input.typeKey,
    label: (input.label ?? "").trim() || input.typeKey,
    value_text: input.valueText,
    date_start: input.dateStart,
    date_end: input.dateEnd,
    location: input.location,
    notes: input.notes,
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
  if (patch.category !== undefined) payload.category = patch.category;
  if (patch.typeKey !== undefined) payload.type_key = patch.typeKey;
  if (patch.label !== undefined) payload.label = patch.label;
  if (patch.valueText !== undefined) payload.value_text = patch.valueText;
  if (patch.dateStart !== undefined) payload.date_start = patch.dateStart;
  if (patch.dateEnd !== undefined) payload.date_end = patch.dateEnd;
  if (patch.location !== undefined) payload.location = patch.location;
  if (patch.notes !== undefined) payload.notes = patch.notes;
  const updated = await updateTableRecordById(ATTRIBUTES_TAB, attributeId, payload, "attribute_id", tenantKey);
  return updated ? toAttributeRecord(updated.data) : null;
}

export async function deleteAttribute(tenantKey: string, attributeId: string) {
  await ensureAttributesStorage(tenantKey);
  const existing = await getAttributeById(tenantKey, attributeId);
  if (!existing) return false;
  const deleted = await deleteTableRecordById(ATTRIBUTES_TAB, attributeId, "attribute_id", tenantKey);
  if (!deleted) return false;
  if (isOciDataSource()) {
    const links = await getOciMediaLinksForEntity({
      familyGroupKey: tenantKey,
      entityType: "attribute",
      entityId: attributeId,
    });
    await Promise.all(links.map((item) => deleteOciMediaLink(item.linkId)));
  }
  return true;
}

export async function getAttributeMediaLinks(tenantKey: string, attributeId: string): Promise<AttributeMediaLink[]> {
  if (isOciDataSource()) {
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
  const mediaRows = await getTableRecords("MediaLinks", tenantKey).catch(() => []);
  return mediaRows
    .filter(
      (row) =>
        normalize(readCell(row.data, "entity_type")) === "attribute" &&
        readCell(row.data, "entity_id") === attributeId,
    )
    .map((row) => ({
      linkId: readCell(row.data, "link_id"),
      fileId: readCell(row.data, "file_id"),
      label: readCell(row.data, "label"),
      description: readCell(row.data, "description"),
      photoDate: readCell(row.data, "photo_date"),
      isPrimary: normalize(readCell(row.data, "is_primary")) === "true",
      mediaMetadata: readCell(row.data, "media_metadata"),
      createdAt: readCell(row.data, "created_at"),
    }))
    .filter((item) => item.linkId && item.fileId);
}

export async function removeAttributeMediaLink(tenantKey: string, attributeId: string, linkId: string) {
  void attributeId;
  if (isOciDataSource()) {
    const count = await deleteOciMediaLink(linkId);
    return count > 0;
  }
  return deleteTableRecordById("MediaLinks", linkId, "link_id", tenantKey);
}
