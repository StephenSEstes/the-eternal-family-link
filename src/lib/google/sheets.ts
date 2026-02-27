import "server-only";

import { google, sheets_v4 } from "googleapis";
import { getEnv } from "@/lib/env";
import { getServiceAccountAuth } from "@/lib/google/auth";
import { viewerPinHash } from "@/lib/security/pin";
import type {
  AppRole,
  ImportantDateRecord,
  LocalUserRecord,
  PersonAttributeRecord,
  PersonRecord,
  PersonUpdateInput,
  TenantAccess,
  TenantConfig,
  UserAccessRecord,
} from "@/lib/google/types";
import { DEFAULT_TENANT_KEY, DEFAULT_TENANT_NAME } from "@/lib/family-group/context";

const USER_ACCESS_TAB = "UserAccess";
const USER_FAMILY_GROUPS_TAB = "UserFamilyGroups";
const PERSON_FAMILY_GROUPS_TAB = "PersonFamilyGroups";
const PERSON_FAMILY_GROUPS_HEADERS = ["person_id", "family_group_key", "is_enabled"];
const USER_FAMILY_GROUPS_HEADERS = [
  "user_email",
  "family_group_key",
  "family_group_name",
  "role",
  "person_id",
  "is_enabled",
];
const USER_ACCESS_HEADERS = [
  "person_id",
  "role",
  "user_email",
  "username",
  "google_access",
  "local_access",
  "is_enabled",
  "password_hash",
  "failed_attempts",
  "locked_until",
  "must_change_password",
];
export const PEOPLE_TAB = "People";
const IMPORTANT_DATES_TAB = "ImportantDates";
export const PERSON_ATTRIBUTES_TAB = "PersonAttributes";
const FAMILY_CONFIG_TAB = "FamilyConfig";
const LEGACY_TENANT_CONFIG_TAB = "TenantConfig";
const FAMILY_SECURITY_POLICY_TAB = "FamilySecurityPolicy";
const TENANT_TAB_DELIMITER = "__";
const GLOBAL_SHARED_TABS = new Set<string>([
  USER_ACCESS_TAB.toLowerCase(),
  USER_FAMILY_GROUPS_TAB.toLowerCase(),
  PERSON_FAMILY_GROUPS_TAB.toLowerCase(),
  PEOPLE_TAB.toLowerCase(),
  IMPORTANT_DATES_TAB.toLowerCase(),
  PERSON_ATTRIBUTES_TAB.toLowerCase(),
]);
const TENANT_TABLE_HEADERS: Record<string, string[]> = {
  People: [
    "person_id",
    "display_name",
    "first_name",
    "middle_name",
    "last_name",
    "nick_name",
    "birth_date",
    "gender",
    "phones",
    "address",
    "hobbies",
    "notes",
    "photo_file_id",
    "is_pinned",
    "relationships",
  ],
  Relationships: ["family_group_key", "rel_id", "from_person_id", "to_person_id", "rel_type"],
  Households: ["family_group_key", "household_id", "husband_person_id", "wife_person_id"],
  ImportantDates: ["id", "date", "title", "description", "person_id", "share_scope", "share_family_group_key"],
  PersonAttributes: [
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
    "share_scope",
    "share_family_group_key",
    "notes",
  ],
  [FAMILY_SECURITY_POLICY_TAB]: [
    "family_group_key",
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
  const normalized = header.trim().toLowerCase();
  if (normalized === "tenant_key") {
    return "family_group_key";
  }
  if (normalized === "tenant_name") {
    return "family_group_name";
  }
  return normalized;
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
  if (raw === "default") {
    return DEFAULT_TENANT_KEY;
  }
  const clean = raw.replace(/[^a-z0-9_-]/g, "");
  return clean || DEFAULT_TENANT_KEY;
}

function buildTenantTabCandidates(tabName: string, tenantKey?: string) {
  const cleanKey = normalizeTenantKey(tenantKey);
  if (GLOBAL_SHARED_TABS.has(tabName.trim().toLowerCase())) {
    return [tabName];
  }
  if (cleanKey === DEFAULT_TENANT_KEY) {
    return [tabName];
  }

  return [`${cleanKey}${TENANT_TAB_DELIMITER}${tabName}`, tabName];
}

function buildMultiTenantTabCandidates(tabNames: string | string[], tenantKey?: string) {
  const names = Array.isArray(tabNames) ? tabNames : [tabNames];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    for (const candidate of buildTenantTabCandidates(name, tenantKey)) {
      const normalized = candidate.trim().toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        out.push(candidate);
      }
    }
  }
  return out;
}

function buildTenantScopedTabName(tabName: string, tenantKey?: string) {
  if (GLOBAL_SHARED_TABS.has(tabName.trim().toLowerCase())) {
    return tabName;
  }
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

async function ensureResolvedTabColumns(
  tabName: string | string[],
  requiredHeaders: string[],
  tenantKey?: string,
) {
  const sheets = await createSheetsClient();
  const resolved = await resolveTenantTabNameWithClient(sheets, tabName, tenantKey);
  if (!resolved) {
    return;
  }
  const matrix = await readTabWithClient(sheets, resolved);
  if (matrix.headers.length === 0) {
    await ensureTabWithHeaders(sheets, resolved, requiredHeaders);
    return;
  }
  const existing = new Set(matrix.headers.map((header) => normalizeHeader(header)));
  const missing = requiredHeaders.filter((header) => !existing.has(normalizeHeader(header)));
  if (missing.length === 0) {
    return;
  }
  const env = getEnv();
  const nextHeaders = [...matrix.headers, ...missing];
  await sheets.spreadsheets.values.update({
    spreadsheetId: env.SHEET_ID,
    range: `${resolved}!A1:ZZ1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [nextHeaders],
    },
  });
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
    family_group_key: normalizedTenantKey,
    family_group_name: input.tenantName.trim() || normalizedTenantKey,
    viewer_pin_hash: viewerPinHash(getEnv().VIEWER_PIN),
    photos_folder_id: input.photosFolderId,
  };

  const updated = await updateTableRecordById(
    [FAMILY_CONFIG_TAB, LEGACY_TENANT_CONFIG_TAB],
    normalizedTenantKey,
    configPayload,
    "family_group_key",
  );
  if (!updated) {
    await createTableRecord(FAMILY_CONFIG_TAB, configPayload);
  }
}

async function resolveTenantTabNameWithClient(
  sheets: sheets_v4.Sheets,
  tabName: string | string[],
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
  const candidates = buildMultiTenantTabCandidates(tabName, tenantKey);

  for (const candidate of candidates) {
    const match = index.get(candidate.trim().toLowerCase());
    if (match) {
      return match;
    }
  }

  return null;
}

async function resolveTenantTabName(tabName: string | string[], tenantKey?: string): Promise<string> {
  const sheets = await createSheetsClient();
  const resolved = await resolveTenantTabNameWithClient(sheets, tabName, tenantKey);
  if (!resolved) {
    const tabLabel = Array.isArray(tabName) ? tabName.join("' or '") : tabName;
    throw new Error(`Tab '${tabLabel}' not found for tenant '${normalizeTenantKey(tenantKey)}'.`);
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

export async function getTableRecords(tabName: string | string[], tenantKey?: string): Promise<SheetRecord[]> {
  const resolvedTab = await resolveTenantTabName(tabName, tenantKey);
  const matrix = await readTab(resolvedTab);
  return matrixToRecords(matrix);
}

export async function getTableRecordById(
  tabName: string | string[],
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
  tabName: string | string[],
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
  tabName: string | string[],
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
  tabName: string | string[],
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

async function ensureUserAccessTabSchema(): Promise<SheetMatrix> {
  const sheets = await createSheetsClient();
  await ensureTabWithHeaders(sheets, USER_ACCESS_TAB, USER_ACCESS_HEADERS);
  const matrix = await readTabWithClient(sheets, USER_ACCESS_TAB);
  const existing = new Set(matrix.headers.map((header) => normalizeHeader(header)));
  const missing = USER_ACCESS_HEADERS.filter((header) => !existing.has(normalizeHeader(header)));
  if (missing.length === 0) {
    return matrix;
  }

  const env = getEnv();
  const nextHeaders = [...matrix.headers, ...missing];
  await sheets.spreadsheets.values.update({
    spreadsheetId: env.SHEET_ID,
    range: `${USER_ACCESS_TAB}!A1:ZZ1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [nextHeaders],
    },
  });

  return { headers: nextHeaders, rows: matrix.rows };
}

async function ensureUserFamilyGroupsTabSchema(): Promise<SheetMatrix> {
  const sheets = await createSheetsClient();
  await ensureTabWithHeaders(sheets, USER_FAMILY_GROUPS_TAB, USER_FAMILY_GROUPS_HEADERS);
  const matrix = await readTabWithClient(sheets, USER_FAMILY_GROUPS_TAB);
  const existing = new Set(matrix.headers.map((header) => normalizeHeader(header)));
  const missing = USER_FAMILY_GROUPS_HEADERS.filter((header) => !existing.has(normalizeHeader(header)));
  if (missing.length === 0) {
    return matrix;
  }

  const env = getEnv();
  const nextHeaders = [...matrix.headers, ...missing];
  await sheets.spreadsheets.values.update({
    spreadsheetId: env.SHEET_ID,
    range: `${USER_FAMILY_GROUPS_TAB}!A1:ZZ1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [nextHeaders],
    },
  });

  return { headers: nextHeaders, rows: matrix.rows };
}

async function ensurePersonFamilyGroupsTabSchema(): Promise<SheetMatrix> {
  const sheets = await createSheetsClient();
  await ensureTabWithHeaders(sheets, PERSON_FAMILY_GROUPS_TAB, PERSON_FAMILY_GROUPS_HEADERS);
  const matrix = await readTabWithClient(sheets, PERSON_FAMILY_GROUPS_TAB);
  const existing = new Set(matrix.headers.map((header) => normalizeHeader(header)));
  const missing = PERSON_FAMILY_GROUPS_HEADERS.filter((header) => !existing.has(normalizeHeader(header)));
  if (missing.length === 0) {
    return matrix;
  }

  const env = getEnv();
  const nextHeaders = [...matrix.headers, ...missing];
  await sheets.spreadsheets.values.update({
    spreadsheetId: env.SHEET_ID,
    range: `${PERSON_FAMILY_GROUPS_TAB}!A1:ZZ1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [nextHeaders],
    },
  });

  return { headers: nextHeaders, rows: matrix.rows };
}

function hasGoogleAccess(row: string[], idx: Map<string, number>) {
  const explicit = getCell(row, idx, "google_access");
  if (explicit.trim()) {
    return parseBool(explicit);
  }
  return parseBool(getCell(row, idx, "is_enabled"));
}

function hasLocalAccess(row: string[], idx: Map<string, number>) {
  const explicit = getCell(row, idx, "local_access");
  if (explicit.trim()) {
    return parseBool(explicit);
  }
  return Boolean(getCell(row, idx, "username").trim());
}

function rowToPerson(headers: string[], row: string[]): PersonRecord {
  const idx = buildHeaderIndex(headers);
  const firstName = getCell(row, idx, "first_name").trim();
  const middleName = getCell(row, idx, "middle_name").trim();
  const lastName = getCell(row, idx, "last_name").trim();
  const nickName = getCell(row, idx, "nick_name").trim();
  const fallbackDisplayName = [firstName, middleName, lastName].filter(Boolean).join(" ").trim();
  return {
    personId: getCell(row, idx, "person_id"),
    displayName: getCell(row, idx, "display_name") || fallbackDisplayName,
    firstName,
    middleName,
    lastName,
    nickName,
    birthDate: getCell(row, idx, "birth_date"),
    gender: ((): "male" | "female" | "unspecified" => {
      const raw = getCell(row, idx, "gender").trim().toLowerCase();
      if (raw === "male" || raw === "female") {
        return raw;
      }
      return "unspecified";
    })(),
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

function rowToPersonAttribute(headers: string[], row: string[], tenantKey: string): PersonAttributeRecord | null {
  const idx = buildHeaderIndex(headers);
  const attributeId = getCell(row, idx, "attribute_id").trim();
  const personId = getCell(row, idx, "person_id").trim();
  const attributeType = getCell(row, idx, "attribute_type").trim().toLowerCase();
  const valueText = getCell(row, idx, "value_text").trim();

  if (!attributeId || !personId || !attributeType || !valueText) {
    return null;
  }

  const shareScopeRaw = getCell(row, idx, "share_scope").trim().toLowerCase();
  const shareFamilyGroupKey = getCell(row, idx, "share_family_group_key").trim().toLowerCase();
  const shareScope: "both_families" | "one_family" =
    shareScopeRaw === "one_family" || shareScopeRaw === "single_family"
      ? "one_family"
      : "both_families";

  return {
    attributeId,
    tenantKey,
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
    shareScope,
    shareFamilyGroupKey: shareScope === "one_family" ? shareFamilyGroupKey : "",
  };
}

export function peopleFromMatrix(matrix: SheetMatrix): PersonRecord[] {
  if (matrix.headers.length === 0) {
    return [];
  }

  const deduped = new Map<string, PersonRecord>();
  for (const row of matrix.rows) {
    const person = rowToPerson(matrix.headers, row);
    if (!person.personId) {
      continue;
    }
    if (!deduped.has(person.personId)) {
      deduped.set(person.personId, person);
    }
  }

  return Array.from(deduped.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function personAttributesFromMatrix(matrix: SheetMatrix, tenantKey?: string): PersonAttributeRecord[] {
  if (matrix.headers.length === 0) {
    return [];
  }

  const normalizedTenantKey = normalizeTenantKey(tenantKey);
  const targetTenantKey = tenantKey ? normalizeTenantKey(tenantKey) : "";

  return matrix.rows
    .map((row) => {
      const attribute = rowToPersonAttribute(matrix.headers, row, normalizedTenantKey);
      if (!attribute) {
        return null;
      }
      if (!targetTenantKey) {
        return attribute;
      }
      if (attribute.shareScope === "both_families") {
        return attribute;
      }
      if (attribute.shareFamilyGroupKey === targetTenantKey) {
        return attribute;
      }
      return null;
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
  const target = email.trim().toLowerCase();
  const links = await ensureUserFamilyGroupsTabSchema();
  if (links.headers.length === 0) {
    return [];
  }
  const idx = buildHeaderIndex(links.headers);
  const familyMap = new Map<string, TenantAccess>();
  for (const row of links.rows) {
    const userEmail = getCell(row, idx, "user_email").trim().toLowerCase();
    const isEnabled = parseBool(getCell(row, idx, "is_enabled"));
    if (userEmail !== target || !isEnabled) {
      continue;
    }
    const tenantKey = getCell(row, idx, "family_group_key").trim() || DEFAULT_TENANT_KEY;
    const tenantName = getCell(row, idx, "family_group_name").trim() || DEFAULT_TENANT_NAME;
    familyMap.set(tenantKey, {
      tenantKey,
      tenantName,
      role: toRole(getCell(row, idx, "role")),
      personId: getCell(row, idx, "person_id"),
    });
  }
  return Array.from(familyMap.values()).sort((a, b) => a.tenantName.localeCompare(b.tenantName));
}

export async function getTenantUserAccessList(tenantKey: string): Promise<UserAccessRecord[]> {
  const normalizedTenantKey = normalizeTenantKey(tenantKey);
  const [links, users] = await Promise.all([
    ensureUserFamilyGroupsTabSchema(),
    ensureUserAccessTabSchema(),
  ]);
  if (links.headers.length === 0 || users.headers.length === 0) {
    return [];
  }
  const linkIdx = buildHeaderIndex(links.headers);
  const userIdx = buildHeaderIndex(users.headers);

  const userByPersonId = new Map<string, string[]>();
  for (const row of users.rows) {
    const personId = getCell(row, userIdx, "person_id").trim();
    if (!personId) {
      continue;
    }
    userByPersonId.set(personId, row);
  }

  const out: UserAccessRecord[] = [];
  const seenPersonIds = new Set<string>();

  for (const row of links.rows) {
    const rowTenantKey = getCell(row, linkIdx, "family_group_key").trim().toLowerCase() || DEFAULT_TENANT_KEY;
    if (rowTenantKey !== normalizedTenantKey) {
      continue;
    }
    const personId = getCell(row, linkIdx, "person_id").trim();
    if (!personId || seenPersonIds.has(personId)) {
      continue;
    }
    seenPersonIds.add(personId);

    const userRow = userByPersonId.get(personId);
    const userEmail = (
      (userRow ? getCell(userRow, userIdx, "user_email") : "") || getCell(row, linkIdx, "user_email")
    )
      .trim()
      .toLowerCase();
    const googleEnabled = userRow ? parseBool(getCell(userRow, userIdx, "google_access")) : false;

    out.push({
      userEmail,
      isEnabled: googleEnabled,
      role: userRow ? toRole(getCell(userRow, userIdx, "role")) : toRole(getCell(row, linkIdx, "role")),
      personId,
      tenantKey: rowTenantKey,
      tenantName: getCell(row, linkIdx, "family_group_name").trim() || DEFAULT_TENANT_NAME,
    });
  }

  return out.sort((a, b) => {
    if (a.userEmail && b.userEmail) {
      return a.userEmail.localeCompare(b.userEmail);
    }
    if (a.userEmail) return -1;
    if (b.userEmail) return 1;
    return a.personId.localeCompare(b.personId);
  });
}

export async function upsertTenantAccess(input: UpsertTenantAccessInput): Promise<UpsertTenantAccessResult> {
  const familyGroups = await ensureUserFamilyGroupsTabSchema();
  const familyIdx = buildHeaderIndex(familyGroups.headers);
  const normalizedEmail = input.userEmail.trim().toLowerCase();
  const normalizedTenantKey = input.tenantKey.trim().toLowerCase() || DEFAULT_TENANT_KEY;
  const normalizedPersonId = input.personId.trim();
  const familyRowIndex = familyGroups.rows.findIndex((row) => {
    const rowEmail = getCell(row, familyIdx, "user_email").trim().toLowerCase();
    const rowTenantKey = getCell(row, familyIdx, "family_group_key").trim().toLowerCase() || DEFAULT_TENANT_KEY;
    if (rowTenantKey !== normalizedTenantKey) {
      return false;
    }
    const rowPersonId = getCell(row, familyIdx, "person_id").trim();
    if (normalizedPersonId && rowPersonId && rowPersonId === normalizedPersonId) {
      return true;
    }
    return rowEmail === normalizedEmail;
  });
  const familyValues = {
    user_email: normalizedEmail,
    family_group_key: normalizedTenantKey,
    family_group_name: input.tenantName.trim() || DEFAULT_TENANT_NAME,
    role: input.role,
    person_id: input.personId,
    is_enabled: toSheetBool(input.isEnabled),
  };
  const sheets = await createSheetsClient();
  const env = getEnv();
  if (familyRowIndex >= 0) {
    const mutable = Array.from({ length: familyGroups.headers.length }, (_, i) => familyGroups.rows[familyRowIndex][i] ?? "");
    setCell(mutable, familyIdx, "user_email", familyValues.user_email);
    setCell(mutable, familyIdx, "family_group_key", familyValues.family_group_key);
    setCell(mutable, familyIdx, "family_group_name", familyValues.family_group_name);
    setCell(mutable, familyIdx, "role", familyValues.role);
    setCell(mutable, familyIdx, "person_id", familyValues.person_id);
    setCell(mutable, familyIdx, "is_enabled", familyValues.is_enabled);
    await sheets.spreadsheets.values.update({
      spreadsheetId: env.SHEET_ID,
      range: `${USER_FAMILY_GROUPS_TAB}!A${familyRowIndex + 2}:ZZ${familyRowIndex + 2}`,
      valueInputOption: "RAW",
      requestBody: { values: [mutable] },
    });
  } else {
    const newFamilyRow = familyGroups.headers.map((header) => {
      const key = normalizeHeader(header);
      if (key === "user_email") return familyValues.user_email;
      if (key === "family_group_key") return familyValues.family_group_key;
      if (key === "family_group_name") return familyValues.family_group_name;
      if (key === "role") return familyValues.role;
      if (key === "person_id") return familyValues.person_id;
      if (key === "is_enabled") return familyValues.is_enabled;
      return "";
    });
    await sheets.spreadsheets.values.append({
      spreadsheetId: env.SHEET_ID,
      range: `${USER_FAMILY_GROUPS_TAB}!A:ZZ`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [newFamilyRow] },
    });
  }

  const matrix = await ensureUserAccessTabSchema();
  if (matrix.headers.length === 0) {
    throw new Error("UserAccess tab has no header row.");
  }

  const idx = buildHeaderIndex(matrix.headers);
  if (!idx.has("user_email")) {
    throw new Error("UserAccess tab missing required 'user_email' column.");
  }

  const rowIndex = matrix.rows.findIndex((row) => {
    if (normalizedPersonId) {
      const rowPersonId = getCell(row, idx, "person_id").trim();
      if (rowPersonId && rowPersonId === normalizedPersonId) {
        return true;
      }
    }
    const rowEmail = getCell(row, idx, "user_email").trim().toLowerCase();
    return rowEmail === normalizedEmail;
  });

  const values = {
    user_email: normalizedEmail,
    google_access: toSheetBool(input.isEnabled),
    role: input.role,
    person_id: input.personId,
  };

  if (rowIndex >= 0) {
    const mutableRow = Array.from({ length: matrix.headers.length }, (_, i) => matrix.rows[rowIndex][i] ?? "");
    setCell(mutableRow, idx, "user_email", values.user_email);
    setCell(mutableRow, idx, "google_access", values.google_access);
    setCell(mutableRow, idx, "role", values.role);
    setCell(mutableRow, idx, "person_id", values.person_id);

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
    if (key === "google_access") return values.google_access;
    if (key === "local_access") return "FALSE";
    if (key === "is_enabled") return "TRUE";
    if (key === "failed_attempts") return "0";
    if (key === "must_change_password") return "FALSE";
    if (key === "role") return values.role;
    if (key === "person_id") return values.person_id;
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

export async function ensurePersonFamilyGroupMembership(
  personId: string,
  tenantKey: string,
  isEnabled = true,
): Promise<"created" | "updated"> {
  const normalizedPersonId = personId.trim();
  const normalizedTenantKey = normalizeTenantKey(tenantKey);
  if (!normalizedPersonId) {
    throw new Error("person_id is required");
  }
  const matrix = await ensurePersonFamilyGroupsTabSchema();
  const idx = buildHeaderIndex(matrix.headers);
  const rowIndex = matrix.rows.findIndex((row) => {
    const rowPersonId = getCell(row, idx, "person_id").trim();
    const rowTenantKey = getCell(row, idx, "family_group_key").trim().toLowerCase() || DEFAULT_TENANT_KEY;
    return rowPersonId === normalizedPersonId && rowTenantKey === normalizedTenantKey;
  });

  const sheets = await createSheetsClient();
  const env = getEnv();
  if (rowIndex >= 0) {
    const mutable = Array.from({ length: matrix.headers.length }, (_, i) => matrix.rows[rowIndex][i] ?? "");
    setCell(mutable, idx, "person_id", normalizedPersonId);
    setCell(mutable, idx, "family_group_key", normalizedTenantKey);
    setCell(mutable, idx, "is_enabled", toSheetBool(isEnabled));
    await sheets.spreadsheets.values.update({
      spreadsheetId: env.SHEET_ID,
      range: `${PERSON_FAMILY_GROUPS_TAB}!A${rowIndex + 2}:ZZ${rowIndex + 2}`,
      valueInputOption: "RAW",
      requestBody: { values: [mutable] },
    });
    return "updated";
  }

  const row = matrix.headers.map((header) => {
    const key = normalizeHeader(header);
    if (key === "person_id") return normalizedPersonId;
    if (key === "family_group_key") return normalizedTenantKey;
    if (key === "is_enabled") return toSheetBool(isEnabled);
    return "";
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId: env.SHEET_ID,
    range: `${PERSON_FAMILY_GROUPS_TAB}!A:ZZ`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
  return "created";
}

export async function getTenantLocalAccessList(tenantKey: string): Promise<LocalUserRecord[]> {
  const { headers, rows } = await ensureUserAccessTabSchema();
  if (headers.length === 0) {
    return [];
  }

  const links = await ensureUserFamilyGroupsTabSchema();
  const linkIdx = buildHeaderIndex(links.headers);
  const idx = buildHeaderIndex(headers);
  const normalizedTenantKey = normalizeTenantKey(tenantKey);
  const allowedPersonIds = new Set(
    links.rows
      .filter((row) => {
        const rowTenantKey = getCell(row, linkIdx, "family_group_key").trim().toLowerCase() || DEFAULT_TENANT_KEY;
        return rowTenantKey === normalizedTenantKey && parseBool(getCell(row, linkIdx, "is_enabled"));
      })
      .map((row) => getCell(row, linkIdx, "person_id").trim())
      .filter(Boolean),
  );

  return rows
    .map((row) => {
      if (!hasLocalAccess(row, idx)) {
        return null;
      }
      const personId = getCell(row, idx, "person_id").trim();
      if (!personId || !allowedPersonIds.has(personId)) {
        return null;
      }
      const username = getCell(row, idx, "username").trim().toLowerCase();
      if (!username) {
        return null;
      }
      return {
        tenantKey: normalizedTenantKey,
        username,
        passwordHash: getCell(row, idx, "password_hash"),
        role: toRole(getCell(row, idx, "role")),
        personId,
        isEnabled: parseBool(getCell(row, idx, "is_enabled")),
        failedAttempts: Number.parseInt(getCell(row, idx, "failed_attempts") || "0", 10) || 0,
        lockedUntil: getCell(row, idx, "locked_until"),
        mustChangePassword: parseBool(getCell(row, idx, "must_change_password")),
      } satisfies LocalUserRecord;
    })
    .filter((row): row is LocalUserRecord => Boolean(row))
    .sort((a, b) => a.username.localeCompare(b.username));
}

export async function getPeople(tenantKey?: string): Promise<PersonRecord[]> {
  await ensureResolvedTabColumns(PEOPLE_TAB, ["gender", "first_name", "middle_name", "last_name", "nick_name"], tenantKey).catch(() => undefined);
  const sheets = await createSheetsClient();

  const readPeopleFromTab = async (tabName: string) => {
    const matrix = await readTabWithClient(sheets, tabName).catch(() => ({ headers: [], rows: [] } as SheetMatrix));
    return peopleFromMatrix(matrix);
  };

  const sharedTabName = await resolveTenantTabNameWithClient(sheets, PEOPLE_TAB);
  const sharedPeople = sharedTabName ? await readPeopleFromTab(sharedTabName) : [];

  if (!tenantKey) {
    return sharedPeople.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  const targetTenant = normalizeTenantKey(tenantKey);
  const memberships = await ensurePersonFamilyGroupsTabSchema().catch(() => null);
  if (!memberships || memberships.headers.length === 0) {
    return [];
  }

  const membershipIdx = buildHeaderIndex(memberships.headers);
  const allowedPersonIds = new Set(
    memberships.rows
      .filter((row) => {
        const rowTenantKey = getCell(row, membershipIdx, "family_group_key").trim().toLowerCase() || DEFAULT_TENANT_KEY;
        if (rowTenantKey !== targetTenant) {
          return false;
        }
        const enabledRaw = getCell(row, membershipIdx, "is_enabled").trim();
        return !enabledRaw || parseBool(enabledRaw);
      })
      .map((row) => getCell(row, membershipIdx, "person_id").trim())
      .filter(Boolean),
  );
  if (allowedPersonIds.size === 0) {
    return [];
  }

  const peopleById = new Map<string, PersonRecord>();
  for (const person of sharedPeople) {
    peopleById.set(person.personId, person);
  }

  return Array.from(allowedPersonIds)
    .map((personId) => peopleById.get(personId))
    .filter((person): person is PersonRecord => Boolean(person))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function getTenantConfig(tenantKey?: string): Promise<TenantConfig> {
  const normalizedTenantKey = normalizeTenantKey(tenantKey);
  let matrix: SheetMatrix | null = null;

  try {
    const tabName = await resolveTenantTabName([FAMILY_CONFIG_TAB, LEGACY_TENANT_CONFIG_TAB], normalizedTenantKey);
    matrix = await readTab(tabName);
  } catch {
    try {
      matrix = await readTab(LEGACY_TENANT_CONFIG_TAB);
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
      const rowTenantKey = getCell(candidate, idx, "family_group_key").trim().toLowerCase();
      return rowTenantKey === normalizedTenantKey;
    }) ??
    matrix.rows.find((candidate) => {
      const rowTenantKey = getCell(candidate, idx, "family_group_key").trim().toLowerCase();
      return !rowTenantKey && normalizedTenantKey === DEFAULT_TENANT_KEY;
    }) ??
    matrix.rows[0];

  const fallback = defaultTenantConfig(normalizedTenantKey);
  const tenantName = getCell(row, idx, "family_group_name").trim() || fallback.tenantName;
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
    await ensureResolvedTabColumns(IMPORTANT_DATES_TAB, ["share_scope", "share_family_group_key"], normalizedTenantKey);
    const tabName = await resolveTenantTabName(IMPORTANT_DATES_TAB, normalizedTenantKey);
    matrix = await readTab(tabName);
  } catch {
    return [];
  }

  if (matrix.headers.length === 0) {
    return [];
  }

  const idx = buildHeaderIndex(matrix.headers);

  const items = matrix.rows
    .map((row, i) => {
      const shareScopeRaw = getCell(row, idx, "share_scope").trim().toLowerCase();
      const shareScope =
        shareScopeRaw === "one_family" || shareScopeRaw === "single_family" ? "one_family" : "both_families";
      const shareFamilyGroupKey = getCell(row, idx, "share_family_group_key").trim().toLowerCase();
      if (normalizedTenantKey) {
        const isVisibleForFamily =
          shareScope === "both_families" ||
          shareFamilyGroupKey === normalizedTenantKey;
        if (!isVisibleForFamily) {
          return null;
        }
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
    await ensureResolvedTabColumns(
      PERSON_ATTRIBUTES_TAB,
      ["share_scope", "share_family_group_key"],
      normalizedTenantKey,
    );
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
  const rowIndex = rows.findIndex((row) => getCell(row, idx, "person_id") === personId);

  if (rowIndex < 0) {
    return null;
  }

  const mutableRow = Array.from({ length: headers.length }, (_, i) => rows[rowIndex][i] ?? "");
  setCell(mutableRow, idx, "display_name", updates.display_name);
  if (updates.first_name !== undefined) {
    setCell(mutableRow, idx, "first_name", updates.first_name);
  }
  if (updates.middle_name !== undefined) {
    setCell(mutableRow, idx, "middle_name", updates.middle_name);
  }
  if (updates.last_name !== undefined) {
    setCell(mutableRow, idx, "last_name", updates.last_name);
  }
  if (updates.nick_name !== undefined) {
    setCell(mutableRow, idx, "nick_name", updates.nick_name);
  }
  setCell(mutableRow, idx, "birth_date", updates.birth_date);
  if (updates.gender) {
    setCell(mutableRow, idx, "gender", updates.gender);
  }
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

