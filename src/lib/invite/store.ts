import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { getLocalUserByUsername, getLocalUsers, getTenantSecurityPolicy, patchLocalUser, upsertLocalUser } from "@/lib/auth/local-users";
import type { TableRecord } from "@/lib/data/types";
import { createTableRecord, getPeople, getTableRecords, updateTableRecordById } from "@/lib/data/runtime";
import { getTenantBasePath } from "@/lib/family-group/context";
import type { AppRole, PersonRecord } from "@/lib/google/types";
import { upsertOciUserFamilyGroupAccess } from "@/lib/oci/tables";
import { validatePasswordComplexity, verifyPassword } from "@/lib/security/password";
import type { CreatedInvitePayload, InviteAuthMode, InviteFamilyGroupGrant, InvitePresentation, InviteStatus } from "@/lib/invite/types";

type InviteRecord = {
  inviteId: string;
  familyGroupKey: string;
  personId: string;
  inviteEmail: string;
  authMode: InviteAuthMode;
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
  sourceTenantKey: string;
  personId: string;
  inviteEmail: string;
  authMode: InviteAuthMode;
  role: AppRole;
  localUsername?: string;
  expiresInDays: number;
  createdByEmail: string;
  createdByPersonId: string;
  appBaseUrl: string;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeUsername(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "")
    .slice(0, 80);
}

function parseBool(value: string | undefined, defaultValue = false) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  return normalized === "true" || normalized === "yes" || normalized === "1" || normalized === "y";
}

function parseInviteStatus(value: string | undefined): "pending" | "accepted" | "revoked" {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "accepted" || normalized === "revoked") {
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

function effectiveStatus(record: InviteRecord): InviteStatus {
  if (record.status === "pending" && isExpired(record.expiresAt)) {
    return "expired";
  }
  return record.status;
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

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function buildInviteMessage(
  invite: InvitePresentation,
  inviteUrl: string,
) {
  const lines = [
    `Hi ${invite.personDisplayName},`,
    "",
    `You have been invited to join The Eternal Family Link for ${invite.familyGroupName}.`,
    "To get started:",
    "1. Open the link below.",
    `2. Confirm your username (${invite.localUsername}) or adjust it if needed.`,
    "3. Choose a password and enter it twice.",
    "4. After activation, sign in with the username you confirm on the invite page and your chosen password.",
    "",
    inviteUrl,
    "",
    "Install guidance:",
    "- On iPhone or iPad, open the link in Safari, tap Share, then choose Add to Home Screen.",
    "- On other devices, install from the browser menu if the app offers it after sign-in.",
    "",
    "For the easiest setup, open the link on the phone or tablet where you want the app installed.",
  ];

  return lines.join("\n");
}

function suggestLocalUsername(person: PersonRecord) {
  const explicit = normalizeUsername(person.email.split("@")[0] ?? "");
  if (explicit.length >= 3) {
    return explicit;
  }
  const parts = [person.firstName, person.middleName, person.lastName, person.displayName]
    .map((value) => normalizeUsername(value))
    .filter(Boolean);
  for (const part of parts) {
    if (part.length >= 3) {
      return part;
    }
  }
  return normalizeUsername(person.personId.replace(/[^a-z0-9]+/g, "")) || "familyuser";
}

function buildOpenAppPath(familyGroups: InviteFamilyGroupGrant[]) {
  const primary = familyGroups[0];
  if (!primary) {
    return "/";
  }
  const base = getTenantBasePath(primary.tenantKey);
  return base || "/";
}

function toInviteRecord(row: TableRecord): InviteRecord {
  const familyGroups = safeJsonParse<InviteFamilyGroupGrant[]>(row.data.family_groups_json ?? "", []);
  return {
    inviteId: (row.data.invite_id ?? "").trim(),
    familyGroupKey: (row.data.family_group_key ?? "").trim().toLowerCase(),
    personId: (row.data.person_id ?? "").trim(),
    inviteEmail: normalizeEmail(row.data.invite_email ?? ""),
    authMode: ((row.data.auth_mode ?? "").trim().toLowerCase() as InviteAuthMode) || "local",
    role: (row.data.role ?? "").trim().toUpperCase() === "ADMIN" ? "ADMIN" : "USER",
    localUsername: normalizeUsername(row.data.local_username ?? ""),
    familyGroups: familyGroups.map((item) => ({
      tenantKey: item.tenantKey.trim().toLowerCase(),
      tenantName: item.tenantName.trim(),
      role: item.role === "ADMIN" ? "ADMIN" : "USER",
    })),
    status: parseInviteStatus(row.data.status),
    tokenHash: (row.data.token_hash ?? "").trim(),
    expiresAt: (row.data.expires_at ?? "").trim(),
    acceptedAt: (row.data.accepted_at ?? "").trim(),
    acceptedByEmail: normalizeEmail(row.data.accepted_by_email ?? ""),
    acceptedAuthMode: (row.data.accepted_auth_mode ?? "").trim().toLowerCase() === "local" ? "local" : (row.data.accepted_auth_mode ?? "").trim().toLowerCase() === "google" ? "google" : "",
    createdAt: (row.data.created_at ?? "").trim(),
    createdByEmail: normalizeEmail(row.data.created_by_email ?? ""),
    createdByPersonId: (row.data.created_by_person_id ?? "").trim(),
  };
}

async function getPersonOrThrow(personId: string) {
  const person = (await getPeople()).find((item) => item.personId === personId) ?? null;
  if (!person) {
    throw new Error("Person not found.");
  }
  return person;
}

async function buildFamilyGroupSnapshot(personId: string, role: AppRole, sourceTenantKey: string) {
  const [membershipRows, configRows] = await Promise.all([
    getTableRecords("PersonFamilyGroups").catch(() => []),
    getTableRecords("FamilyConfig").catch(() => []),
  ]);
  const familyNameByKey = new Map<string, string>();
  for (const row of configRows) {
    const key = (row.data.family_group_key ?? "").trim().toLowerCase();
    if (!key || familyNameByKey.has(key)) {
      continue;
    }
    familyNameByKey.set(key, (row.data.family_group_name ?? "").trim() || key);
  }

  const grants = membershipRows
    .filter((row) => (row.data.person_id ?? "").trim() === personId && parseBool(row.data.is_enabled, true))
    .map((row) => {
      const tenantKey = (row.data.family_group_key ?? "").trim().toLowerCase();
      return {
        tenantKey,
        tenantName: familyNameByKey.get(tenantKey) ?? tenantKey,
        role,
      } satisfies InviteFamilyGroupGrant;
    })
    .filter((item) => item.tenantKey);

  const deduped = new Map<string, InviteFamilyGroupGrant>();
  for (const item of grants) {
    if (!deduped.has(item.tenantKey)) {
      deduped.set(item.tenantKey, item);
    }
  }
  const sourceKey = sourceTenantKey.trim().toLowerCase();
  return Array.from(deduped.values()).sort((a, b) => {
    if (a.tenantKey === sourceKey && b.tenantKey !== sourceKey) return -1;
    if (b.tenantKey === sourceKey && a.tenantKey !== sourceKey) return 1;
    return a.tenantName.localeCompare(b.tenantName);
  });
}

async function ensureInviteEmailAvailable(inviteEmail: string, personId: string) {
  const inviteRows = await getTableRecords("Invites").catch(() => []);
  const conflictingPendingInvite = inviteRows
    .map(toInviteRecord)
    .find((invite) => invite.inviteEmail === inviteEmail && invite.personId !== personId && effectiveStatus(invite) === "pending");
  if (conflictingPendingInvite) {
    throw new Error("This email already has a pending invite for another person.");
  }
}

async function provisionLocalMemberships(invite: InviteRecord, localEmail: string) {
  for (const family of invite.familyGroups) {
    await upsertOciUserFamilyGroupAccess({
      userEmail: localEmail,
      tenantKey: family.tenantKey,
      tenantName: family.tenantName,
      role: family.role,
      personId: invite.personId,
      isEnabled: true,
    });
  }
}

async function resolveInviteLocalUsername(
  personId: string,
  familyGroups: InviteFamilyGroupGrant[],
  preferredUsername: string,
) {
  const familyLocalUsers = await Promise.all(
    familyGroups.map(async (family) => ({
      family,
      localUsers: await getLocalUsers(family.tenantKey),
    })),
  );

  let existingUsername = "";
  for (const { localUsers } of familyLocalUsers) {
    const existing = localUsers.find((user) => user.personId === personId && user.username.trim());
    if (existing) {
      existingUsername = existing.username;
      break;
    }
  }

  const resolvedUsername = existingUsername || preferredUsername;
  if (!resolvedUsername) {
    throw new Error("Local sign-in requires a username.");
  }

  for (const { family, localUsers } of familyLocalUsers) {
    const conflict = localUsers.find((user) => user.username === resolvedUsername && user.personId !== personId);
    if (conflict) {
      throw new Error(`Username "${resolvedUsername}" is already used in ${family.tenantName}.`);
    }
  }

  const pendingInvites = (await getTableRecords("Invites").catch(() => []))
    .map(toInviteRecord)
    .filter((invite) => invite.personId !== personId && effectiveStatus(invite) === "pending" && normalizeUsername(invite.localUsername) === resolvedUsername);
  const requestedFamilyKeys = new Set(familyGroups.map((family) => family.tenantKey));
  const conflictingInvite = pendingInvites.find((invite) =>
    invite.familyGroups.some((family) => requestedFamilyKeys.has(family.tenantKey)),
  );
  if (conflictingInvite) {
    throw new Error(`Username "${resolvedUsername}" is already reserved by another pending invite.`);
  }

  return resolvedUsername;
}

async function updateInviteRecord(
  inviteId: string,
  payload: Record<string, string>,
) {
  await updateTableRecordById("Invites", inviteId, payload, "invite_id");
}

async function buildInvitePresentation(record: InviteRecord): Promise<InvitePresentation> {
  const person = await getPersonOrThrow(record.personId);
  const familyGroup = record.familyGroups[0] ?? {
    tenantKey: record.familyGroupKey,
    tenantName: record.familyGroupKey,
    role: record.role,
  };
  const status = effectiveStatus(record);

  return {
    inviteId: record.inviteId,
    personId: record.personId,
    personDisplayName: person.displayName || person.personId,
    inviteEmail: record.inviteEmail,
    authMode: "local",
    role: record.role,
    localUsername: record.localUsername || suggestLocalUsername(person),
    familyGroupKey: familyGroup.tenantKey,
    familyGroupName: familyGroup.tenantName,
    familyGroups: record.familyGroups,
    status,
    expiresAt: record.expiresAt,
    acceptedAt: record.acceptedAt,
    acceptedByEmail: record.acceptedByEmail,
    acceptedAuthMode: record.acceptedAuthMode,
    createdAt: record.createdAt,
    createdByEmail: record.createdByEmail,
    openAppPath: buildOpenAppPath(record.familyGroups),
  };
}

async function getInviteRecordByToken(token: string) {
  const normalized = token.trim();
  if (!normalized) {
    return null;
  }
  const rows = await getTableRecords("Invites").catch(() => []);
  const targetHash = hashInviteToken(normalized);
  const row = rows.find((item) => (item.data.token_hash ?? "").trim() === targetHash);
  return row ? toInviteRecord(row) : null;
}

export async function getInvitePresentationByToken(token: string) {
  const invite = await getInviteRecordByToken(token);
  if (!invite) {
    return null;
  }
  return buildInvitePresentation(invite);
}

export async function createInvite(input: CreateInviteInput): Promise<CreatedInvitePayload> {
  const inviteEmail = normalizeEmail(input.inviteEmail);
  const person = await getPersonOrThrow(input.personId);
  const familyGroups = await buildFamilyGroupSnapshot(input.personId, input.role, input.sourceTenantKey);
  if (familyGroups.length === 0) {
    throw new Error("Selected person does not have any enabled family-group memberships.");
  }
  await ensureInviteEmailAvailable(inviteEmail, input.personId);

  const inviteId = buildInviteId();
  const token = buildInviteToken();
  const tokenHash = hashInviteToken(token);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.max(1, input.expiresInDays) * 24 * 60 * 60 * 1000).toISOString();
  const requestedLocalUsername = normalizeUsername(input.localUsername ?? "") || suggestLocalUsername(person);
  const localUsername = await resolveInviteLocalUsername(input.personId, familyGroups, requestedLocalUsername);

  const record: InviteRecord = {
    inviteId,
    familyGroupKey: familyGroups[0]?.tenantKey ?? input.sourceTenantKey.trim().toLowerCase(),
    personId: input.personId,
    inviteEmail,
    authMode: "local",
    role: input.role,
    localUsername,
    familyGroups,
    status: "pending",
    tokenHash,
    expiresAt,
    acceptedAt: "",
    acceptedByEmail: "",
    acceptedAuthMode: "",
    createdAt,
    createdByEmail: normalizeEmail(input.createdByEmail),
    createdByPersonId: input.createdByPersonId.trim(),
  };

  await createTableRecord("Invites", {
    invite_id: record.inviteId,
    family_group_key: record.familyGroupKey,
    person_id: record.personId,
    invite_email: record.inviteEmail,
    auth_mode: record.authMode,
    role: record.role,
    local_username: record.localUsername,
    family_groups_json: JSON.stringify(record.familyGroups),
    status: record.status,
    token_hash: record.tokenHash,
    expires_at: record.expiresAt,
    accepted_at: "",
    accepted_by_email: "",
    accepted_auth_mode: "",
    created_at: record.createdAt,
    created_by_email: record.createdByEmail,
    created_by_person_id: record.createdByPersonId,
  });

  const inviteUrl = `${input.appBaseUrl.replace(/\/$/, "")}/invite/${encodeURIComponent(token)}`;
  const invitePresentation = await buildInvitePresentation(record);
  return {
    invite: invitePresentation,
    inviteUrl,
    inviteMessage: buildInviteMessage(invitePresentation, inviteUrl),
  };
}

export async function acceptInviteWithLocal(token: string, username: string, password: string) {
  const invite = await getInviteRecordByToken(token);
  if (!invite) {
    throw new Error("Invite not found.");
  }
  if (effectiveStatus(invite) === "expired") {
    throw new Error("This invite has expired.");
  }
  if (invite.status === "revoked") {
    throw new Error("This invite is no longer active.");
  }
  if (invite.status === "accepted") {
    return {
      invite: await buildInvitePresentation(invite),
      primaryTenantKey: invite.familyGroups[0]?.tenantKey ?? invite.familyGroupKey,
      username: invite.localUsername,
    };
  }
  const normalizedUsername = normalizeUsername(username);
  if (normalizedUsername.length < 3) {
    throw new Error("Username must be at least 3 characters.");
  }
  if (invite.familyGroups.length === 0) {
    throw new Error("Invite has no family-group access to grant.");
  }

  const primaryFamily = invite.familyGroups[0]!;
  const policy = await getTenantSecurityPolicy(primaryFamily.tenantKey);
  const complexityError = validatePasswordComplexity(password, policy);
  if (complexityError) {
    throw new Error(complexityError);
  }

  const existingLocalUser = await getLocalUserByUsername(primaryFamily.tenantKey, normalizedUsername);
  if (existingLocalUser && existingLocalUser.personId !== invite.personId) {
    throw new Error(`Username "${normalizedUsername}" is already used in ${primaryFamily.tenantName}.`);
  }

  await provisionLocalMemberships(invite, `${normalizedUsername}@local`);

  if (!existingLocalUser) {
    await upsertLocalUser({
      tenantKey: primaryFamily.tenantKey,
      username: normalizedUsername,
      password,
      role: invite.role,
      personId: invite.personId,
      isEnabled: true,
    });
    await patchLocalUser(primaryFamily.tenantKey, normalizedUsername, {
      role: invite.role,
      personId: invite.personId,
      isEnabled: true,
      mustChangePassword: false,
      failedAttempts: 0,
      lockedUntil: "",
    });
  } else if (!verifyPassword(password, existingLocalUser.passwordHash)) {
    await patchLocalUser(primaryFamily.tenantKey, normalizedUsername, {
      password,
      role: invite.role,
      personId: invite.personId,
      isEnabled: true,
      mustChangePassword: false,
      failedAttempts: 0,
      lockedUntil: "",
    });
  } else {
    await patchLocalUser(primaryFamily.tenantKey, normalizedUsername, {
      role: invite.role,
      personId: invite.personId,
      isEnabled: true,
      mustChangePassword: false,
      failedAttempts: 0,
      lockedUntil: "",
    });
  }

  const acceptedAt = new Date().toISOString();
  await updateInviteRecord(invite.inviteId, {
    status: "accepted",
    local_username: normalizedUsername,
    accepted_at: acceptedAt,
    accepted_by_email: invite.inviteEmail,
    accepted_auth_mode: "local",
  });

  const presentation = await buildInvitePresentation(
    {
      ...invite,
      status: "accepted",
      localUsername: normalizedUsername,
      acceptedAt,
      acceptedByEmail: invite.inviteEmail,
      acceptedAuthMode: "local",
    },
  );

  return {
    invite: presentation,
    primaryTenantKey: primaryFamily.tenantKey,
    username: normalizedUsername,
  };
}
