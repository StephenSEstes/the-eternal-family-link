import type { AppRole, LocalUserRecord, TenantSecurityPolicy } from "@/lib/google/types";
import { ensureTenantScaffold, getTableRecords, getTenantConfig, updateTableRecordById, createTableRecord } from "@/lib/google/sheets";
import { hashPassword } from "@/lib/security/password";

const LOCAL_USERS_TAB = "LocalUsers";
const POLICY_TAB = "TenantSecurityPolicy";

function readField(record: Record<string, string>, ...keys: string[]) {
  const lowered = new Map(Object.entries(record).map(([k, v]) => [k.trim().toLowerCase(), v]));
  for (const key of keys) {
    const value = lowered.get(key.trim().toLowerCase());
    if (value !== undefined) {
      return value.trim();
    }
  }
  return "";
}

function parseBool(value: string | undefined) {
  if (!value) return false;
  const out = value.trim().toLowerCase();
  return out === "true" || out === "yes" || out === "1";
}

function parseIntSafe(value: string | undefined, fallback: number) {
  const out = Number.parseInt(value ?? "", 10);
  return Number.isFinite(out) ? out : fallback;
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function defaultTenantSecurityPolicy(tenantKey: string): TenantSecurityPolicy {
  return {
    tenantKey,
    minLength: 8,
    requireNumber: true,
    requireUppercase: false,
    requireLowercase: true,
    lockoutAttempts: 5,
  };
}

async function ensureLocalAuthScaffold(tenantKey: string) {
  const config = await getTenantConfig(tenantKey);
  await ensureTenantScaffold({
    tenantKey,
    tenantName: config.tenantName,
    photosFolderId: config.photosFolderId,
  });
}

export async function getTenantSecurityPolicy(tenantKey: string): Promise<TenantSecurityPolicy> {
  try {
    const rows = await getTableRecords(POLICY_TAB, tenantKey);
    const row = rows[0];
    if (!row) {
      return defaultTenantSecurityPolicy(tenantKey);
    }
    return {
      tenantKey,
      minLength: parseIntSafe(readField(row.data, "min_length"), 8),
      requireNumber: parseBool(readField(row.data, "require_number")),
      requireUppercase: parseBool(readField(row.data, "require_uppercase")),
      requireLowercase: parseBool(readField(row.data, "require_lowercase")),
      lockoutAttempts: parseIntSafe(readField(row.data, "lockout_attempts"), 5),
    };
  } catch {
    return defaultTenantSecurityPolicy(tenantKey);
  }
}

export async function upsertTenantSecurityPolicy(tenantKey: string, policy: TenantSecurityPolicy) {
  await ensureLocalAuthScaffold(tenantKey);
  const recordId = tenantKey;
  const payload: Record<string, string> = {
    tenant_key: tenantKey,
    id: tenantKey,
    min_length: String(policy.minLength),
    require_number: policy.requireNumber ? "TRUE" : "FALSE",
    require_uppercase: policy.requireUppercase ? "TRUE" : "FALSE",
    require_lowercase: policy.requireLowercase ? "TRUE" : "FALSE",
    lockout_attempts: String(policy.lockoutAttempts),
  };
  const updated = await updateTableRecordById(POLICY_TAB, recordId, payload, "id", tenantKey);
  if (!updated) {
    await createTableRecord(POLICY_TAB, payload, tenantKey);
  }
}

function rowToLocalUser(tenantKey: string, row: Record<string, string>): LocalUserRecord | null {
  const username = normalizeUsername(readField(row, "username"));
  if (!username) {
    return null;
  }
  return {
    tenantKey,
    username,
    passwordHash: readField(row, "password_hash"),
    role: readField(row, "role").toUpperCase() === "ADMIN" ? "ADMIN" : "USER",
    personId: readField(row, "person_id"),
    isEnabled: parseBool(readField(row, "is_enabled")),
    failedAttempts: parseIntSafe(readField(row, "failed_attempts"), 0),
    lockedUntil: readField(row, "locked_until"),
    mustChangePassword: parseBool(readField(row, "must_change_password")),
  };
}

export async function getLocalUsers(tenantKey: string) {
  try {
    const rows = await getTableRecords(LOCAL_USERS_TAB, tenantKey);
    return rows
      .map((row) => rowToLocalUser(tenantKey, row.data))
      .filter((row): row is LocalUserRecord => Boolean(row))
      .sort((a, b) => a.username.localeCompare(b.username));
  } catch {
    return [] as LocalUserRecord[];
  }
}

export async function getLocalUserByUsername(tenantKey: string, username: string) {
  const normalized = normalizeUsername(username);
  const users = await getLocalUsers(tenantKey);
  return users.find((user) => user.username === normalized) ?? null;
}

type UpsertLocalUserInput = {
  tenantKey: string;
  username: string;
  password: string;
  role: AppRole;
  personId: string;
  isEnabled: boolean;
};

export async function upsertLocalUser(input: UpsertLocalUserInput) {
  await ensureLocalAuthScaffold(input.tenantKey);
  const username = normalizeUsername(input.username);
  const payload: Record<string, string> = {
    tenant_key: input.tenantKey,
    username,
    password_hash: hashPassword(input.password),
    role: input.role,
    person_id: input.personId,
    is_enabled: input.isEnabled ? "TRUE" : "FALSE",
    failed_attempts: "0",
    locked_until: "",
    must_change_password: "TRUE",
  };
  const updated = await updateTableRecordById(LOCAL_USERS_TAB, username, payload, "username", input.tenantKey);
  if (!updated) {
    await createTableRecord(LOCAL_USERS_TAB, payload, input.tenantKey);
  }
}

export async function patchLocalUser(
  tenantKey: string,
  username: string,
  patch: Partial<{
    password: string;
    isEnabled: boolean;
    role: AppRole;
    personId: string;
    failedAttempts: number;
    lockedUntil: string;
    mustChangePassword: boolean;
  }>,
) {
  const normalized = normalizeUsername(username);
  const payload: Record<string, string> = {};
  if (patch.password !== undefined) payload.password_hash = hashPassword(patch.password);
  if (patch.isEnabled !== undefined) payload.is_enabled = patch.isEnabled ? "TRUE" : "FALSE";
  if (patch.role !== undefined) payload.role = patch.role;
  if (patch.personId !== undefined) payload.person_id = patch.personId;
  if (patch.failedAttempts !== undefined) payload.failed_attempts = String(patch.failedAttempts);
  if (patch.lockedUntil !== undefined) payload.locked_until = patch.lockedUntil;
  if (patch.mustChangePassword !== undefined) payload.must_change_password = patch.mustChangePassword ? "TRUE" : "FALSE";
  return updateTableRecordById(LOCAL_USERS_TAB, normalized, payload, "username", tenantKey);
}
