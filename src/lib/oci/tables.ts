import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import oracledb from "oracledb";
import type { TableRecord } from "@/lib/data/types";
import { buildMediaKindMetadata, inferStoredMediaKind, parseMediaMetadata } from "@/lib/media/upload";

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
const OCI_RECOVERABLE_CONNECTION_ERROR_CODES = new Set(["NJS-500", "NJS-521"]);
const OCI_RECOVERABLE_CONNECTION_RETRY_DELAY_MS = 120;
const OCI_RECOVERABLE_CONNECTION_MAX_ATTEMPTS = 2;
let peopleTableCompatEnsured = false;
let familyConfigCompatEnsured = false;
let householdsTableCompatEnsured = false;
let mediaAssetsTableCompatEnsured = false;
let userAccessTableCompatEnsured = false;
let invitesTableCompatEnsured = false;
let personFamilyGroupsTableCompatEnsured = false;
let passwordResetsTableCompatEnsured = false;
let auditLogTableCompatEnsured = false;
let faceInstancesTableCompatEnsured = false;
let faceMatchesTableCompatEnsured = false;
let personFaceProfilesTableCompatEnsured = false;
export const OCI_GLOBAL_FACE_SCOPE_KEY = "__global__";

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
    headers: ["person_id", "family_group_key", "is_enabled", "family_group_relationship_type"],
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
  MediaAssets: {
    tableName: "media_assets",
    headers: [
      "media_id",
      "file_id",
      "media_kind",
      "label",
      "description",
      "photo_date",
      "source_provider",
      "source_file_id",
      "original_object_key",
      "thumbnail_object_key",
      "checksum_sha256",
      "mime_type",
      "file_name",
      "file_size_bytes",
      "media_width",
      "media_height",
      "media_duration_sec",
      "media_metadata",
      "created_at",
      "exif_extracted_at",
      "exif_source_tag",
      "exif_capture_date",
      "exif_capture_timestamp_raw",
      "exif_make",
      "exif_model",
      "exif_software",
      "exif_width",
      "exif_height",
      "exif_orientation",
      "exif_fingerprint",
    ],
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
  FaceInstances: {
    tableName: "face_instances",
    headers: [
      "family_group_key",
      "face_id",
      "file_id",
      "bbox_x",
      "bbox_y",
      "bbox_w",
      "bbox_h",
      "detection_confidence",
      "quality_score",
      "embedding_json",
      "created_at",
      "updated_at",
    ],
  },
  FaceMatches: {
    tableName: "face_matches",
    headers: [
      "family_group_key",
      "match_id",
      "face_id",
      "candidate_person_id",
      "confidence_score",
      "match_status",
      "reviewed_by",
      "reviewed_at",
      "created_at",
      "match_metadata",
    ],
  },
  PersonFaceProfiles: {
    tableName: "person_face_profiles",
    headers: [
      "family_group_key",
      "profile_id",
      "person_id",
      "source_file_id",
      "sample_count",
      "embedding_json",
      "updated_at",
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
      "attribute_kind",
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
      "last_login_at",
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
      "actor_username",
      "actor_person_id",
      "action",
      "entity_type",
      "entity_id",
      "family_group_key",
      "status",
      "details",
    ],
  },
  Invites: {
    tableName: "invites",
    headers: [
      "invite_id",
      "family_group_key",
      "person_id",
      "invite_email",
      "auth_mode",
      "role",
      "local_username",
      "family_groups_json",
      "status",
      "token_hash",
      "expires_at",
      "accepted_at",
      "accepted_by_email",
      "accepted_auth_mode",
      "created_at",
      "created_by_email",
      "created_by_person_id",
    ],
  },
  PasswordResets: {
    tableName: "password_resets",
    headers: [
      "reset_id",
      "person_id",
      "family_group_key",
      "reset_email",
      "username",
      "token_hash",
      "status",
      "expires_at",
      "completed_at",
      "created_at",
    ],
  },
};

export function listOciTables() {
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
           attribute_kind VARCHAR2(32),
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
      "attribute_kind VARCHAR2(32)",
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
    await connection.execute(`
      UPDATE attributes
         SET attribute_kind =
               CASE
                 WHEN NVL(TRIM(attribute_kind), '') <> '' THEN attribute_kind
                 WHEN LOWER(TRIM(attribute_type)) = 'other' AND NVL(TRIM(attribute_date), '') <> '' THEN 'event'
                 WHEN LOWER(TRIM(attribute_type)) IN (
                   'birth',
                   'education',
                   'religious',
                   'accomplishment',
                   'injury_health',
                   'life_event',
                   'moved',
                   'employment',
                   'family_relationship',
                   'pet',
                   'travel'
                 ) THEN 'event'
                 ELSE 'descriptor'
               END
       WHERE NVL(TRIM(attribute_kind), '') = ''
    `);
    await connection.commit();
  });
}

function normalizeHeader(header: string) {
  const normalized = header.trim().toLowerCase();
  if (normalized === "tenant_key") return "family_group_key";
  if (normalized === "tenant_name") return "family_group_name";
  return normalized;
}

function resolveTable(tableName: string | string[]) {
  const names = Array.isArray(tableName) ? tableName : [tableName];
  for (const name of names) {
    if (TABLES[name]) return { table: name, config: TABLES[name] };
  }
  throw new Error(`OCI table mapping not configured for table name(s): ${names.join(", ")}`);
}

function resolveIdColumn(headers: string[], idColumn?: string): string {
  if (idColumn) {
    const match = headers.find((h) => normalizeHeader(h) === normalizeHeader(idColumn));
    if (match) return match;
  }
  for (const fallback of ["id", "person_id", "record_id", "user_email", "rel_id", "household_id", "attribute_id", "photo_id", "media_id", "link_id", "invite_id", "reset_id", "face_id", "match_id", "profile_id"]) {
    const match = headers.find((h) => normalizeHeader(h) === fallback);
    if (match) return match;
  }
  throw new Error("No id column found. Provide idColumn query parameter.");
}

function fromDbValue(value: unknown) {
  return value == null ? "" : String(value);
}

function isLocalAliasEmail(value: string) {
  return value.trim().toLowerCase().endsWith("@local");
}

function getErrorCode(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code.trim().toUpperCase() : "";
}

function isRecoverableOciConnectionError(error: unknown) {
  const code = getErrorCode(error);
  if (OCI_RECOVERABLE_CONNECTION_ERROR_CODES.has(code)) {
    return true;
  }
  const message = String((error as Error | undefined)?.message ?? "").toUpperCase();
  if (!message) {
    return false;
  }
  if (message.includes("NJS-500") || message.includes("NJS-521")) {
    return true;
  }
  if (message.includes("END-OF-FILE ON COMMUNICATION CHANNEL")) {
    return true;
  }
  return false;
}

async function withConnection<T>(run: (connection: OciConnection) => Promise<T>) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= OCI_RECOVERABLE_CONNECTION_MAX_ATTEMPTS; attempt += 1) {
    let connection: OciConnection | null = null;
    try {
      const pool = await getPool();
      connection = (await pool.getConnection()) as OciConnection;
      return await run(connection);
    } catch (error) {
      lastError = error;
      const retryable =
        attempt < OCI_RECOVERABLE_CONNECTION_MAX_ATTEMPTS && isRecoverableOciConnectionError(error);
      if (!retryable) {
        throw error;
      }
      // Reset cached pool on recoverable transport failures and retry once.
      poolPromise = null;
      await waitMs(OCI_RECOVERABLE_CONNECTION_RETRY_DELAY_MS);
    } finally {
      if (connection) {
        await connection.close().catch(() => undefined);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OCI connection failed");
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

async function ensureMediaAssetsTableCompatibility(connection: OciConnection) {
  if (mediaAssetsTableCompatEnsured) {
    return;
  }
  const additiveColumns = [
    "media_kind VARCHAR2(32)",
    "label VARCHAR2(512 CHAR)",
    "description VARCHAR2(4000 CHAR)",
    "photo_date VARCHAR2(32)",
    "source_provider VARCHAR2(64)",
    "source_file_id VARCHAR2(512)",
    "original_object_key VARCHAR2(1024)",
    "thumbnail_object_key VARCHAR2(1024)",
    "checksum_sha256 VARCHAR2(128)",
    "media_width NUMBER",
    "media_height NUMBER",
    "media_duration_sec NUMBER",
    "exif_extracted_at VARCHAR2(64)",
    "exif_source_tag VARCHAR2(64)",
    "exif_capture_date VARCHAR2(32)",
    "exif_capture_timestamp_raw VARCHAR2(64)",
    "exif_make VARCHAR2(120)",
    "exif_model VARCHAR2(160)",
    "exif_software VARCHAR2(160)",
    "exif_width NUMBER",
    "exif_height NUMBER",
    "exif_orientation NUMBER",
    "exif_fingerprint VARCHAR2(128)",
  ];
  for (const columnSql of additiveColumns) {
    try {
      await connection.execute(`ALTER TABLE media_assets ADD (${columnSql})`);
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (!isColumnAlreadyCompatibleError(message)) {
        throw error;
      }
    }
  }
  await connection.commit();
  mediaAssetsTableCompatEnsured = true;
}

async function ensurePersonFamilyGroupsTableCompatibility(connection: OciConnection) {
  if (personFamilyGroupsTableCompatEnsured) {
    return;
  }
  try {
    await connection.execute(`ALTER TABLE person_family_groups ADD (family_group_relationship_type VARCHAR2(32))`);
    await connection.commit();
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (!isColumnAlreadyCompatibleError(message)) {
      throw error;
    }
  }
  personFamilyGroupsTableCompatEnsured = true;
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
        // Avoid failing the user-facing request on transient DDL contention; skip remaining attempts.
        if (isTransientDdlConcurrencyError(message)) {
          applied = true;
          break;
        }
        throw error;
      }
    }
  }
  householdsTableCompatEnsured = true;
}

async function ensureInvitesTableCompatibility(connection: OciConnection) {
  if (invitesTableCompatEnsured) {
    return;
  }

  try {
    await connection.execute(
      `CREATE TABLE invites (
         invite_id VARCHAR2(128) PRIMARY KEY,
         family_group_key VARCHAR2(128),
         person_id VARCHAR2(128) NOT NULL,
         invite_email VARCHAR2(320) NOT NULL,
         auth_mode VARCHAR2(32) NOT NULL,
         role VARCHAR2(32),
         local_username VARCHAR2(256),
         family_groups_json CLOB,
         status VARCHAR2(32),
         token_hash VARCHAR2(128) NOT NULL,
         expires_at VARCHAR2(64),
         accepted_at VARCHAR2(64),
         accepted_by_email VARCHAR2(320),
         accepted_auth_mode VARCHAR2(32),
         created_at VARCHAR2(64),
         created_by_email VARCHAR2(320),
         created_by_person_id VARCHAR2(128)
       )`,
    );
    await connection.execute(`CREATE UNIQUE INDEX ux_invites_token_hash ON invites(token_hash)`);
    await connection.execute(`CREATE INDEX ix_invites_email_status ON invites(invite_email, status)`);
    await connection.execute(`CREATE INDEX ix_invites_person_status ON invites(person_id, status)`);
    await connection.commit();
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (!/ORA-00955|name is already used by an existing object/i.test(message)) {
      throw error;
    }
  }

  const additiveColumns = [
    "family_group_key VARCHAR2(128)",
    "person_id VARCHAR2(128)",
    "invite_email VARCHAR2(320)",
    "auth_mode VARCHAR2(32)",
    "role VARCHAR2(32)",
    "local_username VARCHAR2(256)",
    "family_groups_json CLOB",
    "status VARCHAR2(32)",
    "token_hash VARCHAR2(128)",
    "expires_at VARCHAR2(64)",
    "accepted_at VARCHAR2(64)",
    "accepted_by_email VARCHAR2(320)",
    "accepted_auth_mode VARCHAR2(32)",
    "created_at VARCHAR2(64)",
    "created_by_email VARCHAR2(320)",
    "created_by_person_id VARCHAR2(128)",
  ];
  for (const columnSql of additiveColumns) {
    try {
      await connection.execute(`ALTER TABLE invites ADD (${columnSql})`);
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (!isColumnAlreadyCompatibleError(message)) {
        throw error;
      }
    }
  }

  const indexStatements = [
    "CREATE UNIQUE INDEX ux_invites_token_hash ON invites(token_hash)",
    "CREATE INDEX ix_invites_email_status ON invites(invite_email, status)",
    "CREATE INDEX ix_invites_person_status ON invites(person_id, status)",
  ];
  for (const sql of indexStatements) {
    try {
      await connection.execute(sql);
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (!/ORA-00955|name is already used by an existing object/i.test(message)) {
        throw error;
      }
    }
  }
  await connection.commit();
  invitesTableCompatEnsured = true;
}

async function ensurePasswordResetsTableCompatibility(connection: OciConnection) {
  if (passwordResetsTableCompatEnsured) {
    return;
  }

  try {
    await connection.execute(
      `CREATE TABLE password_resets (
         reset_id VARCHAR2(128) PRIMARY KEY,
         person_id VARCHAR2(128) NOT NULL,
         family_group_key VARCHAR2(128) NOT NULL,
         reset_email VARCHAR2(320) NOT NULL,
         username VARCHAR2(256),
         token_hash VARCHAR2(128) NOT NULL,
         status VARCHAR2(32),
         expires_at VARCHAR2(64),
         completed_at VARCHAR2(64),
         created_at VARCHAR2(64)
       )`,
    );
    await connection.execute(`CREATE UNIQUE INDEX ux_password_resets_token_hash ON password_resets(token_hash)`);
    await connection.execute(`CREATE INDEX ix_password_resets_email_status ON password_resets(reset_email, status)`);
    await connection.execute(`CREATE INDEX ix_password_resets_person_status ON password_resets(person_id, status)`);
    await connection.commit();
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (!/ORA-00955|name is already used by an existing object/i.test(message)) {
      throw error;
    }
  }

  const additiveColumns = [
    "person_id VARCHAR2(128)",
    "family_group_key VARCHAR2(128)",
    "reset_email VARCHAR2(320)",
    "username VARCHAR2(256)",
    "token_hash VARCHAR2(128)",
    "status VARCHAR2(32)",
    "expires_at VARCHAR2(64)",
    "completed_at VARCHAR2(64)",
    "created_at VARCHAR2(64)",
  ];
  for (const columnSql of additiveColumns) {
    try {
      await connection.execute(`ALTER TABLE password_resets ADD (${columnSql})`);
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (!isColumnAlreadyCompatibleError(message)) {
        throw error;
      }
    }
  }

  const indexStatements = [
    "CREATE UNIQUE INDEX ux_password_resets_token_hash ON password_resets(token_hash)",
    "CREATE INDEX ix_password_resets_email_status ON password_resets(reset_email, status)",
    "CREATE INDEX ix_password_resets_person_status ON password_resets(person_id, status)",
  ];
  for (const sql of indexStatements) {
    try {
      await connection.execute(sql);
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (!/ORA-00955|name is already used by an existing object/i.test(message)) {
        throw error;
      }
    }
  }
  await connection.commit();
  passwordResetsTableCompatEnsured = true;
}

async function ensureAuditLogTableCompatibility(connection: OciConnection) {
  if (auditLogTableCompatEnsured) {
    return;
  }

  try {
    await connection.execute(
      `CREATE TABLE audit_log (
         event_id VARCHAR2(128) PRIMARY KEY,
         timestamp VARCHAR2(64),
         actor_email VARCHAR2(320),
         actor_username VARCHAR2(256),
         actor_person_id VARCHAR2(128),
         action VARCHAR2(64),
         entity_type VARCHAR2(64),
         entity_id VARCHAR2(256),
         family_group_key VARCHAR2(128),
         status VARCHAR2(32),
         details VARCHAR2(2000)
       )`,
    );
    await connection.execute(`CREATE INDEX ix_audit_log_family_timestamp ON audit_log(family_group_key, timestamp)`);
    await connection.execute(`CREATE INDEX ix_audit_log_email_timestamp ON audit_log(actor_email, timestamp)`);
    await connection.execute(`CREATE INDEX ix_audit_log_username_timestamp ON audit_log(actor_username, timestamp)`);
    await connection.commit();
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (!/ORA-00955|name is already used by an existing object/i.test(message)) {
      throw error;
    }
  }

  const additiveColumns = [
    "actor_email VARCHAR2(320)",
    "actor_username VARCHAR2(256)",
    "actor_person_id VARCHAR2(128)",
    "action VARCHAR2(64)",
    "entity_type VARCHAR2(64)",
    "entity_id VARCHAR2(256)",
    "family_group_key VARCHAR2(128)",
    "status VARCHAR2(32)",
    "details VARCHAR2(2000)",
  ];
  for (const columnSql of additiveColumns) {
    try {
      await connection.execute(`ALTER TABLE audit_log ADD (${columnSql})`);
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (!isColumnAlreadyCompatibleError(message)) {
        throw error;
      }
    }
  }

  const indexStatements = [
    "CREATE INDEX ix_audit_log_family_timestamp ON audit_log(family_group_key, timestamp)",
    "CREATE INDEX ix_audit_log_email_timestamp ON audit_log(actor_email, timestamp)",
    "CREATE INDEX ix_audit_log_username_timestamp ON audit_log(actor_username, timestamp)",
  ];
  for (const sql of indexStatements) {
    try {
      await connection.execute(sql);
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (!/ORA-00955|name is already used by an existing object/i.test(message)) {
        throw error;
      }
    }
  }

  await connection.commit();
  auditLogTableCompatEnsured = true;
}

async function ensureUserAccessTableCompatibility(connection: OciConnection) {
  if (userAccessTableCompatEnsured) {
    return;
  }
  try {
    await connection.execute(`ALTER TABLE user_access ADD (last_login_at VARCHAR2(64))`);
    await connection.commit();
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (!isColumnAlreadyCompatibleError(message)) {
      throw error;
    }
  }
  userAccessTableCompatEnsured = true;
}

async function ensureFaceInstancesTableCompatibility(connection: OciConnection) {
  if (faceInstancesTableCompatEnsured) {
    return;
  }

  try {
    await connection.execute(
      `CREATE TABLE face_instances (
         face_id VARCHAR2(128) PRIMARY KEY,
         family_group_key VARCHAR2(128) NOT NULL,
         file_id VARCHAR2(128) NOT NULL,
         bbox_x VARCHAR2(32),
         bbox_y VARCHAR2(32),
         bbox_w VARCHAR2(32),
         bbox_h VARCHAR2(32),
         detection_confidence VARCHAR2(32),
         quality_score VARCHAR2(32),
         embedding_json CLOB,
         created_at VARCHAR2(64),
         updated_at VARCHAR2(64)
       )`,
    );
    await connection.execute(`CREATE INDEX ix_face_instances_family_file ON face_instances(family_group_key, file_id)`);
    await connection.execute(`CREATE INDEX ix_face_instances_file ON face_instances(file_id)`);
    await connection.commit();
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (!/ORA-00955|name is already used by an existing object/i.test(message)) {
      throw error;
    }
  }

  const additiveColumns = [
    "family_group_key VARCHAR2(128)",
    "file_id VARCHAR2(128)",
    "bbox_x VARCHAR2(32)",
    "bbox_y VARCHAR2(32)",
    "bbox_w VARCHAR2(32)",
    "bbox_h VARCHAR2(32)",
    "detection_confidence VARCHAR2(32)",
    "quality_score VARCHAR2(32)",
    "embedding_json CLOB",
    "created_at VARCHAR2(64)",
    "updated_at VARCHAR2(64)",
  ];
  for (const columnSql of additiveColumns) {
    try {
      await connection.execute(`ALTER TABLE face_instances ADD (${columnSql})`);
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (!isColumnAlreadyCompatibleError(message)) {
        throw error;
      }
    }
  }

  const indexStatements = [
    "CREATE INDEX ix_face_instances_family_file ON face_instances(family_group_key, file_id)",
    "CREATE INDEX ix_face_instances_file ON face_instances(file_id)",
  ];
  for (const sql of indexStatements) {
    try {
      await connection.execute(sql);
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (!/ORA-00955|name is already used by an existing object/i.test(message)) {
        throw error;
      }
    }
  }

  await connection.commit();
  faceInstancesTableCompatEnsured = true;
}

async function ensureFaceMatchesTableCompatibility(connection: OciConnection) {
  if (faceMatchesTableCompatEnsured) {
    return;
  }

  try {
    await connection.execute(
      `CREATE TABLE face_matches (
         match_id VARCHAR2(128) PRIMARY KEY,
         family_group_key VARCHAR2(128) NOT NULL,
         face_id VARCHAR2(128) NOT NULL,
         candidate_person_id VARCHAR2(128) NOT NULL,
         confidence_score VARCHAR2(32),
         match_status VARCHAR2(32),
         reviewed_by VARCHAR2(320),
         reviewed_at VARCHAR2(64),
         created_at VARCHAR2(64),
         match_metadata CLOB
       )`,
    );
    await connection.execute(`CREATE INDEX ix_face_matches_face ON face_matches(face_id)`);
    await connection.execute(`CREATE INDEX ix_face_matches_person ON face_matches(candidate_person_id)`);
    await connection.execute(`CREATE INDEX ix_face_matches_family_status ON face_matches(family_group_key, match_status)`);
    await connection.commit();
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (!/ORA-00955|name is already used by an existing object/i.test(message)) {
      throw error;
    }
  }

  const additiveColumns = [
    "family_group_key VARCHAR2(128)",
    "face_id VARCHAR2(128)",
    "candidate_person_id VARCHAR2(128)",
    "confidence_score VARCHAR2(32)",
    "match_status VARCHAR2(32)",
    "reviewed_by VARCHAR2(320)",
    "reviewed_at VARCHAR2(64)",
    "created_at VARCHAR2(64)",
    "match_metadata CLOB",
  ];
  for (const columnSql of additiveColumns) {
    try {
      await connection.execute(`ALTER TABLE face_matches ADD (${columnSql})`);
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (!isColumnAlreadyCompatibleError(message)) {
        throw error;
      }
    }
  }

  const indexStatements = [
    "CREATE INDEX ix_face_matches_face ON face_matches(face_id)",
    "CREATE INDEX ix_face_matches_person ON face_matches(candidate_person_id)",
    "CREATE INDEX ix_face_matches_family_status ON face_matches(family_group_key, match_status)",
  ];
  for (const sql of indexStatements) {
    try {
      await connection.execute(sql);
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (!/ORA-00955|name is already used by an existing object/i.test(message)) {
        throw error;
      }
    }
  }

  await connection.commit();
  faceMatchesTableCompatEnsured = true;
}

async function ensurePersonFaceProfilesTableCompatibility(connection: OciConnection) {
  if (personFaceProfilesTableCompatEnsured) {
    return;
  }

  try {
    await connection.execute(
      `CREATE TABLE person_face_profiles (
         profile_id VARCHAR2(128) PRIMARY KEY,
         family_group_key VARCHAR2(128) NOT NULL,
         person_id VARCHAR2(128) NOT NULL,
         source_file_id VARCHAR2(128),
         sample_count VARCHAR2(32),
         embedding_json CLOB,
         updated_at VARCHAR2(64)
       )`,
    );
    await connection.execute(`CREATE UNIQUE INDEX ux_person_face_profiles_person ON person_face_profiles(family_group_key, person_id)`);
    await connection.execute(`CREATE INDEX ix_person_face_profiles_source ON person_face_profiles(source_file_id)`);
    await connection.commit();
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (!/ORA-00955|name is already used by an existing object/i.test(message)) {
      throw error;
    }
  }

  const additiveColumns = [
    "family_group_key VARCHAR2(128)",
    "person_id VARCHAR2(128)",
    "source_file_id VARCHAR2(128)",
    "sample_count VARCHAR2(32)",
    "embedding_json CLOB",
    "updated_at VARCHAR2(64)",
  ];
  for (const columnSql of additiveColumns) {
    try {
      await connection.execute(`ALTER TABLE person_face_profiles ADD (${columnSql})`);
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (!isColumnAlreadyCompatibleError(message)) {
        throw error;
      }
    }
  }

  const indexStatements = [
    "CREATE UNIQUE INDEX ux_person_face_profiles_person ON person_face_profiles(family_group_key, person_id)",
    "CREATE INDEX ix_person_face_profiles_source ON person_face_profiles(source_file_id)",
  ];
  for (const sql of indexStatements) {
    try {
      await connection.execute(sql);
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (!/ORA-00955|name is already used by an existing object/i.test(message)) {
        throw error;
      }
    }
  }

  await connection.commit();
  personFaceProfilesTableCompatEnsured = true;
}

async function ensureTableCompatibility(connection: OciConnection, tableName: string) {
  if (tableName === "people") {
    await ensurePeopleTableCompatibility(connection);
    return;
  }
  if (tableName === "person_family_groups") {
    await ensurePersonFamilyGroupsTableCompatibility(connection);
    return;
  }
  if (tableName === "family_config") {
    await ensureFamilyConfigTableCompatibility(connection);
    return;
  }
  if (tableName === "media_assets") {
    await ensureMediaAssetsTableCompatibility(connection);
    return;
  }
  if (tableName === "households") {
    await ensureHouseholdsTableCompatibility(connection);
    return;
  }
  if (tableName === "user_access") {
    await ensureUserAccessTableCompatibility(connection);
    return;
  }
  if (tableName === "invites") {
    await ensureInvitesTableCompatibility(connection);
    return;
  }
  if (tableName === "password_resets") {
    await ensurePasswordResetsTableCompatibility(connection);
    return;
  }
  if (tableName === "audit_log") {
    await ensureAuditLogTableCompatibility(connection);
    return;
  }
  if (tableName === "face_instances") {
    await ensureFaceInstancesTableCompatibility(connection);
    return;
  }
  if (tableName === "face_matches") {
    await ensureFaceMatchesTableCompatibility(connection);
    return;
  }
  if (tableName === "person_face_profiles") {
    await ensurePersonFaceProfilesTableCompatibility(connection);
  }
}

export async function getOciTableRecords(tableName: string | string[]): Promise<TableRecord[]> {
  const { config } = resolveTable(tableName);
  const selectCols = config.headers.map((h) => (h === "date" ? "date_value AS date" : h)).join(", ");
  return withConnection(async (connection) => {
    await ensureTableCompatibility(connection, config.tableName);
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
  tableName: string | string[],
  recordId: string,
  idColumn?: string
): Promise<TableRecord | null> {
  const { config } = resolveTable(tableName);
  const effectiveIdColumn = resolveIdColumn(config.headers, idColumn);
  const selectCols = config.headers.map((h) => (h === "date" ? "date_value AS date" : h)).join(", ");
  const whereColumn = effectiveIdColumn === "date" ? "date_value" : effectiveIdColumn;
  return withConnection(async (connection) => {
    await ensureTableCompatibility(connection, config.tableName);
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
  tableName: string | string[],
  payloads: Record<string, string>[]
): Promise<TableRecord[]> {
  if (!payloads.length) return [];
  const { config } = resolveTable(tableName);
  const insertCols = config.headers.map((h) => (h === "date" ? "date_value" : h));
  const bindSlots = insertCols.map((_, idx) => `:${idx + 1}`).join(", ");
  const sql = `INSERT INTO ${config.tableName} (${insertCols.join(", ")}) VALUES (${bindSlots})`;

  return withConnection(async (connection) => {
    await ensureTableCompatibility(connection, config.tableName);
    const normalizedRows = payloads.map((payload) => normalizePayload(payload, config.headers));
    const binds = normalizedRows.map((row) => config.headers.map((h) => row[h] ?? ""));
    await connection.executeMany(sql, binds, { autoCommit: true });
    return normalizedRows.map((data) => ({ rowNumber: 0, data }));
  });
}

export async function updateOciTableRecordById(
  tableName: string | string[],
  recordId: string,
  payload: Record<string, string>,
  idColumn?: string
): Promise<TableRecord | null> {
  const { config } = resolveTable(tableName);
  const effectiveIdColumn = resolveIdColumn(config.headers, idColumn);
  const normalizedPayload = normalizePayload(payload, config.headers);
  const entries = Object.entries(normalizedPayload).filter(([key]) => normalizeHeader(key) !== normalizeHeader(effectiveIdColumn));
  if (!entries.length) {
    return getOciTableRecordById(tableName, recordId, effectiveIdColumn);
  }

  const setClauses = entries.map(([key], idx) => `${key === "date" ? "date_value" : key} = :v${idx + 1}`);
  const whereColumn = effectiveIdColumn === "date" ? "date_value" : effectiveIdColumn;
  const binds = entries.map(([, value]) => value);
  binds.push(recordId);

  return withConnection(async (connection) => {
    await ensureTableCompatibility(connection, config.tableName);
    const update = await connection.execute(
      `UPDATE ${config.tableName} SET ${setClauses.join(", ")} WHERE ${whereColumn} = :id`,
      binds,
      { autoCommit: true }
    );
    if (!update.rowsAffected) return null;
    return getOciTableRecordById(tableName, recordId, effectiveIdColumn);
  });
}

export async function deleteOciTableRecordById(
  tableName: string | string[],
  recordId: string,
  idColumn?: string
): Promise<boolean> {
  const { config } = resolveTable(tableName);
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

export async function deleteOciTableRows(tableName: string | string[], rowNumbers: number[]): Promise<number> {
  const clean = Array.from(new Set(rowNumbers.filter((r) => Number.isInteger(r) && r >= 2))).sort((a, b) => b - a);
  if (!clean.length) return 0;
  const { config } = resolveTable(tableName);
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
  lastLoginAt: string;
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
  lastLoginAt: string;
};

type OciAuditLogRow = {
  eventId: string;
  timestamp: string;
  actorEmail: string;
  actorUsername: string;
  actorPersonId: string;
  action: string;
  entityType: string;
  entityId: string;
  familyGroupKey: string;
  status: string;
  details: string;
};

export type OciMediaLinkRow = {
  familyGroupKey: string;
  linkId: string;
  mediaId: string;
  entityType: string;
  entityId: string;
  usageType: string;
  fileId: string;
  fileName: string;
  mediaKind: string;
  label: string;
  description: string;
  photoDate: string;
  isPrimary: boolean;
  sortOrder: number;
  mediaMetadata: string;
  createdAt: string;
  sourceProvider: string;
  originalObjectKey: string;
  thumbnailObjectKey: string;
  mimeType: string;
  fileSizeBytes: string;
  checksumSha256: string;
  mediaWidth: number;
  mediaHeight: number;
  mediaDurationSec: number;
};

export type OciMediaAssetLookup = {
  mediaId: string;
  fileId: string;
  mediaKind: string;
  label: string;
  description: string;
  photoDate: string;
  sourceProvider: string;
  sourceFileId: string;
  originalObjectKey: string;
  thumbnailObjectKey: string;
  checksumSha256: string;
  mimeType: string;
  fileName: string;
  fileSizeBytes: string;
  mediaWidth: number;
  mediaHeight: number;
  mediaDurationSec: number;
  mediaMetadata: string;
  createdAt: string;
  exifExtractedAt: string;
  exifSourceTag: string;
  exifCaptureDate: string;
  exifCaptureTimestampRaw: string;
  exifMake: string;
  exifModel: string;
  exifSoftware: string;
  exifWidth: number;
  exifHeight: number;
  exifOrientation: number;
  exifFingerprint: string;
};

export type OciPersonMediaAttributeRow = {
  attributeId: string;
  entityType: string;
  entityId: string;
  attributeType: string;
  attributeTypeCategory: string;
  attributeDate: string;
  attributeDetail: string;
  attributeNotes: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
};

export type OciFaceInstanceRow = {
  familyGroupKey: string;
  faceId: string;
  fileId: string;
  bboxX: number;
  bboxY: number;
  bboxW: number;
  bboxH: number;
  detectionConfidence: number;
  qualityScore: number;
  embeddingJson: string;
  createdAt: string;
  updatedAt: string;
};

export type OciFaceMatchRow = {
  familyGroupKey: string;
  matchId: string;
  faceId: string;
  candidatePersonId: string;
  confidenceScore: number;
  matchStatus: string;
  reviewedBy: string;
  reviewedAt: string;
  createdAt: string;
  matchMetadata: string;
};

export type OciPersonFaceProfileRow = {
  familyGroupKey: string;
  profileId: string;
  personId: string;
  sourceFileId: string;
  sampleCount: number;
  embeddingJson: string;
  updatedAt: string;
};

function parseStoredNumber(value: unknown) {
  const parsed = Number.parseFloat(fromDbValue(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function readLegacyMediaMetadataString(rawMetadata: string, key: string) {
  const parsed = parseMediaMetadata(rawMetadata);
  if (!parsed) {
    return "";
  }
  const direct = String(parsed[key] ?? "").trim();
  if (direct) {
    return direct;
  }
  const objectStorage = parsed.objectStorage;
  if (objectStorage && typeof objectStorage === "object") {
    return String((objectStorage as Record<string, unknown>)[key] ?? "").trim();
  }
  return "";
}

function readLegacyMediaMetadataNumber(rawMetadata: string, key: string) {
  const parsed = parseMediaMetadata(rawMetadata);
  if (!parsed) {
    return 0;
  }
  const direct = Number(parsed[key] ?? 0);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }
  const objectStorage = parsed.objectStorage;
  if (objectStorage && typeof objectStorage === "object") {
    const nested = Number((objectStorage as Record<string, unknown>)[key] ?? 0);
    if (Number.isFinite(nested) && nested > 0) {
      return nested;
    }
  }
  return 0;
}

function resolveStoredMediaKindValue(input: {
  mediaKind?: string;
  fileId?: string;
  fileName?: string;
  rawMetadata?: string;
}) {
  const normalized = String(input.mediaKind ?? "").trim().toLowerCase();
  if (normalized === "image" || normalized === "video" || normalized === "audio" || normalized === "document") {
    return normalized;
  }
  return inferStoredMediaKind(input.fileName || input.fileId || "", input.rawMetadata);
}

function mapOciMediaLinkRow(row: Record<string, unknown>): OciMediaLinkRow {
  const fileId = fromDbValue(row.FILE_ID);
  const fileName = fromDbValue(row.FILE_NAME);
  const rawMetadata = fromDbValue(row.RAW_MEDIA_METADATA);
  const mediaKind = resolveStoredMediaKindValue({
    mediaKind: fromDbValue(row.MEDIA_KIND),
    fileId,
    fileName,
    rawMetadata,
  });
  return {
    familyGroupKey: fromDbValue(row.FAMILY_GROUP_KEY),
    linkId: fromDbValue(row.LINK_ID),
    mediaId: fromDbValue(row.MEDIA_ID),
    entityType: fromDbValue(row.ENTITY_TYPE),
    entityId: fromDbValue(row.ENTITY_ID),
    usageType: fromDbValue(row.USAGE_TYPE),
    fileId,
    fileName,
    mediaKind,
    label: fromDbValue(row.LABEL),
    description: fromDbValue(row.DESCRIPTION),
    photoDate: fromDbValue(row.PHOTO_DATE),
    isPrimary: fromDbValue(row.IS_PRIMARY).trim().toLowerCase() === "true",
    sortOrder: Number.parseInt(fromDbValue(row.SORT_ORDER), 10) || 0,
    mediaMetadata: buildMediaKindMetadata(mediaKind),
    createdAt: fromDbValue(row.CREATED_AT),
    sourceProvider: fromDbValue(row.SOURCE_PROVIDER),
    originalObjectKey: fromDbValue(row.ORIGINAL_OBJECT_KEY),
    thumbnailObjectKey: fromDbValue(row.THUMBNAIL_OBJECT_KEY),
    mimeType: fromDbValue(row.MIME_TYPE),
    fileSizeBytes: fromDbValue(row.FILE_SIZE_BYTES),
    checksumSha256: fromDbValue(row.CHECKSUM_SHA256),
    mediaWidth: parseStoredNumber(row.MEDIA_WIDTH),
    mediaHeight: parseStoredNumber(row.MEDIA_HEIGHT),
    mediaDurationSec: parseStoredNumber(row.MEDIA_DURATION_SEC),
  };
}

function mapOciFaceInstanceRow(row: Record<string, unknown>): OciFaceInstanceRow {
  return {
    familyGroupKey: fromDbValue(row.FAMILY_GROUP_KEY),
    faceId: fromDbValue(row.FACE_ID),
    fileId: fromDbValue(row.FILE_ID),
    bboxX: parseStoredNumber(row.BBOX_X),
    bboxY: parseStoredNumber(row.BBOX_Y),
    bboxW: parseStoredNumber(row.BBOX_W),
    bboxH: parseStoredNumber(row.BBOX_H),
    detectionConfidence: parseStoredNumber(row.DETECTION_CONFIDENCE),
    qualityScore: parseStoredNumber(row.QUALITY_SCORE),
    embeddingJson: fromDbValue(row.EMBEDDING_JSON),
    createdAt: fromDbValue(row.CREATED_AT),
    updatedAt: fromDbValue(row.UPDATED_AT),
  };
}

function mapOciFaceMatchRow(row: Record<string, unknown>): OciFaceMatchRow {
  return {
    familyGroupKey: fromDbValue(row.FAMILY_GROUP_KEY),
    matchId: fromDbValue(row.MATCH_ID),
    faceId: fromDbValue(row.FACE_ID),
    candidatePersonId: fromDbValue(row.CANDIDATE_PERSON_ID),
    confidenceScore: parseStoredNumber(row.CONFIDENCE_SCORE),
    matchStatus: fromDbValue(row.MATCH_STATUS),
    reviewedBy: fromDbValue(row.REVIEWED_BY),
    reviewedAt: fromDbValue(row.REVIEWED_AT),
    createdAt: fromDbValue(row.CREATED_AT),
    matchMetadata: fromDbValue(row.MATCH_METADATA),
  };
}

function mapOciPersonFaceProfileRow(row: Record<string, unknown>): OciPersonFaceProfileRow {
  return {
    familyGroupKey: fromDbValue(row.FAMILY_GROUP_KEY),
    profileId: fromDbValue(row.PROFILE_ID),
    personId: fromDbValue(row.PERSON_ID),
    sourceFileId: fromDbValue(row.SOURCE_FILE_ID),
    sampleCount: Number.parseInt(fromDbValue(row.SAMPLE_COUNT), 10) || 0,
    embeddingJson: fromDbValue(row.EMBEDDING_JSON),
    updatedAt: fromDbValue(row.UPDATED_AT),
  };
}

async function queryOciMediaLinks(
  whereClause: string,
  binds: Record<string, string>,
): Promise<OciMediaLinkRow[]> {
  return withConnection(async (connection) => {
    await ensureTableCompatibility(connection, "media_assets");
    const result = await connection.execute(
      `SELECT
         l.family_group_key,
         l.link_id,
         l.media_id,
         l.entity_type,
         l.entity_id,
         l.usage_type,
         a.file_id,
         a.file_name,
         a.media_kind,
         COALESCE(NULLIF(TRIM(a.label), ''), l.label) AS label,
         COALESCE(NULLIF(TRIM(a.description), ''), l.description) AS description,
         COALESCE(NULLIF(TRIM(a.photo_date), ''), l.photo_date) AS photo_date,
         l.is_primary,
         l.sort_order,
         CASE
           WHEN a.media_metadata IS NOT NULL AND DBMS_LOB.GETLENGTH(a.media_metadata) > 0 THEN a.media_metadata
           ELSE l.media_metadata
         END AS raw_media_metadata,
         COALESCE(NULLIF(TRIM(a.created_at), ''), l.created_at) AS created_at,
         a.source_provider,
         a.original_object_key,
         a.thumbnail_object_key,
         a.mime_type,
         a.file_size_bytes,
         a.checksum_sha256,
         a.media_width,
         a.media_height,
         a.media_duration_sec
       FROM media_links l
       INNER JOIN media_assets a
         ON TRIM(a.media_id) = TRIM(l.media_id)
       ${whereClause}
        ORDER BY
          a.file_id,
          CASE WHEN LOWER(TRIM(NVL(l.is_primary, 'FALSE'))) = 'true' THEN 0 ELSE 1 END,
          CASE
            WHEN REGEXP_LIKE(TRIM(NVL(l.sort_order, '')), '^[+-]?[0-9]+([.][0-9]+)?$')
              THEN TO_NUMBER(TRIM(l.sort_order))
            ELSE 0
          END,
          COALESCE(NULLIF(TRIM(a.created_at), ''), l.created_at),
          l.link_id`,
      binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map(mapOciMediaLinkRow);
  });
}

function enabledExpr(column: string) {
  return `LOWER(TRIM(NVL(${column}, 'TRUE'))) IN ('true','yes','1')`;
}

function listFaceScopeKeys(requestedFamilyGroupKey?: string) {
  const requested = String(requestedFamilyGroupKey ?? "").trim().toLowerCase();
  const keys = [OCI_GLOBAL_FACE_SCOPE_KEY];
  if (requested && requested !== OCI_GLOBAL_FACE_SCOPE_KEY) {
    keys.push(requested);
  }
  return keys;
}

function buildScopePredicate(columnExpr: string, scopeKeys: string[], bindPrefix: string) {
  const binds: Record<string, string> = {};
  const clauses = scopeKeys.map((scopeKey, index) => {
    const bindKey = `${bindPrefix}${index}`;
    binds[bindKey] = scopeKey;
    return `LOWER(TRIM(${columnExpr})) = :${bindKey}`;
  });
  return {
    clause: clauses.length > 0 ? `(${clauses.join(" OR ")})` : "1 = 0",
    binds,
  };
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
    await ensureUserAccessTableCompatibility(connection);
    const result = await connection.execute(
      `SELECT
         NVL(LOWER(TRIM(u.user_email)), LOWER(TRIM(l.user_email))) AS user_email,
         CASE WHEN ${enabledExpr("u.google_access")} THEN 1 ELSE 0 END AS is_enabled,
         NVL(u.role, l.role) AS role,
         l.person_id AS person_id,
         l.family_group_key AS family_group_key,
         NVL(l.family_group_name, '') AS family_group_name,
         NVL(u.last_login_at, '') AS last_login_at
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
      userEmail: isLocalAliasEmail(fromDbValue(row.USER_EMAIL)) ? "" : fromDbValue(row.USER_EMAIL),
      isEnabled: fromDbValue(row.IS_ENABLED) === "1",
      role: fromDbValue(row.ROLE),
      personId: fromDbValue(row.PERSON_ID),
      tenantKey: fromDbValue(row.FAMILY_GROUP_KEY),
      tenantName: fromDbValue(row.FAMILY_GROUP_NAME),
      lastLoginAt: fromDbValue(row.LAST_LOGIN_AT),
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
  const isLocalAlias = isLocalAliasEmail(userEmail);

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
           LOWER(TRIM(user_email)) = :userEmail
           OR (
             :personId <> ''
             AND TRIM(person_id) = :personId
             AND (
               (:isLocalAlias = 'TRUE' AND LOWER(TRIM(user_email)) LIKE '%@local')
               OR (:isLocalAlias = 'FALSE' AND LOWER(TRIM(user_email)) NOT LIKE '%@local')
             )
           )
         )`,
      {
        userEmail,
        tenantName,
        role,
        personId,
        membershipEnabled,
        tenantKey,
        isLocalAlias: isLocalAlias ? "TRUE" : "FALSE",
      },
      { autoCommit: false },
    );

    const action: "created" | "updated" = (membershipUpdate.rowsAffected ?? 0) > 0 ? "updated" : "created";
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

export async function upsertOciUserFamilyGroupAccess(input: {
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
  const membershipEnabled = input.isEnabled ? "TRUE" : "FALSE";
  const isLocalAlias = isLocalAliasEmail(userEmail);

  if (!userEmail) {
    throw new Error("user_email is required");
  }
  if (!tenantKey) {
    throw new Error("family_group_key is required");
  }
  if (!personId) {
    throw new Error("person_id is required");
  }

  return withConnection(async (connection) => {
    const updated = await connection.execute(
      `UPDATE user_family_groups
       SET user_email = :userEmail,
           family_group_name = :tenantName,
           role = :role,
           person_id = :personId,
           is_enabled = :membershipEnabled
       WHERE LOWER(TRIM(family_group_key)) = :tenantKey
         AND (
           LOWER(TRIM(user_email)) = :userEmail
           OR (
             TRIM(person_id) = :personId
             AND (
               (:isLocalAlias = 'TRUE' AND LOWER(TRIM(user_email)) LIKE '%@local')
               OR (:isLocalAlias = 'FALSE' AND LOWER(TRIM(user_email)) NOT LIKE '%@local')
             )
           )
         )`,
      {
        userEmail,
        tenantName,
        role,
        personId,
        membershipEnabled,
        tenantKey,
        isLocalAlias: isLocalAlias ? "TRUE" : "FALSE",
      },
      { autoCommit: false },
    );

    const action: "created" | "updated" = (updated.rowsAffected ?? 0) > 0 ? "updated" : "created";
    if ((updated.rowsAffected ?? 0) === 0) {
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
    await ensureUserAccessTableCompatibility(connection);
    const result = await connection.execute(
      `SELECT DISTINCT
         :tenantKey AS tenant_key,
         LOWER(TRIM(u.username)) AS username,
         NVL(u.password_hash, '') AS password_hash,
         NVL(u.role, 'USER') AS role,
         NVL(u.person_id, '') AS person_id,
         CASE WHEN ${enabledExpr("u.is_enabled")} THEN 1 ELSE 0 END AS is_enabled,
         TO_NUMBER(NVL(NULLIF(TRIM(u.failed_attempts), ''), '0')) AS failed_attempts,
         NVL(u.locked_until, '') AS locked_until,
         CASE WHEN ${enabledExpr("u.must_change_password")} THEN 1 ELSE 0 END AS must_change_password,
         NVL(u.last_login_at, '') AS last_login_at
       FROM user_access u
       INNER JOIN user_family_groups l
         ON TRIM(l.person_id) = TRIM(u.person_id)
       WHERE LOWER(TRIM(l.family_group_key)) = :tenantKey
         AND ${enabledExpr("l.is_enabled")}
         AND ${enabledExpr("u.local_access")}
         AND LENGTH(TRIM(NVL(u.username, ' '))) > 0
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
      lastLoginAt: fromDbValue(row.LAST_LOGIN_AT),
    }));
  });
}

export async function getOciAuditLogRows(input: {
  familyGroupKey?: string;
  actorEmail?: string;
  actorUsername?: string;
  actorPersonId?: string;
  action?: string;
  entityType?: string;
  status?: string;
  fromTimestamp?: string;
  toTimestamp?: string;
  limit?: number;
}): Promise<OciAuditLogRow[]> {
  const limit = Math.min(Math.max(Number(input.limit ?? 200) || 200, 1), 500);
  const binds: Record<string, unknown> = { limit };
  const whereClauses: string[] = [];

  const familyGroupKey = input.familyGroupKey?.trim().toLowerCase() ?? "";
  if (familyGroupKey) {
    whereClauses.push(`LOWER(TRIM(family_group_key)) = :familyGroupKey`);
    binds.familyGroupKey = familyGroupKey;
  }

  const actorEmail = input.actorEmail?.trim().toLowerCase() ?? "";
  if (actorEmail) {
    whereClauses.push(`LOWER(TRIM(actor_email)) = :actorEmail`);
    binds.actorEmail = actorEmail;
  }

  const actorUsername = input.actorUsername?.trim().toLowerCase() ?? "";
  if (actorUsername) {
    whereClauses.push(`LOWER(TRIM(NVL(actor_username, CASE
      WHEN LOWER(TRIM(actor_email)) LIKE '%@local' THEN SUBSTR(TRIM(actor_email), 1, LENGTH(TRIM(actor_email)) - 6)
      ELSE NULL
    END))) = :actorUsername`);
    binds.actorUsername = actorUsername;
  }

  const actorPersonId = input.actorPersonId?.trim() ?? "";
  if (actorPersonId) {
    whereClauses.push(`TRIM(actor_person_id) = :actorPersonId`);
    binds.actorPersonId = actorPersonId;
  }

  const action = input.action?.trim().toUpperCase() ?? "";
  if (action) {
    whereClauses.push(`UPPER(TRIM(action)) = :action`);
    binds.action = action;
  }

  const entityType = input.entityType?.trim().toUpperCase() ?? "";
  if (entityType) {
    whereClauses.push(`UPPER(TRIM(entity_type)) = :entityType`);
    binds.entityType = entityType;
  }

  const status = input.status?.trim().toUpperCase() ?? "";
  if (status) {
    whereClauses.push(`UPPER(TRIM(status)) = :status`);
    binds.status = status;
  }

  const fromTimestamp = input.fromTimestamp?.trim() ?? "";
  if (fromTimestamp) {
    whereClauses.push(`TRIM(timestamp) >= :fromTimestamp`);
    binds.fromTimestamp = fromTimestamp;
  }

  const toTimestamp = input.toTimestamp?.trim() ?? "";
  if (toTimestamp) {
    whereClauses.push(`TRIM(timestamp) <= :toTimestamp`);
    binds.toTimestamp = toTimestamp;
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  return withConnection(async (connection) => {
    await ensureAuditLogTableCompatibility(connection);
    const result = await connection.execute(
      `SELECT *
       FROM (
         SELECT
           event_id,
           timestamp,
           actor_email,
           actor_username,
           actor_person_id,
           action,
           entity_type,
           entity_id,
           family_group_key,
           status,
           details
         FROM audit_log
         ${whereSql}
         ORDER BY timestamp DESC, event_id DESC
       )
       WHERE ROWNUM <= :limit`,
      binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      eventId: fromDbValue(row.EVENT_ID),
      timestamp: fromDbValue(row.TIMESTAMP),
      actorEmail: fromDbValue(row.ACTOR_EMAIL),
      actorUsername:
        fromDbValue(row.ACTOR_USERNAME) ||
        (() => {
          const actorEmailValue = fromDbValue(row.ACTOR_EMAIL).toLowerCase();
          return actorEmailValue.endsWith("@local") ? actorEmailValue.slice(0, -6) : "";
        })(),
      actorPersonId: fromDbValue(row.ACTOR_PERSON_ID),
      action: fromDbValue(row.ACTION),
      entityType: fromDbValue(row.ENTITY_TYPE),
      entityId: fromDbValue(row.ENTITY_ID),
      familyGroupKey: fromDbValue(row.FAMILY_GROUP_KEY),
      status: fromDbValue(row.STATUS),
      details: fromDbValue(row.DETAILS),
    }));
  });
}

export async function getOciPeopleRows(tenantKey?: string): Promise<TableRecord[]> {
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
    await ensurePersonFamilyGroupsTableCompatibility(connection);
    const result = await connection.execute(
      `SELECT ${TABLES.People.headers.map((h) => `p.${h}`).join(", ")},
              NVL(m.family_group_relationship_type, '') AS family_membership_relationship_type
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
      data: {
        ...Object.fromEntries(TABLES.People.headers.map((header) => [header, fromDbValue(row[header.toUpperCase()])])),
        family_membership_relationship_type: fromDbValue(row.FAMILY_MEMBERSHIP_RELATIONSHIP_TYPE),
      },
    }));
  });
}

export async function getOciRelationshipsForTenant(tenantKey: string): Promise<TableRecord[]> {
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

export async function getOciHouseholdsForTenant(tenantKey: string): Promise<TableRecord[]> {
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
    await ensurePersonFamilyGroupsTableCompatibility(connection);
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
      `INSERT INTO person_family_groups (person_id, family_group_key, is_enabled, family_group_relationship_type)
       VALUES (:personId, :familyGroupKey, :isEnabled, 'undeclared')`,
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

export async function setOciPersonFamilyGroupRelationshipType(
  personId: string,
  familyGroupKey: string,
  familyGroupRelationshipType: "founder" | "direct" | "in_law" | "undeclared",
): Promise<"created" | "updated" | "unchanged"> {
  const normalizedPersonId = personId.trim();
  const normalizedFamilyGroupKey = familyGroupKey.trim().toLowerCase();
  if (!normalizedPersonId || !normalizedFamilyGroupKey) {
    throw new Error("person_id and family_group_key are required");
  }
  const nextRelationshipType = familyGroupRelationshipType.trim().toLowerCase();
  return withConnection(async (connection) => {
    await ensurePersonFamilyGroupsTableCompatibility(connection);
    const existing = await connection.execute(
      `SELECT
         NVL(TRIM(is_enabled), '') AS is_enabled,
         NVL(TRIM(family_group_relationship_type), '') AS family_group_relationship_type
       FROM person_family_groups
       WHERE TRIM(person_id) = :personId
         AND LOWER(TRIM(family_group_key)) = :familyGroupKey
       FETCH FIRST 1 ROWS ONLY`,
      {
        personId: normalizedPersonId,
        familyGroupKey: normalizedFamilyGroupKey,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const current = (existing.rows?.[0] as Record<string, unknown> | undefined) ?? null;
    if (current) {
      const currentRelationshipType = fromDbValue(current.FAMILY_GROUP_RELATIONSHIP_TYPE).trim().toLowerCase();
      if (currentRelationshipType === nextRelationshipType) {
        return "unchanged";
      }
      await connection.execute(
        `UPDATE person_family_groups
         SET family_group_relationship_type = :familyGroupRelationshipType
         WHERE TRIM(person_id) = :personId
           AND LOWER(TRIM(family_group_key)) = :familyGroupKey`,
        {
          familyGroupRelationshipType: nextRelationshipType,
          personId: normalizedPersonId,
          familyGroupKey: normalizedFamilyGroupKey,
        },
        { autoCommit: false },
      );
      await connection.commit();
      return "updated";
    }
    await connection.execute(
      `INSERT INTO person_family_groups (person_id, family_group_key, is_enabled, family_group_relationship_type)
       VALUES (:personId, :familyGroupKey, 'TRUE', :familyGroupRelationshipType)`,
      {
        personId: normalizedPersonId,
        familyGroupKey: normalizedFamilyGroupKey,
        familyGroupRelationshipType: nextRelationshipType,
      },
      { autoCommit: false },
    );
    await connection.commit();
    return "created";
  });
}

export async function upsertOciMediaAsset(input: {
  mediaId: string;
  fileId: string;
  mediaKind?: string;
  label?: string;
  description?: string;
  photoDate?: string;
  sourceProvider?: string;
  sourceFileId?: string;
  originalObjectKey?: string;
  thumbnailObjectKey?: string;
  checksumSha256?: string;
  mimeType?: string;
  fileName?: string;
  fileSizeBytes?: string;
  mediaWidth?: number;
  mediaHeight?: number;
  mediaDurationSec?: number;
  createdAt?: string;
  exifExtractedAt?: string;
  exifSourceTag?: string;
  exifCaptureDate?: string;
  exifCaptureTimestampRaw?: string;
  exifMake?: string;
  exifModel?: string;
  exifSoftware?: string;
  exifWidth?: number;
  exifHeight?: number;
  exifOrientation?: number;
  exifFingerprint?: string;
}) {
  const mediaId = input.mediaId.trim();
  const fileId = input.fileId.trim();
  if (!mediaId || !fileId) {
    throw new Error("media_id and file_id are required");
  }
  return withConnection(async (connection) => {
    await ensureTableCompatibility(connection, "media_assets");
    const numberBind = (value: number | undefined) => ({
      val: Number.isFinite(value) ? value : null,
      type: oracledb.NUMBER,
    });
    await connection.execute(
      `MERGE INTO media_assets t
       USING (
         SELECT :mediaId AS media_id,
                :fileId AS file_id,
                :mediaKind AS media_kind,
                :label AS label,
                :description AS description,
                :photoDate AS photo_date,
                :sourceProvider AS source_provider,
                :sourceFileId AS source_file_id,
                :originalObjectKey AS original_object_key,
                :thumbnailObjectKey AS thumbnail_object_key,
                :checksumSha256 AS checksum_sha256,
                :mimeType AS mime_type,
                :fileName AS file_name,
                :fileSizeBytes AS file_size_bytes,
                :mediaWidth AS media_width,
                :mediaHeight AS media_height,
                :mediaDurationSec AS media_duration_sec,
                :createdAt AS created_at,
                :exifExtractedAt AS exif_extracted_at,
                :exifSourceTag AS exif_source_tag,
                :exifCaptureDate AS exif_capture_date,
                :exifCaptureTimestampRaw AS exif_capture_timestamp_raw,
                :exifMake AS exif_make,
                :exifModel AS exif_model,
                :exifSoftware AS exif_software,
                :exifWidth AS exif_width,
                :exifHeight AS exif_height,
                :exifOrientation AS exif_orientation,
                :exifFingerprint AS exif_fingerprint
         FROM dual
        ) s
        ON (TRIM(t.media_id) = TRIM(s.media_id))
        WHEN MATCHED THEN UPDATE SET
          t.file_id = COALESCE(NULLIF(TRIM(s.file_id), ''), t.file_id),
          t.media_kind = COALESCE(NULLIF(TRIM(s.media_kind), ''), t.media_kind),
          t.label = COALESCE(NULLIF(TRIM(s.label), ''), t.label),
          t.description = COALESCE(NULLIF(TRIM(s.description), ''), t.description),
          t.photo_date = COALESCE(NULLIF(TRIM(s.photo_date), ''), t.photo_date),
          t.source_provider = COALESCE(s.source_provider, t.source_provider),
          t.source_file_id = COALESCE(s.source_file_id, t.source_file_id),
          t.original_object_key = COALESCE(s.original_object_key, t.original_object_key),
          t.thumbnail_object_key = COALESCE(s.thumbnail_object_key, t.thumbnail_object_key),
          t.checksum_sha256 = COALESCE(s.checksum_sha256, t.checksum_sha256),
         t.mime_type = COALESCE(NULLIF(TRIM(s.mime_type), ''), t.mime_type),
          t.file_name = COALESCE(NULLIF(TRIM(s.file_name), ''), t.file_name),
          t.file_size_bytes = COALESCE(NULLIF(TRIM(s.file_size_bytes), ''), t.file_size_bytes),
          t.media_width = COALESCE(s.media_width, t.media_width),
          t.media_height = COALESCE(s.media_height, t.media_height),
          t.media_duration_sec = COALESCE(s.media_duration_sec, t.media_duration_sec),
          t.created_at = COALESCE(NULLIF(TRIM(t.created_at), ''), NULLIF(TRIM(s.created_at), '')),
          t.exif_extracted_at = COALESCE(s.exif_extracted_at, t.exif_extracted_at),
          t.exif_source_tag = COALESCE(s.exif_source_tag, t.exif_source_tag),
          t.exif_capture_date = COALESCE(s.exif_capture_date, t.exif_capture_date),
          t.exif_capture_timestamp_raw = COALESCE(s.exif_capture_timestamp_raw, t.exif_capture_timestamp_raw),
         t.exif_make = COALESCE(s.exif_make, t.exif_make),
         t.exif_model = COALESCE(s.exif_model, t.exif_model),
         t.exif_software = COALESCE(s.exif_software, t.exif_software),
         t.exif_width = COALESCE(s.exif_width, t.exif_width),
         t.exif_height = COALESCE(s.exif_height, t.exif_height),
         t.exif_orientation = COALESCE(s.exif_orientation, t.exif_orientation),
         t.exif_fingerprint = COALESCE(s.exif_fingerprint, t.exif_fingerprint)
        WHEN NOT MATCHED THEN INSERT (
          media_id,
          file_id,
          media_kind,
          label,
          description,
          photo_date,
          source_provider,
          source_file_id,
          original_object_key,
          thumbnail_object_key,
          checksum_sha256,
         mime_type,
          file_name,
          file_size_bytes,
          media_width,
          media_height,
          media_duration_sec,
          created_at,
          exif_extracted_at,
          exif_source_tag,
          exif_capture_date,
         exif_capture_timestamp_raw,
         exif_make,
         exif_model,
         exif_software,
         exif_width,
         exif_height,
         exif_orientation,
         exif_fingerprint
        ) VALUES (
          s.media_id,
          s.file_id,
          s.media_kind,
          s.label,
          s.description,
          s.photo_date,
          s.source_provider,
          s.source_file_id,
          s.original_object_key,
          s.thumbnail_object_key,
          s.checksum_sha256,
         s.mime_type,
          s.file_name,
          s.file_size_bytes,
          s.media_width,
          s.media_height,
          s.media_duration_sec,
          s.created_at,
          s.exif_extracted_at,
          s.exif_source_tag,
          s.exif_capture_date,
         s.exif_capture_timestamp_raw,
         s.exif_make,
         s.exif_model,
         s.exif_software,
         s.exif_width,
         s.exif_height,
         s.exif_orientation,
         s.exif_fingerprint
       )`,
      {
        mediaId,
        fileId,
        mediaKind: (input.mediaKind ?? "").trim() || null,
        label: (input.label ?? "").trim() || null,
        description: (input.description ?? "").trim() || null,
        photoDate: (input.photoDate ?? "").trim() || null,
        sourceProvider: input.sourceProvider ? input.sourceProvider.trim() : null,
        sourceFileId: input.sourceFileId ? input.sourceFileId.trim() : null,
        originalObjectKey: input.originalObjectKey ? input.originalObjectKey.trim() : null,
        thumbnailObjectKey: input.thumbnailObjectKey ? input.thumbnailObjectKey.trim() : null,
        checksumSha256: input.checksumSha256 ? input.checksumSha256.trim() : null,
        mimeType: (input.mimeType ?? "").trim(),
        fileName: (input.fileName ?? "").trim(),
        fileSizeBytes: (input.fileSizeBytes ?? "").trim(),
        mediaWidth: numberBind(input.mediaWidth),
        mediaHeight: numberBind(input.mediaHeight),
        mediaDurationSec: numberBind(input.mediaDurationSec),
        createdAt: (input.createdAt ?? "").trim(),
        exifExtractedAt: input.exifExtractedAt ? input.exifExtractedAt.trim() : null,
        exifSourceTag: input.exifSourceTag ? input.exifSourceTag.trim() : null,
        exifCaptureDate: input.exifCaptureDate ? input.exifCaptureDate.trim() : null,
        exifCaptureTimestampRaw: input.exifCaptureTimestampRaw ? input.exifCaptureTimestampRaw.trim() : null,
        exifMake: input.exifMake ? input.exifMake.trim() : null,
        exifModel: input.exifModel ? input.exifModel.trim() : null,
        exifSoftware: input.exifSoftware ? input.exifSoftware.trim() : null,
        exifWidth: numberBind(input.exifWidth),
        exifHeight: numberBind(input.exifHeight),
        exifOrientation: numberBind(input.exifOrientation),
        exifFingerprint: input.exifFingerprint ? input.exifFingerprint.trim() : null,
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
    const linkMetadata = "";
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
        mediaMetadata: linkMetadata,
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
  const usageClause = usageType ? "AND LOWER(TRIM(NVL(l.usage_type, ''))) = :usageType" : "";
  return queryOciMediaLinks(
    `WHERE LOWER(TRIM(l.family_group_key)) = :familyGroupKey
       AND LOWER(TRIM(l.entity_type)) = :entityType
       AND TRIM(l.entity_id) = :entityId
       ${usageClause}`,
    usageType
      ? { familyGroupKey, entityType, entityId, usageType }
      : { familyGroupKey, entityType, entityId },
  );
}

export async function getOciMediaLinksForEntityAcrossFamilies(input: {
  familyGroupKeys: string[];
  entityType: "person" | "household" | "attribute";
  entityId: string;
  usageType?: string;
}): Promise<OciMediaLinkRow[]> {
  const familyGroupKeys = Array.from(
    new Set(input.familyGroupKeys.map((value) => value.trim().toLowerCase()).filter(Boolean)),
  );
  const entityType = input.entityType;
  const entityId = input.entityId.trim();
  const usageType = (input.usageType ?? "").trim().toLowerCase();
  if (familyGroupKeys.length === 0 || !entityId) {
    return [];
  }
  const scopePredicate = buildScopePredicate("l.family_group_key", familyGroupKeys, "familyGroup");
  const usageClause = usageType ? "AND LOWER(TRIM(NVL(l.usage_type, ''))) = :usageType" : "";
  return queryOciMediaLinks(
    `WHERE ${scopePredicate.clause}
       AND LOWER(TRIM(l.entity_type)) = :entityType
       AND TRIM(l.entity_id) = :entityId
       ${usageClause}`,
    {
      ...scopePredicate.binds,
      entityType,
      entityId,
      ...(usageType ? { usageType } : {}),
    },
  );
}

export async function getOciMediaLinksForEntityAllFamilies(input: {
  entityType: "person" | "household" | "attribute";
  entityId: string;
  usageType?: string;
}): Promise<OciMediaLinkRow[]> {
  const entityType = input.entityType;
  const entityId = input.entityId.trim();
  const usageType = (input.usageType ?? "").trim().toLowerCase();
  if (!entityId) {
    return [];
  }
  const usageClause = usageType ? "AND LOWER(TRIM(NVL(l.usage_type, ''))) = :usageType" : "";
  return queryOciMediaLinks(
    `WHERE LOWER(TRIM(l.entity_type)) = :entityType
       AND TRIM(l.entity_id) = :entityId
       ${usageClause}`,
    usageType
      ? { entityType, entityId, usageType }
      : { entityType, entityId },
  );
}

export async function getOciMediaLinksForTenant(familyGroupKey: string): Promise<OciMediaLinkRow[]> {
  const normalizedFamilyGroupKey = familyGroupKey.trim().toLowerCase();
  if (!normalizedFamilyGroupKey) {
    return [];
  }
  return queryOciMediaLinks(
    `WHERE LOWER(TRIM(l.family_group_key)) = :familyGroupKey`,
    { familyGroupKey: normalizedFamilyGroupKey },
  );
}

export async function getOciMediaLinksForFile(input: {
  familyGroupKey: string;
  fileId: string;
}): Promise<OciMediaLinkRow[]> {
  const familyGroupKey = input.familyGroupKey.trim().toLowerCase();
  const fileId = input.fileId.trim();
  if (!familyGroupKey || !fileId) {
    return [];
  }
  return queryOciMediaLinks(
    `WHERE LOWER(TRIM(l.family_group_key)) = :familyGroupKey
       AND TRIM(a.file_id) = :fileId`,
    { familyGroupKey, fileId },
  );
}

export async function getOciMediaAssetByFileId(
  fileId: string,
  options?: { allowLegacyMetadataFallback?: boolean },
): Promise<OciMediaAssetLookup | null> {
  const normalizedFileId = fileId.trim();
  if (!normalizedFileId) {
    return null;
  }
  return withConnection(async (connection) => {
    await ensureTableCompatibility(connection, "media_assets");
    const result = await connection.execute(
      `SELECT
         a.media_id,
         a.file_id,
         a.media_kind,
         a.label,
         a.description,
         a.photo_date,
         a.source_provider,
         a.source_file_id,
         a.original_object_key,
         a.thumbnail_object_key,
         a.checksum_sha256,
         a.mime_type,
         a.file_name,
         a.file_size_bytes,
         a.media_width,
         a.media_height,
         a.media_duration_sec,
         a.media_metadata,
         a.created_at,
         a.exif_extracted_at,
         a.exif_source_tag,
         a.exif_capture_date,
         a.exif_capture_timestamp_raw,
         a.exif_make,
         a.exif_model,
         a.exif_software,
         a.exif_width,
         a.exif_height,
         a.exif_orientation,
         a.exif_fingerprint
        FROM media_assets a
        WHERE TRIM(a.file_id) = :fileId
        ORDER BY CASE
          WHEN NULLIF(TRIM(a.original_object_key), '') IS NOT NULL THEN 0
          ELSE 1
        END,
        a.created_at DESC NULLS LAST
        FETCH FIRST 1 ROWS ONLY`,
      { fileId: normalizedFileId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = (result.rows ?? [])[0] as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    const rawMetadata = fromDbValue(row.MEDIA_METADATA);
    const allowLegacyMetadataFallback = options?.allowLegacyMetadataFallback !== false;
    const fileName = fromDbValue(row.FILE_NAME);
    const mediaKind = resolveStoredMediaKindValue({
      mediaKind: fromDbValue(row.MEDIA_KIND),
      fileId: normalizedFileId,
      fileName,
      rawMetadata,
    });
    return {
      mediaId: fromDbValue(row.MEDIA_ID),
      fileId: fromDbValue(row.FILE_ID),
      mediaKind,
      label: fromDbValue(row.LABEL),
      description: fromDbValue(row.DESCRIPTION),
      photoDate: fromDbValue(row.PHOTO_DATE),
      sourceProvider:
        fromDbValue(row.SOURCE_PROVIDER) ||
        (allowLegacyMetadataFallback ? readLegacyMediaMetadataString(rawMetadata, "sourceProvider") : ""),
      sourceFileId:
        fromDbValue(row.SOURCE_FILE_ID) ||
        (allowLegacyMetadataFallback ? readLegacyMediaMetadataString(rawMetadata, "sourceFileId") : ""),
      originalObjectKey:
        fromDbValue(row.ORIGINAL_OBJECT_KEY) ||
        (allowLegacyMetadataFallback ? readLegacyMediaMetadataString(rawMetadata, "originalObjectKey") : ""),
      thumbnailObjectKey:
        fromDbValue(row.THUMBNAIL_OBJECT_KEY) ||
        (allowLegacyMetadataFallback ? readLegacyMediaMetadataString(rawMetadata, "thumbnailObjectKey") : ""),
      checksumSha256:
        fromDbValue(row.CHECKSUM_SHA256) ||
        (allowLegacyMetadataFallback ? readLegacyMediaMetadataString(rawMetadata, "checksumSha256") : ""),
      mimeType: fromDbValue(row.MIME_TYPE),
      fileName,
      fileSizeBytes: fromDbValue(row.FILE_SIZE_BYTES),
      mediaWidth:
        parseStoredNumber(row.MEDIA_WIDTH) ||
        (allowLegacyMetadataFallback ? readLegacyMediaMetadataNumber(rawMetadata, "width") : 0),
      mediaHeight:
        parseStoredNumber(row.MEDIA_HEIGHT) ||
        (allowLegacyMetadataFallback ? readLegacyMediaMetadataNumber(rawMetadata, "height") : 0),
      mediaDurationSec:
        parseStoredNumber(row.MEDIA_DURATION_SEC) ||
        (allowLegacyMetadataFallback ? readLegacyMediaMetadataNumber(rawMetadata, "durationSec") : 0),
      mediaMetadata: rawMetadata,
      createdAt: fromDbValue(row.CREATED_AT),
      exifExtractedAt: fromDbValue(row.EXIF_EXTRACTED_AT),
      exifSourceTag: fromDbValue(row.EXIF_SOURCE_TAG),
      exifCaptureDate: fromDbValue(row.EXIF_CAPTURE_DATE),
      exifCaptureTimestampRaw: fromDbValue(row.EXIF_CAPTURE_TIMESTAMP_RAW),
      exifMake: fromDbValue(row.EXIF_MAKE),
      exifModel: fromDbValue(row.EXIF_MODEL),
      exifSoftware: fromDbValue(row.EXIF_SOFTWARE),
      exifWidth: parseStoredNumber(row.EXIF_WIDTH),
      exifHeight: parseStoredNumber(row.EXIF_HEIGHT),
      exifOrientation: parseStoredNumber(row.EXIF_ORIENTATION),
      exifFingerprint: fromDbValue(row.EXIF_FINGERPRINT),
    };
  });
}

export async function getOciFaceInstancesForFile(input: {
  familyGroupKey: string;
  fileId: string;
}): Promise<OciFaceInstanceRow[]> {
  const familyGroupKey = input.familyGroupKey.trim().toLowerCase();
  const fileId = input.fileId.trim();
  if (!fileId) {
    return [];
  }
  return withConnection(async (connection) => {
    await ensureFaceInstancesTableCompatibility(connection);
    const scopeKeys = listFaceScopeKeys(familyGroupKey);
    const scopePredicate = buildScopePredicate("family_group_key", scopeKeys, "scope");
    const result = await connection.execute(
      `SELECT
         family_group_key,
         face_id,
         file_id,
         bbox_x,
         bbox_y,
         bbox_w,
         bbox_h,
         detection_confidence,
         quality_score,
         embedding_json,
         created_at,
         updated_at
       FROM face_instances
       WHERE ${scopePredicate.clause}
         AND TRIM(file_id) = :fileId
       ORDER BY
         CASE WHEN LOWER(TRIM(family_group_key)) = :preferredScope THEN 0 ELSE 1 END,
         created_at,
         face_id`,
      {
        ...scopePredicate.binds,
        fileId,
        preferredScope: OCI_GLOBAL_FACE_SCOPE_KEY,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    const mappedRows = rows.map(mapOciFaceInstanceRow);
    const preferredRows = mappedRows.some((row) => row.familyGroupKey === OCI_GLOBAL_FACE_SCOPE_KEY)
      ? mappedRows.filter((row) => row.familyGroupKey === OCI_GLOBAL_FACE_SCOPE_KEY)
      : mappedRows;
    const deduped = new Map<string, OciFaceInstanceRow>();
    for (const row of preferredRows) {
      if (!deduped.has(row.faceId)) {
        deduped.set(row.faceId, row);
      }
    }
    return Array.from(deduped.values());
  });
}

export async function getOciFaceMatchesForFile(input: {
  familyGroupKey: string;
  fileId: string;
}): Promise<OciFaceMatchRow[]> {
  const familyGroupKey = input.familyGroupKey.trim().toLowerCase();
  const fileId = input.fileId.trim();
  if (!fileId) {
    return [];
  }
  return withConnection(async (connection) => {
    await ensureFaceInstancesTableCompatibility(connection);
    await ensureFaceMatchesTableCompatibility(connection);
    const scopeKeys = listFaceScopeKeys(familyGroupKey);
    const matchScopePredicate = buildScopePredicate("m.family_group_key", scopeKeys, "matchScope");
    const faceScopePredicate = buildScopePredicate("f.family_group_key", scopeKeys, "faceScope");
    const result = await connection.execute(
      `SELECT
         m.family_group_key,
         m.match_id,
         m.face_id,
         m.candidate_person_id,
         m.confidence_score,
         m.match_status,
         m.reviewed_by,
         m.reviewed_at,
         m.created_at,
         m.match_metadata
       FROM face_matches m
       INNER JOIN face_instances f
         ON TRIM(f.face_id) = TRIM(m.face_id)
       WHERE ${matchScopePredicate.clause}
         AND ${faceScopePredicate.clause}
         AND TRIM(f.file_id) = :fileId
       ORDER BY
         CASE WHEN LOWER(TRIM(m.family_group_key)) = :preferredScope THEN 0 ELSE 1 END,
         TO_NUMBER(NVL(NULLIF(TRIM(m.confidence_score), ''), '0')) DESC,
         m.match_id`,
      {
        ...matchScopePredicate.binds,
        ...faceScopePredicate.binds,
        fileId,
        preferredScope: OCI_GLOBAL_FACE_SCOPE_KEY,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    const mappedRows = rows.map(mapOciFaceMatchRow);
    const preferredRows = mappedRows.some((row) => row.familyGroupKey === OCI_GLOBAL_FACE_SCOPE_KEY)
      ? mappedRows.filter((row) => row.familyGroupKey === OCI_GLOBAL_FACE_SCOPE_KEY)
      : mappedRows;
    const deduped = new Map<string, OciFaceMatchRow>();
    for (const row of preferredRows) {
      if (!deduped.has(row.matchId)) {
        deduped.set(row.matchId, row);
      }
    }
    return Array.from(deduped.values());
  });
}

export async function getOciPersonFaceProfilesForTenant(input: {
  familyGroupKey: string;
}): Promise<OciPersonFaceProfileRow[]> {
  const familyGroupKey = input.familyGroupKey.trim().toLowerCase();
  return withConnection(async (connection) => {
    await ensurePersonFaceProfilesTableCompatibility(connection);
    const scopeKeys = listFaceScopeKeys(familyGroupKey);
    const scopePredicate = buildScopePredicate("family_group_key", scopeKeys, "scope");
    const result = await connection.execute(
      `SELECT
         family_group_key,
         profile_id,
         person_id,
         source_file_id,
         sample_count,
         embedding_json,
         updated_at
       FROM person_face_profiles
       WHERE ${scopePredicate.clause}
       ORDER BY
         CASE WHEN LOWER(TRIM(family_group_key)) = :preferredScope THEN 0 ELSE 1 END,
         person_id`,
      {
        ...scopePredicate.binds,
        preferredScope: OCI_GLOBAL_FACE_SCOPE_KEY,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    const deduped = new Map<string, OciPersonFaceProfileRow>();
    for (const row of rows.map(mapOciPersonFaceProfileRow)) {
      if (!deduped.has(row.personId)) {
        deduped.set(row.personId, row);
      }
    }
    return Array.from(deduped.values());
  });
}

export async function getOciPersonFaceProfilesBySourceFile(input: {
  familyGroupKey: string;
  fileId: string;
}): Promise<OciPersonFaceProfileRow[]> {
  const familyGroupKey = input.familyGroupKey.trim().toLowerCase();
  const fileId = input.fileId.trim();
  if (!fileId) {
    return [];
  }
  return withConnection(async (connection) => {
    await ensurePersonFaceProfilesTableCompatibility(connection);
    const scopeKeys = listFaceScopeKeys(familyGroupKey);
    const scopePredicate = buildScopePredicate("family_group_key", scopeKeys, "scope");
    const result = await connection.execute(
      `SELECT
         family_group_key,
         profile_id,
         person_id,
         source_file_id,
         sample_count,
         embedding_json,
         updated_at
       FROM person_face_profiles
       WHERE ${scopePredicate.clause}
         AND TRIM(source_file_id) = :fileId
       ORDER BY
         CASE WHEN LOWER(TRIM(family_group_key)) = :preferredScope THEN 0 ELSE 1 END,
         person_id`,
      {
        ...scopePredicate.binds,
        fileId,
        preferredScope: OCI_GLOBAL_FACE_SCOPE_KEY,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    const mappedRows = rows.map(mapOciPersonFaceProfileRow);
    return mappedRows.some((row) => row.familyGroupKey === OCI_GLOBAL_FACE_SCOPE_KEY)
      ? mappedRows.filter((row) => row.familyGroupKey === OCI_GLOBAL_FACE_SCOPE_KEY)
      : mappedRows;
  });
}

export async function upsertOciPersonFaceProfile(input: {
  familyGroupKey: string;
  profileId: string;
  personId: string;
  sourceFileId: string;
  sampleCount: number;
  embeddingJson: string;
  updatedAt: string;
}) {
  const profileId = input.profileId.trim();
  const personId = input.personId.trim();
  if (!profileId || !personId) {
    throw new Error("profile_id and person_id are required");
  }
  return withConnection(async (connection) => {
    await ensurePersonFaceProfilesTableCompatibility(connection);
    await connection.execute(
      `MERGE INTO person_face_profiles t
       USING (
         SELECT :familyGroupKey AS family_group_key,
                :profileId AS profile_id,
                :personId AS person_id,
                :sourceFileId AS source_file_id,
                :sampleCount AS sample_count,
                :embeddingJson AS embedding_json,
                :updatedAt AS updated_at
         FROM dual
       ) s
       ON (
         LOWER(TRIM(t.family_group_key)) = LOWER(TRIM(s.family_group_key))
         AND TRIM(t.person_id) = TRIM(s.person_id)
       )
       WHEN MATCHED THEN UPDATE SET
         t.profile_id = s.profile_id,
         t.source_file_id = s.source_file_id,
         t.sample_count = s.sample_count,
         t.embedding_json = s.embedding_json,
         t.updated_at = s.updated_at
       WHEN NOT MATCHED THEN INSERT (
         family_group_key,
         profile_id,
         person_id,
         source_file_id,
         sample_count,
         embedding_json,
         updated_at
       ) VALUES (
         s.family_group_key,
         s.profile_id,
         s.person_id,
         s.source_file_id,
         s.sample_count,
         s.embedding_json,
         s.updated_at
       )`,
      {
        familyGroupKey: OCI_GLOBAL_FACE_SCOPE_KEY,
        profileId,
        personId,
        sourceFileId: input.sourceFileId.trim(),
        sampleCount: String(Math.max(1, Math.trunc(input.sampleCount || 1))),
        embeddingJson: input.embeddingJson.trim(),
        updatedAt: input.updatedAt.trim(),
      },
      { autoCommit: false },
    );
    await connection.execute(
      `DELETE FROM person_face_profiles
       WHERE LOWER(TRIM(family_group_key)) <> :globalFamilyGroupKey
         AND TRIM(person_id) = :personId`,
      {
        globalFamilyGroupKey: OCI_GLOBAL_FACE_SCOPE_KEY,
        personId,
      },
      { autoCommit: false },
    );
    await connection.commit();
  });
}

export async function replaceOciFaceMatchesForFace(input: {
  faceId: string;
  matches: Array<{
    matchId: string;
    candidatePersonId: string;
    confidenceScore: number;
    matchStatus: string;
    reviewedBy?: string;
    reviewedAt?: string;
    createdAt: string;
    matchMetadata?: string;
  }>;
}) {
  const faceId = input.faceId.trim();
  if (!faceId) {
    throw new Error("face_id is required");
  }
  return withConnection(async (connection) => {
    await ensureFaceMatchesTableCompatibility(connection);
    await connection.execute(
      `DELETE FROM face_matches
       WHERE TRIM(face_id) = :faceId`,
      { faceId },
      { autoCommit: false },
    );
    if (input.matches.length > 0) {
      await connection.executeMany(
        `INSERT INTO face_matches (
           family_group_key,
           match_id,
           face_id,
           candidate_person_id,
           confidence_score,
           match_status,
           reviewed_by,
           reviewed_at,
           created_at,
           match_metadata
         ) VALUES (
           :familyGroupKey,
           :matchId,
           :faceId,
           :candidatePersonId,
           :confidenceScore,
           :matchStatus,
           :reviewedBy,
           :reviewedAt,
           :createdAt,
           :matchMetadata
         )`,
        input.matches.map((match) => ({
          familyGroupKey: OCI_GLOBAL_FACE_SCOPE_KEY,
          matchId: match.matchId.trim(),
          faceId,
          candidatePersonId: match.candidatePersonId.trim(),
          confidenceScore: String(match.confidenceScore),
          matchStatus: match.matchStatus.trim(),
          reviewedBy: String(match.reviewedBy ?? "").trim(),
          reviewedAt: String(match.reviewedAt ?? "").trim(),
          createdAt: match.createdAt.trim(),
          matchMetadata: String(match.matchMetadata ?? "").trim(),
        })),
        { autoCommit: false },
      );
    }
    await connection.commit();
  });
}

export async function updateOciFaceInstanceEmbedding(input: {
  faceId: string;
  embeddingJson: string;
  updatedAt: string;
}) {
  const faceId = input.faceId.trim();
  if (!faceId) {
    throw new Error("face_id is required");
  }
  return withConnection(async (connection) => {
    await ensureFaceInstancesTableCompatibility(connection);
    const result = await connection.execute(
      `UPDATE face_instances
       SET embedding_json = :embeddingJson,
           updated_at = :updatedAt
       WHERE TRIM(face_id) = :faceId`,
      {
        faceId,
        embeddingJson: input.embeddingJson.trim(),
        updatedAt: input.updatedAt.trim(),
      },
      { autoCommit: true },
    );
    return result.rowsAffected ?? 0;
  });
}

export async function replaceOciFaceAnalysisForFile(input: {
  familyGroupKey: string;
  fileId: string;
  instances: Array<{
    faceId: string;
    bboxX: number;
    bboxY: number;
    bboxW: number;
    bboxH: number;
    detectionConfidence: number;
    qualityScore: number;
    embeddingJson: string;
    createdAt: string;
    updatedAt: string;
    matches: Array<{
      matchId: string;
      candidatePersonId: string;
      confidenceScore: number;
      matchStatus: string;
      reviewedBy?: string;
      reviewedAt?: string;
      createdAt: string;
      matchMetadata?: string;
    }>;
  }>;
}) {
  const fileId = input.fileId.trim();
  if (!fileId) {
    throw new Error("file_id is required");
  }
  return withConnection(async (connection) => {
    await ensureFaceInstancesTableCompatibility(connection);
    await ensureFaceMatchesTableCompatibility(connection);

    const existingFaceIdsResult = await connection.execute(
      `SELECT face_id
         FROM face_instances
        WHERE TRIM(file_id) = :fileId`,
      { fileId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const existingFaceIds = Array.from(
      new Set(
        ((existingFaceIdsResult.rows ?? []) as Record<string, unknown>[])
          .map((row) => fromDbValue(row.FACE_ID))
          .filter(Boolean),
      ),
    );
    for (const faceId of existingFaceIds) {
      await connection.execute(
        `DELETE FROM face_matches
         WHERE TRIM(face_id) = :faceId`,
        { faceId },
        { autoCommit: false },
      );
    }
    await connection.execute(
      `DELETE FROM face_instances
       WHERE TRIM(file_id) = :fileId`,
      { fileId },
      { autoCommit: false },
    );

    if (input.instances.length > 0) {
      await connection.executeMany(
        `INSERT INTO face_instances (
           family_group_key,
           face_id,
           file_id,
           bbox_x,
           bbox_y,
           bbox_w,
           bbox_h,
           detection_confidence,
           quality_score,
           embedding_json,
           created_at,
         updated_at
         ) VALUES (
           :familyGroupKey,
           :faceId,
           :fileId,
           :bboxX,
           :bboxY,
           :bboxW,
           :bboxH,
           :detectionConfidence,
           :qualityScore,
           :embeddingJson,
           :createdAt,
           :updatedAt
         )`,
        input.instances.map((instance) => ({
          familyGroupKey: OCI_GLOBAL_FACE_SCOPE_KEY,
          faceId: instance.faceId.trim(),
          fileId,
          bboxX: String(instance.bboxX),
          bboxY: String(instance.bboxY),
          bboxW: String(instance.bboxW),
          bboxH: String(instance.bboxH),
          detectionConfidence: String(instance.detectionConfidence),
          qualityScore: String(instance.qualityScore),
          embeddingJson: instance.embeddingJson.trim(),
          createdAt: instance.createdAt.trim(),
          updatedAt: instance.updatedAt.trim(),
        })),
        { autoCommit: false },
      );

      const matchRows = input.instances.flatMap((instance) =>
        instance.matches.map((match) => ({
          familyGroupKey: OCI_GLOBAL_FACE_SCOPE_KEY,
          matchId: match.matchId.trim(),
          faceId: instance.faceId.trim(),
          candidatePersonId: match.candidatePersonId.trim(),
          confidenceScore: String(match.confidenceScore),
          matchStatus: match.matchStatus.trim(),
          reviewedBy: String(match.reviewedBy ?? "").trim(),
          reviewedAt: String(match.reviewedAt ?? "").trim(),
          createdAt: match.createdAt.trim(),
          matchMetadata: String(match.matchMetadata ?? "").trim(),
        })),
      );
      if (matchRows.length > 0) {
        await connection.executeMany(
          `INSERT INTO face_matches (
             family_group_key,
             match_id,
             face_id,
             candidate_person_id,
             confidence_score,
             match_status,
             reviewed_by,
             reviewed_at,
             created_at,
             match_metadata
           ) VALUES (
             :familyGroupKey,
             :matchId,
             :faceId,
             :candidatePersonId,
             :confidenceScore,
             :matchStatus,
             :reviewedBy,
             :reviewedAt,
             :createdAt,
             :matchMetadata
           )`,
          matchRows,
          { autoCommit: false },
        );
      }
    }

    await connection.commit();
  });
}

export async function getOciPersonMediaAttributeRowsForTenant(
  familyGroupKey: string,
): Promise<OciPersonMediaAttributeRow[]> {
  const normalizedFamilyGroupKey = familyGroupKey.trim().toLowerCase();
  if (!normalizedFamilyGroupKey) {
    return [];
  }
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT
         a.attribute_id,
         a.entity_type,
         a.entity_id,
         a.attribute_type,
         a.attribute_type_category,
         a.attribute_date,
         a.attribute_detail,
         a.attribute_notes,
         a.end_date,
         a.created_at,
         a.updated_at
       FROM attributes a
       INNER JOIN person_family_groups pfg
         ON TRIM(pfg.person_id) = TRIM(a.entity_id)
       WHERE LOWER(TRIM(pfg.family_group_key)) = :familyGroupKey
         AND (${enabledExpr("pfg.is_enabled")} OR TRIM(NVL(pfg.is_enabled, '')) = '')
         AND LOWER(TRIM(a.entity_type)) = 'person'
         AND LOWER(TRIM(a.attribute_type)) IN ('photo', 'video', 'audio', 'media')
       ORDER BY a.attribute_id`,
      { familyGroupKey: normalizedFamilyGroupKey },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      attributeId: fromDbValue(row.ATTRIBUTE_ID),
      entityType: fromDbValue(row.ENTITY_TYPE),
      entityId: fromDbValue(row.ENTITY_ID),
      attributeType: fromDbValue(row.ATTRIBUTE_TYPE),
      attributeTypeCategory: fromDbValue(row.ATTRIBUTE_TYPE_CATEGORY),
      attributeDate: fromDbValue(row.ATTRIBUTE_DATE),
      attributeDetail: fromDbValue(row.ATTRIBUTE_DETAIL),
      attributeNotes: fromDbValue(row.ATTRIBUTE_NOTES),
      endDate: fromDbValue(row.END_DATE),
      createdAt: fromDbValue(row.CREATED_AT),
      updatedAt: fromDbValue(row.UPDATED_AT),
    }));
  });
}

export async function getOciPersonMediaAttributeRowsForFile(input: {
  familyGroupKey: string;
  fileId: string;
}): Promise<OciPersonMediaAttributeRow[]> {
  const familyGroupKey = input.familyGroupKey.trim().toLowerCase();
  const fileId = input.fileId.trim();
  if (!familyGroupKey || !fileId) {
    return [];
  }
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT
         a.attribute_id,
         a.entity_type,
         a.entity_id,
         a.attribute_type,
         a.attribute_type_category,
         a.attribute_date,
         a.attribute_detail,
         a.attribute_notes,
         a.end_date,
         a.created_at,
         a.updated_at
       FROM attributes a
       INNER JOIN person_family_groups pfg
         ON TRIM(pfg.person_id) = TRIM(a.entity_id)
       WHERE LOWER(TRIM(pfg.family_group_key)) = :familyGroupKey
         AND (${enabledExpr("pfg.is_enabled")} OR TRIM(NVL(pfg.is_enabled, '')) = '')
         AND LOWER(TRIM(a.entity_type)) = 'person'
         AND LOWER(TRIM(a.attribute_type)) IN ('photo', 'video', 'audio', 'media')
         AND DBMS_LOB.COMPARE(TO_CLOB(a.attribute_detail), TO_CLOB(:fileId)) = 0
       ORDER BY a.attribute_id`,
      { familyGroupKey, fileId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      attributeId: fromDbValue(row.ATTRIBUTE_ID),
      entityType: fromDbValue(row.ENTITY_TYPE),
      entityId: fromDbValue(row.ENTITY_ID),
      attributeType: fromDbValue(row.ATTRIBUTE_TYPE),
      attributeTypeCategory: fromDbValue(row.ATTRIBUTE_TYPE_CATEGORY),
      attributeDate: fromDbValue(row.ATTRIBUTE_DATE),
      attributeDetail: fromDbValue(row.ATTRIBUTE_DETAIL),
      attributeNotes: fromDbValue(row.ATTRIBUTE_NOTES),
      endDate: fromDbValue(row.END_DATE),
      createdAt: fromDbValue(row.CREATED_AT),
      updatedAt: fromDbValue(row.UPDATED_AT),
    }));
  });
}

export async function updateOciMediaLinksForFile(input: {
  familyGroupKey: string;
  fileId: string;
  label: string;
  description: string;
  photoDate: string;
}) {
  const familyGroupKey = input.familyGroupKey.trim().toLowerCase();
  const fileId = input.fileId.trim();
  if (!familyGroupKey || !fileId) {
    return 0;
  }
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `UPDATE media_links
       SET label = :label,
           description = :description,
           photo_date = :photoDate
       WHERE LOWER(TRIM(family_group_key)) = :familyGroupKey
         AND TRIM(media_id) IN (
           SELECT TRIM(file_id_media.media_id)
           FROM media_assets file_id_media
           WHERE TRIM(file_id_media.file_id) = :fileId
         )`,
      {
        familyGroupKey,
        fileId,
        label: input.label.trim(),
        description: input.description.trim(),
        photoDate: input.photoDate.trim(),
      },
      { autoCommit: true },
    );
    return result.rowsAffected ?? 0;
  });
}

export async function updateOciMediaAssetDetailsForFile(input: {
  fileId: string;
  label: string;
  description: string;
  photoDate: string;
}) {
  const fileId = input.fileId.trim();
  if (!fileId) {
    return 0;
  }
  return withConnection(async (connection) => {
    await ensureTableCompatibility(connection, "media_assets");
    const result = await connection.execute(
      `UPDATE media_assets
       SET label = :label,
           description = :description,
           photo_date = :photoDate
       WHERE TRIM(file_id) = :fileId`,
      {
        fileId,
        label: input.label.trim() || null,
        description: input.description.trim() || null,
        photoDate: input.photoDate.trim() || null,
      },
      { autoCommit: true },
    );
    return result.rowsAffected ?? 0;
  });
}

export async function updateOciMediaMetadataForFile(input: {
  familyGroupKey: string;
  fileId: string;
  mediaMetadata: string;
  exifExtractedAt?: string;
  exifSourceTag?: string;
  exifCaptureDate?: string;
  exifCaptureTimestampRaw?: string;
  exifMake?: string;
  exifModel?: string;
  exifSoftware?: string;
  exifWidth?: number;
  exifHeight?: number;
  exifOrientation?: number;
  exifFingerprint?: string;
}) {
  const fileId = input.fileId.trim();
  if (!input.familyGroupKey.trim() || !fileId) {
    return { assetsUpdated: 0, linksUpdated: 0 };
  }
  return withConnection(async (connection) => {
    await ensureTableCompatibility(connection, "media_assets");
    const assetSetClauses: string[] = [];
    const assetBinds: Record<string, unknown> = {
      fileId,
    };

    const assignStringColumn = (columnName: string, bindName: string, value: string | undefined) => {
      if (value === undefined) {
        return;
      }
      assetSetClauses.push(`${columnName} = :${bindName}`);
      assetBinds[bindName] = value.trim() || null;
    };

    const assignNumberColumn = (columnName: string, bindName: string, value: number | undefined) => {
      if (value === undefined || value === null || !Number.isFinite(value)) {
        return;
      }
      assetSetClauses.push(`${columnName} = :${bindName}`);
      assetBinds[bindName] = value;
    };

    assignStringColumn("exif_extracted_at", "exifExtractedAt", input.exifExtractedAt);
    assignStringColumn("exif_source_tag", "exifSourceTag", input.exifSourceTag);
    assignStringColumn("exif_capture_date", "exifCaptureDate", input.exifCaptureDate);
    assignStringColumn("exif_capture_timestamp_raw", "exifCaptureTimestampRaw", input.exifCaptureTimestampRaw);
    assignStringColumn("exif_make", "exifMake", input.exifMake);
    assignStringColumn("exif_model", "exifModel", input.exifModel);
    assignStringColumn("exif_software", "exifSoftware", input.exifSoftware);
    assignNumberColumn("exif_width", "exifWidth", input.exifWidth);
    assignNumberColumn("exif_height", "exifHeight", input.exifHeight);
    assignNumberColumn("exif_orientation", "exifOrientation", input.exifOrientation);
    assignStringColumn("exif_fingerprint", "exifFingerprint", input.exifFingerprint);

    if (assetSetClauses.length === 0) {
      return { assetsUpdated: 0, linksUpdated: 0 };
    }

    const assetUpdate = await connection.execute(
      `UPDATE media_assets
       SET ${assetSetClauses.join(", ")}
       WHERE TRIM(file_id) = :fileId`,
      assetBinds,
      { autoCommit: false },
    );
    await connection.commit();
    return {
      assetsUpdated: assetUpdate.rowsAffected ?? 0,
      linksUpdated: 0,
    };
  });
}

export async function updateOciMediaAssetThumbnailObjectKey(input: {
  fileId: string;
  thumbnailObjectKey: string;
}) {
  const fileId = input.fileId.trim();
  const thumbnailObjectKey = input.thumbnailObjectKey.trim();
  if (!fileId || !thumbnailObjectKey) {
    return 0;
  }
  return withConnection(async (connection) => {
    await ensureTableCompatibility(connection, "media_assets");
    const result = await connection.execute(
      `UPDATE media_assets
       SET thumbnail_object_key = :thumbnailObjectKey
       WHERE TRIM(file_id) = :fileId`,
      {
        fileId,
        thumbnailObjectKey,
      },
      { autoCommit: true },
    );
    return result.rowsAffected ?? 0;
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
