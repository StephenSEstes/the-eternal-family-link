import "server-only";

import {
  createTableRecord,
  getTableRecords,
  getTenantConfig,
  updateTableRecordById,
} from "@/lib/data/runtime";
import {
  DEFAULT_ATTRIBUTE_DEFINITIONS_VERSION,
  defaultAttributeDefinitions,
  inferAttributeKindFromTypeKey,
  makeAttributeDefinitionCategoryId,
  makeAttributeDefinitionTypeId,
  normalizeAttributeKind,
  normalizeAttributeTypeKey,
} from "@/lib/attributes/definition-defaults";
import type { AttributeCategory } from "@/lib/attributes/types";
import type {
  AttributeEventCategoryDefinition,
  AttributeEventDefinitions,
  AttributeEventTypeDefinition,
  EventTypeDateMode,
} from "@/lib/attributes/event-definitions-types";

const FAMILY_CONFIG_TABLE = "FamilyConfig";
const LEGACY_TENANT_CONFIG_TABLE = "TenantConfig";
const DEFINITIONS_COLUMN = "attribute_event_definitions_json";

const FAMILY_CONFIG_HEADERS = [
  "family_group_key",
  "family_group_name",
  "viewer_pin_hash",
  "photos_folder_id",
  DEFINITIONS_COLUMN,
];

function normalizeTenantKey(value: string) {
  return value.trim().toLowerCase();
}

function normalizeLabel(value: string) {
  return value.trim();
}

function normalizeColor(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  const hex = raw.startsWith("#") ? raw : `#${raw}`;
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toLowerCase();
  return "";
}

function toBool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "yes", "y"].includes(normalized);
  }
  return fallback;
}

function toInt(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDateMode(value: unknown): EventTypeDateMode {
  return String(value ?? "").trim().toLowerCase() === "range" ? "range" : "single";
}

function sortCategories(rows: AttributeEventCategoryDefinition[]) {
  return rows.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.categoryLabel.localeCompare(b.categoryLabel));
}

function sortTypes(rows: AttributeEventTypeDefinition[]) {
  return rows
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || `${a.kind}:${a.categoryKey}:${a.typeLabel}`.localeCompare(`${b.kind}:${b.categoryKey}:${b.typeLabel}`));
}

function dedupeCategories(rows: AttributeEventCategoryDefinition[]) {
  const map = new Map<string, AttributeEventCategoryDefinition>();
  for (const row of rows) {
    map.set(makeAttributeDefinitionCategoryId(row.kind, row.categoryKey), row);
  }
  return sortCategories(Array.from(map.values()));
}

function dedupeTypes(rows: AttributeEventTypeDefinition[]) {
  const map = new Map<string, AttributeEventTypeDefinition>();
  for (const row of rows) {
    map.set(makeAttributeDefinitionTypeId(row.kind, row.categoryKey, row.typeKey), row);
  }
  return sortTypes(Array.from(map.values()));
}

function normalizeCategoryRow(
  raw: Record<string, unknown>,
  fallback: AttributeEventDefinitions,
  index: number,
  fallbackKind: AttributeCategory,
): AttributeEventCategoryDefinition | null {
  const categoryKey = normalizeAttributeTypeKey(String(raw.categoryKey ?? ""));
  const kind = normalizeAttributeKind(String(raw.kind ?? "")) ?? inferAttributeKindFromTypeKey(categoryKey) ?? fallbackKind;
  const categoryLabel = normalizeLabel(String(raw.categoryLabel ?? ""));
  if (!categoryKey || !categoryLabel) return null;
  const fallbackColor =
    fallback.categories.find((item) => item.kind === kind && normalizeAttributeTypeKey(item.categoryKey) === categoryKey)?.categoryColor ??
    fallback.categories[index]?.categoryColor ??
    "#e5e7eb";
  return {
    kind,
    categoryKey,
    categoryLabel,
    categoryColor: normalizeColor(String(raw.categoryColor ?? "")) || normalizeColor(fallbackColor) || "#e5e7eb",
    description: normalizeLabel(String(raw.description ?? "")),
    sortOrder: toInt(raw.sortOrder, (index + 1) * 10),
    isEnabled: toBool(raw.isEnabled, true),
  };
}

function normalizeTypeRow(
  raw: Record<string, unknown>,
  categoryIds: Set<string>,
  fallback: AttributeEventDefinitions,
  index: number,
  fallbackKind: AttributeCategory,
): AttributeEventTypeDefinition | null {
  const categoryKey = normalizeAttributeTypeKey(String(raw.categoryKey ?? ""));
  const kind = normalizeAttributeKind(String(raw.kind ?? "")) ?? inferAttributeKindFromTypeKey(categoryKey) ?? fallbackKind;
  const typeKey = normalizeAttributeTypeKey(String(raw.typeKey ?? ""));
  const typeLabel = normalizeLabel(String(raw.typeLabel ?? ""));
  if (!typeKey || !categoryKey || !typeLabel) return null;
  if (!categoryIds.has(makeAttributeDefinitionCategoryId(kind, categoryKey))) return null;
  const fallbackType = fallback.types.find(
    (item) => item.kind === kind && normalizeAttributeTypeKey(item.categoryKey) === categoryKey && normalizeAttributeTypeKey(item.typeKey) === typeKey,
  );
  const mode = normalizeDateMode(raw.dateMode ?? fallbackType?.dateMode);
  return {
    kind,
    typeKey,
    categoryKey,
    typeLabel,
    detailLabel: normalizeLabel(String(raw.detailLabel ?? fallbackType?.detailLabel ?? "")) || "Attribute Detail",
    dateMode: mode,
    askEndDate: toBool(raw.askEndDate, mode === "range" || fallbackType?.askEndDate === true),
    sortOrder: toInt(raw.sortOrder, (index + 1) * 10),
    isEnabled: toBool(raw.isEnabled, true),
  };
}

function mergeDescriptorDefaults(defs: AttributeEventDefinitions, fallback: AttributeEventDefinitions): AttributeEventDefinitions {
  const descriptorCategories = fallback.categories.filter((item) => item.kind === "descriptor");
  const descriptorTypes = fallback.types.filter((item) => item.kind === "descriptor");
  const mergedCategories = dedupeCategories([...defs.categories, ...descriptorCategories]);
  const categoryIds = new Set(mergedCategories.map((item) => makeAttributeDefinitionCategoryId(item.kind, item.categoryKey)));
  const mergedTypes = dedupeTypes([...defs.types, ...descriptorTypes]).filter((item) =>
    categoryIds.has(makeAttributeDefinitionCategoryId(item.kind, item.categoryKey)),
  );
  return {
    version: DEFAULT_ATTRIBUTE_DEFINITIONS_VERSION,
    categories: mergedCategories,
    types: mergedTypes,
  };
}

export function defaultAttributeEventDefinitions(): AttributeEventDefinitions {
  return defaultAttributeDefinitions();
}

function normalizeConfig(input: unknown): AttributeEventDefinitions {
  const fallback = defaultAttributeEventDefinitions();
  if (!input || typeof input !== "object") {
    return fallback;
  }
  const record = input as Record<string, unknown>;
  const version = toInt(record.version, 1);
  const categoriesInput = Array.isArray(record.categories) ? record.categories : [];
  const normalizedCategories = dedupeCategories(
    categoriesInput
      .map((raw, index) => {
        if (!raw || typeof raw !== "object") return null;
        return normalizeCategoryRow(raw as Record<string, unknown>, fallback, index, version >= 2 ? "descriptor" : "event");
      })
      .filter((row): row is AttributeEventCategoryDefinition => Boolean(row)),
  );

  if (normalizedCategories.length === 0) {
    return fallback;
  }

  const categoryIds = new Set(normalizedCategories.map((row) => makeAttributeDefinitionCategoryId(row.kind, row.categoryKey)));
  const typesInput = Array.isArray(record.types) ? record.types : [];
  const normalizedTypes = dedupeTypes(
    typesInput
      .map((raw, index) => {
        if (!raw || typeof raw !== "object") return null;
        return normalizeTypeRow(raw as Record<string, unknown>, categoryIds, fallback, index, version >= 2 ? "descriptor" : "event");
      })
      .filter((row): row is AttributeEventTypeDefinition => Boolean(row)),
  );

  const normalized = {
    version: DEFAULT_ATTRIBUTE_DEFINITIONS_VERSION,
    categories: normalizedCategories,
    types: normalizedTypes.filter((row) => categoryIds.has(makeAttributeDefinitionCategoryId(row.kind, row.categoryKey))),
  } satisfies AttributeEventDefinitions;

  return version >= DEFAULT_ATTRIBUTE_DEFINITIONS_VERSION ? normalized : mergeDescriptorDefaults(normalized, fallback);
}

async function ensureFamilyConfigShape(tenantKey: string) {
  void tenantKey;
  void FAMILY_CONFIG_HEADERS;
}

async function findFamilyConfigRow(tenantKey: string) {
  const normalizedTenantKey = normalizeTenantKey(tenantKey);
  const rows = await getTableRecords([FAMILY_CONFIG_TABLE, LEGACY_TENANT_CONFIG_TABLE], normalizedTenantKey).catch(() => []);
  return rows.find((row) => normalizeTenantKey(row.data.family_group_key ?? "") === normalizedTenantKey) ?? null;
}

export async function getAttributeEventDefinitions(tenantKey: string): Promise<AttributeEventDefinitions> {
  await ensureFamilyConfigShape(tenantKey);
  const row = await findFamilyConfigRow(tenantKey);
  const raw = (row?.data[DEFINITIONS_COLUMN] ?? "").trim();
  if (!raw) return defaultAttributeEventDefinitions();
  try {
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return defaultAttributeEventDefinitions();
  }
}

export async function upsertAttributeEventDefinitions(
  tenantKey: string,
  input: AttributeEventDefinitions,
): Promise<AttributeEventDefinitions> {
  await ensureFamilyConfigShape(tenantKey);
  const normalizedTenantKey = normalizeTenantKey(tenantKey);
  const next = normalizeConfig(input);
  const payload: Record<string, string> = {
    [DEFINITIONS_COLUMN]: JSON.stringify(next),
  };
  const existing = await findFamilyConfigRow(normalizedTenantKey);
  if (existing) {
    await updateTableRecordById([FAMILY_CONFIG_TABLE, LEGACY_TENANT_CONFIG_TABLE], existing.data.family_group_key, payload, "family_group_key", normalizedTenantKey);
    return next;
  }
  const base = await getTenantConfig(normalizedTenantKey);
  await createTableRecord(
    FAMILY_CONFIG_TABLE,
    {
      family_group_key: normalizedTenantKey,
      family_group_name: base.tenantName,
      viewer_pin_hash: base.viewerPinHash,
      photos_folder_id: base.photosFolderId,
      [DEFINITIONS_COLUMN]: JSON.stringify(next),
    },
    normalizedTenantKey,
  );
  return next;
}
