#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const oracledb = require('oracledb');

function loadDotEnv(dotEnvPath) {
  if (!fs.existsSync(dotEnvPath)) return;
  const text = fs.readFileSync(dotEnvPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function requireEnv(...keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(', ')}`);
}

async function tableExists(conn, name) {
  const result = await conn.execute(
    `SELECT COUNT(*) AS CNT FROM user_tables WHERE table_name = :name`,
    { name: String(name).trim().toUpperCase() },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  const count = Number(result.rows?.[0]?.CNT ?? 0);
  return count > 0;
}

async function columnExists(conn, tableName, columnName) {
  const result = await conn.execute(
    `SELECT COUNT(*) AS CNT
       FROM user_tab_cols
      WHERE table_name = :tableName
        AND column_name = :columnName`,
    {
      tableName: String(tableName).trim().toUpperCase(),
      columnName: String(columnName).trim().toUpperCase(),
    },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return Number(result.rows?.[0]?.CNT ?? 0) > 0;
}

async function ensureColumn(conn, tableName, columnName, columnSqlType) {
  const exists = await columnExists(conn, tableName, columnName);
  if (exists) return false;
  await conn.execute(`ALTER TABLE ${tableName} ADD (${columnName} ${columnSqlType})`);
  return true;
}

async function dropColumnIfExists(conn, tableName, columnName) {
  const exists = await columnExists(conn, tableName, columnName);
  if (!exists) return false;
  await conn.execute(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`);
  return true;
}

async function main() {
  loadDotEnv(path.join(process.cwd(), '.env.local'));
  requireEnv('OCI_DB_CONNECT_STRING', 'OCI_DB_USER', 'OCI_DB_PASSWORD', 'TNS_ADMIN', 'OCI_WALLET_PASSWORD');

  const conn = await oracledb.getConnection({
    user: process.env.OCI_DB_USER,
    password: process.env.OCI_DB_PASSWORD,
    connectString: process.env.OCI_DB_CONNECT_STRING,
    configDir: process.env.TNS_ADMIN,
    walletLocation: process.env.TNS_ADMIN,
    walletPassword: process.env.OCI_WALLET_PASSWORD,
  });

  const table = 'attributes';

  try {
    const exists = await tableExists(conn, table);
    if (!exists) {
      console.log('Table not found: attributes');
      return;
    }

    const requiredColumns = [
      ['attribute_type', 'VARCHAR2(80)'],
      ['attribute_type_category', 'VARCHAR2(120)'],
      ['attribute_date', 'VARCHAR2(32)'],
      ['date_is_estimated', 'VARCHAR2(8)'],
      ['estimated_to', 'VARCHAR2(16)'],
      ['attribute_detail', 'CLOB'],
      ['attribute_notes', 'CLOB'],
      ['end_date', 'VARCHAR2(32)'],
      ['created_at', 'VARCHAR2(64)'],
      ['updated_at', 'VARCHAR2(64)'],
    ];

    let added = 0;
    for (const [name, sqlType] of requiredColumns) {
      const didAdd = await ensureColumn(conn, table, name, sqlType);
      if (didAdd) added += 1;
    }

    const countResult = await conn.execute(`SELECT COUNT(*) AS CNT FROM ${table}`, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const beforeCount = Number(countResult.rows?.[0]?.CNT ?? 0);

    await conn.execute(`DELETE FROM ${table}`);

    const legacyColumns = [
      'category',
      'type_key',
      'person_id',
      'value_json',
      'is_primary',
      'sort_order',
      'start_date',
      'visibility',
      'share_scope',
      'share_family_group_key',
      'label',
      'value_text',
      'date_start',
      'date_end',
      'date',
      'location',
      'notes',
    ];

    let dropped = 0;
    for (const column of legacyColumns) {
      try {
        const didDrop = await dropColumnIfExists(conn, table, column);
        if (didDrop) dropped += 1;
      } catch (error) {
        const message = String(error?.message || '');
        if (!/ORA-00904|ORA-01430|ORA-01442/i.test(message)) {
          throw error;
        }
      }
    }

    await conn.commit();

    const afterResult = await conn.execute(`SELECT COUNT(*) AS CNT FROM ${table}`, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const afterCount = Number(afterResult.rows?.[0]?.CNT ?? 0);

    console.log(`attributes rows before delete: ${beforeCount}`);
    console.log(`attributes rows after delete: ${afterCount}`);
    console.log(`columns added: ${added}`);
    console.log(`legacy columns dropped: ${dropped}`);
  } finally {
    await conn.close();
  }
}

main().catch((error) => {
  console.error(`Attributes reset failed: ${error.message}`);
  process.exit(1);
});
