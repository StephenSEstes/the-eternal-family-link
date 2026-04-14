import "server-only";

import { createHash, randomBytes } from "node:crypto";
import oracledb from "oracledb";
import { sendPlainTextEmail } from "@/lib/auth/email";
import { hashPassword, validatePasswordComplexity } from "@/lib/auth/password";
import { withConnection } from "@/lib/oci/client";

const OUT_FORMAT = { outFormat: oracledb.OUT_FORMAT_OBJECT };
const APP_SCOPE = "famailink";
const APP_NAME = "Famailink";
const GENERIC_MESSAGE = "If that email matches an active user, a password reset email has been sent.";

let schemaEnsured = false;

type PasswordResetStatus = "pending" | "used" | "revoked" | "expired";

type PasswordResetRecord = {
  resetId: string;
  personId: string;
  familyGroupKey: string;
  resetEmail: string;
  username: string;
  tokenHash: string;
  status: "pending" | "used" | "revoked";
  expiresAt: string;
  completedAt: string;
  createdAt: string;
};

export type PasswordResetPresentation = {
  resetId: string;
  personId: string;
  familyGroupKey: string;
  familyGroupName: string;
  resetEmail: string;
  username: string;
  status: PasswordResetStatus;
  expiresAt: string;
};

type ResetTarget = {
  personId: string;
  username: string;
  resetEmail: string;
};

function normalize(value?: string) {
  return String(value ?? "").trim();
}

function normalizeLower(value?: string) {
  return normalize(value).toLowerCase();
}

function getCell(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function safeIso(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function buildResetId() {
  return `fm-reset-${randomBytes(8).toString("hex")}`;
}

function buildResetToken() {
  return randomBytes(24).toString("base64url");
}

function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeStatus(value: string): PasswordResetRecord["status"] {
  const normalized = normalizeLower(value);
  if (normalized === "used" || normalized === "revoked") {
    return normalized;
  }
  return "pending";
}

function safeExecuteError(message: string) {
  return /ORA-00955|ORA-01408|ORA-01430|ORA-01442|already exists|already used/i.test(message);
}

async function safeExecute(connection: any, sql: string) {
  try {
    await connection.execute(sql);
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (!safeExecuteError(message)) {
      throw error;
    }
  }
}

async function ensureSchema() {
  if (schemaEnsured) return;

  await withConnection(async (connection) => {
    const statements = [
      `CREATE TABLE password_resets (
         reset_id VARCHAR2(128) PRIMARY KEY,
         person_id VARCHAR2(128) NOT NULL,
         family_group_key VARCHAR2(128) NOT NULL,
         reset_email VARCHAR2(320) NOT NULL,
         username VARCHAR2(256),
         token_hash VARCHAR2(128) NOT NULL,
         status VARCHAR2(32),
         expires_at VARCHAR2(64),
         completed_at VARCHAR2(64),
         created_at VARCHAR2(64)
       )`,
      "CREATE UNIQUE INDEX ux_password_resets_token_hash ON password_resets(token_hash)",
      "CREATE INDEX ix_password_resets_email_status ON password_resets(reset_email, status)",
      "CREATE INDEX ix_password_resets_person_status ON password_resets(person_id, family_group_key, status)",
    ];

    for (const statement of statements) {
      await safeExecute(connection, statement);
    }
    await connection.commit();
  });

  schemaEnsured = true;
}

function toRecord(row: Record<string, unknown>): PasswordResetRecord {
  return {
    resetId: getCell(row, "RESET_ID"),
    personId: getCell(row, "PERSON_ID"),
    familyGroupKey: normalizeLower(getCell(row, "FAMILY_GROUP_KEY")),
    resetEmail: normalizeLower(getCell(row, "RESET_EMAIL")),
    username: normalizeLower(getCell(row, "USERNAME")),
    tokenHash: getCell(row, "TOKEN_HASH"),
    status: normalizeStatus(getCell(row, "STATUS")),
    expiresAt: safeIso(getCell(row, "EXPIRES_AT")) || getCell(row, "EXPIRES_AT"),
    completedAt: safeIso(getCell(row, "COMPLETED_AT")) || getCell(row, "COMPLETED_AT"),
    createdAt: safeIso(getCell(row, "CREATED_AT")) || getCell(row, "CREATED_AT"),
  };
}

function effectiveStatus(record: PasswordResetRecord): PasswordResetStatus {
  if (record.status === "pending") {
    const expiresAt = Date.parse(record.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
      return "expired";
    }
  }
  return record.status;
}

function toPresentation(record: PasswordResetRecord): PasswordResetPresentation {
  return {
    resetId: record.resetId,
    personId: record.personId,
    familyGroupKey: record.familyGroupKey,
    familyGroupName: APP_NAME,
    resetEmail: record.resetEmail,
    username: record.username,
    status: effectiveStatus(record),
    expiresAt: record.expiresAt,
  };
}

async function listResetTargetsByEmail(email: string): Promise<ResetTarget[]> {
  const normalizedEmail = normalizeLower(email);
  if (!normalizedEmail) return [];

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT u.person_id,
              u.username,
              LOWER(COALESCE(TRIM(u.user_email), TRIM(p.email))) AS reset_email
         FROM user_access u
         LEFT JOIN people p ON p.person_id = u.person_id
        WHERE LOWER(COALESCE(TRIM(u.user_email), TRIM(p.email))) = :email
          AND (LOWER(TRIM(NVL(u.local_access, 'TRUE'))) IN ('y','yes','true','1'))
          AND (LOWER(TRIM(NVL(u.is_enabled, 'TRUE'))) IN ('y','yes','true','1'))
          AND TRIM(u.password_hash) IS NOT NULL
        ORDER BY u.person_id`,
      { email: normalizedEmail },
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      personId: getCell(row, "PERSON_ID"),
      username: getCell(row, "USERNAME"),
      resetEmail: getCell(row, "RESET_EMAIL"),
    }));
  });
}

async function findResetRecordByToken(token: string): Promise<PasswordResetRecord | null> {
  const normalizedToken = normalize(token);
  if (!normalizedToken) return null;

  await ensureSchema();
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT reset_id, person_id, family_group_key, reset_email, username, token_hash, status, expires_at, completed_at, created_at
         FROM password_resets
        WHERE token_hash = :tokenHash`,
      { tokenHash: hashResetToken(normalizedToken) },
      OUT_FORMAT,
    );
    const row = ((result.rows ?? []) as Record<string, unknown>[])[0];
    return row ? toRecord(row) : null;
  });
}

function buildPasswordResetMessage(input: { username: string; resetUrl: string }) {
  return [
    "You requested a password reset for Famailink.",
    "",
    `Username: ${input.username}`,
    "",
    "Open the link below to choose a new password:",
    input.resetUrl,
    "",
    "This link expires in 2 hours.",
    "If you did not request this reset, you can ignore this email.",
  ].join("\n");
}

export async function requestPasswordReset(input: { email: string; appBaseUrl: string }) {
  await ensureSchema();

  const matches = await listResetTargetsByEmail(input.email);
  if (matches.length !== 1) {
    return { ok: true, message: GENERIC_MESSAGE };
  }

  const target = matches[0]!;
  const token = buildResetToken();
  const now = new Date().toISOString();
  const record: PasswordResetRecord = {
    resetId: buildResetId(),
    personId: target.personId,
    familyGroupKey: APP_SCOPE,
    resetEmail: normalizeLower(target.resetEmail),
    username: normalizeLower(target.username),
    tokenHash: hashResetToken(token),
    status: "pending",
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    completedAt: "",
    createdAt: now,
  };

  await withConnection(async (connection) => {
    await connection.execute(
      `UPDATE password_resets
          SET status = 'revoked'
        WHERE person_id = :personId
          AND family_group_key = :familyGroupKey
          AND status = 'pending'`,
      {
        personId: target.personId,
        familyGroupKey: APP_SCOPE,
      },
      { autoCommit: false },
    );

    await connection.execute(
      `INSERT INTO password_resets (
         reset_id, person_id, family_group_key, reset_email, username, token_hash, status, expires_at, completed_at, created_at
       ) VALUES (
         :resetId, :personId, :familyGroupKey, :resetEmail, :username, :tokenHash, :status, :expiresAt, :completedAt, :createdAt
       )`,
      {
        resetId: record.resetId,
        personId: record.personId,
        familyGroupKey: record.familyGroupKey,
        resetEmail: record.resetEmail,
        username: record.username,
        tokenHash: record.tokenHash,
        status: record.status,
        expiresAt: record.expiresAt,
        completedAt: "",
        createdAt: record.createdAt,
      },
      { autoCommit: false },
    );

    await connection.commit();
  });

  const resetUrl = `${input.appBaseUrl.replace(/\/$/, "")}/reset-password/${encodeURIComponent(token)}`;
  try {
    await sendPlainTextEmail({
      to: record.resetEmail,
      subject: `Reset your password for ${APP_NAME}`,
      text: buildPasswordResetMessage({
        username: target.username,
        resetUrl,
      }),
    });
  } catch {
    await withConnection(async (connection) => {
      await connection.execute(
        `UPDATE password_resets
            SET status = 'revoked'
          WHERE reset_id = :resetId`,
        { resetId: record.resetId },
        { autoCommit: true },
      );
    });
    throw new Error("Password reset email could not be sent.");
  }

  return { ok: true, message: GENERIC_MESSAGE };
}

export async function getPasswordResetPresentationByToken(token: string): Promise<PasswordResetPresentation | null> {
  const record = await findResetRecordByToken(token);
  return record ? toPresentation(record) : null;
}

export async function completePasswordReset(token: string, password: string) {
  await ensureSchema();

  const record = await findResetRecordByToken(token);
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

  const complexityError = validatePasswordComplexity(password);
  if (complexityError) {
    throw new Error(complexityError);
  }

  const passwordHash = hashPassword(password);
  const completedAt = new Date().toISOString();

  await withConnection(async (connection) => {
    const updateResult = await connection.execute(
      `UPDATE user_access
          SET password_hash = :passwordHash
        WHERE person_id = :personId
          AND (LOWER(TRIM(NVL(local_access, 'TRUE'))) IN ('y','yes','true','1'))
          AND (LOWER(TRIM(NVL(is_enabled, 'TRUE'))) IN ('y','yes','true','1'))`,
      {
        passwordHash,
        personId: record.personId,
      },
      { autoCommit: false },
    );

    if (!updateResult.rowsAffected) {
      throw new Error("Active local user not found for this password reset.");
    }

    await connection.execute(
      `UPDATE password_resets
          SET status = 'used',
              completed_at = :completedAt
        WHERE reset_id = :resetId`,
      {
        completedAt,
        resetId: record.resetId,
      },
      { autoCommit: false },
    );

    await connection.commit();
  });

  return {
    username: record.username,
  };
}
