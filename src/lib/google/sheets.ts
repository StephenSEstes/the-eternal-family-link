import "server-only";

import { google, sheets_v4 } from "googleapis";
import { getEnv } from "@/lib/env";
import { getServiceAccountAuth } from "@/lib/google/auth";
import type { AppRole, PersonRecord, PersonUpdateInput, UserAccessRecord } from "@/lib/google/types";
import { DEFAULT_TENANT_KEY, DEFAULT_TENANT_NAME } from "@/lib/tenant/context";

const USER_ACCESS_TAB = "UserAccess";
export const PEOPLE_TAB = "People";
const TENANT_TAB_DELIMITER = "__";

export type SheetMatrix = {
  headers: string[];
  rows: string[][];
};

export type SheetRecord = {
  rowNumber: number;
  data: Record<string, string>;
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
    phones: getCell(row, idx, "phones"),
    address: getCell(row, idx, "address"),
    hobbies: getCell(row, idx, "hobbies"),
    notes: getCell(row, idx, "notes"),
    photoFileId: getCell(row, idx, "photo_file_id"),
    isPinned:
      parseBool(getCell(row, idx, "is_pinned")) || parseBool(getCell(row, idx, "is_pinned_viewer")),
    relationships: toList(getCell(row, idx, "relationships")),
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

export async function getEnabledUserAccess(email: string): Promise<UserAccessRecord | null> {
  const { headers, rows } = await readTab(USER_ACCESS_TAB);
  if (headers.length === 0) {
    return null;
  }

  const idx = buildHeaderIndex(headers);
  const target = email.trim().toLowerCase();

  for (const row of rows) {
    const userEmail = getCell(row, idx, "user_email").trim().toLowerCase();
    const isEnabled = parseBool(getCell(row, idx, "is_enabled"));

    if (userEmail === target && isEnabled) {
      const tenantKey = getCell(row, idx, "tenant_key").trim() || DEFAULT_TENANT_KEY;
      const tenantName = getCell(row, idx, "tenant_name").trim() || DEFAULT_TENANT_NAME;
      return {
        userEmail,
        isEnabled,
        role: toRole(getCell(row, idx, "role")),
        personId: getCell(row, idx, "person_id"),
        tenantKey,
        tenantName,
      };
    }
  }

  return null;
}

export async function getPeople(tenantKey?: string): Promise<PersonRecord[]> {
  const tabName = await resolveTenantTabName(PEOPLE_TAB, tenantKey);
  const matrix = await readTab(tabName);
  return peopleFromMatrix(matrix);
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
