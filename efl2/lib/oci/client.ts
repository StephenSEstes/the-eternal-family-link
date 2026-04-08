import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import oracledb from "oracledb";

oracledb.fetchAsString = [oracledb.CLOB];

let cachedWalletDir: string | null = null;
let poolPromise: Promise<any> | null = null;

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
  if (cachedWalletDir) return cachedWalletDir;

  const walletFilesJson = readWalletJsonPayload().replace(/\r?\n/g, "");
  if (!walletFilesJson) return null;

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

async function getPool() {
  if (poolPromise) return poolPromise;

  const user = (process.env.OCI_DB_USER ?? "").trim();
  const password = (process.env.OCI_DB_PASSWORD ?? "").trim();
  const connectString = (process.env.OCI_DB_CONNECT_STRING ?? "").trim();
  const walletDir = resolveWalletDirectory();
  const walletPassword = (process.env.OCI_WALLET_PASSWORD ?? "").trim();

  if (!user || !password || !connectString) {
    throw new Error("Missing OCI connection env (OCI_DB_USER, OCI_DB_PASSWORD, OCI_DB_CONNECT_STRING).");
  }

  poolPromise = oracledb.createPool({
    user,
    password,
    connectString,
    poolMin: 1,
    poolMax: 4,
    poolIncrement: 1,
    stmtCacheSize: 30,
    homogeneous: true,
    configDir: walletDir || undefined,
    walletLocation: walletDir || undefined,
    walletPassword: walletPassword || undefined,
  });

  return poolPromise;
}

export async function withConnection<T>(work: (connection: any) => Promise<T>) {
  const pool = await getPool();
  const connection = await pool.getConnection();
  try {
    return await work(connection);
  } finally {
    await connection.close();
  }
}

export async function withTransaction<T>(work: (connection: any) => Promise<T>) {
  return withConnection(async (connection) => {
    try {
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // no-op
      }
      throw error;
    }
  });
}
