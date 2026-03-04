#!/usr/bin/env node

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

async function main() {
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
