import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import oracledb from "oracledb";
import type { SheetRecord } from "@/lib/google/sheets";

type TableConfig = {
  tableName: string;
  headers: string[];
};

type OciConnection = {
  execute: (sql: string, binds?: unknown[] | Record<string, unknown>, options?: Record<string, unknown>) => Promise<{
    rows?: unknown[];
    rowsAffected?: number;
  }>;
  executeMany: (sql: string, binds: unknown[], options?: Record<string, unknown>) => Promise<unknown>;
  commit: () => Promise<void>;
  close: () => Promise<void>;
};

let cachedWalletDir: string | null = null;

function readWalletJsonPayload() {
  const single = process.env.OCI_WALLET_FILES_JSON;
  if (single && single.trim()) {
    return single;
  }

  const partCountRaw = process.env.OCI_WALLET_FILES_JSON_PART_COUNT;
  const partCount = Number.parseInt(partCountRaw ?? "", 10);
  if (!Number.isFinite(partCount) || partCount <= 0) {
    return "";
  }

  const parts: string[] = [];
  for (let i = 1; i <= partCount; i += 1) {
    const key = `OCI_WALLET_FILES_JSON_PART_${i}`;
    const value = process.env[key];
    if (!value) {
      throw new Error(`Missing wallet env chunk: ${key}`);
    }
    parts.push(value);
  }
  return parts.join("");
}

function ensureWalletDirFromEnv(): string | null {
  if (cachedWalletDir) {
    return cachedWalletDir;
  }

  const walletFilesJson = readWalletJsonPayload().replace(/\r?\n/g, "");
  if (!walletFilesJson) {
    return null;
  }

  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(walletFilesJson) as Record<string, string>;
  } catch (error) {
    throw new Error(`Failed to parse OCI wallet env payload: ${(error as Error).message}`);
  }
  const baseDir = path.join(os.tmpdir(), "efl-oci-wallet");
  fs.mkdirSync(baseDir, { recursive: true });

  for (const [fileName, b64] of Object.entries(parsed)) {
    const target = path.join(baseDir, fileName);
    if (!fs.existsSync(target)) {
      fs.writeFileSync(target, Buffer.from(b64, "base64"));
    }
  }

  cachedWalletDir = baseDir;
  return cachedWalletDir;
}

function resolveWalletDirectory() {
  return ensureWalletDirFromEnv() ?? process.env.TNS_ADMIN ?? "";
}

const TABLES: Record<string, TableConfig> = {
  People: {
    tableName: "people",
    headers: [
      "person_id",
      "display_name",
      "first_name",
      "middle_name",
      "last_name",
      "nick_name",
      "birth_date",
      "gender",
      "phones",
      "email",
      "address",
      "hobbies",
      "notes",
      "photo_file_id",
      "is_pinned",
      "relationships",
    ],
  },
  PersonFamilyGroups: {
    tableName: "person_family_groups",
    headers: ["person_id", "family_group_key", "is_enabled"],
  },
  Relationships: {
    tableName: "relationships",
    headers: ["family_group_key", "rel_id", "from_person_id", "to_person_id", "rel_type"],
  },
  Households: {
    tableName: "households",
    headers: [
      "family_group_key",
      "household_id",
      "husband_person_id",
      "wife_person_id",
      "label",
      "notes",
      "wedding_photo_file_id",
    ],
  },
  HouseholdPhotos: {
    tableName: "household_photos",
    headers: ["family_group_key", "photo_id", "household_id", "file_id", "name", "description", "photo_date", "is_primary", "media_metadata"],
  },
  ImportantDates: {
    tableName: "important_dates",
    headers: ["id", "date", "title", "description", "person_id", "share_scope", "share_family_group_key"],
  },
  PersonAttributes: {
    tableName: "person_attributes",
    headers: [
      "attribute_id",
      "person_id",
      "attribute_type",
      "value_text",
      "value_json",
      "media_metadata",
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
  },
  UserAccess: {
    tableName: "user_access",
    headers: [
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
    ],
  },
  UserFamilyGroups: {
    tableName: "user_family_groups",
    headers: ["user_email", "family_group_key", "family_group_name", "role", "person_id", "is_enabled"],
  },
  FamilyConfig: {
    tableName: "family_config",
    headers: ["family_group_key", "family_group_name", "viewer_pin_hash", "photos_folder_id"],
  },
  TenantConfig: {
    tableName: "family_config",
    headers: ["family_group_key", "family_group_name", "viewer_pin_hash", "photos_folder_id"],
  },
  FamilySecurityPolicy: {
    tableName: "family_security_policy",
    headers: ["family_group_key", "id", "min_length", "require_number", "require_uppercase", "require_lowercase", "lockout_attempts"],
  },
};

function normalizeHeader(header: string) {
  const normalized = header.trim().toLowerCase();
  if (normalized === "tenant_key") return "family_group_key";
  if (normalized === "tenant_name") return "family_group_name";
  return normalized;
}

function resolveTab(tabName: string | string[]) {
  const names = Array.isArray(tabName) ? tabName : [tabName];
  for (const name of names) {
    if (TABLES[name]) return { tab: name, config: TABLES[name] };
  }
  throw new Error(`OCI table mapping not configured for tab name(s): ${names.join(", ")}`);
}

function resolveIdColumn(headers: string[], idColumn?: string): string {
  if (idColumn) {
    const match = headers.find((h) => normalizeHeader(h) === normalizeHeader(idColumn));
    if (match) return match;
  }
  for (const fallback of ["id", "person_id", "record_id", "user_email", "rel_id", "household_id", "attribute_id", "photo_id"]) {
    const match = headers.find((h) => normalizeHeader(h) === fallback);
    if (match) return match;
  }
  throw new Error("No id column found. Provide idColumn query parameter.");
}

function fromDbValue(value: unknown) {
  return value == null ? "" : String(value);
}

async function withConnection<T>(run: (connection: OciConnection) => Promise<T>) {
  const walletDir = resolveWalletDirectory();
  const connection = (await oracledb.getConnection({
    user: process.env.OCI_DB_USER,
    password: process.env.OCI_DB_PASSWORD,
    connectString: process.env.OCI_DB_CONNECT_STRING,
    configDir: walletDir || undefined,
    walletLocation: walletDir || undefined,
    walletPassword: process.env.OCI_WALLET_PASSWORD,
  })) as OciConnection;
  try {
    return await run(connection);
  } finally {
    await connection.close();
  }
}

function normalizePayload(payload: Record<string, string>, headers: string[]) {
  const out: Record<string, string> = {};
  const exact = new Map(headers.map((h) => [normalizeHeader(h), h]));
  for (const [key, value] of Object.entries(payload)) {
    const canonical = exact.get(normalizeHeader(key));
    if (canonical) out[canonical] = value;
  }
  return out;
}

export async function getOciTableRecords(tabName: string | string[]): Promise<SheetRecord[]> {
  const { config } = resolveTab(tabName);
  const selectCols = config.headers.map((h) => (h === "date" ? "date_value AS date" : h)).join(", ");
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT ${selectCols} FROM ${config.tableName} ORDER BY ROWID`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row, idx) => {
      const data: Record<string, string> = {};
      for (const header of config.headers) {
        data[header] = fromDbValue((row as Record<string, unknown>)[header.toUpperCase()]);
      }
      return { rowNumber: idx + 2, data };
    });
  });
}

export async function getOciTableRecordById(
  tabName: string | string[],
  recordId: string,
  idColumn?: string
): Promise<SheetRecord | null> {
  const { config } = resolveTab(tabName);
  const effectiveIdColumn = resolveIdColumn(config.headers, idColumn);
  const selectCols = config.headers.map((h) => (h === "date" ? "date_value AS date" : h)).join(", ");
  const whereColumn = effectiveIdColumn === "date" ? "date_value" : effectiveIdColumn;
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT ${selectCols} FROM ${config.tableName} WHERE ${whereColumn} = :id FETCH FIRST 1 ROWS ONLY`,
      [recordId],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const row = (result.rows?.[0] as Record<string, unknown> | undefined) ?? null;
    if (!row) return null;
    const data: Record<string, string> = {};
    for (const header of config.headers) {
      data[header] = fromDbValue((row as Record<string, unknown>)[header.toUpperCase()]);
    }
    return { rowNumber: 0, data };
  });
}

export async function createOciTableRecords(
  tabName: string | string[],
  payloads: Record<string, string>[]
): Promise<SheetRecord[]> {
  if (!payloads.length) return [];
  const { config } = resolveTab(tabName);
  const insertCols = config.headers.map((h) => (h === "date" ? "date_value" : h));
  const bindSlots = insertCols.map((_, idx) => `:${idx + 1}`).join(", ");
  const sql = `INSERT INTO ${config.tableName} (${insertCols.join(", ")}) VALUES (${bindSlots})`;

  return withConnection(async (connection) => {
    const normalizedRows = payloads.map((payload) => normalizePayload(payload, config.headers));
    const binds = normalizedRows.map((row) => config.headers.map((h) => row[h] ?? ""));
    await connection.executeMany(sql, binds, { autoCommit: true });
    return normalizedRows.map((data) => ({ rowNumber: 0, data }));
  });
}

export async function updateOciTableRecordById(
  tabName: string | string[],
  recordId: string,
  payload: Record<string, string>,
  idColumn?: string
): Promise<SheetRecord | null> {
  const { config } = resolveTab(tabName);
  const effectiveIdColumn = resolveIdColumn(config.headers, idColumn);
  const normalizedPayload = normalizePayload(payload, config.headers);
  const entries = Object.entries(normalizedPayload).filter(([key]) => normalizeHeader(key) !== normalizeHeader(effectiveIdColumn));
  if (!entries.length) {
    return getOciTableRecordById(tabName, recordId, effectiveIdColumn);
  }

  const setClauses = entries.map(([key], idx) => `${key === "date" ? "date_value" : key} = :v${idx + 1}`);
  const whereColumn = effectiveIdColumn === "date" ? "date_value" : effectiveIdColumn;
  const binds = entries.map(([, value]) => value);
  binds.push(recordId);

  return withConnection(async (connection) => {
    const update = await connection.execute(
      `UPDATE ${config.tableName} SET ${setClauses.join(", ")} WHERE ${whereColumn} = :id`,
      binds,
      { autoCommit: true }
    );
    if (!update.rowsAffected) return null;
    return getOciTableRecordById(tabName, recordId, effectiveIdColumn);
  });
}

export async function deleteOciTableRecordById(
  tabName: string | string[],
  recordId: string,
  idColumn?: string
): Promise<boolean> {
  const { config } = resolveTab(tabName);
  const effectiveIdColumn = resolveIdColumn(config.headers, idColumn);
  const whereColumn = effectiveIdColumn === "date" ? "date_value" : effectiveIdColumn;
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `DELETE FROM ${config.tableName} WHERE ${whereColumn} = :id`,
      [recordId],
      { autoCommit: true }
    );
    return (result.rowsAffected ?? 0) > 0;
  });
}

export async function deleteOciTableRows(tabName: string | string[], rowNumbers: number[]): Promise<number> {
  const clean = Array.from(new Set(rowNumbers.filter((r) => Number.isInteger(r) && r >= 2))).sort((a, b) => b - a);
  if (!clean.length) return 0;
  const { config } = resolveTab(tabName);
  return withConnection(async (connection) => {
    let deleted = 0;
    for (const rowNumber of clean) {
      const targetRn = rowNumber - 1;
      const result = await connection.execute(
        `DELETE FROM ${config.tableName}
         WHERE ROWID IN (
           SELECT rid FROM (
             SELECT ROWID AS rid, ROW_NUMBER() OVER (ORDER BY ROWID) AS rn
             FROM ${config.tableName}
           )
           WHERE rn = :rn
         )`,
        [targetRn],
        { autoCommit: false }
      );
      deleted += result.rowsAffected ?? 0;
    }
    await connection.commit();
    return deleted;
  });
}
