import "server-only";

import { randomUUID } from "node:crypto";
import {
  createTableRecords,
  deleteTableRows,
  getTableRecords,
  updateTableRecordById,
} from "@/lib/data/runtime";
import type { TableRecord } from "@/lib/data/types";
import type {
  U1EffectType,
  U1HouseholdLite,
  U1LineageSide,
  U1OwnerShareDefaultRule,
  U1OwnerShareHouseholdException,
  U1OwnerSharePersonException,
  U1PersonLite,
  U1PreviewRow,
  U1ProfileAccessMapRow,
  U1RecomputeJob,
  U1RecomputeRun,
  U1RelationshipCategory,
  U1RelationshipLite,
  U1SubscriptionDefaultRule,
  U1SubscriptionHouseholdException,
  U1SubscriptionPersonException,
} from "@/lib/u1/types";

const TABLE_SUBSCRIPTION_DEFAULTS = "SubscriptionDefaultRules";
const TABLE_SUBSCRIPTION_PERSON_EXCEPTIONS = "SubscriptionPersonExceptions";
const TABLE_SUBSCRIPTION_HOUSEHOLD_EXCEPTIONS = "SubscriptionHouseholdExceptions";
const TABLE_OWNER_SHARE_DEFAULTS = "OwnerShareDefaultRules";
const TABLE_OWNER_SHARE_PERSON_EXCEPTIONS = "OwnerSharePersonExceptions";
const TABLE_OWNER_SHARE_HOUSEHOLD_EXCEPTIONS = "OwnerShareHouseholdExceptions";
const TABLE_PROFILE_ACCESS_MAP = "ProfileAccessMap";
const TABLE_RECOMPUTE_JOBS = "AccessRecomputeJobs";
const TABLE_RECOMPUTE_RUNS = "AccessRecomputeRuns";

function nowIso() {
  return new Date().toISOString();
}

function normalize(value?: string) {
  return String(value ?? "").trim();
}

function normalizeLower(value?: string) {
  return normalize(value).toLowerCase();
}

function fromDbBool(value?: string) {
  const normalized = normalizeLower(value);
  return normalized === "y" || normalized === "yes" || normalized === "true" || normalized === "1";
}

function fromNullableDbBool(value?: string) {
  const normalized = normalizeLower(value);
  if (!normalized) return null;
  return normalized === "y" || normalized === "yes" || normalized === "true" || normalized === "1";
}

function toDbBool(value: boolean) {
  return value ? "Y" : "N";
}

function toDbNullableBool(value: boolean | null) {
  if (value === null) return "";
  return value ? "Y" : "N";
}

function readCell(record: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function filterByViewer(rows: TableRecord[], viewerPersonId: string, key = "viewer_person_id") {
  const normalizedViewer = normalize(viewerPersonId);
  return rows.filter((row) => normalize(readCell(row.data, key)) === normalizedViewer);
}

function sortByUpdatedDesc<T extends { updatedAt: string; createdAt: string }>(rows: T[]) {
  return rows.slice().sort((left, right) => {
    const leftTs = Date.parse(left.updatedAt || left.createdAt || "");
    const rightTs = Date.parse(right.updatedAt || right.createdAt || "");
    return rightTs - leftTs;
  });
}

async function deleteRowsByPredicate(
  tableName: string,
  predicate: (row: TableRecord) => boolean,
) {
  const rows = await getTableRecords(tableName).catch(() => []);
  const rowNumbers = rows.filter(predicate).map((row) => row.rowNumber);
  if (rowNumbers.length === 0) return 0;
  return deleteTableRows(tableName, rowNumbers);
}

async function replaceViewerScopedRows(
  tableName: string,
  viewerKey: string,
  viewerPersonId: string,
  payloads: Record<string, string>[],
) {
  const normalizedViewer = normalize(viewerPersonId);
  await deleteRowsByPredicate(
    tableName,
    (row) => normalize(readCell(row.data, viewerKey)) === normalizedViewer,
  );
  if (!payloads.length) return;
  await createTableRecords(tableName, payloads);
}

function toRelationshipCategory(value: string): U1RelationshipCategory {
  return normalizeLower(value) as U1RelationshipCategory;
}

function toLineageSide(value: string): U1LineageSide {
  return normalizeLower(value) as U1LineageSide;
}

function toEffect(value: string): U1EffectType {
  return normalizeLower(value) as U1EffectType;
}

export async function listSubscriptionDefaults(viewerPersonId: string): Promise<U1SubscriptionDefaultRule[]> {
  const rows = await getTableRecords(TABLE_SUBSCRIPTION_DEFAULTS).catch(() => []);
  const mapped = filterByViewer(rows, viewerPersonId).map((row) => ({
    ruleId: readCell(row.data, "rule_id"),
    viewerPersonId: readCell(row.data, "viewer_person_id"),
    relationshipCategory: toRelationshipCategory(readCell(row.data, "relationship_category")),
    lineageSide: toLineageSide(readCell(row.data, "lineage_side")),
    isSubscribed: fromDbBool(readCell(row.data, "is_subscribed")),
    isActive: fromDbBool(readCell(row.data, "is_active")),
    createdAt: readCell(row.data, "created_at"),
    updatedAt: readCell(row.data, "updated_at"),
  }));
  return sortByUpdatedDesc(mapped);
}

export async function replaceSubscriptionDefaults(
  viewerPersonId: string,
  rows: Array<{
    relationshipCategory: U1RelationshipCategory;
    lineageSide: U1LineageSide;
    isSubscribed: boolean;
    isActive?: boolean;
  }>,
) {
  const timestamp = nowIso();
  const normalizedViewer = normalize(viewerPersonId);
  const payloads = rows.map((row) => ({
    rule_id: `u1-sd-${randomUUID()}`,
    viewer_person_id: normalizedViewer,
    relationship_category: row.relationshipCategory,
    lineage_side: row.lineageSide,
    is_subscribed: toDbBool(Boolean(row.isSubscribed)),
    is_active: toDbBool(row.isActive ?? true),
    created_at: timestamp,
    updated_at: timestamp,
  }));
  await replaceViewerScopedRows(TABLE_SUBSCRIPTION_DEFAULTS, "viewer_person_id", normalizedViewer, payloads);
}

export async function listSubscriptionPersonExceptions(
  viewerPersonId: string,
): Promise<U1SubscriptionPersonException[]> {
  const rows = await getTableRecords(TABLE_SUBSCRIPTION_PERSON_EXCEPTIONS).catch(() => []);
  const mapped = filterByViewer(rows, viewerPersonId).map((row) => ({
    exceptionId: readCell(row.data, "exception_id"),
    viewerPersonId: readCell(row.data, "viewer_person_id"),
    targetPersonId: readCell(row.data, "target_person_id"),
    effect: toEffect(readCell(row.data, "effect")),
    createdAt: readCell(row.data, "created_at"),
    updatedAt: readCell(row.data, "updated_at"),
  }));
  return sortByUpdatedDesc(mapped);
}

export async function replaceSubscriptionPersonExceptions(
  viewerPersonId: string,
  rows: Array<{ targetPersonId: string; effect: U1EffectType }>,
) {
  const timestamp = nowIso();
  const normalizedViewer = normalize(viewerPersonId);
  const payloads = rows.map((row) => ({
    exception_id: `u1-spe-${randomUUID()}`,
    viewer_person_id: normalizedViewer,
    target_person_id: normalize(row.targetPersonId),
    effect: row.effect,
    created_at: timestamp,
    updated_at: timestamp,
  }));
  await replaceViewerScopedRows(TABLE_SUBSCRIPTION_PERSON_EXCEPTIONS, "viewer_person_id", normalizedViewer, payloads);
}

export async function listSubscriptionHouseholdExceptions(
  viewerPersonId: string,
): Promise<U1SubscriptionHouseholdException[]> {
  const rows = await getTableRecords(TABLE_SUBSCRIPTION_HOUSEHOLD_EXCEPTIONS).catch(() => []);
  const mapped = filterByViewer(rows, viewerPersonId).map((row) => ({
    exceptionId: readCell(row.data, "exception_id"),
    viewerPersonId: readCell(row.data, "viewer_person_id"),
    householdId: readCell(row.data, "household_id"),
    effect: toEffect(readCell(row.data, "effect")),
    createdAt: readCell(row.data, "created_at"),
    updatedAt: readCell(row.data, "updated_at"),
  }));
  return sortByUpdatedDesc(mapped);
}

export async function replaceSubscriptionHouseholdExceptions(
  viewerPersonId: string,
  rows: Array<{ householdId: string; effect: U1EffectType }>,
) {
  const timestamp = nowIso();
  const normalizedViewer = normalize(viewerPersonId);
  const payloads = rows.map((row) => ({
    exception_id: `u1-she-${randomUUID()}`,
    viewer_person_id: normalizedViewer,
    household_id: normalize(row.householdId),
    effect: row.effect,
    created_at: timestamp,
    updated_at: timestamp,
  }));
  await replaceViewerScopedRows(TABLE_SUBSCRIPTION_HOUSEHOLD_EXCEPTIONS, "viewer_person_id", normalizedViewer, payloads);
}

export async function listOwnerShareDefaults(ownerPersonId: string): Promise<U1OwnerShareDefaultRule[]> {
  const rows = await getTableRecords(TABLE_OWNER_SHARE_DEFAULTS).catch(() => []);
  const normalizedOwner = normalize(ownerPersonId);
  const mapped = rows
    .filter((row) => normalize(readCell(row.data, "owner_person_id")) === normalizedOwner)
    .map((row) => ({
      ruleId: readCell(row.data, "rule_id"),
      ownerPersonId: readCell(row.data, "owner_person_id"),
      relationshipCategory: toRelationshipCategory(readCell(row.data, "relationship_category")),
      lineageSide: toLineageSide(readCell(row.data, "lineage_side")),
      shareVitals: fromDbBool(readCell(row.data, "share_vitals")),
      shareStories: fromDbBool(readCell(row.data, "share_stories")),
      shareMedia: fromDbBool(readCell(row.data, "share_media")),
      shareConversations: fromDbBool(readCell(row.data, "share_conversations")),
      isActive: fromDbBool(readCell(row.data, "is_active")),
      createdAt: readCell(row.data, "created_at"),
      updatedAt: readCell(row.data, "updated_at"),
    }));
  return sortByUpdatedDesc(mapped);
}

export async function listAllOwnerShareDefaults(): Promise<U1OwnerShareDefaultRule[]> {
  const rows = await getTableRecords(TABLE_OWNER_SHARE_DEFAULTS).catch(() => []);
  return rows.map((row) => ({
    ruleId: readCell(row.data, "rule_id"),
    ownerPersonId: readCell(row.data, "owner_person_id"),
    relationshipCategory: toRelationshipCategory(readCell(row.data, "relationship_category")),
    lineageSide: toLineageSide(readCell(row.data, "lineage_side")),
    shareVitals: fromDbBool(readCell(row.data, "share_vitals")),
    shareStories: fromDbBool(readCell(row.data, "share_stories")),
    shareMedia: fromDbBool(readCell(row.data, "share_media")),
    shareConversations: fromDbBool(readCell(row.data, "share_conversations")),
    isActive: fromDbBool(readCell(row.data, "is_active")),
    createdAt: readCell(row.data, "created_at"),
    updatedAt: readCell(row.data, "updated_at"),
  }));
}

export async function replaceOwnerShareDefaults(
  ownerPersonId: string,
  rows: Array<{
    relationshipCategory: U1RelationshipCategory;
    lineageSide: U1LineageSide;
    shareVitals: boolean;
    shareStories: boolean;
    shareMedia: boolean;
    shareConversations: boolean;
    isActive?: boolean;
  }>,
) {
  const timestamp = nowIso();
  const normalizedOwner = normalize(ownerPersonId);
  const payloads = rows.map((row) => ({
    rule_id: `u1-osd-${randomUUID()}`,
    owner_person_id: normalizedOwner,
    relationship_category: row.relationshipCategory,
    lineage_side: row.lineageSide,
    share_vitals: toDbBool(Boolean(row.shareVitals)),
    share_stories: toDbBool(Boolean(row.shareStories)),
    share_media: toDbBool(Boolean(row.shareMedia)),
    share_conversations: toDbBool(Boolean(row.shareConversations)),
    is_active: toDbBool(row.isActive ?? true),
    created_at: timestamp,
    updated_at: timestamp,
  }));
  await replaceViewerScopedRows(TABLE_OWNER_SHARE_DEFAULTS, "owner_person_id", normalizedOwner, payloads);
}

export async function listOwnerSharePersonExceptions(
  ownerPersonId: string,
): Promise<U1OwnerSharePersonException[]> {
  const rows = await getTableRecords(TABLE_OWNER_SHARE_PERSON_EXCEPTIONS).catch(() => []);
  const normalizedOwner = normalize(ownerPersonId);
  const mapped = rows
    .filter((row) => normalize(readCell(row.data, "owner_person_id")) === normalizedOwner)
    .map((row) => ({
      exceptionId: readCell(row.data, "exception_id"),
      ownerPersonId: readCell(row.data, "owner_person_id"),
      targetPersonId: readCell(row.data, "target_person_id"),
      effect: toEffect(readCell(row.data, "effect")),
      shareVitals: fromNullableDbBool(readCell(row.data, "share_vitals")),
      shareStories: fromNullableDbBool(readCell(row.data, "share_stories")),
      shareMedia: fromNullableDbBool(readCell(row.data, "share_media")),
      shareConversations: fromNullableDbBool(readCell(row.data, "share_conversations")),
      createdAt: readCell(row.data, "created_at"),
      updatedAt: readCell(row.data, "updated_at"),
    }));
  return sortByUpdatedDesc(mapped);
}

export async function listAllOwnerSharePersonExceptions(): Promise<U1OwnerSharePersonException[]> {
  const rows = await getTableRecords(TABLE_OWNER_SHARE_PERSON_EXCEPTIONS).catch(() => []);
  return rows.map((row) => ({
    exceptionId: readCell(row.data, "exception_id"),
    ownerPersonId: readCell(row.data, "owner_person_id"),
    targetPersonId: readCell(row.data, "target_person_id"),
    effect: toEffect(readCell(row.data, "effect")),
    shareVitals: fromNullableDbBool(readCell(row.data, "share_vitals")),
    shareStories: fromNullableDbBool(readCell(row.data, "share_stories")),
    shareMedia: fromNullableDbBool(readCell(row.data, "share_media")),
    shareConversations: fromNullableDbBool(readCell(row.data, "share_conversations")),
    createdAt: readCell(row.data, "created_at"),
    updatedAt: readCell(row.data, "updated_at"),
  }));
}

export async function replaceOwnerSharePersonExceptions(
  ownerPersonId: string,
  rows: Array<{
    targetPersonId: string;
    effect: U1EffectType;
    shareVitals: boolean | null;
    shareStories: boolean | null;
    shareMedia: boolean | null;
    shareConversations: boolean | null;
  }>,
) {
  const timestamp = nowIso();
  const normalizedOwner = normalize(ownerPersonId);
  const payloads = rows.map((row) => ({
    exception_id: `u1-ospe-${randomUUID()}`,
    owner_person_id: normalizedOwner,
    target_person_id: normalize(row.targetPersonId),
    effect: row.effect,
    share_vitals: toDbNullableBool(row.shareVitals),
    share_stories: toDbNullableBool(row.shareStories),
    share_media: toDbNullableBool(row.shareMedia),
    share_conversations: toDbNullableBool(row.shareConversations),
    created_at: timestamp,
    updated_at: timestamp,
  }));
  await replaceViewerScopedRows(TABLE_OWNER_SHARE_PERSON_EXCEPTIONS, "owner_person_id", normalizedOwner, payloads);
}

export async function listOwnerShareHouseholdExceptions(
  ownerPersonId: string,
): Promise<U1OwnerShareHouseholdException[]> {
  const rows = await getTableRecords(TABLE_OWNER_SHARE_HOUSEHOLD_EXCEPTIONS).catch(() => []);
  const normalizedOwner = normalize(ownerPersonId);
  const mapped = rows
    .filter((row) => normalize(readCell(row.data, "owner_person_id")) === normalizedOwner)
    .map((row) => ({
      exceptionId: readCell(row.data, "exception_id"),
      ownerPersonId: readCell(row.data, "owner_person_id"),
      householdId: readCell(row.data, "household_id"),
      effect: toEffect(readCell(row.data, "effect")),
      shareVitals: fromNullableDbBool(readCell(row.data, "share_vitals")),
      shareStories: fromNullableDbBool(readCell(row.data, "share_stories")),
      shareMedia: fromNullableDbBool(readCell(row.data, "share_media")),
      shareConversations: fromNullableDbBool(readCell(row.data, "share_conversations")),
      createdAt: readCell(row.data, "created_at"),
      updatedAt: readCell(row.data, "updated_at"),
    }));
  return sortByUpdatedDesc(mapped);
}

export async function listAllOwnerShareHouseholdExceptions(): Promise<U1OwnerShareHouseholdException[]> {
  const rows = await getTableRecords(TABLE_OWNER_SHARE_HOUSEHOLD_EXCEPTIONS).catch(() => []);
  return rows.map((row) => ({
    exceptionId: readCell(row.data, "exception_id"),
    ownerPersonId: readCell(row.data, "owner_person_id"),
    householdId: readCell(row.data, "household_id"),
    effect: toEffect(readCell(row.data, "effect")),
    shareVitals: fromNullableDbBool(readCell(row.data, "share_vitals")),
    shareStories: fromNullableDbBool(readCell(row.data, "share_stories")),
    shareMedia: fromNullableDbBool(readCell(row.data, "share_media")),
    shareConversations: fromNullableDbBool(readCell(row.data, "share_conversations")),
    createdAt: readCell(row.data, "created_at"),
    updatedAt: readCell(row.data, "updated_at"),
  }));
}

export async function replaceOwnerShareHouseholdExceptions(
  ownerPersonId: string,
  rows: Array<{
    householdId: string;
    effect: U1EffectType;
    shareVitals: boolean | null;
    shareStories: boolean | null;
    shareMedia: boolean | null;
    shareConversations: boolean | null;
  }>,
) {
  const timestamp = nowIso();
  const normalizedOwner = normalize(ownerPersonId);
  const payloads = rows.map((row) => ({
    exception_id: `u1-oshe-${randomUUID()}`,
    owner_person_id: normalizedOwner,
    household_id: normalize(row.householdId),
    effect: row.effect,
    share_vitals: toDbNullableBool(row.shareVitals),
    share_stories: toDbNullableBool(row.shareStories),
    share_media: toDbNullableBool(row.shareMedia),
    share_conversations: toDbNullableBool(row.shareConversations),
    created_at: timestamp,
    updated_at: timestamp,
  }));
  await replaceViewerScopedRows(TABLE_OWNER_SHARE_HOUSEHOLD_EXCEPTIONS, "owner_person_id", normalizedOwner, payloads);
}

export async function listProfileAccessMap(viewerPersonId: string): Promise<U1ProfileAccessMapRow[]> {
  const rows = await getTableRecords(TABLE_PROFILE_ACCESS_MAP).catch(() => []);
  const mapped = filterByViewer(rows, viewerPersonId).map((row) => ({
    mapId: readCell(row.data, "map_id"),
    viewerPersonId: readCell(row.data, "viewer_person_id"),
    targetPersonId: readCell(row.data, "target_person_id"),
    isSubscribed: fromDbBool(readCell(row.data, "is_subscribed")),
    isShared: fromDbBool(readCell(row.data, "is_shared")),
    canVitals: fromDbBool(readCell(row.data, "can_vitals")),
    canStories: fromDbBool(readCell(row.data, "can_stories")),
    canMedia: fromDbBool(readCell(row.data, "can_media")),
    canConversations: fromDbBool(readCell(row.data, "can_conversations")),
    placeholderOnly: fromDbBool(readCell(row.data, "placeholder_only")),
    reasonCode: readCell(row.data, "reason_code"),
    mapVersion: readCell(row.data, "map_version"),
    computedAt: readCell(row.data, "computed_at"),
  }));
  return mapped.sort((left, right) => left.targetPersonId.localeCompare(right.targetPersonId));
}

export async function replaceProfileAccessMap(
  viewerPersonId: string,
  rows: Array<Omit<U1ProfileAccessMapRow, "mapId">>,
) {
  const normalizedViewer = normalize(viewerPersonId);
  await deleteRowsByPredicate(
    TABLE_PROFILE_ACCESS_MAP,
    (row) => normalize(readCell(row.data, "viewer_person_id")) === normalizedViewer,
  );
  if (!rows.length) return;
  const payloads = rows.map((row) => ({
    map_id: `u1-pam-${randomUUID()}`,
    viewer_person_id: normalizedViewer,
    target_person_id: normalize(row.targetPersonId),
    is_subscribed: toDbBool(Boolean(row.isSubscribed)),
    is_shared: toDbBool(Boolean(row.isShared)),
    can_vitals: toDbBool(Boolean(row.canVitals)),
    can_stories: toDbBool(Boolean(row.canStories)),
    can_media: toDbBool(Boolean(row.canMedia)),
    can_conversations: toDbBool(Boolean(row.canConversations)),
    placeholder_only: toDbBool(Boolean(row.placeholderOnly)),
    reason_code: normalize(row.reasonCode),
    map_version: normalize(row.mapVersion),
    computed_at: normalize(row.computedAt),
  }));
  await createTableRecords(TABLE_PROFILE_ACCESS_MAP, payloads);
}

export async function listPeopleLite(): Promise<U1PersonLite[]> {
  const rows = await getTableRecords("People").catch(() => []);
  const map = new Map<string, U1PersonLite>();
  for (const row of rows) {
    const personId = readCell(row.data, "person_id");
    if (!personId || map.has(personId)) continue;
    const displayName =
      readCell(row.data, "display_name") ||
      [readCell(row.data, "first_name"), readCell(row.data, "last_name")].filter(Boolean).join(" ").trim() ||
      personId;
    map.set(personId, {
      personId,
      displayName,
      gender: normalizeLower(readCell(row.data, "gender")),
    });
  }
  return Array.from(map.values()).sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export async function listRelationshipsLite(): Promise<U1RelationshipLite[]> {
  const rows = await getTableRecords("Relationships").catch(() => []);
  return rows
    .map((row) => ({
      fromPersonId: readCell(row.data, "from_person_id"),
      toPersonId: readCell(row.data, "to_person_id"),
      relType: normalizeLower(readCell(row.data, "rel_type")),
    }))
    .filter((row) => row.fromPersonId && row.toPersonId && row.relType);
}

export async function listHouseholdsLite(): Promise<U1HouseholdLite[]> {
  const rows = await getTableRecords("Households").catch(() => []);
  return rows
    .map((row) => ({
      householdId: readCell(row.data, "household_id"),
      husbandPersonId: readCell(row.data, "husband_person_id"),
      wifePersonId: readCell(row.data, "wife_person_id"),
    }))
    .filter((row) => row.householdId);
}

export async function enqueueRecomputeJob(input: {
  viewerPersonId: string;
  reason: string;
  dedupeKey?: string;
}) {
  const viewerPersonId = normalize(input.viewerPersonId);
  const reason = normalize(input.reason) || "manual";
  const dedupeKey = normalize(input.dedupeKey) || `${viewerPersonId}:${reason}`;
  const existing = await listRecomputeJobs(viewerPersonId);
  const pending = existing.find((job) => job.status === "queued" || job.status === "running");
  if (pending && normalize(pending.dedupeKey) === dedupeKey) {
    return pending;
  }
  const timestamp = nowIso();
  const job: U1RecomputeJob = {
    jobId: `u1-job-${randomUUID()}`,
    viewerPersonId,
    reason,
    status: "queued",
    dedupeKey,
    requestedAt: timestamp,
    startedAt: "",
    completedAt: "",
    errorMessage: "",
  };
  await createTableRecords(TABLE_RECOMPUTE_JOBS, [
    {
      job_id: job.jobId,
      viewer_person_id: job.viewerPersonId,
      reason: job.reason,
      status: job.status,
      dedupe_key: job.dedupeKey,
      requested_at: job.requestedAt,
      started_at: "",
      completed_at: "",
      error_message: "",
    },
  ]);
  return job;
}

export async function listRecomputeJobs(viewerPersonId: string): Promise<U1RecomputeJob[]> {
  const rows = await getTableRecords(TABLE_RECOMPUTE_JOBS).catch(() => []);
  const mapped = filterByViewer(rows, viewerPersonId).map((row) => ({
    jobId: readCell(row.data, "job_id"),
    viewerPersonId: readCell(row.data, "viewer_person_id"),
    reason: readCell(row.data, "reason"),
    status: normalizeLower(readCell(row.data, "status")) as U1RecomputeJob["status"],
    dedupeKey: readCell(row.data, "dedupe_key"),
    requestedAt: readCell(row.data, "requested_at"),
    startedAt: readCell(row.data, "started_at"),
    completedAt: readCell(row.data, "completed_at"),
    errorMessage: readCell(row.data, "error_message"),
  }));
  return mapped.sort((left, right) => Date.parse(right.requestedAt || "") - Date.parse(left.requestedAt || ""));
}

export async function updateRecomputeJob(jobId: string, patch: Partial<U1RecomputeJob>) {
  await updateTableRecordById(
    TABLE_RECOMPUTE_JOBS,
    normalize(jobId),
    {
      status: normalize(patch.status),
      started_at: normalize(patch.startedAt),
      completed_at: normalize(patch.completedAt),
      error_message: normalize(patch.errorMessage),
    },
    "job_id",
  );
}

export async function createRecomputeRun(run: U1RecomputeRun) {
  await createTableRecords(TABLE_RECOMPUTE_RUNS, [
    {
      run_id: run.runId,
      job_id: run.jobId,
      viewer_person_id: run.viewerPersonId,
      status: run.status,
      started_at: run.startedAt,
      completed_at: run.completedAt,
      processed_count: String(run.processedCount),
      changed_count: String(run.changedCount),
      overexposed_count: String(run.overexposedCount),
      underexposed_count: String(run.underexposedCount),
      stale_count: String(run.staleCount),
      error_message: run.errorMessage,
    },
  ]);
}

export async function listRecomputeRuns(viewerPersonId: string): Promise<U1RecomputeRun[]> {
  const rows = await getTableRecords(TABLE_RECOMPUTE_RUNS).catch(() => []);
  const mapped = filterByViewer(rows, viewerPersonId).map((row) => ({
    runId: readCell(row.data, "run_id"),
    jobId: readCell(row.data, "job_id"),
    viewerPersonId: readCell(row.data, "viewer_person_id"),
    status: normalizeLower(readCell(row.data, "status")) as U1RecomputeRun["status"],
    startedAt: readCell(row.data, "started_at"),
    completedAt: readCell(row.data, "completed_at"),
    processedCount: Number.parseInt(readCell(row.data, "processed_count") || "0", 10) || 0,
    changedCount: Number.parseInt(readCell(row.data, "changed_count") || "0", 10) || 0,
    overexposedCount: Number.parseInt(readCell(row.data, "overexposed_count") || "0", 10) || 0,
    underexposedCount: Number.parseInt(readCell(row.data, "underexposed_count") || "0", 10) || 0,
    staleCount: Number.parseInt(readCell(row.data, "stale_count") || "0", 10) || 0,
    errorMessage: readCell(row.data, "error_message"),
  }));
  return mapped.sort((left, right) => Date.parse(right.startedAt || "") - Date.parse(left.startedAt || ""));
}

export async function getLatestRecomputeStatus(viewerPersonId: string) {
  const [jobs, runs] = await Promise.all([
    listRecomputeJobs(viewerPersonId),
    listRecomputeRuns(viewerPersonId),
  ]);
  return {
    latestJob: jobs[0] ?? null,
    latestRun: runs[0] ?? null,
  };
}

export function asPreviewRow(row: U1ProfileAccessMapRow, targetDisplayName: string): U1PreviewRow {
  return {
    ...row,
    targetDisplayName,
  };
}
