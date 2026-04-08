import "server-only";

import { randomUUID } from "node:crypto";
import oracledb from "oracledb";
import { withConnection, withTransaction } from "@/lib/oci/client";
import type {
  U1EffectType,
  U1LineageSide,
  U1OwnerShareDefaultRule,
  U1OwnerSharePersonException,
  U1PersonLite,
  U1ProfileAccessMapRow,
  U1RecomputeJob,
  U1RecomputeRun,
  U1RelationshipCategory,
  U1RelationshipLite,
  U1SubscriptionDefaultRule,
  U1SubscriptionPersonException,
} from "@/lib/u1/types";

const OUT_FORMAT = { outFormat: oracledb.OUT_FORMAT_OBJECT };

let schemaEnsured = false;

function normalize(value?: string) {
  return String(value ?? "").trim();
}

function normalizeLower(value?: string) {
  return normalize(value).toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function asBool(value?: string) {
  const normalized = normalizeLower(value);
  return normalized === "y" || normalized === "yes" || normalized === "true" || normalized === "1";
}

function asNullableBool(value?: string) {
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

function getCell(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

async function safeExecute(connection: any, sql: string) {
  try {
    await connection.execute(sql);
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (!/ORA-00955|ORA-01408|ORA-01430|ORA-01442|already exists|already used/i.test(message)) {
      throw error;
    }
  }
}

async function ensureSchema() {
  if (schemaEnsured) return;
  await withConnection(async (connection) => {
    const statements = [
      `CREATE TABLE subscription_default_rules (
         rule_id VARCHAR2(128) PRIMARY KEY,
         viewer_person_id VARCHAR2(128) NOT NULL,
         relationship_category VARCHAR2(64) NOT NULL,
         lineage_side VARCHAR2(24) NOT NULL,
         is_subscribed VARCHAR2(8) NOT NULL,
         is_active VARCHAR2(8) NOT NULL,
         created_at VARCHAR2(64),
         updated_at VARCHAR2(64)
       )`,
      "CREATE UNIQUE INDEX ux_subscription_default_rules_scope ON subscription_default_rules(viewer_person_id, relationship_category, lineage_side)",
      "CREATE INDEX ix_subscription_default_rules_viewer ON subscription_default_rules(viewer_person_id, is_active)",
      `CREATE TABLE subscription_person_exceptions (
         exception_id VARCHAR2(128) PRIMARY KEY,
         viewer_person_id VARCHAR2(128) NOT NULL,
         target_person_id VARCHAR2(128) NOT NULL,
         effect VARCHAR2(16) NOT NULL,
         created_at VARCHAR2(64),
         updated_at VARCHAR2(64)
       )`,
      "CREATE UNIQUE INDEX ux_subscription_person_exceptions_scope ON subscription_person_exceptions(viewer_person_id, target_person_id)",
      "CREATE INDEX ix_subscription_person_exceptions_viewer ON subscription_person_exceptions(viewer_person_id)",
      `CREATE TABLE owner_share_default_rules (
         rule_id VARCHAR2(128) PRIMARY KEY,
         owner_person_id VARCHAR2(128) NOT NULL,
         relationship_category VARCHAR2(64) NOT NULL,
         lineage_side VARCHAR2(24) NOT NULL,
         share_vitals VARCHAR2(8) NOT NULL,
         share_stories VARCHAR2(8) NOT NULL,
         share_media VARCHAR2(8) NOT NULL,
         share_conversations VARCHAR2(8) NOT NULL,
         is_active VARCHAR2(8) NOT NULL,
         created_at VARCHAR2(64),
         updated_at VARCHAR2(64)
       )`,
      "CREATE UNIQUE INDEX ux_owner_share_default_rules_scope ON owner_share_default_rules(owner_person_id, relationship_category, lineage_side)",
      "CREATE INDEX ix_owner_share_default_rules_owner ON owner_share_default_rules(owner_person_id, is_active)",
      `CREATE TABLE owner_share_person_exceptions (
         exception_id VARCHAR2(128) PRIMARY KEY,
         owner_person_id VARCHAR2(128) NOT NULL,
         target_person_id VARCHAR2(128) NOT NULL,
         effect VARCHAR2(16) NOT NULL,
         share_vitals VARCHAR2(8),
         share_stories VARCHAR2(8),
         share_media VARCHAR2(8),
         share_conversations VARCHAR2(8),
         created_at VARCHAR2(64),
         updated_at VARCHAR2(64)
       )`,
      "CREATE UNIQUE INDEX ux_owner_share_person_exceptions_scope ON owner_share_person_exceptions(owner_person_id, target_person_id)",
      "CREATE INDEX ix_owner_share_person_exceptions_owner ON owner_share_person_exceptions(owner_person_id)",
      `CREATE TABLE profile_access_map (
         map_id VARCHAR2(128) PRIMARY KEY,
         viewer_person_id VARCHAR2(128) NOT NULL,
         target_person_id VARCHAR2(128) NOT NULL,
         is_subscribed VARCHAR2(8) NOT NULL,
         is_shared VARCHAR2(8) NOT NULL,
         can_vitals VARCHAR2(8) NOT NULL,
         can_stories VARCHAR2(8) NOT NULL,
         can_media VARCHAR2(8) NOT NULL,
         can_conversations VARCHAR2(8) NOT NULL,
         placeholder_only VARCHAR2(8) NOT NULL,
         reason_code VARCHAR2(128),
         map_version VARCHAR2(64),
         computed_at VARCHAR2(64)
       )`,
      "CREATE UNIQUE INDEX ux_profile_access_map_scope ON profile_access_map(viewer_person_id, target_person_id)",
      "CREATE INDEX ix_profile_access_map_viewer ON profile_access_map(viewer_person_id)",
      "CREATE INDEX ix_profile_access_map_target ON profile_access_map(target_person_id)",
      `CREATE TABLE access_recompute_jobs (
         job_id VARCHAR2(128) PRIMARY KEY,
         viewer_person_id VARCHAR2(128) NOT NULL,
         reason VARCHAR2(64) NOT NULL,
         status VARCHAR2(24) NOT NULL,
         dedupe_key VARCHAR2(256),
         requested_at VARCHAR2(64),
         started_at VARCHAR2(64),
         completed_at VARCHAR2(64),
         error_message VARCHAR2(4000)
       )`,
      "CREATE INDEX ix_access_recompute_jobs_viewer ON access_recompute_jobs(viewer_person_id, status)",
      "CREATE INDEX ix_access_recompute_jobs_requested ON access_recompute_jobs(requested_at)",
      `CREATE TABLE access_recompute_runs (
         run_id VARCHAR2(128) PRIMARY KEY,
         job_id VARCHAR2(128),
         viewer_person_id VARCHAR2(128) NOT NULL,
         status VARCHAR2(24) NOT NULL,
         started_at VARCHAR2(64),
         completed_at VARCHAR2(64),
         processed_count VARCHAR2(32),
         changed_count VARCHAR2(32),
         error_message VARCHAR2(4000)
       )`,
      "CREATE INDEX ix_access_recompute_runs_viewer ON access_recompute_runs(viewer_person_id, started_at)",
      "CREATE INDEX ix_access_recompute_runs_job ON access_recompute_runs(job_id)",
    ];

    for (const statement of statements) {
      await safeExecute(connection, statement);
    }

    await connection.commit();
    schemaEnsured = true;
  });
}

type UserLoginRow = {
  personId: string;
  username: string;
  userEmail: string;
  passwordHash: string;
};

export async function getLocalUserByUsername(username: string): Promise<UserLoginRow | null> {
  const normalized = normalizeLower(username);
  if (!normalized) return null;

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT person_id, username, user_email, password_hash
         FROM user_access
        WHERE LOWER(TRIM(username)) = :username
          AND (LOWER(TRIM(NVL(local_access, 'TRUE'))) IN ('y','yes','true','1'))
          AND (LOWER(TRIM(NVL(is_enabled, 'TRUE'))) IN ('y','yes','true','1'))
          AND NVL(password_hash, '') <> ''`,
      { username: normalized },
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    if (!rows.length) return null;
    const row = rows[0];
    return {
      personId: getCell(row, "PERSON_ID"),
      username: getCell(row, "USERNAME"),
      userEmail: getCell(row, "USER_EMAIL"),
      passwordHash: getCell(row, "PASSWORD_HASH"),
    };
  });
}

export async function listPeopleLite(): Promise<U1PersonLite[]> {
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT person_id,
              COALESCE(NULLIF(TRIM(display_name), ''), TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), person_id) AS display_name,
              LOWER(TRIM(NVL(gender, ''))) AS gender
         FROM people
        WHERE NVL(TRIM(person_id), '') <> ''
        ORDER BY display_name`,
      {},
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      personId: getCell(row, "PERSON_ID"),
      displayName: getCell(row, "DISPLAY_NAME"),
      gender: getCell(row, "GENDER"),
    }));
  });
}

export async function listRelationshipsLite(): Promise<U1RelationshipLite[]> {
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT from_person_id, to_person_id, LOWER(TRIM(rel_type)) AS rel_type
         FROM relationships
        WHERE NVL(TRIM(from_person_id), '') <> ''
          AND NVL(TRIM(to_person_id), '') <> ''
          AND NVL(TRIM(rel_type), '') <> ''`,
      {},
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      fromPersonId: getCell(row, "FROM_PERSON_ID"),
      toPersonId: getCell(row, "TO_PERSON_ID"),
      relType: getCell(row, "REL_TYPE"),
    }));
  });
}

export async function listSubscriptionDefaults(viewerPersonId: string): Promise<U1SubscriptionDefaultRule[]> {
  await ensureSchema();
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT rule_id, viewer_person_id, relationship_category, lineage_side, is_subscribed, is_active, created_at, updated_at
         FROM subscription_default_rules
        WHERE viewer_person_id = :viewer
        ORDER BY updated_at DESC NULLS LAST`,
      { viewer: normalize(viewerPersonId) },
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      ruleId: getCell(row, "RULE_ID"),
      viewerPersonId: getCell(row, "VIEWER_PERSON_ID"),
      relationshipCategory: getCell(row, "RELATIONSHIP_CATEGORY") as U1RelationshipCategory,
      lineageSide: getCell(row, "LINEAGE_SIDE") as U1LineageSide,
      isSubscribed: asBool(getCell(row, "IS_SUBSCRIBED")),
      isActive: asBool(getCell(row, "IS_ACTIVE")),
      createdAt: getCell(row, "CREATED_AT"),
      updatedAt: getCell(row, "UPDATED_AT"),
    }));
  });
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
  await ensureSchema();
  const viewer = normalize(viewerPersonId);
  const timestamp = nowIso();
  await withTransaction(async (connection) => {
    await connection.execute(
      "DELETE FROM subscription_default_rules WHERE viewer_person_id = :viewer",
      { viewer },
    );
    for (const row of rows) {
      await connection.execute(
        `INSERT INTO subscription_default_rules (
           rule_id, viewer_person_id, relationship_category, lineage_side, is_subscribed, is_active, created_at, updated_at
         ) VALUES (
           :ruleId, :viewer, :relationshipCategory, :lineageSide, :isSubscribed, :isActive, :createdAt, :updatedAt
         )`,
        {
          ruleId: `u1-sd-${randomUUID()}`,
          viewer,
          relationshipCategory: row.relationshipCategory,
          lineageSide: row.lineageSide,
          isSubscribed: toDbBool(Boolean(row.isSubscribed)),
          isActive: toDbBool(row.isActive ?? true),
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      );
    }
  });
}

export async function listSubscriptionPersonExceptions(viewerPersonId: string): Promise<U1SubscriptionPersonException[]> {
  await ensureSchema();
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT exception_id, viewer_person_id, target_person_id, effect, created_at, updated_at
         FROM subscription_person_exceptions
        WHERE viewer_person_id = :viewer
        ORDER BY updated_at DESC NULLS LAST`,
      { viewer: normalize(viewerPersonId) },
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      exceptionId: getCell(row, "EXCEPTION_ID"),
      viewerPersonId: getCell(row, "VIEWER_PERSON_ID"),
      targetPersonId: getCell(row, "TARGET_PERSON_ID"),
      effect: getCell(row, "EFFECT") as U1EffectType,
      createdAt: getCell(row, "CREATED_AT"),
      updatedAt: getCell(row, "UPDATED_AT"),
    }));
  });
}

export async function replaceSubscriptionPersonExceptions(
  viewerPersonId: string,
  rows: Array<{ targetPersonId: string; effect: U1EffectType }>,
) {
  await ensureSchema();
  const viewer = normalize(viewerPersonId);
  const timestamp = nowIso();
  await withTransaction(async (connection) => {
    await connection.execute(
      "DELETE FROM subscription_person_exceptions WHERE viewer_person_id = :viewer",
      { viewer },
    );
    for (const row of rows) {
      await connection.execute(
        `INSERT INTO subscription_person_exceptions (
           exception_id, viewer_person_id, target_person_id, effect, created_at, updated_at
         ) VALUES (
           :exceptionId, :viewer, :target, :effect, :createdAt, :updatedAt
         )`,
        {
          exceptionId: `u1-spe-${randomUUID()}`,
          viewer,
          target: normalize(row.targetPersonId),
          effect: row.effect,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      );
    }
  });
}

export async function listOwnerShareDefaults(ownerPersonId: string): Promise<U1OwnerShareDefaultRule[]> {
  await ensureSchema();
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT rule_id, owner_person_id, relationship_category, lineage_side, share_vitals, share_stories, share_media, share_conversations, is_active, created_at, updated_at
         FROM owner_share_default_rules
        WHERE owner_person_id = :owner
        ORDER BY updated_at DESC NULLS LAST`,
      { owner: normalize(ownerPersonId) },
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      ruleId: getCell(row, "RULE_ID"),
      ownerPersonId: getCell(row, "OWNER_PERSON_ID"),
      relationshipCategory: getCell(row, "RELATIONSHIP_CATEGORY") as U1RelationshipCategory,
      lineageSide: getCell(row, "LINEAGE_SIDE") as U1LineageSide,
      shareVitals: asBool(getCell(row, "SHARE_VITALS")),
      shareStories: asBool(getCell(row, "SHARE_STORIES")),
      shareMedia: asBool(getCell(row, "SHARE_MEDIA")),
      shareConversations: asBool(getCell(row, "SHARE_CONVERSATIONS")),
      isActive: asBool(getCell(row, "IS_ACTIVE")),
      createdAt: getCell(row, "CREATED_AT"),
      updatedAt: getCell(row, "UPDATED_AT"),
    }));
  });
}

export async function listAllOwnerShareDefaults(): Promise<U1OwnerShareDefaultRule[]> {
  await ensureSchema();
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT rule_id, owner_person_id, relationship_category, lineage_side, share_vitals, share_stories, share_media, share_conversations, is_active, created_at, updated_at
         FROM owner_share_default_rules`,
      {},
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      ruleId: getCell(row, "RULE_ID"),
      ownerPersonId: getCell(row, "OWNER_PERSON_ID"),
      relationshipCategory: getCell(row, "RELATIONSHIP_CATEGORY") as U1RelationshipCategory,
      lineageSide: getCell(row, "LINEAGE_SIDE") as U1LineageSide,
      shareVitals: asBool(getCell(row, "SHARE_VITALS")),
      shareStories: asBool(getCell(row, "SHARE_STORIES")),
      shareMedia: asBool(getCell(row, "SHARE_MEDIA")),
      shareConversations: asBool(getCell(row, "SHARE_CONVERSATIONS")),
      isActive: asBool(getCell(row, "IS_ACTIVE")),
      createdAt: getCell(row, "CREATED_AT"),
      updatedAt: getCell(row, "UPDATED_AT"),
    }));
  });
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
  await ensureSchema();
  const owner = normalize(ownerPersonId);
  const timestamp = nowIso();
  await withTransaction(async (connection) => {
    await connection.execute(
      "DELETE FROM owner_share_default_rules WHERE owner_person_id = :owner",
      { owner },
    );
    for (const row of rows) {
      await connection.execute(
        `INSERT INTO owner_share_default_rules (
           rule_id, owner_person_id, relationship_category, lineage_side,
           share_vitals, share_stories, share_media, share_conversations,
           is_active, created_at, updated_at
         ) VALUES (
           :ruleId, :owner, :relationshipCategory, :lineageSide,
           :shareVitals, :shareStories, :shareMedia, :shareConversations,
           :isActive, :createdAt, :updatedAt
         )`,
        {
          ruleId: `u1-osd-${randomUUID()}`,
          owner,
          relationshipCategory: row.relationshipCategory,
          lineageSide: row.lineageSide,
          shareVitals: toDbBool(Boolean(row.shareVitals)),
          shareStories: toDbBool(Boolean(row.shareStories)),
          shareMedia: toDbBool(Boolean(row.shareMedia)),
          shareConversations: toDbBool(Boolean(row.shareConversations)),
          isActive: toDbBool(row.isActive ?? true),
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      );
    }
  });
}

export async function listOwnerSharePersonExceptions(ownerPersonId: string): Promise<U1OwnerSharePersonException[]> {
  await ensureSchema();
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT exception_id, owner_person_id, target_person_id, effect, share_vitals, share_stories, share_media, share_conversations, created_at, updated_at
         FROM owner_share_person_exceptions
        WHERE owner_person_id = :owner
        ORDER BY updated_at DESC NULLS LAST`,
      { owner: normalize(ownerPersonId) },
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      exceptionId: getCell(row, "EXCEPTION_ID"),
      ownerPersonId: getCell(row, "OWNER_PERSON_ID"),
      targetPersonId: getCell(row, "TARGET_PERSON_ID"),
      effect: getCell(row, "EFFECT") as U1EffectType,
      shareVitals: asNullableBool(getCell(row, "SHARE_VITALS")),
      shareStories: asNullableBool(getCell(row, "SHARE_STORIES")),
      shareMedia: asNullableBool(getCell(row, "SHARE_MEDIA")),
      shareConversations: asNullableBool(getCell(row, "SHARE_CONVERSATIONS")),
      createdAt: getCell(row, "CREATED_AT"),
      updatedAt: getCell(row, "UPDATED_AT"),
    }));
  });
}

export async function listAllOwnerSharePersonExceptions(): Promise<U1OwnerSharePersonException[]> {
  await ensureSchema();
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT exception_id, owner_person_id, target_person_id, effect, share_vitals, share_stories, share_media, share_conversations, created_at, updated_at
         FROM owner_share_person_exceptions`,
      {},
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      exceptionId: getCell(row, "EXCEPTION_ID"),
      ownerPersonId: getCell(row, "OWNER_PERSON_ID"),
      targetPersonId: getCell(row, "TARGET_PERSON_ID"),
      effect: getCell(row, "EFFECT") as U1EffectType,
      shareVitals: asNullableBool(getCell(row, "SHARE_VITALS")),
      shareStories: asNullableBool(getCell(row, "SHARE_STORIES")),
      shareMedia: asNullableBool(getCell(row, "SHARE_MEDIA")),
      shareConversations: asNullableBool(getCell(row, "SHARE_CONVERSATIONS")),
      createdAt: getCell(row, "CREATED_AT"),
      updatedAt: getCell(row, "UPDATED_AT"),
    }));
  });
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
  await ensureSchema();
  const owner = normalize(ownerPersonId);
  const timestamp = nowIso();
  await withTransaction(async (connection) => {
    await connection.execute(
      "DELETE FROM owner_share_person_exceptions WHERE owner_person_id = :owner",
      { owner },
    );
    for (const row of rows) {
      await connection.execute(
        `INSERT INTO owner_share_person_exceptions (
           exception_id, owner_person_id, target_person_id, effect,
           share_vitals, share_stories, share_media, share_conversations,
           created_at, updated_at
         ) VALUES (
           :exceptionId, :owner, :target, :effect,
           :shareVitals, :shareStories, :shareMedia, :shareConversations,
           :createdAt, :updatedAt
         )`,
        {
          exceptionId: `u1-ospe-${randomUUID()}`,
          owner,
          target: normalize(row.targetPersonId),
          effect: row.effect,
          shareVitals: toDbNullableBool(row.shareVitals),
          shareStories: toDbNullableBool(row.shareStories),
          shareMedia: toDbNullableBool(row.shareMedia),
          shareConversations: toDbNullableBool(row.shareConversations),
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      );
    }
  });
}

export async function listProfileAccessMap(viewerPersonId: string): Promise<U1ProfileAccessMapRow[]> {
  await ensureSchema();
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT map_id, viewer_person_id, target_person_id, is_subscribed, is_shared, can_vitals, can_stories, can_media, can_conversations, placeholder_only, reason_code, map_version, computed_at
         FROM profile_access_map
        WHERE viewer_person_id = :viewer
        ORDER BY target_person_id`,
      { viewer: normalize(viewerPersonId) },
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      mapId: getCell(row, "MAP_ID"),
      viewerPersonId: getCell(row, "VIEWER_PERSON_ID"),
      targetPersonId: getCell(row, "TARGET_PERSON_ID"),
      isSubscribed: asBool(getCell(row, "IS_SUBSCRIBED")),
      isShared: asBool(getCell(row, "IS_SHARED")),
      canVitals: asBool(getCell(row, "CAN_VITALS")),
      canStories: asBool(getCell(row, "CAN_STORIES")),
      canMedia: asBool(getCell(row, "CAN_MEDIA")),
      canConversations: asBool(getCell(row, "CAN_CONVERSATIONS")),
      placeholderOnly: asBool(getCell(row, "PLACEHOLDER_ONLY")),
      reasonCode: getCell(row, "REASON_CODE"),
      mapVersion: getCell(row, "MAP_VERSION"),
      computedAt: getCell(row, "COMPUTED_AT"),
    }));
  });
}

export async function replaceProfileAccessMap(
  viewerPersonId: string,
  rows: Array<Omit<U1ProfileAccessMapRow, "mapId">>,
) {
  await ensureSchema();
  const viewer = normalize(viewerPersonId);
  await withTransaction(async (connection) => {
    await connection.execute("DELETE FROM profile_access_map WHERE viewer_person_id = :viewer", { viewer });
    for (const row of rows) {
      await connection.execute(
        `INSERT INTO profile_access_map (
           map_id, viewer_person_id, target_person_id, is_subscribed, is_shared,
           can_vitals, can_stories, can_media, can_conversations, placeholder_only,
           reason_code, map_version, computed_at
         ) VALUES (
           :mapId, :viewer, :target, :isSubscribed, :isShared,
           :canVitals, :canStories, :canMedia, :canConversations, :placeholderOnly,
           :reasonCode, :mapVersion, :computedAt
         )`,
        {
          mapId: `u1-map-${randomUUID()}`,
          viewer,
          target: normalize(row.targetPersonId),
          isSubscribed: toDbBool(Boolean(row.isSubscribed)),
          isShared: toDbBool(Boolean(row.isShared)),
          canVitals: toDbBool(Boolean(row.canVitals)),
          canStories: toDbBool(Boolean(row.canStories)),
          canMedia: toDbBool(Boolean(row.canMedia)),
          canConversations: toDbBool(Boolean(row.canConversations)),
          placeholderOnly: toDbBool(Boolean(row.placeholderOnly)),
          reasonCode: normalize(row.reasonCode),
          mapVersion: normalize(row.mapVersion),
          computedAt: normalize(row.computedAt),
        },
      );
    }
  });
}

export async function listRecomputeJobs(viewerPersonId: string): Promise<U1RecomputeJob[]> {
  await ensureSchema();
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT job_id, viewer_person_id, reason, status, dedupe_key, requested_at, started_at, completed_at, error_message
         FROM access_recompute_jobs
        WHERE viewer_person_id = :viewer
        ORDER BY requested_at DESC`,
      { viewer: normalize(viewerPersonId) },
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      jobId: getCell(row, "JOB_ID"),
      viewerPersonId: getCell(row, "VIEWER_PERSON_ID"),
      reason: getCell(row, "REASON"),
      status: getCell(row, "STATUS") as U1RecomputeJob["status"],
      dedupeKey: getCell(row, "DEDUPE_KEY"),
      requestedAt: getCell(row, "REQUESTED_AT"),
      startedAt: getCell(row, "STARTED_AT"),
      completedAt: getCell(row, "COMPLETED_AT"),
      errorMessage: getCell(row, "ERROR_MESSAGE"),
    }));
  });
}

export async function listRecomputeRuns(viewerPersonId: string): Promise<U1RecomputeRun[]> {
  await ensureSchema();
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT run_id, job_id, viewer_person_id, status, started_at, completed_at, processed_count, changed_count, error_message
         FROM access_recompute_runs
        WHERE viewer_person_id = :viewer
        ORDER BY started_at DESC`,
      { viewer: normalize(viewerPersonId) },
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      runId: getCell(row, "RUN_ID"),
      jobId: getCell(row, "JOB_ID"),
      viewerPersonId: getCell(row, "VIEWER_PERSON_ID"),
      status: getCell(row, "STATUS") as U1RecomputeRun["status"],
      startedAt: getCell(row, "STARTED_AT"),
      completedAt: getCell(row, "COMPLETED_AT"),
      processedCount: Number.parseInt(getCell(row, "PROCESSED_COUNT") || "0", 10) || 0,
      changedCount: Number.parseInt(getCell(row, "CHANGED_COUNT") || "0", 10) || 0,
      errorMessage: getCell(row, "ERROR_MESSAGE"),
    }));
  });
}

export async function enqueueRecomputeJob(viewerPersonId: string, reason: string) {
  await ensureSchema();
  const viewer = normalize(viewerPersonId);
  const normalizedReason = normalize(reason) || "manual";
  const dedupeKey = `${viewer}:${normalizedReason.toLowerCase()}`;
  const existing = await listRecomputeJobs(viewer);
  const pending = existing.find(
    (job) => (job.status === "queued" || job.status === "running") && normalize(job.dedupeKey) === dedupeKey,
  );
  if (pending) return pending;

  const job: U1RecomputeJob = {
    jobId: `u1-job-${randomUUID()}`,
    viewerPersonId: viewer,
    reason: normalizedReason,
    status: "queued",
    dedupeKey,
    requestedAt: nowIso(),
    startedAt: "",
    completedAt: "",
    errorMessage: "",
  };

  await withConnection(async (connection) => {
    await connection.execute(
      `INSERT INTO access_recompute_jobs (
         job_id, viewer_person_id, reason, status, dedupe_key, requested_at, started_at, completed_at, error_message
       ) VALUES (
         :jobId, :viewer, :reason, :status, :dedupeKey, :requestedAt, :startedAt, :completedAt, :errorMessage
       )`,
      {
        jobId: job.jobId,
        viewer,
        reason: job.reason,
        status: job.status,
        dedupeKey: job.dedupeKey,
        requestedAt: job.requestedAt,
        startedAt: "",
        completedAt: "",
        errorMessage: "",
      },
      { autoCommit: true },
    );
  });

  return job;
}

export async function updateRecomputeJob(jobId: string, patch: Partial<U1RecomputeJob>) {
  await ensureSchema();
  await withConnection(async (connection) => {
    await connection.execute(
      `UPDATE access_recompute_jobs
          SET status = COALESCE(:status, status),
              started_at = COALESCE(:startedAt, started_at),
              completed_at = COALESCE(:completedAt, completed_at),
              error_message = COALESCE(:errorMessage, error_message)
        WHERE job_id = :jobId`,
      {
        status: patch.status ? normalize(patch.status) : null,
        startedAt: patch.startedAt ? normalize(patch.startedAt) : null,
        completedAt: patch.completedAt ? normalize(patch.completedAt) : null,
        errorMessage: patch.errorMessage ? normalize(patch.errorMessage) : null,
        jobId: normalize(jobId),
      },
      { autoCommit: true },
    );
  });
}

export async function createRecomputeRun(run: U1RecomputeRun) {
  await ensureSchema();
  await withConnection(async (connection) => {
    await connection.execute(
      `INSERT INTO access_recompute_runs (
         run_id, job_id, viewer_person_id, status, started_at, completed_at, processed_count, changed_count, error_message
       ) VALUES (
         :runId, :jobId, :viewer, :status, :startedAt, :completedAt, :processedCount, :changedCount, :errorMessage
       )`,
      {
        runId: run.runId,
        jobId: run.jobId,
        viewer: run.viewerPersonId,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        processedCount: String(run.processedCount),
        changedCount: String(run.changedCount),
        errorMessage: run.errorMessage,
      },
      { autoCommit: true },
    );
  });
}

export async function getLatestRecomputeStatus(viewerPersonId: string) {
  const [jobs, runs] = await Promise.all([listRecomputeJobs(viewerPersonId), listRecomputeRuns(viewerPersonId)]);
  return {
    latestJob: jobs[0] ?? null,
    latestRun: runs[0] ?? null,
  };
}
