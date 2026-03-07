import "server-only";

import {
  createTableRecord,
  ensureResolvedTabColumns,
  getTableRecords,
  getTenantConfig,
  updateTableRecordById,
} from "@/lib/google/sheets";
import type {
  AttributeEventCategoryDefinition,
  AttributeEventDefinitions,
  AttributeEventTypeDefinition,
} from "@/lib/attributes/event-definitions-types";

const FAMILY_CONFIG_TAB = "FamilyConfig";
const LEGACY_TENANT_CONFIG_TAB = "TenantConfig";
const DEFINITIONS_COLUMN = "attribute_event_definitions_json";

const FAMILY_CONFIG_HEADERS = [
  "family_group_key",
  "family_group_name",
  "viewer_pin_hash",
  "photos_folder_id",
  DEFINITIONS_COLUMN,
];

function isOciDataSource() {
  return (process.env.EFL_DATA_SOURCE ?? "").trim().toLowerCase() === "oci";
}

function normalizeTenantKey(value: string) {
  return value.trim().toLowerCase();
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_ -]/g, "").replace(/\s+/g, "_").replace(/-+/g, "_");
}

function normalizeLabel(value: string) {
  return value.trim();
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

export function defaultAttributeEventDefinitions(): AttributeEventDefinitions {
  return {
    version: 1,
    categories: [
      { categoryKey: "birth", categoryLabel: "Birth", description: "", sortOrder: 10, isEnabled: true },
      { categoryKey: "education", categoryLabel: "Education", description: "", sortOrder: 20, isEnabled: true },
      { categoryKey: "religious", categoryLabel: "Religious", description: "", sortOrder: 30, isEnabled: true },
      { categoryKey: "accomplishment", categoryLabel: "Accomplishment", description: "", sortOrder: 40, isEnabled: true },
      { categoryKey: "injury_health", categoryLabel: "Injury/Health", description: "", sortOrder: 50, isEnabled: true },
      { categoryKey: "life_event", categoryLabel: "Life Event", description: "", sortOrder: 60, isEnabled: true },
      { categoryKey: "moved", categoryLabel: "Moved", description: "", sortOrder: 70, isEnabled: true },
      { categoryKey: "employment", categoryLabel: "Employment", description: "", sortOrder: 80, isEnabled: true },
      { categoryKey: "family_relationship", categoryLabel: "Family/Relationship", description: "", sortOrder: 90, isEnabled: true },
      { categoryKey: "pet", categoryLabel: "Pet", description: "", sortOrder: 100, isEnabled: true },
      { categoryKey: "travel", categoryLabel: "Travel", description: "", sortOrder: 110, isEnabled: true },
      { categoryKey: "other", categoryLabel: "Other", description: "", sortOrder: 120, isEnabled: true },
    ],
    types: [
      { typeKey: "enrolled", categoryKey: "education", typeLabel: "Enrolled", detailLabel: "School Name", dateMode: "single", askEndDate: false, sortOrder: 10, isEnabled: true },
      { typeKey: "awarded", categoryKey: "education", typeLabel: "Awarded", detailLabel: "Award Name", dateMode: "single", askEndDate: false, sortOrder: 20, isEnabled: true },
      { typeKey: "exam_test", categoryKey: "education", typeLabel: "Exam/Test", detailLabel: "Score", dateMode: "single", askEndDate: false, sortOrder: 30, isEnabled: true },
      { typeKey: "grade", categoryKey: "education", typeLabel: "Grade", detailLabel: "Grade Detail", dateMode: "single", askEndDate: false, sortOrder: 40, isEnabled: true },
      { typeKey: "baptism", categoryKey: "religious", typeLabel: "Baptism", detailLabel: "Details", dateMode: "single", askEndDate: false, sortOrder: 10, isEnabled: true },
      { typeKey: "ordinance", categoryKey: "religious", typeLabel: "Ordinance", detailLabel: "Details", dateMode: "single", askEndDate: false, sortOrder: 20, isEnabled: true },
      { typeKey: "mission", categoryKey: "religious", typeLabel: "Mission", detailLabel: "Mission Name", dateMode: "range", askEndDate: true, sortOrder: 30, isEnabled: true },
      { typeKey: "calling", categoryKey: "religious", typeLabel: "Calling", detailLabel: "Calling Name", dateMode: "range", askEndDate: true, sortOrder: 40, isEnabled: true },
      { typeKey: "hired", categoryKey: "employment", typeLabel: "Hired", detailLabel: "Employer", dateMode: "single", askEndDate: false, sortOrder: 10, isEnabled: true },
      { typeKey: "departed", categoryKey: "employment", typeLabel: "Departed", detailLabel: "Employer", dateMode: "single", askEndDate: false, sortOrder: 20, isEnabled: true },
      { typeKey: "promotion", categoryKey: "employment", typeLabel: "Promotion", detailLabel: "Promotion Detail", dateMode: "single", askEndDate: false, sortOrder: 30, isEnabled: true },
      { typeKey: "awarded", categoryKey: "employment", typeLabel: "Awarded", detailLabel: "Award Name", dateMode: "single", askEndDate: false, sortOrder: 40, isEnabled: true },
      { typeKey: "married", categoryKey: "family_relationship", typeLabel: "Married", detailLabel: "Spouse Name", dateMode: "single", askEndDate: false, sortOrder: 10, isEnabled: true },
      { typeKey: "divorced", categoryKey: "family_relationship", typeLabel: "Divorced", detailLabel: "Details", dateMode: "single", askEndDate: false, sortOrder: 20, isEnabled: true },
      { typeKey: "adopted", categoryKey: "family_relationship", typeLabel: "Adopted", detailLabel: "Details", dateMode: "single", askEndDate: false, sortOrder: 30, isEnabled: true },
    ],
  };
}

function normalizeConfig(input: unknown): AttributeEventDefinitions {
  const fallback = defaultAttributeEventDefinitions();
  if (!input || typeof input !== "object") {
    return fallback;
  }
  const record = input as Record<string, unknown>;
  const categoriesInput = Array.isArray(record.categories) ? record.categories : [];
  const typesInput = Array.isArray(record.types) ? record.types : [];

  const categories = categoriesInput
    .map((raw, index) => {
      if (!raw || typeof raw !== "object") return null;
      const row = raw as Record<string, unknown>;
      const categoryKey = normalizeKey(String(row.categoryKey ?? ""));
      const categoryLabel = normalizeLabel(String(row.categoryLabel ?? ""));
      if (!categoryKey || !categoryLabel) return null;
      return {
        categoryKey,
        categoryLabel,
        description: normalizeLabel(String(row.description ?? "")),
        sortOrder: toInt(row.sortOrder, (index + 1) * 10),
        isEnabled: toBool(row.isEnabled, true),
      } satisfies AttributeEventCategoryDefinition;
    })
    .filter((row): row is AttributeEventCategoryDefinition => Boolean(row))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.categoryLabel.localeCompare(b.categoryLabel));

  const categorySet = new Set(categories.map((row) => row.categoryKey));
  const types = typesInput
    .map((raw, index) => {
      if (!raw || typeof raw !== "object") return null;
      const row = raw as Record<string, unknown>;
      const categoryKey = normalizeKey(String(row.categoryKey ?? ""));
      const typeKey = normalizeKey(String(row.typeKey ?? ""));
      const typeLabel = normalizeLabel(String(row.typeLabel ?? ""));
      if (!categorySet.has(categoryKey) || !typeKey || !typeLabel) return null;
      const mode = String(row.dateMode ?? "").trim().toLowerCase() === "range" ? "range" : "single";
      return {
        typeKey,
        categoryKey,
        typeLabel,
        detailLabel: normalizeLabel(String(row.detailLabel ?? "")) || "Attribute Detail",
        dateMode: mode,
        askEndDate: toBool(row.askEndDate, mode === "range"),
        sortOrder: toInt(row.sortOrder, (index + 1) * 10),
        isEnabled: toBool(row.isEnabled, true),
      } satisfies AttributeEventTypeDefinition;
    })
    .filter((row): row is AttributeEventTypeDefinition => Boolean(row))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.typeLabel.localeCompare(b.typeLabel));

  return {
    version: 1,
    categories: categories.length > 0 ? categories : fallback.categories,
    types: types.length > 0 ? types : fallback.types,
  };
}

async function ensureFamilyConfigShape(tenantKey: string) {
  if (isOciDataSource()) return;
  await ensureResolvedTabColumns([FAMILY_CONFIG_TAB, LEGACY_TENANT_CONFIG_TAB], FAMILY_CONFIG_HEADERS, tenantKey);
}

async function findFamilyConfigRow(tenantKey: string) {
  const normalizedTenantKey = normalizeTenantKey(tenantKey);
  const rows = await getTableRecords([FAMILY_CONFIG_TAB, LEGACY_TENANT_CONFIG_TAB], normalizedTenantKey).catch(() => []);
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
    await updateTableRecordById([FAMILY_CONFIG_TAB, LEGACY_TENANT_CONFIG_TAB], existing.data.family_group_key, payload, "family_group_key", normalizedTenantKey);
    return next;
  }
  const base = await getTenantConfig(normalizedTenantKey);
  await createTableRecord(
    FAMILY_CONFIG_TAB,
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
