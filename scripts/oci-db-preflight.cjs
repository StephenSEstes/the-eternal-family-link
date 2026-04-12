#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const oracledb = require("oracledb");

const REQUIRED_VARS = [
  "OCI_DB_CONNECT_STRING",
  "OCI_DB_USER",
  "OCI_DB_PASSWORD",
  "TNS_ADMIN",
  "OCI_WALLET_PASSWORD",
];

function getMissingVars() {
  return REQUIRED_VARS.filter((name) => !process.env[name]);
}

function loadLocalEnvFiles() {
  const candidates = [".env.local", ".env"];
  for (const fileName of candidates) {
    const fullPath = path.join(process.cwd(), fileName);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!key || process.env[key] !== undefined) continue;
      let value = trimmed.slice(eq + 1).trim();
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

async function main() {
  loadLocalEnvFiles();
  const missing = getMissingVars();
  if (missing.length > 0) {
    console.error(`OCI preflight failed: missing env vars: ${missing.join(", ")}`);
    process.exit(1);
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

    const result = await connection.execute(
      "select user as db_user, to_char(sysdate, 'YYYY-MM-DD HH24:MI:SS') as db_time from dual"
    );
    const [dbUser, dbTime] = result.rows?.[0] || [];
    console.log(`OCI preflight OK: connected as ${dbUser} at ${dbTime}`);
  } catch (error) {
    console.error(`OCI preflight failed: ${error.message}`);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.close();
    }
  }
}

main();
