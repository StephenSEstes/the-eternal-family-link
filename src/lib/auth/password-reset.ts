import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { getLocalUsers, getTenantSecurityPolicy, patchLocalUser } from "@/lib/auth/local-users";
import type { PasswordResetPresentation } from "@/lib/auth/password-reset-types";
import { appendAuditLog, createTableRecord, getPeople, getTableRecords, getTenantConfig, updateTableRecordById } from "@/lib/data/runtime";
import { sendPlainTextEmail } from "@/lib/google/gmail";
import { validatePasswordComplexity } from "@/lib/security/password";

type PasswordResetRecord = {
  resetId: string;
  personId: string;
  tenantKey: string;
  resetEmail: string;
  username: string;
  tokenHash: string;
  status: "pending" | "used" | "revoked";
  expiresAt: string;
  completedAt: string;
  createdAt: string;
};

type PasswordResetTarget = {
  personId: string;
  tenantKey: string;
  tenantName: string;
  resetEmail: string;
  username: string;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function normalizeStatus(value: string): "pending" | "used" | "revoked" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "used" || normalized === "revoked") {
    return normalized;
  }
  return "pending";
}

function isExpired(expiresAt: string) {
  if (!expiresAt.trim()) {
    return false;
  }
  const ms = Date.parse(expiresAt);
  return Number.isFinite(ms) && ms < Date.now();
}

function effectiveStatus(record: PasswordResetRecord): PasswordResetPresentation["status"] {
  if (record.status === "pending" && isExpired(record.expiresAt)) {
    return "expired";
  }
  return record.status;
}

function buildResetId() {
  return `reset-${randomBytes(8).toString("hex")}`;
}

function buildResetToken() {
  return randomBytes(24).toString("base64url");
}

function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function safeIsoDate(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function toPasswordResetRecord(data: Record<string, string>): PasswordResetRecord {
  return {
    resetId: (data.reset_id ?? "").trim(),
    personId: (data.person_id ?? "").trim(),
    tenantKey: (data.family_group_key ?? "").trim().toLowerCase(),
    resetEmail: normalizeEmail(data.reset_email ?? ""),
    username: normalizeUsername(data.username ?? ""),
    tokenHash: (data.token_hash ?? "").trim(),
    status: normalizeStatus(data.status ?? ""),
    expiresAt: safeIsoDate(data.expires_at ?? "") || (data.expires_at ?? "").trim(),
    completedAt: safeIsoDate(data.completed_at ?? "") || (data.completed_at ?? "").trim(),
    createdAt: safeIsoDate(data.created_at ?? "") || (data.created_at ?? "").trim(),
  };
}

function toPresentation(record: PasswordResetRecord, tenantName: string): PasswordResetPresentation {
  return {
    resetId: record.resetId,
    personId: record.personId,
    tenantKey: record.tenantKey,
    tenantName,
    resetEmail: record.resetEmail,
    username: record.username,
    status: effectiveStatus(record),
    expiresAt: record.expiresAt,
  };
}

async function getPasswordResetRecordByToken(token: string) {
  const normalized = token.trim();
  if (!normalized) {
    return null;
  }
  const targetHash = hashResetToken(normalized);
  const rows = await getTableRecords("PasswordResets").catch(() => []);
  const row = rows.find((item) => (item.data.token_hash ?? "").trim() === targetHash);
  return row ? toPasswordResetRecord(row.data) : null;
}

function uniqueEmails(...values: string[]) {
  return Array.from(
    new Set(
      values
        .map(normalizeEmail)
        .filter((value) => value && !value.endsWith("@local")),
    ),
  );
}

async function resolvePasswordResetTarget(tenantKey: string, email: string): Promise<PasswordResetTarget | null> {
  const normalizedTenantKey = tenantKey.trim().toLowerCase();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedTenantKey || !normalizedEmail) {
    return null;
  }

  const [localUsers, people, userAccessRows, inviteRows, tenantConfig] = await Promise.all([
    getLocalUsers(normalizedTenantKey),
    getPeople(normalizedTenantKey),
    getTableRecords("UserAccess").catch(() => []),
    getTableRecords("Invites").catch(() => []),
    getTenantConfig(normalizedTenantKey),
  ]);

  const personEmailById = new Map(
    people
      .filter((person) => person.personId.trim())
      .map((person) => [person.personId.trim(), normalizeEmail(person.email)]),
  );

  const userAccessEmailByPersonId = new Map<string, string>();
  for (const row of userAccessRows) {
    const personId = (row.data.person_id ?? "").trim();
    const rowEmail = normalizeEmail(row.data.user_email ?? "");
    if (!personId || !rowEmail || rowEmail.endsWith("@local")) {
      continue;
    }
    if (!userAccessEmailByPersonId.has(personId)) {
      userAccessEmailByPersonId.set(personId, rowEmail);
    }
  }

  const latestInviteEmailByPersonId = new Map<string, string>();
  const sortedInvites = inviteRows
    .map((row) => ({
      personId: (row.data.person_id ?? "").trim(),
      inviteEmail: normalizeEmail(row.data.invite_email ?? ""),
      createdAt: Date.parse(row.data.created_at ?? "") || 0,
      status: normalizeStatus(row.data.status ?? ""),
    }))
    .filter((row) => row.personId && row.inviteEmail && row.status !== "revoked")
    .sort((a, b) => b.createdAt - a.createdAt);
  for (const invite of sortedInvites) {
    if (!latestInviteEmailByPersonId.has(invite.personId)) {
      latestInviteEmailByPersonId.set(invite.personId, invite.inviteEmail);
    }
  }

  const matches = localUsers
    .filter((user) => user.isEnabled)
    .map((user) => ({
      user,
      emails: uniqueEmails(
        userAccessEmailByPersonId.get(user.personId) ?? "",
        personEmailById.get(user.personId) ?? "",
        latestInviteEmailByPersonId.get(user.personId) ?? "",
      ),
    }))
    .filter((entry) => entry.emails.includes(normalizedEmail));

  if (matches.length !== 1) {
    return null;
  }

  const match = matches[0]!;
  return {
    personId: match.user.personId,
    tenantKey: normalizedTenantKey,
    tenantName: tenantConfig.tenantName,
    resetEmail: normalizedEmail,
    username: match.user.username,
  };
}

function buildPasswordResetMessage(input: {
  tenantName: string;
  username: string;
  resetUrl: string;
}) {
  return [
    "You requested a password reset for The Eternal Family Link.",
    "",
    `Family group: ${input.tenantName}`,
    `Username: ${input.username}`,
    "",
    "Open the link below to choose a new password:",
    input.resetUrl,
    "",
    "This link expires in 2 hours.",
    "If you did not request this reset, you can ignore this email.",
  ].join("\n");
}

export async function requestPasswordReset(input: {
  tenantKey: string;
  email: string;
  appBaseUrl: string;
}) {
  const target = await resolvePasswordResetTarget(input.tenantKey, input.email);
  const genericMessage = "If that email matches an active user, a password reset email has been sent.";
  if (!target) {
    await appendAuditLog({
      actorEmail: normalizeEmail(input.email),
      action: "REQUEST_PASSWORD_RESET",
      entityType: "AUTH",
      entityId: normalizeEmail(input.email),
      familyGroupKey: input.tenantKey,
      status: "FAILURE",
      details: "Password reset request did not match exactly one active local user.",
    }).catch(() => undefined);
    return { ok: true, message: genericMessage };
  }

  const existingRows = await getTableRecords("PasswordResets").catch(() => []);
  const pendingRows = existingRows
    .map((row) => toPasswordResetRecord(row.data))
    .filter((row) => row.personId === target.personId && row.tenantKey === target.tenantKey && row.status === "pending");
  for (const row of pendingRows) {
    await updateTableRecordById("PasswordResets", row.resetId, { status: "revoked" }, "reset_id").catch(() => undefined);
  }

  const token = buildResetToken();
  const record: PasswordResetRecord = {
    resetId: buildResetId(),
    personId: target.personId,
    tenantKey: target.tenantKey,
    resetEmail: target.resetEmail,
    username: target.username,
    tokenHash: hashResetToken(token),
    status: "pending",
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    completedAt: "",
    createdAt: new Date().toISOString(),
  };

  await createTableRecord("PasswordResets", {
    reset_id: record.resetId,
    person_id: record.personId,
    family_group_key: record.tenantKey,
    reset_email: record.resetEmail,
    username: record.username,
    token_hash: record.tokenHash,
    status: record.status,
    expires_at: record.expiresAt,
    completed_at: record.completedAt,
    created_at: record.createdAt,
  });

  const resetUrl = `${input.appBaseUrl.replace(/\/$/, "")}/reset-password/${encodeURIComponent(token)}`;
  try {
    await sendPlainTextEmail({
      to: target.resetEmail,
      subject: `Reset your password for The Eternal Family Link (${target.tenantName})`,
      text: buildPasswordResetMessage({
        tenantName: target.tenantName,
        username: target.username,
        resetUrl,
      }),
    });
  } catch (error) {
    await appendAuditLog({
      actorEmail: target.resetEmail,
      actorPersonId: target.personId,
      action: "REQUEST_PASSWORD_RESET",
      entityType: "AUTH",
      entityId: record.resetId,
      familyGroupKey: target.tenantKey,
      status: "FAILURE",
      details: `Password reset email send failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    }).catch(() => undefined);
    throw error;
  }

  await appendAuditLog({
    actorEmail: target.resetEmail,
    actorPersonId: target.personId,
    action: "REQUEST_PASSWORD_RESET",
    entityType: "AUTH",
    entityId: record.resetId,
    familyGroupKey: target.tenantKey,
    status: "SUCCESS",
    details: `Password reset email sent for username=${target.username}.`,
  }).catch(() => undefined);

  return { ok: true, message: genericMessage };
}

export async function getPasswordResetPresentationByToken(token: string): Promise<PasswordResetPresentation | null> {
  const record = await getPasswordResetRecordByToken(token);
  if (!record) {
    return null;
  }
  const tenantConfig = await getTenantConfig(record.tenantKey);
  return toPresentation(record, tenantConfig.tenantName);
}

export async function completePasswordReset(token: string, password: string) {
  const record = await getPasswordResetRecordByToken(token);
  if (!record) {
    throw new Error("Password reset link not found.");
  }
  const status = effectiveStatus(record);
  if (status === "expired") {
    throw new Error("This password reset link has expired.");
  }
  if (status === "used") {
    throw new Error("This password reset link has already been used.");
  }
  if (status === "revoked") {
    throw new Error("This password reset link is no longer active.");
  }

  const policy = await getTenantSecurityPolicy(record.tenantKey);
  const complexityError = validatePasswordComplexity(password, policy);
  if (complexityError) {
    throw new Error(complexityError);
  }

  const localUsers = await getLocalUsers(record.tenantKey);
  const localUser = localUsers.find((user) => user.personId === record.personId && user.isEnabled);
  if (!localUser) {
    throw new Error("Active local user not found for this password reset.");
  }

  const updated = await patchLocalUser(record.tenantKey, localUser.username, {
    password,
    isEnabled: true,
    failedAttempts: 0,
    lockedUntil: "",
    mustChangePassword: false,
  });
  if (!updated) {
    throw new Error("Password reset could not be applied.");
  }

  const completedAt = new Date().toISOString();
  await updateTableRecordById("PasswordResets", record.resetId, {
    status: "used",
    username: localUser.username,
    completed_at: completedAt,
  }, "reset_id");

  await appendAuditLog({
    actorEmail: record.resetEmail,
    actorPersonId: record.personId,
    action: "COMPLETE_PASSWORD_RESET",
    entityType: "AUTH",
    entityId: record.resetId,
    familyGroupKey: record.tenantKey,
    status: "SUCCESS",
    details: `Password reset completed for username=${localUser.username}.`,
  }).catch(() => undefined);

  const tenantConfig = await getTenantConfig(record.tenantKey);
  return {
    tenantKey: record.tenantKey,
    tenantName: tenantConfig.tenantName,
    username: localUser.username,
  };
}
