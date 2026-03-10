import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import oracledb from "oracledb";
import type { SheetRecord } from "@/lib/google/sheets";

// Ensure CLOB columns are returned as text instead of Lob objects.
oracledb.fetchAsString = [oracledb.CLOB];

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

type OciPool = {
  getConnection: () => Promise<OciConnection>;
};

let cachedWalletDir: string | null = null;
let poolPromise: Promise<OciPool> | null = null;
let peopleTableCompatEnsured = false;
let familyConfigCompatEnsured = false;
let householdsTableCompatEnsured = false;

function isColumnAlreadyCompatibleError(message: string) {
  return /ORA-01430|ORA-01442|ORA-00904/i.test(message);
}

function isTransientDdlConcurrencyError(message: string) {
  return /ORA-14411|ORA-00054/i.test(message);
}

function waitMs(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

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
      "maiden_name",
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
      "married_date",
      "address",
      "city",
      "state",
      "zip",
    ],
  },
  HouseholdPhotos: {
    tableName: "household_photos",
    headers: ["family_group_key", "photo_id", "household_id", "file_id", "name", "description", "photo_date", "is_primary", "media_metadata"],
  },
  MediaAssets: {
    tableName: "media_assets",
    headers: ["media_id", "file_id", "storage_provider", "mime_type", "file_name", "file_size_bytes", "media_metadata", "created_at"],
  },
  MediaLinks: {
    tableName: "media_links",
    headers: [
      "family_group_key",
      "link_id",
      "media_id",
      "entity_type",
      "entity_id",
      "usage_type",
      "label",
      "description",
      "photo_date",
      "is_primary",
      "sort_order",
      "media_metadata",
      "created_at",
    ],
  },
  ImportantDates: {
    tableName: "important_dates",
    headers: ["id", "date", "title", "description", "person_id", "share_scope", "share_family_group_key"],
  },
  Attributes: {
    tableName: "attributes",
    headers: [
      "attribute_id",
      "entity_type",
      "entity_id",
      "attribute_type",
      "attribute_type_category",
      "attribute_date",
      "date_is_estimated",
      "estimated_to",
      "attribute_detail",
      "attribute_notes",
      "end_date",
      "created_at",
      "updated_at",
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
    headers: ["family_group_key", "family_group_name", "viewer_pin_hash", "photos_folder_id", "attribute_event_definitions_json"],
  },
  TenantConfig: {
    tableName: "family_config",
    headers: ["family_group_key", "family_group_name", "viewer_pin_hash", "photos_folder_id", "attribute_event_definitions_json"],
  },
  FamilySecurityPolicy: {
    tableName: "family_security_policy",
    headers: ["family_group_key", "id", "min_length", "require_number", "require_uppercase", "require_lowercase", "lockout_attempts"],
  },
  AuditLog: {
    tableName: "audit_log",
    headers: [
      "event_id",
      "timestamp",
      "actor_email",
      "actor_person_id",
      "action",
      "entity_type",
      "entity_id",
      "family_group_key",
      "status",
      "details",
    ],
  },
};

export function listOciTabs() {
  return Object.keys(TABLES);
}

export async function ensureOciAttributesTable() {
  return withConnection(async (connection) => {
    try {
      await connection.execute(
        `CREATE TABLE attributes (
           attribute_id VARCHAR2(128) PRIMARY KEY,
           entity_type VARCHAR2(32) NOT NULL,
           entity_id VARCHAR2(128) NOT NULL,
           attribute_type VARCHAR2(80) NOT NULL,
           attribute_type_category VARCHAR2(120),
           attribute_date VARCHAR2(32),
           date_is_estimated VARCHAR2(8),
           estimated_to VARCHAR2(16),
           attribute_detail CLOB,
           attribute_notes CLOB,
           end_date VARCHAR2(32),
           created_at VARCHAR2(64),
           updated_at VARCHAR2(64)
         )`,
      );
      await connection.execute(
        `CREATE INDEX idx_attributes_entity ON attributes(entity_type, entity_id, attribute_type)`,
      );
      await connection.commit();
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (!/ORA-00955|name is already used by an existing object/i.test(message)) {
        throw error;
      }
    }

    const additiveColumns = [
      "attribute_type VARCHAR2(80)",
      "attribute_type_category VARCHAR2(120)",
      "attribute_date VARCHAR2(32)",
      "date_is_estimated VARCHAR2(8)",
      "estimated_to VARCHAR2(16)",
      "attribute_detail CLOB",
      "attribute_notes CLOB",
      "end_date VARCHAR2(32)",
      "updated_at VARCHAR2(64)",
    ];
    for (const columnSql of additiveColumns) {
      try {
        await connection.execute(`ALTER TABLE attributes ADD (${columnSql})`);
      } catch (error) {
        const message = (error as Error).message ?? "";
        if (!/ORA-01430|ORA-01442|ORA-00904/i.test(message)) {
          throw error;
        }
      }
    }
    await connection.commit();
  });
}

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
  for (const fallback of ["id", "person_id", "record_id", "user_email", "rel_id", "household_id", "attribute_id", "photo_id", "media_id", "link_id"]) {
    const match = headers.find((h) => normalizeHeader(h) === fallback);
    if (match) return match;
  }
  throw new Error("No id column found. Provide idColumn query parameter.");
}

function fromDbValue(value: unknown) {
  return value == null ? "" : String(value);
}

async function withConnection<T>(run: (connection: OciConnection) => Promise<T>) {
  const pool = await getPool();
  const connection = (await pool.getConnection()) as OciConnection;
  try {
    return await run(connection);
  } finally {
    await connection.close();
  }
}

async function getPool(): Promise<OciPool> {
  if (poolPromise) {
    return poolPromise;
  }

  const walletDir = resolveWalletDirectory();
  const user = (process.env.OCI_DB_USER ?? "").trim();
  const password = (process.env.OCI_DB_PASSWORD ?? "").trim();
  const connectString = (process.env.OCI_DB_CONNECT_STRING ?? "").trim();
  const walletPassword = (process.env.OCI_WALLET_PASSWORD ?? "").trim();

  poolPromise = oracledb.createPool({
    user,
    password,
    connectString,
    configDir: walletDir || undefined,
    walletLocation: walletDir || undefined,
    walletPassword,
    poolMin: 1,
    poolMax: 8,
    poolIncrement: 1,
    poolTimeout: 60,
  });

  const nextPoolPromise = poolPromise;
  try {
    return await nextPoolPromise!;
  } catch (error) {
    poolPromise = null;
    throw error;
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

async function ensurePeopleTableCompatibility(connection: OciConnection) {
  if (peopleTableCompatEnsured) {
    return;
  }
  try {
    await connection.execute(`ALTER TABLE people ADD (maiden_name VARCHAR2(128))`);
    await connection.commit();
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (!isColumnAlreadyCompatibleError(message)) {
      throw error;
    }
  }
  peopleTableCompatEnsured = true;
}

async function ensureFamilyConfigTableCompatibility(connection: OciConnection) {
  if (familyConfigCompatEnsured) {
    return;
  }
  try {
    await connection.execute(`ALTER TABLE family_config ADD (attribute_event_definitions_json CLOB)`);
    await connection.commit();
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (!isColumnAlreadyCompatibleError(message)) {
      throw error;
    }
  }
  familyConfigCompatEnsured = true;
}

async function ensureHouseholdsTableCompatibility(connection: OciConnection) {
  if (householdsTableCompatEnsured) {
    return;
  }
  const additiveColumns = [
    "married_date VARCHAR2(32)",
    "address VARCHAR2(400)",
    "city VARCHAR2(120)",
    "state VARCHAR2(80)",
    "zip VARCHAR2(40)",
  ];
  for (const columnSql of additiveColumns) {
    let applied = false;
    let attempts = 0;
    while (!applied && attempts < 3) {
      try {
        await connection.execute(`ALTER TABLE households ADD (${columnSql})`);
        await connection.commit();
        applied = true;
      } catch (error) {
        const message = (error as Error).message ?? "";
        if (isColumnAlreadyCompatibleError(message)) {
          applied = true;
          continue;
        }
        if (isTransientDdlConcurrencyError(message) && attempts < 2) {
          attempts += 1;
          await waitMs(180);
          continue;
        }
        throw error;
      }
    }
  }
  householdsTableCompatEnsured = true;
}

export async function getOciTableRecords(tabName: string | string[]): Promise<SheetRecord[]> {
  const { config } = resolveTab(tabName);
  const selectCols = config.headers.map((h) => (h === "date" ? "date_value AS date" : h)).join(", ");
  return withConnection(async (connection) => {
    if (config.tableName === "people") {
      await ensurePeopleTableCompatibility(connection);
    }
    if (config.tableName === "family_config") {
      await ensureFamilyConfigTableCompatibility(connection);
    }
    if (config.tableName === "households") {
      await ensureHouseholdsTableCompatibility(connection);
    }
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
    if (config.tableName === "people") {
      await ensurePeopleTableCompatibility(connection);
    }
    if (config.tableName === "family_config") {
      await ensureFamilyConfigTableCompatibility(connection);
    }
    if (config.tableName === "households") {
      await ensureHouseholdsTableCompatibility(connection);
    }
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
    if (config.tableName === "people") {
      await ensurePeopleTableCompatibility(connection);
    }
    if (config.tableName === "family_config") {
      await ensureFamilyConfigTableCompatibility(connection);
    }
    if (config.tableName === "households") {
      await ensureHouseholdsTableCompatibility(connection);
    }
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
    if (config.tableName === "people") {
      await ensurePeopleTableCompatibility(connection);
    }
    if (config.tableName === "family_config") {
      await ensureFamilyConfigTableCompatibility(connection);
    }
    if (config.tableName === "households") {
      await ensureHouseholdsTableCompatibility(connection);
    }
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

type OciTenantAccessRow = {
  tenantKey: string;
  tenantName: string;
  role: string;
  personId: string;
};

type OciTenantUserAccessRow = {
  userEmail: string;
  isEnabled: boolean;
  role: string;
  personId: string;
  tenantKey: string;
  tenantName: string;
};

type OciLocalUserRow = {
  tenantKey: string;
  username: string;
  passwordHash: string;
  role: string;
  personId: string;
  isEnabled: boolean;
  failedAttempts: number;
  lockedUntil: string;
  mustChangePassword: boolean;
};

type OciMediaLinkRow = {
  familyGroupKey: string;
  linkId: string;
  mediaId: string;
  entityType: string;
  entityId: string;
  usageType: string;
  fileId: string;
  label: string;
  description: string;
  photoDate: string;
  isPrimary: boolean;
  sortOrder: number;
  mediaMetadata: string;
  createdAt: string;
};

function enabledExpr(column: string) {
  return `LOWER(TRIM(NVL(${column}, 'TRUE'))) IN ('true','yes','1')`;
}

export async function getOciEnabledUserAccessesByEmail(email: string): Promise<OciTenantAccessRow[]> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT
         family_group_key,
         family_group_name,
         role,
         person_id
       FROM user_family_groups
       WHERE LOWER(TRIM(user_email)) = :email
         AND ${enabledExpr("is_enabled")}
       ORDER BY family_group_name, family_group_key`,
      [normalized],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      tenantKey: fromDbValue(row.FAMILY_GROUP_KEY),
      tenantName: fromDbValue(row.FAMILY_GROUP_NAME),
      role: fromDbValue(row.ROLE),
      personId: fromDbValue(row.PERSON_ID),
    }));
  });
}

export async function getOciEnabledUserAccessesByPersonId(personId: string): Promise<OciTenantAccessRow[]> {
  const normalized = personId.trim();
  if (!normalized) {
    return [];
  }
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT
         family_group_key,
         family_group_name,
         role,
         person_id
       FROM user_family_groups
       WHERE TRIM(person_id) = :personId
         AND ${enabledExpr("is_enabled")}
       ORDER BY family_group_name, family_group_key`,
      [normalized],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      tenantKey: fromDbValue(row.FAMILY_GROUP_KEY),
      tenantName: fromDbValue(row.FAMILY_GROUP_NAME),
      role: fromDbValue(row.ROLE),
      personId: fromDbValue(row.PERSON_ID),
    }));
  });
}

export async function getOciTenantUserAccessRows(tenantKey: string): Promise<OciTenantUserAccessRow[]> {
  const normalized = tenantKey.trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT
         NVL(LOWER(TRIM(u.user_email)), LOWER(TRIM(l.user_email))) AS user_email,
         CASE WHEN ${enabledExpr("u.google_access")} THEN 1 ELSE 0 END AS is_enabled,
         NVL(u.role, l.role) AS role,
         l.person_id AS person_id,
         l.family_group_key AS family_group_key,
         NVL(l.family_group_name, '') AS family_group_name
       FROM (
         SELECT
           user_email,
           family_group_key,
           family_group_name,
           role,
           person_id,
           ROW_NUMBER() OVER (PARTITION BY person_id ORDER BY ROWID) AS rn
         FROM user_family_groups
         WHERE LOWER(TRIM(family_group_key)) = :tenantKey
       ) l
       LEFT JOIN user_access u
         ON TRIM(u.person_id) = TRIM(l.person_id)
       WHERE l.rn = 1
       ORDER BY user_email, person_id`,
      [normalized],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      userEmail: fromDbValue(row.USER_EMAIL),
      isEnabled: fromDbValue(row.IS_ENABLED) === "1",
      role: fromDbValue(row.ROLE),
      personId: fromDbValue(row.PERSON_ID),
      tenantKey: fromDbValue(row.FAMILY_GROUP_KEY),
      tenantName: fromDbValue(row.FAMILY_GROUP_NAME),
    }));
  });
}

export async function upsertOciTenantAccess(input: {
  userEmail: string;
  tenantKey: string;
  tenantName: string;
  role: string;
  personId: string;
  isEnabled: boolean;
}): Promise<"created" | "updated"> {
  const userEmail = input.userEmail.trim().toLowerCase();
  const tenantKey = input.tenantKey.trim().toLowerCase();
  const tenantName = input.tenantName.trim();
  const role = input.role.trim().toUpperCase() || "USER";
  const personId = input.personId.trim();
  const googleAccess = input.isEnabled ? "TRUE" : "FALSE";
  const membershipEnabled = input.isEnabled ? "TRUE" : "FALSE";

  if (!tenantKey) {
    throw new Error("family_group_key is required");
  }

  return withConnection(async (connection) => {
    const membershipUpdate = await connection.execute(
      `UPDATE user_family_groups
       SET user_email = :userEmail,
           family_group_name = :tenantName,
           role = :role,
           person_id = :personId,
           is_enabled = :membershipEnabled
       WHERE LOWER(TRIM(family_group_key)) = :tenantKey
         AND (
           (:personId <> '' AND TRIM(person_id) = :personId)
           OR LOWER(TRIM(user_email)) = :userEmail
         )`,
      {
        userEmail,
        tenantName,
        role,
        personId,
        membershipEnabled,
        tenantKey,
      },
      { autoCommit: false },
    );

    let action: "created" | "updated" = (membershipUpdate.rowsAffected ?? 0) > 0 ? "updated" : "created";
    if ((membershipUpdate.rowsAffected ?? 0) === 0) {
      await connection.execute(
        `INSERT INTO user_family_groups (
           user_email,
           family_group_key,
           family_group_name,
           role,
           person_id,
           is_enabled
         ) VALUES (
           :userEmail,
           :tenantKey,
           :tenantName,
           :role,
           :personId,
           :membershipEnabled
         )`,
        {
          userEmail,
          tenantKey,
          tenantName,
          role,
          personId,
          membershipEnabled,
        },
        { autoCommit: false },
      );
    }

    const userUpdate = await connection.execute(
      `UPDATE user_access
       SET user_email = :userEmail,
           google_access = :googleAccess,
           role = :role,
           person_id = :personId
       WHERE (
         (:personId <> '' AND TRIM(person_id) = :personId)
         OR LOWER(TRIM(user_email)) = :userEmail
       )`,
      {
        userEmail,
        googleAccess,
        role,
        personId,
      },
      { autoCommit: false },
    );

    if ((userUpdate.rowsAffected ?? 0) === 0) {
      await connection.execute(
        `INSERT INTO user_access (
           person_id,
           role,
           user_email,
           username,
           google_access,
           local_access,
           is_enabled,
           password_hash,
           failed_attempts,
           locked_until,
           must_change_password
         ) VALUES (
           :personId,
           :role,
           :userEmail,
           '',
           :googleAccess,
           'FALSE',
           'TRUE',
           '',
           '0',
           '',
           'FALSE'
         )`,
        {
          personId,
          role,
          userEmail,
          googleAccess,
        },
        { autoCommit: false },
      );
    }

    await connection.commit();
    return action;
  });
}

export async function getOciLocalUsersForTenant(tenantKey: string): Promise<OciLocalUserRow[]> {
  const normalized = tenantKey.trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT
         :tenantKey AS tenant_key,
         LOWER(TRIM(u.username)) AS username,
         NVL(u.password_hash, '') AS password_hash,
         NVL(u.role, 'USER') AS role,
         NVL(u.person_id, '') AS person_id,
         CASE WHEN ${enabledExpr("u.is_enabled")} THEN 1 ELSE 0 END AS is_enabled,
         TO_NUMBER(NVL(NULLIF(TRIM(u.failed_attempts), ''), '0')) AS failed_attempts,
         NVL(u.locked_until, '') AS locked_until,
         CASE WHEN ${enabledExpr("u.must_change_password")} THEN 1 ELSE 0 END AS must_change_password
       FROM user_access u
       INNER JOIN user_family_groups l
         ON TRIM(l.person_id) = TRIM(u.person_id)
       WHERE LOWER(TRIM(l.family_group_key)) = :tenantKey
         AND ${enabledExpr("l.is_enabled")}
         AND ${enabledExpr("u.local_access")}
         AND TRIM(NVL(u.username, '')) IS NOT NULL
         AND TRIM(NVL(u.username, '')) <> ''
       ORDER BY LOWER(TRIM(u.username))`,
      { tenantKey: normalized },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      tenantKey: fromDbValue(row.TENANT_KEY),
      username: fromDbValue(row.USERNAME),
      passwordHash: fromDbValue(row.PASSWORD_HASH),
      role: fromDbValue(row.ROLE),
      personId: fromDbValue(row.PERSON_ID),
      isEnabled: fromDbValue(row.IS_ENABLED) === "1",
      failedAttempts: Number.parseInt(fromDbValue(row.FAILED_ATTEMPTS), 10) || 0,
      lockedUntil: fromDbValue(row.LOCKED_UNTIL),
      mustChangePassword: fromDbValue(row.MUST_CHANGE_PASSWORD) === "1",
    }));
  });
}

export async function getOciPeopleRows(tenantKey?: string): Promise<SheetRecord[]> {
  const cols = TABLES.People.headers.join(", ");
  if (!tenantKey) {
    return withConnection(async (connection) => {
      await ensurePeopleTableCompatibility(connection);
      const result = await connection.execute(
        `SELECT ${cols} FROM people ORDER BY display_name, person_id`,
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const rows = (result.rows ?? []) as Record<string, unknown>[];
      return rows.map((row, idx) => ({
        rowNumber: idx + 2,
        data: Object.fromEntries(TABLES.People.headers.map((header) => [header, fromDbValue(row[header.toUpperCase()])])),
      }));
    });
  }
  const normalized = tenantKey.trim().toLowerCase();
  return withConnection(async (connection) => {
    await ensurePeopleTableCompatibility(connection);
    const result = await connection.execute(
      `SELECT ${TABLES.People.headers.map((h) => `p.${h}`).join(", ")}
       FROM people p
       INNER JOIN person_family_groups m
         ON TRIM(m.person_id) = TRIM(p.person_id)
       WHERE LOWER(TRIM(m.family_group_key)) = :tenantKey
         AND (${enabledExpr("m.is_enabled")} OR TRIM(NVL(m.is_enabled, '')) = '')
       ORDER BY p.display_name, p.person_id`,
      [normalized],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row, idx) => ({
      rowNumber: idx + 2,
      data: Object.fromEntries(TABLES.People.headers.map((header) => [header, fromDbValue(row[header.toUpperCase()])])),
    }));
  });
}

export async function getOciRelationshipsForTenant(tenantKey: string): Promise<SheetRecord[]> {
  const normalized = tenantKey.trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT DISTINCT
         r.family_group_key,
         r.rel_id,
         r.from_person_id,
         r.to_person_id,
         r.rel_type
       FROM relationships r
       INNER JOIN person_family_groups m_from
         ON TRIM(m_from.person_id) = TRIM(r.from_person_id)
       INNER JOIN person_family_groups m_to
         ON TRIM(m_to.person_id) = TRIM(r.to_person_id)
       WHERE LOWER(TRIM(m_from.family_group_key)) = :tenantKey
         AND LOWER(TRIM(m_to.family_group_key)) = :tenantKey
         AND (${enabledExpr("m_from.is_enabled")} OR TRIM(NVL(m_from.is_enabled, '')) = '')
         AND (${enabledExpr("m_to.is_enabled")} OR TRIM(NVL(m_to.is_enabled, '')) = '')
       ORDER BY r.rel_id`,
      { tenantKey: normalized },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row, idx) => ({
      rowNumber: idx + 2,
      data: {
        family_group_key: fromDbValue(row.FAMILY_GROUP_KEY),
        rel_id: fromDbValue(row.REL_ID),
        from_person_id: fromDbValue(row.FROM_PERSON_ID),
        to_person_id: fromDbValue(row.TO_PERSON_ID),
        rel_type: fromDbValue(row.REL_TYPE),
      },
    }));
  });
}

export async function getOciHouseholdsForTenant(tenantKey: string): Promise<SheetRecord[]> {
  const normalized = tenantKey.trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT
         family_group_key,
         household_id,
         husband_person_id,
         wife_person_id,
         label,
         notes,
         wedding_photo_file_id
       FROM households
       WHERE LOWER(TRIM(family_group_key)) = :tenantKey
       ORDER BY household_id`,
      [normalized],
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row, idx) => ({
      rowNumber: idx + 2,
      data: {
        family_group_key: fromDbValue(row.FAMILY_GROUP_KEY),
        household_id: fromDbValue(row.HOUSEHOLD_ID),
        husband_person_id: fromDbValue(row.HUSBAND_PERSON_ID),
        wife_person_id: fromDbValue(row.WIFE_PERSON_ID),
        label: fromDbValue(row.LABEL),
        notes: fromDbValue(row.NOTES),
        wedding_photo_file_id: fromDbValue(row.WEDDING_PHOTO_FILE_ID),
      },
    }));
  });
}

export async function upsertOciPersonFamilyGroupMembership(
  personId: string,
  familyGroupKey: string,
  isEnabled: boolean
): Promise<"created" | "updated"> {
  const normalizedPersonId = personId.trim();
  const normalizedFamilyGroupKey = familyGroupKey.trim().toLowerCase();
  if (!normalizedPersonId || !normalizedFamilyGroupKey) {
    throw new Error("person_id and family_group_key are required");
  }
  const enabledValue = isEnabled ? "TRUE" : "FALSE";
  return withConnection(async (connection) => {
    const update = await connection.execute(
      `UPDATE person_family_groups
       SET is_enabled = :isEnabled
       WHERE TRIM(person_id) = :personId
         AND LOWER(TRIM(family_group_key)) = :familyGroupKey`,
      {
        isEnabled: enabledValue,
        personId: normalizedPersonId,
        familyGroupKey: normalizedFamilyGroupKey,
      },
      { autoCommit: false }
    );
    if ((update.rowsAffected ?? 0) > 0) {
      await connection.commit();
      return "updated";
    }
    await connection.execute(
      `INSERT INTO person_family_groups (person_id, family_group_key, is_enabled)
       VALUES (:personId, :familyGroupKey, :isEnabled)`,
      {
        personId: normalizedPersonId,
        familyGroupKey: normalizedFamilyGroupKey,
        isEnabled: enabledValue,
      },
      { autoCommit: false }
    );
    await connection.commit();
    return "created";
  });
}

export async function upsertOciMediaAsset(input: {
  mediaId: string;
  fileId: string;
  storageProvider?: string;
  mimeType?: string;
  fileName?: string;
  fileSizeBytes?: string;
  mediaMetadata?: string;
  createdAt?: string;
}) {
  const mediaId = input.mediaId.trim();
  const fileId = input.fileId.trim();
  if (!mediaId || !fileId) {
    throw new Error("media_id and file_id are required");
  }
  return withConnection(async (connection) => {
    await connection.execute(
      `MERGE INTO media_assets t
       USING (
         SELECT :mediaId AS media_id,
                :fileId AS file_id,
                :storageProvider AS storage_provider,
                :mimeType AS mime_type,
                :fileName AS file_name,
                :fileSizeBytes AS file_size_bytes,
                :mediaMetadata AS media_metadata,
                :createdAt AS created_at
         FROM dual
       ) s
       ON (TRIM(t.media_id) = TRIM(s.media_id))
       WHEN MATCHED THEN UPDATE SET
         t.file_id = s.file_id,
         t.storage_provider = s.storage_provider,
         t.mime_type = s.mime_type,
         t.file_name = s.file_name,
         t.file_size_bytes = s.file_size_bytes,
         t.media_metadata = s.media_metadata,
         t.created_at = s.created_at
       WHEN NOT MATCHED THEN INSERT (
         media_id,
         file_id,
         storage_provider,
         mime_type,
         file_name,
         file_size_bytes,
         media_metadata,
         created_at
       ) VALUES (
         s.media_id,
         s.file_id,
         s.storage_provider,
         s.mime_type,
         s.file_name,
         s.file_size_bytes,
         s.media_metadata,
         s.created_at
       )`,
      {
        mediaId,
        fileId,
        storageProvider: (input.storageProvider ?? "gdrive").trim(),
        mimeType: (input.mimeType ?? "").trim(),
        fileName: (input.fileName ?? "").trim(),
        fileSizeBytes: (input.fileSizeBytes ?? "").trim(),
        mediaMetadata: (input.mediaMetadata ?? "").trim(),
        createdAt: (input.createdAt ?? "").trim(),
      },
      { autoCommit: true },
    );
  });
}

export async function upsertOciMediaLink(input: {
  familyGroupKey: string;
  linkId: string;
  mediaId: string;
  entityType: "person" | "household" | "attribute";
  entityId: string;
  usageType?: string;
  label?: string;
  description?: string;
  photoDate?: string;
  isPrimary?: boolean;
  sortOrder?: number;
  mediaMetadata?: string;
  createdAt?: string;
}) {
  const familyGroupKey = input.familyGroupKey.trim().toLowerCase();
  const linkId = input.linkId.trim();
  const mediaId = input.mediaId.trim();
  const entityId = input.entityId.trim();
  if (!familyGroupKey || !linkId || !mediaId || !entityId) {
    throw new Error("family_group_key, link_id, media_id, and entity_id are required");
  }
  return withConnection(async (connection) => {
    await connection.execute(
      `MERGE INTO media_links t
       USING (
         SELECT :familyGroupKey AS family_group_key,
                :linkId AS link_id,
                :mediaId AS media_id,
                :entityType AS entity_type,
                :entityId AS entity_id,
                :usageType AS usage_type,
                :label AS label,
                :description AS description,
                :photoDate AS photo_date,
                :isPrimary AS is_primary,
                :sortOrder AS sort_order,
                :mediaMetadata AS media_metadata,
                :createdAt AS created_at
         FROM dual
       ) s
       ON (TRIM(t.link_id) = TRIM(s.link_id))
       WHEN MATCHED THEN UPDATE SET
         t.family_group_key = s.family_group_key,
         t.media_id = s.media_id,
         t.entity_type = s.entity_type,
         t.entity_id = s.entity_id,
         t.usage_type = s.usage_type,
         t.label = s.label,
         t.description = s.description,
         t.photo_date = s.photo_date,
         t.is_primary = s.is_primary,
         t.sort_order = s.sort_order,
         t.media_metadata = s.media_metadata,
         t.created_at = s.created_at
       WHEN NOT MATCHED THEN INSERT (
         family_group_key,
         link_id,
         media_id,
         entity_type,
         entity_id,
         usage_type,
         label,
         description,
         photo_date,
         is_primary,
         sort_order,
         media_metadata,
         created_at
       ) VALUES (
         s.family_group_key,
         s.link_id,
         s.media_id,
         s.entity_type,
         s.entity_id,
         s.usage_type,
         s.label,
         s.description,
         s.photo_date,
         s.is_primary,
         s.sort_order,
         s.media_metadata,
         s.created_at
       )`,
      {
        familyGroupKey,
        linkId,
        mediaId,
        entityType: input.entityType,
        entityId,
        usageType: (input.usageType ?? "").trim(),
        label: (input.label ?? "").trim(),
        description: (input.description ?? "").trim(),
        photoDate: (input.photoDate ?? "").trim(),
        isPrimary: input.isPrimary ? "TRUE" : "FALSE",
        sortOrder: String(input.sortOrder ?? 0),
        mediaMetadata: (input.mediaMetadata ?? "").trim(),
        createdAt: (input.createdAt ?? "").trim(),
      },
      { autoCommit: true },
    );
  });
}

export async function setOciPrimaryMediaLink(input: {
  familyGroupKey: string;
  entityType: "person" | "household" | "attribute";
  entityId: string;
  usageType?: string;
  linkId: string;
}) {
  const familyGroupKey = input.familyGroupKey.trim().toLowerCase();
  const entityType = input.entityType;
  const entityId = input.entityId.trim();
  const usageType = (input.usageType ?? "").trim();
  const linkId = input.linkId.trim();
  if (!familyGroupKey || !entityId || !linkId) {
    throw new Error("family_group_key, entity_id and link_id are required");
  }
  return withConnection(async (connection) => {
    await connection.execute(
      `UPDATE media_links
       SET is_primary = CASE
         WHEN TRIM(link_id) = :linkId THEN 'TRUE'
         ELSE 'FALSE'
       END
       WHERE LOWER(TRIM(family_group_key)) = :familyGroupKey
         AND LOWER(TRIM(entity_type)) = :entityType
         AND TRIM(entity_id) = :entityId
         AND LOWER(TRIM(NVL(usage_type, ''))) = :usageType`,
      {
        linkId,
        familyGroupKey,
        entityType,
        entityId,
        usageType: usageType.toLowerCase(),
      },
      { autoCommit: true },
    );
  });
}

export async function getOciMediaLinksForEntity(input: {
  familyGroupKey: string;
  entityType: "person" | "household" | "attribute";
  entityId: string;
  usageType?: string;
}): Promise<OciMediaLinkRow[]> {
  const familyGroupKey = input.familyGroupKey.trim().toLowerCase();
  const entityType = input.entityType;
  const entityId = input.entityId.trim();
  const usageType = (input.usageType ?? "").trim().toLowerCase();
  if (!familyGroupKey || !entityId) {
    return [];
  }
  return withConnection(async (connection) => {
    const usageClause = usageType ? "AND LOWER(TRIM(NVL(l.usage_type, ''))) = :usageType" : "";
    const result = await connection.execute(
      `SELECT
         l.family_group_key,
         l.link_id,
         l.media_id,
         l.entity_type,
         l.entity_id,
         l.usage_type,
         a.file_id,
         l.label,
         l.description,
         l.photo_date,
         l.is_primary,
         l.sort_order,
         COALESCE(NULLIF(TRIM(l.media_metadata), ''), a.media_metadata) AS media_metadata,
         l.created_at
       FROM media_links l
       INNER JOIN media_assets a
         ON TRIM(a.media_id) = TRIM(l.media_id)
       WHERE LOWER(TRIM(l.family_group_key)) = :familyGroupKey
         AND LOWER(TRIM(l.entity_type)) = :entityType
         AND TRIM(l.entity_id) = :entityId
         ${usageClause}
       ORDER BY
         CASE WHEN LOWER(TRIM(NVL(l.is_primary, 'FALSE'))) = 'true' THEN 0 ELSE 1 END,
         TO_NUMBER(NVL(NULLIF(TRIM(l.sort_order), ''), '0')),
         l.created_at,
         l.link_id`,
      usageType
        ? { familyGroupKey, entityType, entityId, usageType }
        : { familyGroupKey, entityType, entityId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      familyGroupKey: fromDbValue(row.FAMILY_GROUP_KEY),
      linkId: fromDbValue(row.LINK_ID),
      mediaId: fromDbValue(row.MEDIA_ID),
      entityType: fromDbValue(row.ENTITY_TYPE),
      entityId: fromDbValue(row.ENTITY_ID),
      usageType: fromDbValue(row.USAGE_TYPE),
      fileId: fromDbValue(row.FILE_ID),
      label: fromDbValue(row.LABEL),
      description: fromDbValue(row.DESCRIPTION),
      photoDate: fromDbValue(row.PHOTO_DATE),
      isPrimary: fromDbValue(row.IS_PRIMARY).trim().toLowerCase() === "true",
      sortOrder: Number.parseInt(fromDbValue(row.SORT_ORDER), 10) || 0,
      mediaMetadata: fromDbValue(row.MEDIA_METADATA),
      createdAt: fromDbValue(row.CREATED_AT),
    }));
  });
}

export async function deleteOciMediaLink(linkId: string) {
  const normalized = linkId.trim();
  if (!normalized) {
    return 0;
  }
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `DELETE FROM media_links WHERE TRIM(link_id) = :linkId`,
      { linkId: normalized },
      { autoCommit: true },
    );
    return result.rowsAffected ?? 0;
  });
}
