#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const oracledb = require("oracledb");

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

function shortHash(seed) {
  return crypto.createHash("sha1").update(String(seed).trim().toLowerCase()).digest("hex").slice(0, 8);
}

function linkId(familyGroupKey, entityType, entityId, fileId, usageType) {
  return `mlink-${shortHash(`${familyGroupKey}|${entityType}|${entityId}|${fileId}|${usageType}`)}`;
}

function norm(v) {
  return String(v ?? "").trim();
}

async function queryRows(conn, sql, binds = {}) {
  const res = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  return res.rows || [];
}

function printSample(title, values) {
  if (!values.length) return;
  console.log(`  ${title} (${Math.min(values.length, 20)} sample):`);
  values.slice(0, 20).forEach((value) => console.log(`    - ${value}`));
}

async function main() {
  loadDotEnv(path.join(process.cwd(), ".env.local"));
  requireEnv("OCI_DB_CONNECT_STRING", "OCI_DB_USER", "OCI_DB_PASSWORD", "TNS_ADMIN", "OCI_WALLET_PASSWORD");

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
    const memberships = await queryRows(
      conn,
      `SELECT TRIM(person_id) AS person_id, LOWER(TRIM(family_group_key)) AS family_group_key
       FROM person_family_groups
       WHERE TRIM(NVL(person_id, '')) <> ''
         AND TRIM(NVL(family_group_key, '')) <> ''
         AND (LOWER(TRIM(NVL(is_enabled, 'TRUE'))) IN ('true','yes','1') OR TRIM(NVL(is_enabled, '')) = '')`,
    );
    const familyKeysByPerson = new Map();
    for (const row of memberships) {
      const personId = norm(row.PERSON_ID);
      const familyGroupKey = norm(row.FAMILY_GROUP_KEY).toLowerCase();
      if (!personId || !familyGroupKey) continue;
      const set = familyKeysByPerson.get(personId) || new Set();
      set.add(familyGroupKey);
      familyKeysByPerson.set(personId, set);
    }

    const expected = new Set();

    const peopleRows = await queryRows(
      conn,
      `SELECT TRIM(person_id) AS person_id, TRIM(photo_file_id) AS file_id
       FROM people
       WHERE TRIM(NVL(photo_file_id, '')) <> ''`,
    );
    for (const row of peopleRows) {
      const personId = norm(row.PERSON_ID);
      const fileId = norm(row.FILE_ID);
      const familyKeys = familyKeysByPerson.get(personId) || new Set();
      for (const familyGroupKey of familyKeys) {
        expected.add(linkId(familyGroupKey, "person", personId, fileId, "profile"));
      }
    }

    const householdPhotoRows = await queryRows(
      conn,
      `SELECT LOWER(TRIM(family_group_key)) AS family_group_key,
              TRIM(household_id) AS household_id,
              TRIM(file_id) AS file_id
       FROM household_photos
       WHERE TRIM(NVL(file_id, '')) <> ''`,
    );
    for (const row of householdPhotoRows) {
      const familyGroupKey = norm(row.FAMILY_GROUP_KEY).toLowerCase();
      const householdId = norm(row.HOUSEHOLD_ID);
      const fileId = norm(row.FILE_ID);
      if (!familyGroupKey || !householdId || !fileId) continue;
      expected.add(linkId(familyGroupKey, "household", householdId, fileId, "gallery"));
    }

    const weddingRows = await queryRows(
      conn,
      `SELECT LOWER(TRIM(family_group_key)) AS family_group_key,
              TRIM(household_id) AS household_id,
              TRIM(wedding_photo_file_id) AS file_id
       FROM households
       WHERE TRIM(NVL(wedding_photo_file_id, '')) <> ''`,
    );
    for (const row of weddingRows) {
      const familyGroupKey = norm(row.FAMILY_GROUP_KEY).toLowerCase();
      const householdId = norm(row.HOUSEHOLD_ID);
      const fileId = norm(row.FILE_ID);
      if (!familyGroupKey || !householdId || !fileId) continue;
      expected.add(linkId(familyGroupKey, "household", householdId, fileId, "wedding"));
    }

    const attributeRows = await queryRows(
      conn,
      `SELECT TRIM(attribute_id) AS attribute_id, TRIM(person_id) AS person_id, TRIM(value_text) AS file_id
       FROM person_attributes
       WHERE LOWER(TRIM(attribute_type)) = 'photo'
         AND TRIM(NVL(value_text, '')) <> ''`,
    );
    for (const row of attributeRows) {
      const attributeId = norm(row.ATTRIBUTE_ID);
      const personId = norm(row.PERSON_ID);
      const fileId = norm(row.FILE_ID);
      if (!attributeId || !personId || !fileId) continue;
      const familyKeys = familyKeysByPerson.get(personId) || new Set();
      for (const familyGroupKey of familyKeys) {
        expected.add(linkId(familyGroupKey, "attribute", attributeId, fileId, "photo"));
      }
    }

    const targetRows = await queryRows(
      conn,
      `SELECT TRIM(link_id) AS link_id FROM media_links`,
    );
    const actual = new Set(targetRows.map((row) => norm(row.LINK_ID)).filter(Boolean));

    const missing = Array.from(expected).filter((id) => !actual.has(id));
    const extra = Array.from(actual).filter((id) => !expected.has(id));

    const pass = missing.length === 0;
    allPass = pass && allPass;

    console.log(`[${pass ? "PASS" : "FAIL"}] media_links parity`);
    console.log(`  expected_links=${expected.size}`);
    console.log(`  actual_links=${actual.size}`);
    console.log(`  missing=${missing.length}`);
    console.log(`  extra=${extra.length}`);
    printSample("missing", missing);
    printSample("extra", extra);
  } finally {
    await conn.close();
  }

  console.log(`Overall parity: ${allPass ? "PASS" : "FAIL"}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((error) => {
  console.error(`Media parity failed: ${error.message}`);
  process.exit(1);
});
