#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const oracledb = require("oracledb");

const TABLES = [
  { tabName: "People", tableName: "people", keyColumns: ["person_id"] },
  { tabName: "PersonFamilyGroups", tableName: "person_family_groups", keyColumns: ["person_id", "family_group_key"] },
  { tabName: "Relationships", tableName: "relationships", keyColumns: ["rel_id"] },
  { tabName: "Households", tableName: "households", keyColumns: ["household_id"] },
  { tabName: "UserAccess", tableName: "user_access", keyColumns: ["person_id", "user_email"] },
  { tabName: "UserFamilyGroups", tableName: "user_family_groups", keyColumns: ["user_email", "family_group_key"] },
  { tabName: "FamilyConfig", tableName: "family_config", keyColumns: ["family_group_key"] },
  { tabName: "FamilySecurityPolicy", tableName: "family_security_policy", keyColumns: ["family_group_key", "id"] },
  { tabName: "PersonAttributes", tableName: "person_attributes", keyColumns: ["attribute_id"] },
  { tabName: "HouseholdPhotos", tableName: "household_photos", keyColumns: ["photo_id"] },
  { tabName: "ImportantDates", tableName: "important_dates", keyColumns: ["id"] },
];

function loadDotEnv(dotEnvPath) {
  if (!fs.existsSync(dotEnvPath)) return;
  const text = fs.readFileSync(dotEnvPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function requireEnv(...keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(", ")}`);
}

function normalizeHeader(header) {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function normalizeValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

function makeKey(row, keyColumns) {
  return keyColumns.map((k) => normalizeValue(row[k])).join("||");
}

async function createSheetsClient() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

async function readSheetRows(sheets, tabName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: `${tabName}!A1:ZZ`,
  });
  const values = res.data.values || [];
  if (!values.length) return { headers: [], rows: [] };
  const headers = values[0].map(normalizeHeader);
  const rows = values.slice(1).map((row) => {
    const out = {};
    headers.forEach((h, idx) => {
      out[h] = row[idx] ?? "";
    });
    return out;
  });
  return { headers, rows };
}

async function readOciRows(conn, tableName, keyColumns) {
  const sql = `SELECT ${keyColumns.join(", ")} FROM ${tableName}`;
  const result = await conn.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
  return (result.rows || []).map((row) => {
    const out = {};
    for (const col of keyColumns) {
      out[col] = row[col.toUpperCase()] ?? "";
    }
    return out;
  });
}

function printSample(title, values) {
  if (!values.length) return;
  console.log(`  ${title} (sample ${Math.min(values.length, 20)}):`);
  values.slice(0, 20).forEach((v) => console.log(`    - ${v}`));
}

async function main() {
  loadDotEnv(path.join(process.cwd(), ".env.local"));
  requireEnv(
    "GOOGLE_SERVICE_ACCOUNT_JSON",
    "SHEET_ID",
    "OCI_DB_CONNECT_STRING",
    "OCI_DB_USER",
    "OCI_DB_PASSWORD",
    "TNS_ADMIN",
    "OCI_WALLET_PASSWORD"
  );

  const sheets = await createSheetsClient();
  const conn = await oracledb.getConnection({
    user: process.env.OCI_DB_USER,
    password: process.env.OCI_DB_PASSWORD,
    connectString: process.env.OCI_DB_CONNECT_STRING,
    configDir: process.env.TNS_ADMIN,
    walletLocation: process.env.TNS_ADMIN,
    walletPassword: process.env.OCI_WALLET_PASSWORD,
  });

  let allPass = true;
  try {
    for (const table of TABLES) {
      const { rows: sheetRows } = await readSheetRows(sheets, table.tabName);
      const ociRows = await readOciRows(conn, table.tableName, table.keyColumns);

      const sheetKeys = new Set(sheetRows.map((row) => makeKey(row, table.keyColumns)));
      const ociKeys = new Set(ociRows.map((row) => makeKey(row, table.keyColumns)));

      const onlyInSheets = Array.from(sheetKeys).filter((k) => !ociKeys.has(k));
      const onlyInOci = Array.from(ociKeys).filter((k) => !sheetKeys.has(k));

      const countMatch = sheetRows.length === ociRows.length;
      const keyMatch = onlyInSheets.length === 0 && onlyInOci.length === 0;
      const pass = countMatch && keyMatch;
      if (!pass) allPass = false;

      console.log(`\n[${pass ? "PASS" : "FAIL"}] ${table.tabName} <-> ${table.tableName}`);
      console.log(`  count sheets=${sheetRows.length} oci=${ociRows.length}`);
      if (!keyMatch) {
        console.log(`  key mismatch sheets_only=${onlyInSheets.length} oci_only=${onlyInOci.length}`);
        printSample("sheets_only", onlyInSheets);
        printSample("oci_only", onlyInOci);
      }
    }
  } finally {
    await conn.close();
  }

  console.log(`\nOverall parity: ${allPass ? "PASS" : "FAIL"}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((error) => {
  console.error(`Parity check failed: ${error.message}`);
  process.exit(1);
});

