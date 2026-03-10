import "server-only";

import { getEnv } from "@/lib/env";
import { DEFAULT_TENANT_KEY, DEFAULT_TENANT_NAME } from "@/lib/family-group/context";
import type {
  AppRole,
  ImportantDateRecord,
  LocalUserRecord,
  PersonRecord,
  PersonUpdateInput,
  TenantAccess,
  TenantConfig,
  UserAccessRecord,
} from "@/lib/google/types";
import type { TableRecord } from "@/lib/data/types";
import {
  createOciTableRecords,
  deleteOciTableRecordById,
  deleteOciTableRows,
  getOciAuditLogRows,
  getOciEnabledUserAccessesByEmail,
  getOciEnabledUserAccessesByPersonId,
  getOciLocalUsersForTenant,
  getOciPeopleRows,
  getOciTableRecordById,
  getOciTableRecords,
  getOciTenantUserAccessRows,
  listOciTables,
  updateOciTableRecordById,
  upsertOciPersonFamilyGroupMembership,
  upsertOciTenantAccess,
} from "@/lib/oci/tables";
import { viewerPinHash } from "@/lib/security/pin";

export const PEOPLE_TABLE = "People";
export const PERSON_ATTRIBUTES_TABLE = "Attributes";

const IMPORTANT_DATES_TABLE = "ImportantDates";
const FAMILY_CONFIG_TABLE = "FamilyConfig";
const LEGACY_TENANT_CONFIG_TABLE = "TenantConfig";

export type UpsertTenantAccessInput = {
  userEmail: string;
  tenantKey: string;
  tenantName: string;
  role: AppRole;
  personId: string;
  isEnabled: boolean;
};

export type UpsertTenantAccessResult = {
  action: "created" | "updated";
  rowNumber: number;
};

export type AuditLogInput = {
  actorEmail?: string;
  actorPersonId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  familyGroupKey?: string;
  status?: "SUCCESS" | "FAILURE";
  details?: string;
};

export type AuditLogRecord = {
  eventId: string;
  timestamp: string;
  actorEmail: string;
  actorPersonId: string;
  action: string;
  entityType: string;
  entityId: string;
  familyGroupKey: string;
  status: string;
  details: string;
};

export type AuditLogQuery = {
  familyGroupKey?: string;
  actorEmail?: string;
  actorPersonId?: string;
  action?: string;
  entityType?: string;
  status?: string;
  fromTimestamp?: string;
  toTimestamp?: string;
  limit?: number;
};

const PEOPLE_HEADERS = [
  "person_id",
  "display_name",
  "first_name",
  "middle_name",
  "last_name",
  "maiden_name",
  "nick_name",
  "birth_date",
  "gender",
  "phones",
  "email",
  "address",
  "hobbies",
  "notes",
  "photo_file_id",
  "is_pinned",
  "relationships",
];

function toRole(value: string | undefined): AppRole {
  return value?.trim().toUpperCase() === "ADMIN" ? "ADMIN" : "USER";
}

function parseBool(value: string | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1" || normalized === "y";
}

function toList(value: string | undefined) {
  return (value ?? "")
    .split(/[,;|]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readValue(record: Record<string, string>, ...keys: string[]) {
  const lowered = new Map(Object.entries(record).map(([key, value]) => [key.trim().toLowerCase(), value]));
  for (const key of keys) {
    const value = lowered.get(key.trim().toLowerCase());
    if (value !== undefined) {
      return value;
    }
  }
  return "";
}

function normalizeTenantKey(tenantKey?: string) {
  const raw = (tenantKey ?? DEFAULT_TENANT_KEY).trim().toLowerCase();
  if (raw === "default") {
    return DEFAULT_TENANT_KEY;
  }
  const clean = raw.replace(/[^a-z0-9_-]/g, "");
  return clean || DEFAULT_TENANT_KEY;
}

function normalizeDate(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (iso.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toISOString().slice(0, 10);
}

function defaultTenantConfig(tenantKey?: string): TenantConfig {
  const env = getEnv();
  const normalizedKey = normalizeTenantKey(tenantKey);
  return {
    tenantKey: normalizedKey,
    tenantName: normalizedKey === DEFAULT_TENANT_KEY ? DEFAULT_TENANT_NAME : normalizedKey,
    viewerPinHash: viewerPinHash(env.VIEWER_PIN),
    photosFolderId: env.PHOTOS_FOLDER_ID,
  };
}

function rowToPerson(data: Record<string, string>): PersonRecord {
  const firstName = (data.first_name ?? "").trim();
  const middleName = (data.middle_name ?? "").trim();
  const lastName = (data.last_name ?? "").trim();
  const maidenName = (data.maiden_name ?? "").trim();
  const nickName = (data.nick_name ?? "").trim();
  const fallbackDisplayName = [firstName, middleName, lastName].filter(Boolean).join(" ").trim();
  return {
    personId: data.person_id ?? "",
    displayName: (data.display_name ?? "").trim() || fallbackDisplayName,
    firstName,
    middleName,
    lastName,
    maidenName,
    nickName,
    birthDate: data.birth_date ?? "",
    gender: ((): "male" | "female" | "unspecified" => {
      const raw = (data.gender ?? "").trim().toLowerCase();
      if (raw === "male" || raw === "female") {
        return raw;
      }
      return "unspecified";
    })(),
    phones: data.phones ?? "",
    email: data.email ?? "",
    address: data.address ?? "",
    hobbies: data.hobbies ?? "",
    notes: data.notes ?? "",
    photoFileId: (data.photo_file_id ?? "").trim() || (data.primary_photo_file_id ?? "").trim(),
    isPinned: parseBool(data.is_pinned) || parseBool(data.is_pinned_viewer),
    relationships: toList(data.relationships),
  };
}

function peopleFromRows(rows: TableRecord[]) {
  const deduped = new Map<string, PersonRecord>();
  for (const row of rows) {
    const person = rowToPerson(row.data);
    if (!person.personId || deduped.has(person.personId)) {
      continue;
    }
    deduped.set(person.personId, person);
  }
  return Array.from(deduped.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function listTables(_timeoutMs = 3000): Promise<string[]> {
  return listOciTables();
}

export async function ensureTenantScaffold(input: {
  tenantKey: string;
  tenantName: string;
  photosFolderId: string;
}) {
  const normalizedTenantKey = normalizeTenantKey(input.tenantKey);
  const configPayload: Record<string, string> = {
    family_group_key: normalizedTenantKey,
    family_group_name: input.tenantName.trim() || normalizedTenantKey,
    viewer_pin_hash: viewerPinHash(getEnv().VIEWER_PIN),
    photos_folder_id: input.photosFolderId,
  };
  const updated = await updateTableRecordById(
    [FAMILY_CONFIG_TABLE, LEGACY_TENANT_CONFIG_TABLE],
    normalizedTenantKey,
    configPayload,
    "family_group_key",
  );
  if (!updated) {
    await createTableRecord(FAMILY_CONFIG_TABLE, configPayload);
  }
}

export async function appendAuditLog(input: AuditLogInput) {
  const now = new Date().toISOString();
  const eventId = `${now}-${Math.random().toString(36).slice(2, 10)}`.replace(/[^a-zA-Z0-9_-]/g, "");
  await createOciTableRecords("AuditLog", [
    {
      event_id: eventId,
      timestamp: now,
      actor_email: (input.actorEmail ?? "").trim().toLowerCase(),
      actor_person_id: (input.actorPersonId ?? "").trim(),
      action: input.action.trim(),
      entity_type: input.entityType.trim(),
      entity_id: (input.entityId ?? "").trim(),
      family_group_key: input.familyGroupKey ? normalizeTenantKey(input.familyGroupKey) : "",
      status: (input.status ?? "SUCCESS").trim().toUpperCase(),
      details: (input.details ?? "").slice(0, 2000),
    },
  ]).catch(() => undefined);
}

export async function getAuditLogEntries(query: AuditLogQuery = {}): Promise<AuditLogRecord[]> {
  const rows = await getOciAuditLogRows(query);
  return rows.map((row) => ({
    eventId: row.eventId,
    timestamp: row.timestamp,
    actorEmail: row.actorEmail,
    actorPersonId: row.actorPersonId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    familyGroupKey: row.familyGroupKey,
    status: row.status,
    details: row.details,
  }));
}

export async function getTableRecords(tableName: string | string[], _tenantKey?: string): Promise<TableRecord[]> {
  return getOciTableRecords(tableName);
}

export async function getTableRecordById(
  tableName: string | string[],
  recordId: string,
  idColumn?: string,
  _tenantKey?: string,
): Promise<TableRecord | null> {
  return getOciTableRecordById(tableName, recordId, idColumn);
}

export async function createTableRecord(
  tableName: string | string[],
  payload: Record<string, string>,
  tenantKey?: string,
): Promise<TableRecord> {
  const [created] = await createTableRecords(tableName, [payload], tenantKey);
  return created;
}

export async function createTableRecords(
  tableName: string | string[],
  payloads: Record<string, string>[],
  _tenantKey?: string,
): Promise<TableRecord[]> {
  return createOciTableRecords(tableName, payloads);
}

export async function updateTableRecordById(
  tableName: string | string[],
  recordId: string,
  payload: Record<string, string>,
  idColumn?: string,
  _tenantKey?: string,
): Promise<TableRecord | null> {
  return updateOciTableRecordById(tableName, recordId, payload, idColumn);
}

export async function deleteTableRecordById(
  tableName: string | string[],
  recordId: string,
  idColumn?: string,
  _tenantKey?: string,
): Promise<boolean> {
  return deleteOciTableRecordById(tableName, recordId, idColumn);
}

export async function deleteTableRows(
  tableName: string | string[],
  rowNumbers: number[],
  _tenantKey?: string,
): Promise<number> {
  return deleteOciTableRows(tableName, rowNumbers);
}

export async function getEnabledUserAccess(email: string): Promise<UserAccessRecord | null> {
  const entries = await getEnabledUserAccessList(email);
  if (entries.length === 0) {
    return null;
  }
  const primary = entries[0];
  return {
    userEmail: email.trim().toLowerCase(),
    isEnabled: true,
    role: primary.role,
    personId: primary.personId,
    tenantKey: primary.tenantKey,
    tenantName: primary.tenantName,
    lastLoginAt: "",
  };
}

export async function getEnabledUserAccessList(email: string): Promise<TenantAccess[]> {
  const rows = await getOciEnabledUserAccessesByEmail(email);
  const familyMap = new Map<string, TenantAccess>();
  for (const row of rows) {
    const tenantKey = row.tenantKey.trim() || DEFAULT_TENANT_KEY;
    familyMap.set(tenantKey, {
      tenantKey,
      tenantName: row.tenantName.trim() || DEFAULT_TENANT_NAME,
      role: toRole(row.role),
      personId: row.personId,
    });
  }
  return Array.from(familyMap.values()).sort((a, b) => a.tenantName.localeCompare(b.tenantName));
}

export async function getEnabledUserAccessListByPersonId(personId: string): Promise<TenantAccess[]> {
  const rows = await getOciEnabledUserAccessesByPersonId(personId);
  const familyMap = new Map<string, TenantAccess>();
  for (const row of rows) {
    const tenantKey = row.tenantKey.trim() || DEFAULT_TENANT_KEY;
    familyMap.set(tenantKey, {
      tenantKey,
      tenantName: row.tenantName.trim() || DEFAULT_TENANT_NAME,
      role: toRole(row.role),
      personId: row.personId,
    });
  }
  return Array.from(familyMap.values()).sort((a, b) => a.tenantName.localeCompare(b.tenantName));
}

export async function getAllFamilyGroupAccesses(personId: string): Promise<TenantAccess[]> {
  const normalizedPersonId = personId.trim();
  const rows = await getTableRecords(["FamilyConfig", "TenantConfig"]).catch(() => []);
  const byKey = new Map<string, TenantAccess>();
  for (const row of rows) {
    const tenantKey = readValue(row.data, "family_group_key", "tenant_key").trim().toLowerCase();
    const tenantName = readValue(row.data, "family_group_name", "tenant_name").trim();
    if (!tenantKey) {
      continue;
    }
    if (!byKey.has(tenantKey)) {
      byKey.set(tenantKey, {
        tenantKey,
        tenantName: tenantName || DEFAULT_TENANT_NAME,
        role: "ADMIN",
        personId: normalizedPersonId,
      });
    }
  }
  if (!byKey.has(DEFAULT_TENANT_KEY)) {
    byKey.set(DEFAULT_TENANT_KEY, {
      tenantKey: DEFAULT_TENANT_KEY,
      tenantName: DEFAULT_TENANT_NAME,
      role: "ADMIN",
      personId: normalizedPersonId,
    });
  }
  return Array.from(byKey.values()).sort((a, b) => a.tenantName.localeCompare(b.tenantName));
}

export async function getTenantUserAccessList(tenantKey: string): Promise<UserAccessRecord[]> {
  const normalizedTenantKey = normalizeTenantKey(tenantKey);
  const rows = await getOciTenantUserAccessRows(normalizedTenantKey);
  return rows.map((row) => ({
    userEmail: row.userEmail,
    isEnabled: row.isEnabled,
    role: toRole(row.role),
    personId: row.personId,
    tenantKey: row.tenantKey || normalizedTenantKey,
    tenantName: row.tenantName || DEFAULT_TENANT_NAME,
    lastLoginAt: row.lastLoginAt,
  }));
}

export async function upsertTenantAccess(input: UpsertTenantAccessInput): Promise<UpsertTenantAccessResult> {
  const action = await upsertOciTenantAccess({
    userEmail: input.userEmail,
    tenantKey: input.tenantKey,
    tenantName: input.tenantName,
    role: input.role,
    personId: input.personId,
    isEnabled: input.isEnabled,
  });
  return { action, rowNumber: 0 };
}

export async function ensurePersonFamilyGroupMembership(
  personId: string,
  tenantKey: string,
  isEnabled = true,
): Promise<"created" | "updated"> {
  const normalizedPersonId = personId.trim();
  const normalizedTenantKey = normalizeTenantKey(tenantKey);
  if (!normalizedPersonId) {
    throw new Error("person_id is required");
  }
  return upsertOciPersonFamilyGroupMembership(normalizedPersonId, normalizedTenantKey, isEnabled);
}

export async function getTenantLocalAccessList(tenantKey: string): Promise<LocalUserRecord[]> {
  const normalizedTenantKey = normalizeTenantKey(tenantKey);
  const rows = await getOciLocalUsersForTenant(normalizedTenantKey);
  return rows.map((row) => ({
    tenantKey: normalizedTenantKey,
    username: row.username,
    passwordHash: row.passwordHash,
    role: toRole(row.role),
    personId: row.personId,
    isEnabled: row.isEnabled,
    failedAttempts: row.failedAttempts,
    lockedUntil: row.lockedUntil,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt,
  }));
}

export async function getPeople(tenantKey?: string): Promise<PersonRecord[]> {
  const rows = await getOciPeopleRows(tenantKey).catch(() => []);
  return peopleFromRows(
    rows.map((record) => ({
      rowNumber: record.rowNumber,
      data: Object.fromEntries(PEOPLE_HEADERS.map((header) => [header, record.data[header] ?? ""])),
    })),
  );
}

export async function getTenantConfig(tenantKey?: string): Promise<TenantConfig> {
  const normalizedTenantKey = normalizeTenantKey(tenantKey);
  const rows = await getTableRecords([FAMILY_CONFIG_TABLE, LEGACY_TENANT_CONFIG_TABLE]).catch(() => []);
  if (rows.length === 0) {
    return defaultTenantConfig(normalizedTenantKey);
  }
  const row =
    rows.find((candidate) => (candidate.data.family_group_key ?? "").trim().toLowerCase() === normalizedTenantKey) ??
    rows.find((candidate) => {
      const rowTenantKey = (candidate.data.family_group_key ?? "").trim().toLowerCase();
      return !rowTenantKey && normalizedTenantKey === DEFAULT_TENANT_KEY;
    }) ??
    rows[0];
  if (!row) {
    return defaultTenantConfig(normalizedTenantKey);
  }
  const fallback = defaultTenantConfig(normalizedTenantKey);
  return {
    tenantKey: normalizedTenantKey,
    tenantName: (row.data.family_group_name ?? "").trim() || fallback.tenantName,
    viewerPinHash: (row.data.viewer_pin_hash ?? "").trim() || fallback.viewerPinHash,
    photosFolderId: (row.data.photos_folder_id ?? "").trim() || fallback.photosFolderId,
  };
}

export async function getImportantDates(tenantKey?: string): Promise<ImportantDateRecord[]> {
  const normalizedTenantKey = normalizeTenantKey(tenantKey);
  const rows = await getTableRecords(IMPORTANT_DATES_TABLE, normalizedTenantKey).catch(() => []);
  const items = rows
    .map((row, index) => {
      const shareScopeRaw = (row.data.share_scope ?? "").trim().toLowerCase();
      const shareScope = shareScopeRaw === "one_family" || shareScopeRaw === "single_family" ? "one_family" : "both_families";
      const shareFamilyGroupKey = (row.data.share_family_group_key ?? "").trim().toLowerCase();
      if (normalizedTenantKey) {
        const isVisibleForFamily = shareScope === "both_families" || shareFamilyGroupKey === normalizedTenantKey;
        if (!isVisibleForFamily) {
          return null;
        }
      }
      const title = (row.data.title ?? "").trim() || (row.data.event_title ?? "").trim();
      const rawDate =
        (row.data.date ?? "").trim() ||
        (row.data.event_date ?? "").trim() ||
        (row.data.important_date ?? "").trim();
      const personId = (row.data.person_id ?? "").trim();
      const description = (row.data.description ?? "").trim() || (row.data.notes ?? "").trim();
      const id = (row.data.id ?? "").trim() || `${normalizedTenantKey}-${index + 2}`;
      if (!title || !rawDate) {
        return null;
      }
      return {
        id,
        title,
        date: normalizeDate(rawDate),
        description,
        personId,
      } satisfies ImportantDateRecord;
    })
    .filter((item): item is ImportantDateRecord => Boolean(item));
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

export async function getPersonById(personId: string, tenantKey?: string): Promise<PersonRecord | null> {
  const people = await getPeople(tenantKey);
  return people.find((person) => person.personId === personId) ?? null;
}

export async function updatePerson(
  personId: string,
  updates: PersonUpdateInput,
  tenantKey?: string,
): Promise<PersonRecord | null> {
  const payload: Record<string, string> = {
    display_name: updates.display_name,
    birth_date: updates.birth_date,
    phones: updates.phones,
    address: updates.address,
    hobbies: updates.hobbies,
    notes: updates.notes,
  };
  if (updates.first_name !== undefined) payload.first_name = updates.first_name;
  if (updates.middle_name !== undefined) payload.middle_name = updates.middle_name;
  if (updates.last_name !== undefined) payload.last_name = updates.last_name;
  if (updates.maiden_name !== undefined) payload.maiden_name = updates.maiden_name;
  if (updates.nick_name !== undefined) payload.nick_name = updates.nick_name;
  if (updates.gender) payload.gender = updates.gender;
  if (updates.email !== undefined) payload.email = updates.email;
  const updated = await updateTableRecordById(PEOPLE_TABLE, personId, payload, "person_id", tenantKey);
  if (!updated) {
    return null;
  }
  return getPersonById(personId, tenantKey);
}
