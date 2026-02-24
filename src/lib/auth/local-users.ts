import type { AppRole, LocalUserRecord, TenantSecurityPolicy } from "@/lib/google/types";
import {
  createTableRecord,
  ensureTenantScaffold,
  getTableRecords,
  getTenantConfig,
  getTenantLocalAccessList,
  updateTableRecordById,
} from "@/lib/google/sheets";
import { hashPassword } from "@/lib/security/password";

const USERS_TAB = "UserAccess";
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

function localUserId(username: string) {
  return `local:${normalizeUsername(username)}`;
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
  await getTenantLocalAccessList(tenantKey);
}

async function upsertDirectoryLocalRecord(input: {
  username: string;
  passwordHash: string;
  role: AppRole;
  personId: string;
  isEnabled: boolean;
  failedAttempts: number;
  lockedUntil: string;
  mustChangePassword: boolean;
}) {
  const username = normalizeUsername(input.username);
  const userId = localUserId(username);
  const payload: Record<string, string> = {
    user_id: userId,
    username,
    password_hash: input.passwordHash,
    role: input.role,
    person_id: input.personId,
    local_access: "TRUE",
    is_enabled: input.isEnabled ? "TRUE" : "FALSE",
    failed_attempts: String(input.failedAttempts),
    locked_until: input.lockedUntil,
    must_change_password: input.mustChangePassword ? "TRUE" : "FALSE",
  };

  let updated = await updateTableRecordById(USERS_TAB, userId, payload, "user_id");
  if (!updated && input.personId) {
    updated = await updateTableRecordById(USERS_TAB, input.personId, payload, "person_id");
  }
  if (!updated) {
    await createTableRecord(USERS_TAB, payload);
  }
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

export async function getLocalUsers(tenantKey: string) {
  return getTenantLocalAccessList(tenantKey);
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
  await upsertDirectoryLocalRecord({
    username: input.username,
    passwordHash: hashPassword(input.password),
    role: input.role,
    personId: input.personId,
    isEnabled: input.isEnabled,
    failedAttempts: 0,
    lockedUntil: "",
    mustChangePassword: true,
  });
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
  const current = await getLocalUserByUsername(tenantKey, username);
  if (!current) {
    return false;
  }

  const payload: Record<string, string> = { local_access: "TRUE" };
  if (patch.password !== undefined) payload.password_hash = hashPassword(patch.password);
  if (patch.isEnabled !== undefined) payload.is_enabled = patch.isEnabled ? "TRUE" : "FALSE";
  if (patch.role !== undefined) payload.role = patch.role;
  if (patch.personId !== undefined) payload.person_id = patch.personId;
  if (patch.failedAttempts !== undefined) payload.failed_attempts = String(patch.failedAttempts);
  if (patch.lockedUntil !== undefined) payload.locked_until = patch.lockedUntil;
  if (patch.mustChangePassword !== undefined) payload.must_change_password = patch.mustChangePassword ? "TRUE" : "FALSE";

  const userId = localUserId(current.username);
  let updated = await updateTableRecordById(USERS_TAB, userId, payload, "user_id");
  if (!updated && current.personId) {
    updated = await updateTableRecordById(USERS_TAB, current.personId, payload, "person_id");
  }
  return updated;
}

export async function renameLocalUser(tenantKey: string, username: string, nextUsername: string) {
  const current = normalizeUsername(username);
  const next = normalizeUsername(nextUsername);
  if (!next || next.length < 3) {
    throw new Error("Username must be at least 3 characters.");
  }
  if (current === next) {
    return;
  }

  const users = await getLocalUsers(tenantKey);
  const existing = users.find((user) => user.username === current);
  if (!existing) {
    throw new Error("Local user not found.");
  }
  if (users.some((user) => user.username === next)) {
    throw new Error("Target username already exists.");
  }

  const oldUserId = localUserId(current);
  const nextUserId = localUserId(next);
  let updated = await updateTableRecordById(
    USERS_TAB,
    oldUserId,
    { username: next, user_id: nextUserId, local_access: "TRUE" },
    "user_id",
  );
  if (!updated && existing.personId) {
    updated = await updateTableRecordById(
      USERS_TAB,
      existing.personId,
      { username: next, user_id: nextUserId, local_access: "TRUE" },
      "person_id",
    );
  }
  if (!updated) {
    throw new Error("Local user not found.");
  }
}

export async function deleteLocalUser(tenantKey: string, username: string) {
  const existing = await getLocalUserByUsername(tenantKey, username);
  if (!existing) {
    return false;
  }

  const payload: Record<string, string> = {
    local_access: "FALSE",
    is_enabled: "FALSE",
    password_hash: "",
    failed_attempts: "0",
    locked_until: "",
    must_change_password: "FALSE",
  };

  const userId = localUserId(existing.username);
  let updated = await updateTableRecordById(USERS_TAB, userId, payload, "user_id");
  if (!updated && existing.personId) {
    updated = await updateTableRecordById(USERS_TAB, existing.personId, payload, "person_id");
  }
  return updated;
}
