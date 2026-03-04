#!/usr/bin/env node

/*
  Sheets -> OCI migration runner.
  Modes:
    --mode=dry-run  (default): read sheets and print row counts / mapping checks
    --mode=load: read sheets and insert into OCI

  Optional flags:
    --truncate=true   truncate target tables before load (load mode only)
*/

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const oracledb = require("oracledb");

const TABLES = [
  {
    tabName: "People",
    tableName: "people",
    columns: [
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
    optionalColumns: ["is_pinned", "relationships"],
  },
  {
    tabName: "PersonFamilyGroups",
    tableName: "person_family_groups",
    columns: ["person_id", "family_group_key", "is_enabled"],
  },
  {
    tabName: "Relationships",
    tableName: "relationships",
    columns: ["family_group_key", "rel_id", "from_person_id", "to_person_id", "rel_type"],
    optionalColumns: ["family_group_key"],
  },
  {
    tabName: "Households",
    tableName: "households",
    columns: [
      "family_group_key",
      "household_id",
      "husband_person_id",
      "wife_person_id",
      "label",
      "notes",
      "wedding_photo_file_id",
    ],
    optionalColumns: ["family_group_key", "label", "notes", "wedding_photo_file_id"],
  },
  {
    tabName: "UserAccess",
    tableName: "user_access",
    columns: [
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
  {
    tabName: "UserFamilyGroups",
    tableName: "user_family_groups",
    columns: ["user_email", "family_group_key", "family_group_name", "role", "person_id", "is_enabled"],
  },
  {
    tabName: "FamilyConfig",
    tableName: "family_config",
    columns: ["family_group_key", "family_group_name", "viewer_pin_hash", "photos_folder_id"],
  },
  {
    tabName: "FamilySecurityPolicy",
    tableName: "family_security_policy",
    columns: [
      "family_group_key",
      "id",
      "min_length",
      "require_number",
      "require_uppercase",
      "require_lowercase",
      "lockout_attempts",
    ],
  },
  {
    tabName: "PersonAttributes",
    tableName: "person_attributes",
    columns: [
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
  {
    tabName: "HouseholdPhotos",
    tableName: "household_photos",
    columns: [
      "family_group_key",
      "photo_id",
      "household_id",
      "file_id",
      "name",
      "description",
      "photo_date",
      "is_primary",
      "media_metadata",
    ],
  },
  {
    tabName: "ImportantDates",
    tableName: "important_dates",
    columns: ["id", "date", "title", "description", "person_id", "share_scope", "share_family_group_key"],
    rename: {
      date: "date_value",
    },
  },
];

const BOOLEAN_COLUMNS = new Set([
  "is_enabled",
  "is_primary",
  "is_pinned",
  "google_access",
  "local_access",
  "must_change_password",
  "require_number",
  "require_uppercase",
  "require_lowercase",
]);

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    mode: "dry-run",
    truncate: false,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      out.mode = arg.split("=")[1] || out.mode;
      continue;
    }
    if (arg.startsWith("--truncate=")) {
      out.truncate = (arg.split("=")[1] || "").toLowerCase() === "true";
      continue;
    }
  }
  return out;
}

function printHelp() {
  console.log("Usage:");
  console.log("  node oci-migrate-sheets-to-oci.cjs --mode=dry-run");
  console.log("  node oci-migrate-sheets-to-oci.cjs --mode=load --truncate=true");
}

function loadDotEnv(dotEnvPath) {
  if (!fs.existsSync(dotEnvPath)) {
    return;
  }
  const text = fs.readFileSync(dotEnvPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function requireEnv(...names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}

function normalizeHeader(header) {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function normalizeBoolean(value) {
  if (value == null || value === "") {
    return "";
  }
  const raw = String(value).trim().toLowerCase();
  if (["true", "yes", "1", "y"].includes(raw)) {
    return "TRUE";
  }
  if (["false", "no", "0", "n"].includes(raw)) {
    return "FALSE";
  }
  return String(value).trim();
}

async function createSheetsClient() {
  const serviceAccountRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountRaw);
  } catch (error) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

async function readTabRows(sheets, tabName) {
  const sheetId = process.env.SHEET_ID;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tabName}!A1:ZZ`,
  });
  const values = res.data.values || [];
  if (values.length === 0) {
    return { headers: [], rows: [] };
  }
  const rawHeaders = values[0];
  const headers = rawHeaders.map(normalizeHeader);
  const rows = values.slice(1);
  return { headers, rows };
}

function mapRowsForTable(tableDef, sheetHeaders, sheetRows) {
  const indexByHeader = new Map();
  sheetHeaders.forEach((h, idx) => indexByHeader.set(h, idx));

  const optional = new Set(tableDef.optionalColumns || []);
  const missingColumns = tableDef.columns.filter((column) => !indexByHeader.has(column));
  const missingRequiredColumns = missingColumns.filter((column) => !optional.has(column));

  const mappedRows = sheetRows.map((row) => {
    const out = {};
    for (const sourceColumn of tableDef.columns) {
      const sourceIdx = indexByHeader.get(sourceColumn);
      let value = sourceIdx == null ? "" : row[sourceIdx] ?? "";
      if (BOOLEAN_COLUMNS.has(sourceColumn)) {
        value = normalizeBoolean(value);
      } else {
        value = String(value).trim();
      }
      const targetColumn = tableDef.rename?.[sourceColumn] || sourceColumn;
      out[targetColumn] = value;
    }
    return out;
  });

  return { missingColumns, missingRequiredColumns, mappedRows };
}

function buildInsert(tableName, targetColumns) {
  const bindSlots = targetColumns.map((_, idx) => `:${idx + 1}`).join(", ");
  const cols = targetColumns.join(", ");
  return `INSERT INTO ${tableName} (${cols}) VALUES (${bindSlots})`;
}

async function getTableCount(connection, tableName) {
  const result = await connection.execute(`SELECT COUNT(*) FROM ${tableName}`);
  return Number(result.rows?.[0]?.[0] || 0);
}

async function run() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  if (!["dry-run", "load"].includes(args.mode)) {
    throw new Error(`Invalid mode: ${args.mode}`);
  }

  loadDotEnv(path.join(process.cwd(), ".env.local"));

  requireEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "SHEET_ID");
  if (args.mode === "load") {
    requireEnv(
      "OCI_DB_CONNECT_STRING",
      "OCI_DB_USER",
      "OCI_DB_PASSWORD",
      "TNS_ADMIN",
      "OCI_WALLET_PASSWORD"
    );
  }

  const sheets = await createSheetsClient();
  const sourceSummary = [];
  const loadPayload = [];

  for (const tableDef of TABLES) {
    const { headers, rows } = await readTabRows(sheets, tableDef.tabName);
    const { missingColumns, missingRequiredColumns, mappedRows } = mapRowsForTable(tableDef, headers, rows);
    const targetColumns = tableDef.columns.map((c) => tableDef.rename?.[c] || c);

    sourceSummary.push({
      tabName: tableDef.tabName,
      tableName: tableDef.tableName,
      sheetRows: rows.length,
      mappedRows: mappedRows.length,
      missingColumns,
      missingRequiredColumns,
    });

    loadPayload.push({
      tableName: tableDef.tableName,
      targetColumns,
      mappedRows,
    });
  }

  console.log("\nSource Summary:");
  for (const entry of sourceSummary) {
    const missing = entry.missingColumns.length ? ` missing=[${entry.missingColumns.join(", ")}]` : "";
    console.log(
      `- ${entry.tabName} -> ${entry.tableName}: sourceRows=${entry.sheetRows}, mappedRows=${entry.mappedRows}${missing}`
    );
  }

  const hasMissing = sourceSummary.some((entry) => entry.missingRequiredColumns.length > 0);
  if (hasMissing) {
    throw new Error("Schema mismatch: one or more tabs are missing expected columns");
  }

  if (args.mode === "dry-run") {
    console.log("\nDry-run complete. No OCI writes were performed.");
    return;
  }

  let connection;
  try {
    connection = await oracledb.getConnection({
      user: process.env.OCI_DB_USER,
      password: process.env.OCI_DB_PASSWORD,
      connectString: process.env.OCI_DB_CONNECT_STRING,
      configDir: process.env.TNS_ADMIN,
      walletLocation: process.env.TNS_ADMIN,
      walletPassword: process.env.OCI_WALLET_PASSWORD,
    });

    if (args.truncate) {
      // Child/edge tables first, then parent tables.
      const truncateOrder = [
        "household_photos",
        "person_attributes",
        "important_dates",
        "relationships",
        "households",
        "user_family_groups",
        "user_access",
        "person_family_groups",
        "family_security_policy",
        "family_config",
        "people",
      ];
      for (const tableName of truncateOrder) {
        await connection.execute(`TRUNCATE TABLE ${tableName}`);
      }
      console.log("\nTarget tables truncated.");
    }

    for (const payload of loadPayload) {
      if (!payload.mappedRows.length) {
        console.log(`- ${payload.tableName}: skipped (0 rows)`);
        continue;
      }
      const sql = buildInsert(payload.tableName, payload.targetColumns);
      const binds = payload.mappedRows.map((row) => payload.targetColumns.map((col) => row[col] ?? ""));
      await connection.executeMany(sql, binds, { autoCommit: false });
      console.log(`- ${payload.tableName}: inserted ${binds.length} rows`);
    }

    await connection.commit();
    console.log("\nLoad committed.");

    console.log("\nTarget Counts:");
    for (const payload of loadPayload) {
      const count = await getTableCount(connection, payload.tableName);
      console.log(`- ${payload.tableName}: ${count}`);
    }
  } finally {
    if (connection) {
      await connection.close();
    }
  }
}

run().catch((error) => {
  console.error(`\nMigration failed: ${error.message}`);
  process.exit(1);
});
