#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const oracledb = require("oracledb");

let cachedWalletDir = null;

function loadLocalEnvFiles() {
  const candidates = [".env.local", ".env"];
  for (const fileName of candidates) {
    const fullPath = path.join(process.cwd(), fileName);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, "utf8");
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      if (!key || process.env[key] !== undefined) continue;
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
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

  const parts = [];
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

function ensureWalletDirFromEnv() {
  if (cachedWalletDir) {
    return cachedWalletDir;
  }

  const walletFilesJson = readWalletJsonPayload().replace(/\r?\n/g, "");
  if (!walletFilesJson) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(walletFilesJson);
  } catch (error) {
    throw new Error(`Failed to parse OCI wallet env payload: ${error.message}`);
  }

  const baseDir = path.join(os.tmpdir(), "efl-oci-wallet");
  fs.mkdirSync(baseDir, { recursive: true });
  for (const [fileName, b64] of Object.entries(parsed)) {
    const target = path.join(baseDir, fileName);
    if (!fs.existsSync(target)) {
      fs.writeFileSync(target, Buffer.from(String(b64), "base64"));
    }
  }

  cachedWalletDir = baseDir;
  return cachedWalletDir;
}

function resolveWalletDirectory() {
  return ensureWalletDirFromEnv() ?? process.env.TNS_ADMIN ?? "";
}

function hasFlag(name) {
  return process.argv.slice(2).some((arg) => arg === `--${name}`);
}

function isMissingTableError(message) {
  return /ORA-00942/i.test(String(message ?? ""));
}

async function safeCount(connection, tableName, whereClause = "", binds = {}) {
  try {
    const result = await connection.execute(
      `SELECT COUNT(1) AS C FROM ${tableName}${whereClause ? ` WHERE ${whereClause}` : ""}`,
      binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return Number(result.rows?.[0]?.C ?? 0);
  } catch (error) {
    if (isMissingTableError(error.message)) {
      return null;
    }
    throw error;
  }
}

function printCounts(title, counts) {
  console.log(`\n${title}`);
  for (const [label, value] of counts) {
    if (value === null) {
      console.log(`- ${label}: table not found`);
    } else {
      console.log(`- ${label}: ${value}`);
    }
  }
}

async function main() {
  if (hasFlag("apply")) {
    throw new Error("Apply mode is disabled. Use this script for dry-run counts only until a targeted reset plan is implemented.");
  }

  loadLocalEnvFiles();
  const walletDir = resolveWalletDirectory();
  const required = ["OCI_DB_CONNECT_STRING", "OCI_DB_USER", "OCI_DB_PASSWORD", "OCI_WALLET_PASSWORD"];
  const missing = required.filter((key) => !String(process.env[key] ?? "").trim());
  if (missing.length > 0) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }
  if (!walletDir) {
    throw new Error("Missing wallet directory. Provide OCI_WALLET_FILES_JSON(_PART_*) or TNS_ADMIN.");
  }

  const connection = await oracledb.getConnection({
    user: process.env.OCI_DB_USER,
    password: process.env.OCI_DB_PASSWORD,
    connectString: process.env.OCI_DB_CONNECT_STRING,
    configDir: walletDir,
    walletLocation: walletDir,
    walletPassword: process.env.OCI_WALLET_PASSWORD,
  });

  try {
    const beforeCounts = [
      ["share_groups", await safeCount(connection, "share_groups")],
      ["share_group_members", await safeCount(connection, "share_group_members")],
      ["share_threads", await safeCount(connection, "share_threads")],
      ["share_thread_members", await safeCount(connection, "share_thread_members")],
      ["share_conversations", await safeCount(connection, "share_conversations")],
      ["share_conversation_members", await safeCount(connection, "share_conversation_members")],
      ["share_posts", await safeCount(connection, "share_posts")],
      ["share_post_comments", await safeCount(connection, "share_post_comments")],
      ["notification_outbox", await safeCount(connection, "notification_outbox")],
      ["push_subscriptions", await safeCount(connection, "push_subscriptions")],
      ["media_assets", await safeCount(connection, "media_assets")],
      ["media_links", await safeCount(connection, "media_links")],
      ["media_comments", await safeCount(connection, "media_comments")],
      ["face_instances", await safeCount(connection, "face_instances")],
      ["face_matches", await safeCount(connection, "face_matches")],
      ["person_face_profiles", await safeCount(connection, "person_face_profiles")],
      [
        "attributes(media/photo/video/audio)",
        await safeCount(
          connection,
          "attributes",
          "LOWER(TRIM(NVL(attribute_type, ''))) IN ('media','photo','video','audio')",
        ),
      ],
      ["people.photo_file_id not empty", await safeCount(connection, "people", "TRIM(NVL(photo_file_id, '')) <> ''")],
      [
        "households.wedding_photo_file_id not empty",
        await safeCount(connection, "households", "TRIM(NVL(wedding_photo_file_id, '')) <> ''"),
      ],
    ];
    printCounts("Before", beforeCounts);

    console.log("\nDry run only. Apply mode is disabled until a targeted reset plan is implemented.");
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error(`reset-content-hard-cutover failed: ${error.message}`);
  process.exit(1);
});
