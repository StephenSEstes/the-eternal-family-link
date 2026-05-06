import "server-only";

import { createHash, randomBytes } from "node:crypto";
import oracledb from "oracledb";
import { hashPassword, validatePasswordComplexity } from "@/lib/auth/password";
import { withConnection } from "@/lib/oci/client";
import type {
  AppRole,
  CreatedInvitePayload,
  InviteDirectoryPerson,
  InviteFamilyGroupGrant,
  InvitePresentation,
  InviteStatus,
} from "@/lib/invite/types";

const OUT_FORMAT = { outFormat: oracledb.OUT_FORMAT_OBJECT };

type InviteRecord = {
  inviteId: string;
  familyGroupKey: string;
  personId: string;
  inviteEmail: string;
  authMode: "google" | "local" | "either";
  role: AppRole;
  localUsername: string;
  familyGroups: InviteFamilyGroupGrant[];
  status: "pending" | "accepted" | "revoked";
  tokenHash: string;
  expiresAt: string;
  acceptedAt: string;
  acceptedByEmail: string;
  acceptedAuthMode: "" | "google" | "local";
  createdAt: string;
  createdByEmail: string;
  createdByPersonId: string;
};

type CreateInviteInput = {
  adminPersonId: string;
  personId: string;
  inviteEmail: string;
  role: AppRole;
  localUsername?: string;
  expiresInDays: number;
  createdByEmail: string;
  createdByPersonId: string;
  appBaseUrl: string;
};

type PersonRow = {
  personId: string;
  displayName: string;
  email: string;
};

type LocalUserRow = {
  personId: string;
  username: string;
  userEmail: string;
  role: AppRole;
};

function normalize(value?: unknown) {
  return String(value ?? "").trim();
}

function normalizeLower(value?: unknown) {
  return normalize(value).toLowerCase();
}

function normalizeRole(value?: unknown): AppRole {
  return normalize(value).toUpperCase() === "ADMIN" ? "ADMIN" : "USER";
}

function normalizeUsername(value?: unknown) {
  return normalize(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "")
    .slice(0, 80);
}

function normalizeEmail(value?: unknown) {
  return normalize(value).toLowerCase();
}

function getCell(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return value === undefined || value === null ? "" : String(value).trim();
}

function parseIntSafe(value?: unknown, fallback = 0) {
  const out = Number.parseInt(normalize(value), 10);
  return Number.isFinite(out) ? out : fallback;
}

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function buildInviteToken() {
  return randomBytes(24).toString("base64url");
}

function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function buildInviteId() {
  return `invite-${randomBytes(8).toString("hex")}`;
}

function isExpired(expiresAt: string) {
  const ms = Date.parse(normalize(expiresAt));
  return Number.isFinite(ms) && ms < Date.now();
}

function effectiveStatus(record: InviteRecord): InviteStatus {
  if (record.status === "pending" && isExpired(record.expiresAt)) {
    return "expired";
  }
  return record.status;
}

function suggestLocalUsername(person: PersonRow) {
  const emailLocal = normalizeUsername(person.email.split("@")[0] ?? "");
  if (emailLocal.length >= 3) return emailLocal;

  const displayTokens = normalize(person.displayName)
    .split(/[\s._-]+/)
    .map((token) => normalizeUsername(token))
    .filter(Boolean);
  for (const token of displayTokens) {
    if (token.length >= 3) return token;
  }
  return normalizeUsername(person.personId.replace(/[^a-z0-9]+/g, "")) || "familyuser";
}

function buildOpenAppPath() {
  return "/tree";
}

function buildInviteMessage(invite: InvitePresentation, inviteUrl: string) {
  return [
    `Hi ${invite.personDisplayName},`,
    "",
    `You have been invited to join Famailink for ${invite.familyGroupName}.`,
    "To get started:",
    "1. Open the link below.",
    `2. Confirm your username (${invite.localUsername}) or adjust it if needed.`,
    "3. Choose a password and enter it twice.",
    "4. After activation, sign in to Famailink with that username and your chosen password.",
    "",
    inviteUrl,
    "",
    "Install guidance:",
    "- On iPhone or iPad, open the link in Safari, tap Share, then choose Add to Home Screen.",
    "- On other devices, install from the browser menu if the app offers it after sign-in.",
    "",
    "For the easiest setup, open the link on the phone or tablet where you want the app installed.",
  ].join("\n");
}

function buildPrimaryFamilyName(families: InviteFamilyGroupGrant[]) {
  return families[0]?.tenantName || "Famailink";
}

function mapInviteRecord(row: Record<string, unknown>): InviteRecord {
  const familyGroups = safeJsonParse<InviteFamilyGroupGrant[]>(getCell(row, "FAMILY_GROUPS_JSON"), []);
  return {
    inviteId: getCell(row, "INVITE_ID"),
    familyGroupKey: normalizeLower(getCell(row, "FAMILY_GROUP_KEY")),
    personId: getCell(row, "PERSON_ID"),
    inviteEmail: normalizeEmail(getCell(row, "INVITE_EMAIL")),
    authMode: (normalizeLower(getCell(row, "AUTH_MODE")) as "google" | "local" | "either") || "local",
    role: normalizeRole(getCell(row, "ROLE")),
    localUsername: normalizeUsername(getCell(row, "LOCAL_USERNAME")),
    familyGroups: familyGroups
      .map((family) => ({
        tenantKey: normalizeLower(family.tenantKey),
        tenantName: normalize(family.tenantName),
        role: normalizeRole(family.role),
      }))
      .filter((family) => family.tenantKey),
    status: normalizeLower(getCell(row, "STATUS")) === "accepted" ? "accepted" : normalizeLower(getCell(row, "STATUS")) === "revoked" ? "revoked" : "pending",
    tokenHash: getCell(row, "TOKEN_HASH"),
    expiresAt: getCell(row, "EXPIRES_AT"),
    acceptedAt: getCell(row, "ACCEPTED_AT"),
    acceptedByEmail: normalizeEmail(getCell(row, "ACCEPTED_BY_EMAIL")),
    acceptedAuthMode:
      normalizeLower(getCell(row, "ACCEPTED_AUTH_MODE")) === "local"
        ? "local"
        : normalizeLower(getCell(row, "ACCEPTED_AUTH_MODE")) === "google"
          ? "google"
          : "",
    createdAt: getCell(row, "CREATED_AT"),
    createdByEmail: normalizeEmail(getCell(row, "CREATED_BY_EMAIL")),
    createdByPersonId: getCell(row, "CREATED_BY_PERSON_ID"),
  };
}

function toPresentation(record: InviteRecord): InvitePresentation {
  return {
    inviteId: record.inviteId,
    personId: record.personId,
    personDisplayName: "",
    inviteEmail: record.inviteEmail,
    authMode: record.authMode,
    role: record.role,
    localUsername: record.localUsername,
    familyGroupKey: record.familyGroupKey,
    familyGroupName: buildPrimaryFamilyName(record.familyGroups),
    familyGroups: record.familyGroups,
    status: effectiveStatus(record),
    expiresAt: record.expiresAt,
    acceptedAt: record.acceptedAt,
    acceptedByEmail: record.acceptedByEmail,
    acceptedAuthMode: record.acceptedAuthMode,
    createdAt: record.createdAt,
    createdByEmail: record.createdByEmail,
    openAppPath: buildOpenAppPath(),
  };
}

function bindList(prefix: string, values: string[], binds: Record<string, string>) {
  return values
    .map((value, index) => {
      const key = `${prefix}${index}`;
      binds[key] = value;
      return `:${key}`;
    })
    .join(", ");
}

async function listAdminFamilyKeys(personId: string) {
  const normalized = normalize(personId);
  if (!normalized) return [] as string[];

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT family_group_key
         FROM person_family_groups
        WHERE TRIM(person_id) = :personId
          AND (LOWER(TRIM(NVL(is_enabled, 'TRUE'))) IN ('y','yes','true','1'))
        ORDER BY family_group_key`,
      { personId: normalized },
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => normalizeLower(getCell(row, "FAMILY_GROUP_KEY"))).filter(Boolean);
  });
}

async function getPerson(personId: string): Promise<PersonRow | null> {
  const normalized = normalize(personId);
  if (!normalized) return null;

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT person_id,
              COALESCE(NULLIF(TRIM(display_name), ''), TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), person_id) AS display_name,
              TRIM(NVL(email, '')) AS email
         FROM people
        WHERE TRIM(person_id) = :personId`,
      { personId: normalized },
      OUT_FORMAT,
    );
    const row = ((result.rows ?? []) as Record<string, unknown>[])[0];
    return row
      ? {
          personId: getCell(row, "PERSON_ID"),
          displayName: getCell(row, "DISPLAY_NAME"),
          email: normalizeEmail(getCell(row, "EMAIL")),
        }
      : null;
  });
}

async function getLocalUserByPersonId(personId: string): Promise<LocalUserRow | null> {
  const normalized = normalize(personId);
  if (!normalized) return null;

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT person_id, username, user_email, role
         FROM user_access
        WHERE TRIM(person_id) = :personId
          AND (LOWER(TRIM(NVL(local_access, 'TRUE'))) IN ('y','yes','true','1'))
        ORDER BY person_id`,
      { personId: normalized },
      OUT_FORMAT,
    );
    const row = ((result.rows ?? []) as Record<string, unknown>[])[0];
    return row
      ? {
          personId: getCell(row, "PERSON_ID"),
          username: normalizeUsername(getCell(row, "USERNAME")),
          userEmail: normalizeEmail(getCell(row, "USER_EMAIL")),
          role: normalizeRole(getCell(row, "ROLE")),
        }
      : null;
  });
}

async function listLocalUsersByUsername(username: string): Promise<LocalUserRow[]> {
  const normalized = normalizeUsername(username);
  if (!normalized) return [];

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT person_id, username, user_email, role
         FROM user_access
        WHERE LOWER(TRIM(username)) = :username
          AND (LOWER(TRIM(NVL(local_access, 'TRUE'))) IN ('y','yes','true','1'))
          AND (LOWER(TRIM(NVL(is_enabled, 'TRUE'))) IN ('y','yes','true','1'))
        ORDER BY person_id`,
      { username: normalized },
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      personId: getCell(row, "PERSON_ID"),
      username: normalizeUsername(getCell(row, "USERNAME")),
      userEmail: normalizeEmail(getCell(row, "USER_EMAIL")),
      role: normalizeRole(getCell(row, "ROLE")),
    }));
  });
}

async function buildFamilyGroupSnapshot(personId: string, role: AppRole) {
  const normalized = normalize(personId);
  if (!normalized) return [] as InviteFamilyGroupGrant[];

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT DISTINCT
              LOWER(TRIM(pfg.family_group_key)) AS family_group_key,
              COALESCE(NULLIF(TRIM(cfg.family_group_name), ''), LOWER(TRIM(pfg.family_group_key))) AS family_group_name
         FROM person_family_groups pfg
         LEFT JOIN family_config cfg
           ON LOWER(TRIM(cfg.family_group_key)) = LOWER(TRIM(pfg.family_group_key))
        WHERE TRIM(pfg.person_id) = :personId
          AND (LOWER(TRIM(NVL(pfg.is_enabled, 'TRUE'))) IN ('y','yes','true','1'))
        ORDER BY family_group_name`,
      { personId: normalized },
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows
      .map((row) => ({
        tenantKey: normalizeLower(getCell(row, "FAMILY_GROUP_KEY")),
        tenantName: getCell(row, "FAMILY_GROUP_NAME"),
        role,
      }))
      .filter((family) => family.tenantKey);
  });
}

async function ensureAdminCanManagePerson(adminPersonId: string, targetPersonId: string) {
  const adminFamilyKeys = await listAdminFamilyKeys(adminPersonId);
  if (!adminFamilyKeys.length) {
    throw new Error("Admin has no enabled family-group memberships.");
  }

  return withConnection(async (connection) => {
    const binds: Record<string, string> = {
      personId: normalize(targetPersonId),
    };
    const inClause = bindList("familyKey", adminFamilyKeys, binds);
    const result = await connection.execute(
      `SELECT COUNT(*) AS match_count
         FROM person_family_groups
        WHERE TRIM(person_id) = :personId
          AND (LOWER(TRIM(NVL(is_enabled, 'TRUE'))) IN ('y','yes','true','1'))
          AND LOWER(TRIM(family_group_key)) IN (${inClause})`,
      binds,
      OUT_FORMAT,
    );
    const row = ((result.rows ?? []) as Record<string, unknown>[])[0];
    if (parseIntSafe(row?.MATCH_COUNT, 0) <= 0) {
      throw new Error("Selected person is not in one of your family groups.");
    }
  });
}

async function ensureInviteEmailAvailable(inviteEmail: string, personId: string) {
  const email = normalizeEmail(inviteEmail);
  const targetPersonId = normalize(personId);
  if (!email || !targetPersonId) return;

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT invite_id, person_id, invite_email, auth_mode, role, local_username, family_groups_json, status,
              token_hash, expires_at, accepted_at, accepted_by_email, accepted_auth_mode, created_at,
              created_by_email, created_by_person_id
         FROM invites
        WHERE LOWER(TRIM(invite_email)) = :inviteEmail
          AND TRIM(person_id) <> :personId
          AND LOWER(TRIM(NVL(status, 'pending'))) = 'pending'
          AND (NULLIF(TRIM(expires_at), '') IS NULL OR TRIM(expires_at) >= :nowIso)`,
      {
        inviteEmail: email,
        personId: targetPersonId,
        nowIso: new Date().toISOString(),
      },
      OUT_FORMAT,
    );
    const existing = ((result.rows ?? []) as Record<string, unknown>[])[0];
    if (existing) {
      throw new Error("This email already has a pending invite for another person.");
    }
  });
}

async function resolveInviteLocalUsername(person: PersonRow, preferredUsername: string) {
  const existingLocalUser = await getLocalUserByPersonId(person.personId);
  const resolvedUsername = normalizeUsername(existingLocalUser?.username || preferredUsername || suggestLocalUsername(person));
  if (!resolvedUsername || resolvedUsername.length < 3) {
    throw new Error("Local sign-in requires a username with at least 3 characters.");
  }

  const conflictingLocalUser = (await listLocalUsersByUsername(resolvedUsername)).find((user) => user.personId !== person.personId);
  if (conflictingLocalUser) {
    throw new Error(`Username "${resolvedUsername}" is already used by another person.`);
  }

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT person_id
         FROM invites
        WHERE LOWER(TRIM(NVL(status, 'pending'))) = 'pending'
          AND LOWER(TRIM(NVL(local_username, ''))) = :localUsername
          AND TRIM(person_id) <> :personId
          AND (NULLIF(TRIM(expires_at), '') IS NULL OR TRIM(expires_at) >= :nowIso)`,
      {
        localUsername: resolvedUsername,
        personId: person.personId,
        nowIso: new Date().toISOString(),
      },
      OUT_FORMAT,
    );
    const conflictingInvite = ((result.rows ?? []) as Record<string, unknown>[])[0];
    if (conflictingInvite) {
      throw new Error(`Username "${resolvedUsername}" is already reserved by another pending invite.`);
    }
    return resolvedUsername;
  });
}

async function insertInviteRecord(record: InviteRecord) {
  return withConnection(async (connection) => {
    await connection.execute(
      `INSERT INTO invites (
         invite_id, family_group_key, person_id, invite_email, auth_mode, role, local_username, family_groups_json,
         status, token_hash, expires_at, accepted_at, accepted_by_email, accepted_auth_mode, created_at,
         created_by_email, created_by_person_id
       ) VALUES (
         :inviteId, :familyGroupKey, :personId, :inviteEmail, :authMode, :role, :localUsername, :familyGroupsJson,
         :status, :tokenHash, :expiresAt, :acceptedAt, :acceptedByEmail, :acceptedAuthMode, :createdAt,
         :createdByEmail, :createdByPersonId
       )`,
      {
        inviteId: record.inviteId,
        familyGroupKey: record.familyGroupKey,
        personId: record.personId,
        inviteEmail: record.inviteEmail,
        authMode: record.authMode,
        role: record.role,
        localUsername: record.localUsername,
        familyGroupsJson: JSON.stringify(record.familyGroups),
        status: record.status,
        tokenHash: record.tokenHash,
        expiresAt: record.expiresAt,
        acceptedAt: record.acceptedAt,
        acceptedByEmail: record.acceptedByEmail,
        acceptedAuthMode: record.acceptedAuthMode,
        createdAt: record.createdAt,
        createdByEmail: record.createdByEmail,
        createdByPersonId: record.createdByPersonId,
      },
      { autoCommit: true },
    );
  });
}

async function updateInviteRecord(inviteId: string, payload: Record<string, unknown>) {
  const sets: string[] = [];
  const binds: Record<string, unknown> = { inviteId: normalize(inviteId) };
  for (const [key, value] of Object.entries(payload)) {
    sets.push(`${key} = :${key}`);
    binds[key] = value;
  }
  if (!sets.length) return;

  return withConnection(async (connection) => {
    await connection.execute(
      `UPDATE invites
          SET ${sets.join(", ")}
        WHERE TRIM(invite_id) = :inviteId`,
      binds,
      { autoCommit: true },
    );
  });
}

async function findInviteByToken(token: string): Promise<InviteRecord | null> {
  const normalizedToken = normalize(token);
  if (!normalizedToken) return null;

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT invite_id, family_group_key, person_id, invite_email, auth_mode, role, local_username, family_groups_json,
              status, token_hash, expires_at, accepted_at, accepted_by_email, accepted_auth_mode, created_at,
              created_by_email, created_by_person_id
         FROM invites
        WHERE token_hash = :tokenHash`,
      { tokenHash: hashInviteToken(normalizedToken) },
      OUT_FORMAT,
    );
    const row = ((result.rows ?? []) as Record<string, unknown>[])[0];
    return row ? mapInviteRecord(row) : null;
  });
}

async function provisionLocalMemberships(invite: InviteRecord, localEmail: string) {
  return withConnection(async (connection) => {
    for (const family of invite.familyGroups) {
      const updateResult = await connection.execute(
        `UPDATE user_family_groups
            SET user_email = :userEmail,
                family_group_name = :tenantName,
                role = :role,
                person_id = :personId,
                is_enabled = 'TRUE'
          WHERE LOWER(TRIM(family_group_key)) = :tenantKey
            AND (
              LOWER(TRIM(user_email)) = :userEmail
              OR TRIM(person_id) = :personId
            )`,
        {
          userEmail: localEmail,
          tenantName: family.tenantName,
          role: family.role,
          personId: invite.personId,
          tenantKey: family.tenantKey,
        },
        { autoCommit: false },
      );

      if (!(updateResult.rowsAffected ?? 0)) {
        await connection.execute(
          `INSERT INTO user_family_groups (
             user_email, family_group_key, family_group_name, role, person_id, is_enabled
           ) VALUES (
             :userEmail, :tenantKey, :tenantName, :role, :personId, 'TRUE'
           )`,
          {
            userEmail: localEmail,
            tenantKey: family.tenantKey,
            tenantName: family.tenantName,
            role: family.role,
            personId: invite.personId,
          },
          { autoCommit: false },
        );
      }
    }
    await connection.commit();
  });
}

async function upsertLocalUser(input: {
  personId: string;
  username: string;
  userEmail: string;
  password: string;
  role: AppRole;
}) {
  const passwordHash = hashPassword(input.password);
  return withConnection(async (connection) => {
    const updated = await connection.execute(
      `UPDATE user_access
          SET role = :role,
              user_email = :userEmail,
              username = :username,
              local_access = 'TRUE',
              is_enabled = 'TRUE',
              password_hash = :passwordHash,
              failed_attempts = '0',
              locked_until = '',
              must_change_password = 'FALSE'
        WHERE TRIM(person_id) = :personId`,
      {
        role: input.role,
        userEmail: input.userEmail,
        username: input.username,
        passwordHash,
        personId: input.personId,
      },
      { autoCommit: false },
    );

    if (!(updated.rowsAffected ?? 0)) {
      await connection.execute(
        `INSERT INTO user_access (
           person_id, role, user_email, username, google_access, local_access, is_enabled, password_hash,
           failed_attempts, locked_until, must_change_password, last_login_at
         ) VALUES (
           :personId, :role, :userEmail, :username, '', 'TRUE', 'TRUE', :passwordHash,
           '0', '', 'FALSE', ''
         )`,
        {
          personId: input.personId,
          role: input.role,
          userEmail: input.userEmail,
          username: input.username,
          passwordHash,
        },
        { autoCommit: false },
      );
    }

    await connection.commit();
  });
}

export async function canAdministerInvites(personId: string) {
  const normalized = normalize(personId);
  if (!normalized) return false;

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT COUNT(*) AS admin_count
         FROM user_access
        WHERE TRIM(person_id) = :personId
          AND UPPER(TRIM(NVL(role, 'USER'))) = 'ADMIN'
          AND (LOWER(TRIM(NVL(is_enabled, 'TRUE'))) IN ('y','yes','true','1'))`,
      { personId: normalized },
      OUT_FORMAT,
    );
    const row = ((result.rows ?? []) as Record<string, unknown>[])[0];
    return parseIntSafe(row?.ADMIN_COUNT, 0) > 0;
  });
}

export async function listInviteDirectoryPeople(adminPersonId: string): Promise<InviteDirectoryPerson[]> {
  const familyKeys = await listAdminFamilyKeys(adminPersonId);
  if (!familyKeys.length) return [];

  return withConnection(async (connection) => {
    const binds: Record<string, string> = {
      adminPersonId: normalize(adminPersonId),
    };
    const inClause = bindList("familyKey", familyKeys, binds);
    const result = await connection.execute(
      `SELECT
          p.person_id,
          COALESCE(NULLIF(TRIM(p.display_name), ''), TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), p.person_id) AS display_name,
          TRIM(NVL(p.email, '')) AS email,
          MAX(CASE
                WHEN LOWER(TRIM(NVL(u.local_access, 'TRUE'))) IN ('y','yes','true','1')
                 AND LOWER(TRIM(NVL(u.is_enabled, 'TRUE'))) IN ('y','yes','true','1')
                THEN TRIM(NVL(u.username, ''))
                ELSE ''
              END) AS local_username,
          MAX(CASE
                WHEN LOWER(TRIM(NVL(u.local_access, 'TRUE'))) IN ('y','yes','true','1')
                 AND LOWER(TRIM(NVL(u.is_enabled, 'TRUE'))) IN ('y','yes','true','1')
                THEN UPPER(TRIM(NVL(u.role, 'USER')))
                ELSE ''
              END) AS local_role,
          COUNT(DISTINCT LOWER(TRIM(pfg.family_group_key))) AS family_group_count
         FROM people p
         JOIN person_family_groups pfg
           ON TRIM(pfg.person_id) = TRIM(p.person_id)
          AND (LOWER(TRIM(NVL(pfg.is_enabled, 'TRUE'))) IN ('y','yes','true','1'))
          AND LOWER(TRIM(pfg.family_group_key)) IN (${inClause})
         LEFT JOIN user_access u
           ON TRIM(u.person_id) = TRIM(p.person_id)
         WHERE TRIM(p.person_id) <> :adminPersonId
         GROUP BY p.person_id, p.display_name, p.first_name, p.last_name, p.email
         ORDER BY display_name`,
      binds,
      OUT_FORMAT,
    );

    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      personId: getCell(row, "PERSON_ID"),
      displayName: getCell(row, "DISPLAY_NAME"),
      email: normalizeEmail(getCell(row, "EMAIL")),
      localUsername: normalizeUsername(getCell(row, "LOCAL_USERNAME")),
      localRole: getCell(row, "LOCAL_ROLE") ? normalizeRole(getCell(row, "LOCAL_ROLE")) : "",
      familyGroupCount: parseIntSafe(row.FAMILY_GROUP_COUNT, 0),
    }));
  });
}

export async function getInvitePresentationByToken(token: string): Promise<InvitePresentation | null> {
  const record = await findInviteByToken(token);
  if (!record) return null;

  const person = await getPerson(record.personId);
  const presentation = toPresentation(record);
  return {
    ...presentation,
    personDisplayName: person?.displayName || record.personId,
  };
}

export async function createInvite(input: CreateInviteInput): Promise<CreatedInvitePayload> {
  const adminCanInvite = await canAdministerInvites(input.adminPersonId);
  if (!adminCanInvite) {
    throw new Error("Only admins can create invites.");
  }

  await ensureAdminCanManagePerson(input.adminPersonId, input.personId);

  const person = await getPerson(input.personId);
  if (!person) {
    throw new Error("Person not found.");
  }

  const inviteEmail = normalizeEmail(input.inviteEmail);
  if (!inviteEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(inviteEmail)) {
    throw new Error("Invite email is required.");
  }

  await ensureInviteEmailAvailable(inviteEmail, input.personId);

  const familyGroups = await buildFamilyGroupSnapshot(input.personId, input.role);
  if (!familyGroups.length) {
    throw new Error("This person has no enabled family-group memberships to grant.");
  }

  const localUsername = await resolveInviteLocalUsername(person, input.localUsername ?? "");
  const token = buildInviteToken();
  const inviteRecord: InviteRecord = {
    inviteId: buildInviteId(),
    familyGroupKey: familyGroups[0]?.tenantKey ?? "",
    personId: person.personId,
    inviteEmail,
    authMode: "local",
    role: input.role,
    localUsername,
    familyGroups,
    status: "pending",
    tokenHash: hashInviteToken(token),
    expiresAt: new Date(Date.now() + Math.max(1, Math.min(60, Math.trunc(input.expiresInDays))) * 24 * 60 * 60 * 1000).toISOString(),
    acceptedAt: "",
    acceptedByEmail: "",
    acceptedAuthMode: "",
    createdAt: new Date().toISOString(),
    createdByEmail: normalizeEmail(input.createdByEmail),
    createdByPersonId: normalize(input.createdByPersonId),
  };

  await insertInviteRecord(inviteRecord);

  const invite = await getInvitePresentationByToken(token);
  if (!invite) {
    throw new Error("Invite could not be loaded after creation.");
  }

  const inviteUrl = `${input.appBaseUrl.replace(/\/$/, "")}/invite/${encodeURIComponent(token)}`;
  return {
    invite,
    inviteUrl,
    inviteMessage: buildInviteMessage(invite, inviteUrl),
  };
}

export async function acceptInviteWithLocal(token: string, username: string, password: string) {
  const invite = await findInviteByToken(token);
  if (!invite) {
    throw new Error("Invite not found.");
  }
  if (invite.status === "accepted") {
    throw new Error("This invite has already been accepted.");
  }
  if (effectiveStatus(invite) === "expired") {
    throw new Error("This invite has expired.");
  }
  if (invite.status === "revoked") {
    throw new Error("This invite is no longer active.");
  }
  if (!invite.familyGroups.length) {
    throw new Error("Invite has no family-group access to grant.");
  }

  const normalizedUsername = normalizeUsername(username);
  if (normalizedUsername.length < 3) {
    throw new Error("Username must be at least 3 characters.");
  }

  const complexityError = validatePasswordComplexity(password);
  if (complexityError) {
    throw new Error(complexityError);
  }

  const conflictingUser = (await listLocalUsersByUsername(normalizedUsername)).find((user) => user.personId !== invite.personId);
  if (conflictingUser) {
    throw new Error(`Username "${normalizedUsername}" is already used by another person.`);
  }

  await provisionLocalMemberships(invite, `${normalizedUsername}@local`);
  await upsertLocalUser({
    personId: invite.personId,
    username: normalizedUsername,
    userEmail: `${normalizedUsername}@local`,
    password,
    role: invite.role,
  });

  await updateInviteRecord(invite.inviteId, {
    status: "accepted",
    local_username: normalizedUsername,
    accepted_at: new Date().toISOString(),
    accepted_by_email: invite.inviteEmail,
    accepted_auth_mode: "local",
  });

  const acceptedInvite = await getInvitePresentationByToken(token);
  if (!acceptedInvite) {
    throw new Error("Invite acceptance succeeded but could not be reloaded.");
  }

  return {
    invite: acceptedInvite,
    username: normalizedUsername,
    redirectPath: "/tree",
  };
}
