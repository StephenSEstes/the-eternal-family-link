import "server-only";

import { google, sheets_v4 } from "googleapis";
import { getEnv } from "@/lib/env";
import { getServiceAccountAuth } from "@/lib/google/auth";
import { viewerPinHash } from "@/lib/security/pin";
import type {
  AppRole,
  ImportantDateRecord,
  PersonAttributeRecord,
  PersonRecord,
  PersonUpdateInput,
  TenantAccess,
  TenantConfig,
  UserAccessRecord,
} from "@/lib/google/types";
import { DEFAULT_TENANT_KEY, DEFAULT_TENANT_NAME } from "@/lib/tenant/context";

const USER_ACCESS_TAB = "UserAccess";
export const PEOPLE_TAB = "People";
const IMPORTANT_DATES_TAB = "ImportantDates";
export const PERSON_ATTRIBUTES_TAB = "PersonAttributes";
const TENANT_CONFIG_TAB = "TenantConfig";
const TENANT_TAB_DELIMITER = "__";
const TENANT_TABLE_HEADERS: Record<string, string[]> = {
  People: [
    "tenant_key",
    "person_id",
    "display_name",
    "birth_date",
    "phones",
    "address",
    "hobbies",
    "notes",
    "photo_file_id",
    "is_pinned",
    "relationships",
  ],
  Relationships: ["tenant_key", "rel_id", "from_person_id", "to_person_id", "rel_type"],
  FamilyUnits: ["tenant_key", "family_unit_id", "partner1_person_id", "partner2_person_id"],
  ImportantDates: ["tenant_key", "id", "date", "title", "description", "person_id"],
  PersonAttributes: [
    "tenant_key",
    "attribute_id",
    "person_id",
    "attribute_type",
    "value_text",
    "value_json",
    "label",
    "is_primary",
    "sort_order",
    "start_date",
    "end_date",
    "visibility",
    "notes",
  ],
  LocalUsers: [
    "tenant_key",
    "username",
    "password_hash",
    "role",
    "person_id",
    "is_enabled",
    "failed_attempts",
    "locked_until",
    "must_change_password",
  ],
  TenantSecurityPolicy: [
    "tenant_key",
    "id",
    "min_length",
    "require_number",
    "require_uppercase",
    "require_lowercase",
    "lockout_attempts",
  ],
};

export type SheetMatrix = {
  headers: string[];
  rows: string[][];
};

export type SheetRecord = {
  rowNumber: number;
  data: Record<string, string>;
};

export type UpsertTenantAccessInput = {
  userEmail: string;
  tenantKey: string;
  tenantName: string;
  role: AppRole;
  personId: string;
  isEnabled: boolean;
};

export type UpsertTenantAccessResult = {
  action: "created" | "updated";
  rowNumber: number;
};

function normalizeHeader(header: string) {
  return header.trim().toLowerCase();
}

function parseBool(value: string | undefined) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

function toRole(value: string | undefined): AppRole {
  return value?.trim().toUpperCase() === "ADMIN" ? "ADMIN" : "USER";
}

function toList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[,;|]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildHeaderIndex(headers: string[]) {
  const map = new Map<string, number>();
  headers.forEach((header, index) => {
    map.set(normalizeHeader(header), index);
  });
  return map;
}

function toRecord(headers: string[], row: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((header, idx) => {
    out[header] = row[idx] ?? "";
  });
  return out;
}

function headerKeyMap(headers: string[]) {
  const map = new Map<string, string>();
  headers.forEach((header) => map.set(normalizeHeader(header), header));
  return map;
}

function getCell(row: string[], indexMap: Map<string, number>, key: string) {
  const idx = indexMap.get(normalizeHeader(key));
  if (idx === undefined) {
    return "";
  }
  return row[idx] ?? "";
}

function setCell(row: string[], indexMap: Map<string, number>, key: string, value: string) {
  const idx = indexMap.get(normalizeHeader(key));
  if (idx === undefined) {
    return;
  }
  row[idx] = value;
}

function toSheetBool(value: boolean) {
  return value ? "TRUE" : "FALSE";
}

function normalizeTenantKey(tenantKey?: string) {
  const raw = (tenantKey ?? DEFAULT_TENANT_KEY).trim().toLowerCase();
  const clean = raw.replace(/[^a-z0-9_-]/g, "");
  return clean || DEFAULT_TENANT_KEY;
}

function buildTenantTabCandidates(tabName: string, tenantKey?: string) {
  const cleanKey = normalizeTenantKey(tenantKey);
  if (cleanKey === DEFAULT_TENANT_KEY) {
    return [tabName];
  }

  return [`${cleanKey}${TENANT_TAB_DELIMITER}${tabName}`, tabName];
}

function buildTenantScopedTabName(tabName: string, tenantKey?: string) {
  const cleanKey = normalizeTenantKey(tenantKey);
  if (cleanKey === DEFAULT_TENANT_KEY) {
    return tabName;
  }
  return `${cleanKey}${TENANT_TAB_DELIMITER}${tabName}`;
}

function defaultTenantConfig(tenantKey?: string): TenantConfig {
  const env = getEnv();
  const normalizedKey = normalizeTenantKey(tenantKey);
  return {
    tenantKey: normalizedKey,
    tenantName: normalizedKey === DEFAULT_TENANT_KEY ? DEFAULT_TENANT_NAME : normalizedKey,
    viewerPinHash: viewerPinHash(env.VIEWER_PIN),
    photosFolderId: env.PHOTOS_FOLDER_ID,
  };
}

function normalizeDate(value: string) {
  const raw = value.trim();
  if (!raw) {
    return "";
  }

  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (iso.test(raw)) {
    return raw;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }

  return parsed.toISOString().slice(0, 10);
}

function parseNumber(value: string | undefined) {
  if (!value) {
    return 0;
  }
  const out = Number.parseInt(value, 10);
  return Number.isFinite(out) ? out : 0;
}

export async function createSheetsClient(): Promise<sheets_v4.Sheets> {
  const auth = getServiceAccountAuth();
  return google.sheets({ version: "v4", auth });
}

async function withAbortTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("google-timeout"), timeoutMs);

  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupTab(
  sheets: sheets_v4.Sheets,
  tabName: string,
  timeoutMs = 3000,
): Promise<boolean> {
  const env = getEnv();
  const result = await withAbortTimeout(timeoutMs, (signal) =>
    sheets.spreadsheets.get(
      {
        spreadsheetId: env.SHEET_ID,
        fields: "sheets.properties.title",
      },
      { signal },
    ),
  );

  const tabs =
    result.data.sheets
      ?.map((sheet) => sheet.properties?.title?.trim().toLowerCase())
      .filter((title): title is string => Boolean(title)) ?? [];

  return tabs.includes(tabName.trim().toLowerCase());
}

export async function listTabs(timeoutMs = 3000): Promise<string[]> {
  const env = getEnv();
  const sheets = await createSheetsClient();
  const result = await withAbortTimeout(timeoutMs, (signal) =>
    sheets.spreadsheets.get(
      {
        spreadsheetId: env.SHEET_ID,
        fields: "sheets.properties.title",
      },
      { signal },
    ),
  );

  return (
    result.data.sheets
      ?.map((sheet) => sheet.properties?.title ?? "")
      .map((title) => title.trim())
      .filter(Boolean) ?? []
  );
}

async function ensureTabWithHeaders(sheets: sheets_v4.Sheets, tabName: string, headers: string[]) {
  const env = getEnv();
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: env.SHEET_ID,
    fields: "sheets.properties.title",
  });
  const existing =
    metadata.data.sheets
      ?.map((sheet) => sheet.properties?.title ?? "")
      .map((title) => title.trim().toLowerCase())
      .filter(Boolean) ?? [];

  if (!existing.includes(tabName.trim().toLowerCase())) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: env.SHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tabName } } }],
      },
    });
  }

  const matrix = await readTabWithClient(sheets, tabName);
  if (matrix.headers.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: env.SHEET_ID,
      range: `${tabName}!A1:ZZ1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [headers],
      },
    });
  }
}

export async function ensureTenantScaffold(input: {
  tenantKey: string;
  tenantName: string;
  photosFolderId: string;
}) {
  const normalizedTenantKey = normalizeTenantKey(input.tenantKey);
  const sheets = await createSheetsClient();
  for (const [tab, headers] of Object.entries(TENANT_TABLE_HEADERS)) {
    const scopedTab = buildTenantScopedTabName(tab, normalizedTenantKey);
    await ensureTabWithHeaders(sheets, scopedTab, headers);
  }

  const configPayload: Record<string, string> = {
    tenant_key: normalizedTenantKey,
    tenant_name: input.tenantName.trim() || normalizedTenantKey,
    viewer_pin_hash: viewerPinHash(getEnv().VIEWER_PIN),
    photos_folder_id: input.photosFolderId,
  };

  const updated = await updateTableRecordById(TENANT_CONFIG_TAB, normalizedTenantKey, configPayload, "tenant_key");
  if (!updated) {
    await createTableRecord(TENANT_CONFIG_TAB, configPayload);
  }
}

async function resolveTenantTabNameWithClient(
  sheets: sheets_v4.Sheets,
  tabName: string,
  tenantKey?: string,
  timeoutMs = 3500,
): Promise<string | null> {
  const env = getEnv();
  const result = await withAbortTimeout(timeoutMs, (signal) =>
    sheets.spreadsheets.get(
      {
        spreadsheetId: env.SHEET_ID,
        fields: "sheets.properties.title",
      },
      { signal },
    ),
  );

  const tabs =
    result.data.sheets
      ?.map((sheet) => sheet.properties?.title ?? "")
      .map((title) => title.trim())
      .filter(Boolean) ?? [];
  const index = new Map(tabs.map((tab) => [tab.trim().toLowerCase(), tab]));
  const candidates = buildTenantTabCandidates(tabName, tenantKey);

  for (const candidate of candidates) {
    const match = index.get(candidate.trim().toLowerCase());
    if (match) {
      return match;
    }
  }

  return null;
}

async function resolveTenantTabName(tabName: string, tenantKey?: string): Promise<string> {
  const sheets = await createSheetsClient();
  const resolved = await resolveTenantTabNameWithClient(sheets, tabName, tenantKey);
  if (!resolved) {
    throw new Error(`Tab '${tabName}' not found for tenant '${normalizeTenantKey(tenantKey)}'.`);
  }
  return resolved;
}

export async function readTabWithClient(
  sheets: sheets_v4.Sheets,
  tabName: string,
  timeoutMs = 5000,
): Promise<SheetMatrix> {
  const env = getEnv();
  const result = await withAbortTimeout(timeoutMs, (signal) =>
    sheets.spreadsheets.values.get(
      {
        spreadsheetId: env.SHEET_ID,
        range: `${tabName}!A1:ZZ`,
      },
      { signal },
    ),
  );

  const matrix = (result.data.values ?? []) as string[][];
  if (matrix.length === 0) {
    return { headers: [], rows: [] };
  }

  const [headers, ...rows] = matrix;
  return { headers, rows };
}

function resolveIdColumn(headers: string[], idColumn?: string): string | null {
  const exactMap = headerKeyMap(headers);
  if (idColumn) {
    return exactMap.get(normalizeHeader(idColumn)) ?? null;
  }

  const fallbacks = ["id", "person_id", "record_id", "user_email"];
  for (const fallback of fallbacks) {
    const match = exactMap.get(fallback);
    if (match) {
      return match;
    }
  }

  return null;
}

export function matrixToRecords(matrix: SheetMatrix): SheetRecord[] {
  return matrix.rows.map((row, idx) => ({
    rowNumber: idx + 2,
    data: toRecord(matrix.headers, row),
  }));
}

export async function getTableRecords(tabName: string, tenantKey?: string): Promise<SheetRecord[]> {
  const resolvedTab = await resolveTenantTabName(tabName, tenantKey);
  const matrix = await readTab(resolvedTab);
  return matrixToRecords(matrix);
}

export async function getTableRecordById(
  tabName: string,
  recordId: string,
  idColumn?: string,
  tenantKey?: string,
): Promise<SheetRecord | null> {
  const resolvedTab = await resolveTenantTabName(tabName, tenantKey);
  const matrix = await readTab(resolvedTab);
  if (matrix.headers.length === 0) {
    return null;
  }

  const effectiveIdColumn = resolveIdColumn(matrix.headers, idColumn);
  if (!effectiveIdColumn) {
    throw new Error("No id column found. Provide idColumn query parameter.");
  }

  const records = matrixToRecords(matrix);
  return records.find((record) => (record.data[effectiveIdColumn] ?? "") === recordId) ?? null;
}

export async function createTableRecord(
  tabName: string,
  payload: Record<string, string>,
  tenantKey?: string,
): Promise<SheetRecord> {
  const resolvedTab = await resolveTenantTabName(tabName, tenantKey);
  const matrix = await readTab(resolvedTab);
  if (matrix.headers.length === 0) {
    throw new Error("Tab has no header row.");
  }

  const canonicalHeaders = headerKeyMap(matrix.headers);
  const normalizedPayload: Record<string, string> = {};

  Object.entries(payload).forEach(([key, value]) => {
    const canonical = canonicalHeaders.get(normalizeHeader(key));
    if (canonical) {
      normalizedPayload[canonical] = value;
    }
  });

  const row = matrix.headers.map((header) => normalizedPayload[header] ?? "");
  const sheets = await createSheetsClient();
  const env = getEnv();
  await sheets.spreadsheets.values.append({
    spreadsheetId: env.SHEET_ID,
    range: `${resolvedTab}!A:ZZ`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });

  const refreshed = await readTab(resolvedTab);
  const createdData = toRecord(refreshed.headers, row);
  return {
    rowNumber: refreshed.rows.length + 1,
    data: createdData,
  };
}

export async function updateTableRecordById(
  tabName: string,
  recordId: string,
  payload: Record<string, string>,
  idColumn?: string,
  tenantKey?: string,
): Promise<SheetRecord | null> {
  const resolvedTab = await resolveTenantTabName(tabName, tenantKey);
  const matrix = await readTab(resolvedTab);
  if (matrix.headers.length === 0) {
    return null;
  }

  const effectiveIdColumn = resolveIdColumn(matrix.headers, idColumn);
  if (!effectiveIdColumn) {
    throw new Error("No id column found. Provide idColumn query parameter.");
  }

  const idIndex = matrix.headers.findIndex((header) => normalizeHeader(header) === normalizeHeader(effectiveIdColumn));
  const rowIndex = matrix.rows.findIndex((row) => (row[idIndex] ?? "") === recordId);
  if (rowIndex < 0) {
    return null;
  }

  const canonicalHeaders = headerKeyMap(matrix.headers);
  const existing = Array.from({ length: matrix.headers.length }, (_, i) => matrix.rows[rowIndex][i] ?? "");
  Object.entries(payload).forEach(([key, value]) => {
    const canonical = canonicalHeaders.get(normalizeHeader(key));
    if (!canonical) {
      return;
    }
    const idx = matrix.headers.findIndex((header) => header === canonical);
    if (idx >= 0) {
      existing[idx] = value;
    }
  });

  const sheets = await createSheetsClient();
  const env = getEnv();
  const rowNumber = rowIndex + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: env.SHEET_ID,
    range: `${resolvedTab}!A${rowNumber}:ZZ${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [existing] },
  });

  return {
    rowNumber,
    data: toRecord(matrix.headers, existing),
  };
}

export async function deleteTableRecordById(
  tabName: string,
  recordId: string,
  idColumn?: string,
  tenantKey?: string,
): Promise<boolean> {
  const resolvedTab = await resolveTenantTabName(tabName, tenantKey);
  const matrix = await readTab(resolvedTab);
  if (matrix.headers.length === 0) {
    return false;
  }

  const effectiveIdColumn = resolveIdColumn(matrix.headers, idColumn);
  if (!effectiveIdColumn) {
    throw new Error("No id column found. Provide idColumn query parameter.");
  }

  const idIndex = matrix.headers.findIndex((header) => normalizeHeader(header) === normalizeHeader(effectiveIdColumn));
  const rowIndex = matrix.rows.findIndex((row) => (row[idIndex] ?? "") === recordId);
  if (rowIndex < 0) {
    return false;
  }

  const env = getEnv();
  const sheets = await createSheetsClient();
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: env.SHEET_ID,
    fields: "sheets.properties.sheetId,sheets.properties.title",
  });
  const sheet = metadata.data.sheets?.find(
    (item) => item.properties?.title?.trim().toLowerCase() === resolvedTab.trim().toLowerCase(),
  );
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId === undefined) {
    throw new Error("Sheet not found.");
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: env.SHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowIndex + 1,
              endIndex: rowIndex + 2,
            },
          },
        },
      ],
    },
  });

  return true;
}

async function readTab(tabName: string): Promise<SheetMatrix> {
  const sheets = await createSheetsClient();
  return readTabWithClient(sheets, tabName);
}

function rowToPerson(headers: string[], row: string[]): PersonRecord {
  const idx = buildHeaderIndex(headers);
  return {
    personId: getCell(row, idx, "person_id"),
    displayName: getCell(row, idx, "display_name"),
    birthDate: getCell(row, idx, "birth_date"),
    phones: getCell(row, idx, "phones"),
    address: getCell(row, idx, "address"),
    hobbies: getCell(row, idx, "hobbies"),
    notes: getCell(row, idx, "notes"),
    photoFileId: getCell(row, idx, "photo_file_id") || getCell(row, idx, "primary_photo_file_id"),
    isPinned:
      parseBool(getCell(row, idx, "is_pinned")) || parseBool(getCell(row, idx, "is_pinned_viewer")),
    relationships: toList(getCell(row, idx, "relationships")),
  };
}

function rowToPersonAttribute(headers: string[], row: string[], fallbackTenantKey: string): PersonAttributeRecord | null {
  const idx = buildHeaderIndex(headers);
  const attributeId = getCell(row, idx, "attribute_id").trim();
  const personId = getCell(row, idx, "person_id").trim();
  const attributeType = getCell(row, idx, "attribute_type").trim().toLowerCase();
  const valueText = getCell(row, idx, "value_text").trim();

  if (!attributeId || !personId || !attributeType || !valueText) {
    return null;
  }

  return {
    attributeId,
    tenantKey: getCell(row, idx, "tenant_key").trim().toLowerCase() || fallbackTenantKey,
    personId,
    attributeType,
    valueText,
    valueJson: getCell(row, idx, "value_json").trim(),
    label: getCell(row, idx, "label").trim(),
    isPrimary: parseBool(getCell(row, idx, "is_primary")),
    sortOrder: parseNumber(getCell(row, idx, "sort_order")),
    startDate: normalizeDate(getCell(row, idx, "start_date")),
    endDate: normalizeDate(getCell(row, idx, "end_date")),
    visibility: getCell(row, idx, "visibility").trim().toLowerCase() || "family",
    notes: getCell(row, idx, "notes").trim(),
  };
}

export function peopleFromMatrix(matrix: SheetMatrix): PersonRecord[] {
  if (matrix.headers.length === 0) {
    return [];
  }

  return matrix.rows
    .map((row) => rowToPerson(matrix.headers, row))
    .filter((person) => person.personId)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function personAttributesFromMatrix(matrix: SheetMatrix, tenantKey?: string): PersonAttributeRecord[] {
  if (matrix.headers.length === 0) {
    return [];
  }

  const normalizedTenantKey = normalizeTenantKey(tenantKey);
  const idx = buildHeaderIndex(matrix.headers);
  const hasTenantColumn = idx.has("tenant_key");

  return matrix.rows
    .map((row) => {
      if (hasTenantColumn) {
        const rowTenant = getCell(row, idx, "tenant_key").trim().toLowerCase();
        if (rowTenant && rowTenant !== normalizedTenantKey) {
          return null;
        }
      }
      return rowToPersonAttribute(matrix.headers, row, normalizedTenantKey);
    })
    .filter((item): item is PersonAttributeRecord => Boolean(item))
    .sort((a, b) => {
      const typeCompare = a.attributeType.localeCompare(b.attributeType);
      if (typeCompare !== 0) {
        return typeCompare;
      }
      const orderCompare = a.sortOrder - b.sortOrder;
      if (orderCompare !== 0) {
        return orderCompare;
      }
      const primaryCompare = Number(b.isPrimary) - Number(a.isPrimary);
      if (primaryCompare !== 0) {
        return primaryCompare;
      }
      return a.valueText.localeCompare(b.valueText);
    });
}

export async function getEnabledUserAccess(email: string): Promise<UserAccessRecord | null> {
  const entries = await getEnabledUserAccessList(email);
  if (entries.length === 0) {
    return null;
  }

  const primary = entries[0];
  return {
    userEmail: email.trim().toLowerCase(),
    isEnabled: true,
    role: primary.role,
    personId: primary.personId,
    tenantKey: primary.tenantKey,
    tenantName: primary.tenantName,
  };
}

export async function getEnabledUserAccessList(email: string): Promise<TenantAccess[]> {
  const { headers, rows } = await readTab(USER_ACCESS_TAB);
  if (headers.length === 0) {
    return [];
  }

  const idx = buildHeaderIndex(headers);
  const target = email.trim().toLowerCase();
  const tenantMap = new Map<string, TenantAccess>();

  for (const row of rows) {
    const userEmail = getCell(row, idx, "user_email").trim().toLowerCase();
    const isEnabled = parseBool(getCell(row, idx, "is_enabled"));

    if (userEmail === target && isEnabled) {
      const tenantKey = getCell(row, idx, "tenant_key").trim() || DEFAULT_TENANT_KEY;
      const tenantName = getCell(row, idx, "tenant_name").trim() || DEFAULT_TENANT_NAME;
      tenantMap.set(tenantKey, {
        tenantKey,
        tenantName,
        role: toRole(getCell(row, idx, "role")),
        personId: getCell(row, idx, "person_id"),
      });
    }
  }

  return Array.from(tenantMap.values()).sort((a, b) => a.tenantName.localeCompare(b.tenantName));
}

export async function getTenantUserAccessList(tenantKey: string): Promise<UserAccessRecord[]> {
  const { headers, rows } = await readTab(USER_ACCESS_TAB);
  if (headers.length === 0) {
    return [];
  }

  const idx = buildHeaderIndex(headers);
  const normalizedTenantKey = normalizeTenantKey(tenantKey);

  return rows
    .map((row) => {
      const userEmail = getCell(row, idx, "user_email").trim().toLowerCase();
      if (!userEmail) {
        return null;
      }

      const rowTenantKey = getCell(row, idx, "tenant_key").trim().toLowerCase() || DEFAULT_TENANT_KEY;
      if (rowTenantKey !== normalizedTenantKey) {
        return null;
      }

      return {
        userEmail,
        isEnabled: parseBool(getCell(row, idx, "is_enabled")),
        role: toRole(getCell(row, idx, "role")),
        personId: getCell(row, idx, "person_id"),
        tenantKey: rowTenantKey,
        tenantName: getCell(row, idx, "tenant_name").trim() || DEFAULT_TENANT_NAME,
      } satisfies UserAccessRecord;
    })
    .filter((row): row is UserAccessRecord => Boolean(row))
    .sort((a, b) => a.userEmail.localeCompare(b.userEmail));
}

export async function upsertTenantAccess(input: UpsertTenantAccessInput): Promise<UpsertTenantAccessResult> {
  const matrix = await readTab(USER_ACCESS_TAB);
  if (matrix.headers.length === 0) {
    throw new Error("UserAccess tab has no header row.");
  }

  const idx = buildHeaderIndex(matrix.headers);
  if (!idx.has("user_email")) {
    throw new Error("UserAccess tab missing required 'user_email' column.");
  }

  const normalizedEmail = input.userEmail.trim().toLowerCase();
  const normalizedTenantKey = input.tenantKey.trim().toLowerCase() || DEFAULT_TENANT_KEY;
  const tenantKeyColumnExists = idx.has("tenant_key");

  const rowIndex = matrix.rows.findIndex((row) => {
    const rowEmail = getCell(row, idx, "user_email").trim().toLowerCase();
    if (rowEmail !== normalizedEmail) {
      return false;
    }

    if (!tenantKeyColumnExists) {
      return true;
    }

    const rowTenantKey = getCell(row, idx, "tenant_key").trim().toLowerCase() || DEFAULT_TENANT_KEY;
    return rowTenantKey === normalizedTenantKey;
  });

  const values = {
    user_email: normalizedEmail,
    is_enabled: toSheetBool(input.isEnabled),
    role: input.role,
    person_id: input.personId,
    tenant_key: normalizedTenantKey,
    tenant_name: input.tenantName.trim() || DEFAULT_TENANT_NAME,
  };

  const sheets = await createSheetsClient();
  const env = getEnv();

  if (rowIndex >= 0) {
    const mutableRow = Array.from({ length: matrix.headers.length }, (_, i) => matrix.rows[rowIndex][i] ?? "");
    setCell(mutableRow, idx, "user_email", values.user_email);
    setCell(mutableRow, idx, "is_enabled", values.is_enabled);
    setCell(mutableRow, idx, "role", values.role);
    setCell(mutableRow, idx, "person_id", values.person_id);
    setCell(mutableRow, idx, "tenant_key", values.tenant_key);
    setCell(mutableRow, idx, "tenant_name", values.tenant_name);

    const rowNumber = rowIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: env.SHEET_ID,
      range: `${USER_ACCESS_TAB}!A${rowNumber}:ZZ${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [mutableRow] },
    });

    return { action: "updated", rowNumber };
  }

  const newRow = matrix.headers.map((header) => {
    const key = normalizeHeader(header);
    if (key === "user_email") return values.user_email;
    if (key === "is_enabled") return values.is_enabled;
    if (key === "role") return values.role;
    if (key === "person_id") return values.person_id;
    if (key === "tenant_key") return values.tenant_key;
    if (key === "tenant_name") return values.tenant_name;
    return "";
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: env.SHEET_ID,
    range: `${USER_ACCESS_TAB}!A:ZZ`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [newRow] },
  });

  return { action: "created", rowNumber: matrix.rows.length + 2 };
}

export async function getPeople(tenantKey?: string): Promise<PersonRecord[]> {
  const tabName = await resolveTenantTabName(PEOPLE_TAB, tenantKey);
  const matrix = await readTab(tabName);
  const people = peopleFromMatrix(matrix);
  if (matrix.headers.length === 0) {
    return people;
  }

  const idx = buildHeaderIndex(matrix.headers);
  const hasTenantColumn = idx.has("tenant_key");
  if (!hasTenantColumn) {
    return people;
  }

  const targetTenant = normalizeTenantKey(tenantKey);
  return matrix.rows
    .filter((row) => {
      const rowTenant = getCell(row, idx, "tenant_key").trim().toLowerCase();
      return rowTenant === targetTenant;
    })
    .map((row) => rowToPerson(matrix.headers, row))
    .filter((person) => person.personId)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function getTenantConfig(tenantKey?: string): Promise<TenantConfig> {
  const normalizedTenantKey = normalizeTenantKey(tenantKey);
  let matrix: SheetMatrix | null = null;

  try {
    const tabName = await resolveTenantTabName(TENANT_CONFIG_TAB, normalizedTenantKey);
    matrix = await readTab(tabName);
  } catch {
    try {
      matrix = await readTab(TENANT_CONFIG_TAB);
    } catch {
      return defaultTenantConfig(normalizedTenantKey);
    }
  }

  if (!matrix || matrix.headers.length === 0) {
    return defaultTenantConfig(normalizedTenantKey);
  }

  const idx = buildHeaderIndex(matrix.headers);
  const row =
    matrix.rows.find((candidate) => {
      const rowTenantKey = getCell(candidate, idx, "tenant_key").trim().toLowerCase();
      return rowTenantKey === normalizedTenantKey;
    }) ??
    matrix.rows.find((candidate) => {
      const rowTenantKey = getCell(candidate, idx, "tenant_key").trim().toLowerCase();
      return !rowTenantKey && normalizedTenantKey === DEFAULT_TENANT_KEY;
    }) ??
    matrix.rows[0];

  const fallback = defaultTenantConfig(normalizedTenantKey);
  const tenantName = getCell(row, idx, "tenant_name").trim() || fallback.tenantName;
  const viewerPin = getCell(row, idx, "viewer_pin_hash").trim() || fallback.viewerPinHash;
  const photosFolderId = getCell(row, idx, "photos_folder_id").trim() || fallback.photosFolderId;

  return {
    tenantKey: normalizedTenantKey,
    tenantName,
    viewerPinHash: viewerPin,
    photosFolderId,
  };
}

export async function getImportantDates(tenantKey?: string): Promise<ImportantDateRecord[]> {
  const normalizedTenantKey = normalizeTenantKey(tenantKey);
  let matrix: SheetMatrix;

  try {
    const tabName = await resolveTenantTabName(IMPORTANT_DATES_TAB, normalizedTenantKey);
    matrix = await readTab(tabName);
  } catch {
    return [];
  }

  if (matrix.headers.length === 0) {
    return [];
  }

  const idx = buildHeaderIndex(matrix.headers);
  const hasTenantColumn = idx.has("tenant_key");

  const items = matrix.rows
    .map((row, i) => {
      const tenantFilter = getCell(row, idx, "tenant_key").trim().toLowerCase();
      if (hasTenantColumn && tenantFilter && tenantFilter !== normalizedTenantKey) {
        return null;
      }

      const title = getCell(row, idx, "title").trim() || getCell(row, idx, "event_title").trim();
      const rawDate =
        getCell(row, idx, "date").trim() ||
        getCell(row, idx, "event_date").trim() ||
        getCell(row, idx, "important_date").trim();
      const personId = getCell(row, idx, "person_id").trim();
      const description = getCell(row, idx, "description").trim() || getCell(row, idx, "notes").trim();
      const id = getCell(row, idx, "id").trim() || `${normalizedTenantKey}-${i + 2}`;

      if (!title || !rawDate) {
        return null;
      }

      return {
        id,
        title,
        date: normalizeDate(rawDate),
        description,
        personId,
      } satisfies ImportantDateRecord;
    })
    .filter((item): item is ImportantDateRecord => Boolean(item));

  return items.sort((a, b) => a.date.localeCompare(b.date));
}

export async function getPersonAttributes(
  tenantKey?: string,
  personId?: string,
): Promise<PersonAttributeRecord[]> {
  const normalizedTenantKey = normalizeTenantKey(tenantKey);
  let matrix: SheetMatrix;

  try {
    const tabName = await resolveTenantTabName(PERSON_ATTRIBUTES_TAB, normalizedTenantKey);
    matrix = await readTab(tabName);
  } catch {
    return [];
  }

  const attributes = personAttributesFromMatrix(matrix, normalizedTenantKey);
  if (!personId) {
    return attributes;
  }
  return attributes.filter((item) => item.personId === personId);
}

export async function getPrimaryPhotoFileIdFromAttributes(
  personId: string,
  tenantKey?: string,
): Promise<string | null> {
  const attributes = await getPersonAttributes(tenantKey, personId);
  const photos = attributes.filter((item) => item.attributeType === "photo" && item.valueText);
  if (photos.length === 0) {
    return null;
  }

  const primary = photos.find((item) => item.isPrimary);
  return (primary ?? photos[0]).valueText;
}

export async function getPersonById(personId: string, tenantKey?: string): Promise<PersonRecord | null> {
  const people = await getPeople(tenantKey);
  return people.find((person) => person.personId === personId) ?? null;
}

export async function updatePerson(
  personId: string,
  updates: PersonUpdateInput,
  tenantKey?: string,
): Promise<PersonRecord | null> {
  const tabName = await resolveTenantTabName(PEOPLE_TAB, tenantKey);
  const { headers, rows } = await readTab(tabName);
  if (headers.length === 0) {
    return null;
  }

  const idx = buildHeaderIndex(headers);
  const targetTenant = normalizeTenantKey(tenantKey);
  const hasTenantColumn = idx.has("tenant_key");
  const rowIndex = rows.findIndex((row) => {
    if (getCell(row, idx, "person_id") !== personId) {
      return false;
    }
    if (!hasTenantColumn) {
      return true;
    }
    return getCell(row, idx, "tenant_key").trim().toLowerCase() === targetTenant;
  });

  if (rowIndex < 0) {
    return null;
  }

  const mutableRow = Array.from({ length: headers.length }, (_, i) => rows[rowIndex][i] ?? "");
  setCell(mutableRow, idx, "display_name", updates.display_name);
  setCell(mutableRow, idx, "birth_date", updates.birth_date);
  setCell(mutableRow, idx, "phones", updates.phones);
  setCell(mutableRow, idx, "address", updates.address);
  setCell(mutableRow, idx, "hobbies", updates.hobbies);
  setCell(mutableRow, idx, "notes", updates.notes);

  const sheets = await createSheetsClient();
  const env = getEnv();
  const sheetRowNumber = rowIndex + 2;

  await sheets.spreadsheets.values.update({
    spreadsheetId: env.SHEET_ID,
    range: `${tabName}!A${sheetRowNumber}:ZZ${sheetRowNumber}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [mutableRow],
    },
  });

  return rowToPerson(headers, mutableRow);
}
