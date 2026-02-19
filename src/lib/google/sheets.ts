import "server-only";

import { google } from "googleapis";
import { getEnv } from "@/lib/env";
import { getServiceAccountAuth } from "@/lib/google/auth";
import type { AppRole, PersonRecord, PersonUpdateInput, UserAccessRecord } from "@/lib/google/types";

const USER_ACCESS_TAB = "UserAccess";
const PEOPLE_TAB = "People";

type SheetMatrix = {
  headers: string[];
  rows: string[][];
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

async function getSheetsClient() {
  const auth = getServiceAccountAuth();
  return google.sheets({ version: "v4", auth });
}

async function readTab(tabName: string): Promise<SheetMatrix> {
  const sheets = await getSheetsClient();
  const env = getEnv();
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: env.SHEET_ID,
    range: `${tabName}!A1:ZZ`,
  });

  const matrix = (result.data.values ?? []) as string[][];
  if (matrix.length === 0) {
    return { headers: [], rows: [] };
  }

  const [headers, ...rows] = matrix;
  return { headers, rows };
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
      return {
        userEmail,
        isEnabled,
        role: toRole(getCell(row, idx, "role")),
        personId: getCell(row, idx, "person_id"),
      };
    }
  }

  return null;
}

export async function getPeople(): Promise<PersonRecord[]> {
  const { headers, rows } = await readTab(PEOPLE_TAB);
  if (headers.length === 0) {
    return [];
  }

  return rows
    .map((row) => rowToPerson(headers, row))
    .filter((person) => person.personId)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function getPersonById(personId: string): Promise<PersonRecord | null> {
  const people = await getPeople();
  return people.find((person) => person.personId === personId) ?? null;
}

export async function updatePerson(personId: string, updates: PersonUpdateInput): Promise<PersonRecord | null> {
  const { headers, rows } = await readTab(PEOPLE_TAB);
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

  const sheets = await getSheetsClient();
  const env = getEnv();
  const sheetRowNumber = rowIndex + 2;

  await sheets.spreadsheets.values.update({
    spreadsheetId: env.SHEET_ID,
    range: `${PEOPLE_TAB}!A${sheetRowNumber}:ZZ${sheetRowNumber}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [mutableRow],
    },
  });

  return rowToPerson(headers, mutableRow);
}