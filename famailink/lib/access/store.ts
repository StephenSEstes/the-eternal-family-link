import "server-only";

import { randomUUID } from "node:crypto";
import oracledb from "oracledb";
import { withConnection } from "@/lib/oci/client";
import type {
  AccessDerivedSummary,
  AccessRecomputeJob,
  AccessRecomputeRun,
  ProfileSubscriptionMapRow,
  ProfileVisibilityMapRow,
  ShareDefaultRule,
  SharePersonException,
  SubscriptionDefaultRule,
  SubscriptionPersonException,
} from "@/lib/access/types";
import type { EffectType, LineageSide, RelationshipCategory } from "@/lib/model/relationships";

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

function sortByUpdatedDesc<T extends { updatedAt: string; createdAt: string }>(rows: T[]) {
  return rows.slice().sort((left, right) => {
    const leftTs = Date.parse(left.updatedAt || left.createdAt || "");
    const rightTs = Date.parse(right.updatedAt || right.createdAt || "");
    return rightTs - leftTs;
  });
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
      `CREATE TABLE profile_visibility_map (
         map_id VARCHAR2(128) PRIMARY KEY,
         viewer_person_id VARCHAR2(128) NOT NULL,
         target_person_id VARCHAR2(128) NOT NULL,
         tree_visible VARCHAR2(8) NOT NULL,
         can_vitals VARCHAR2(8) NOT NULL,
         can_stories VARCHAR2(8) NOT NULL,
         can_media VARCHAR2(8) NOT NULL,
         can_conversations VARCHAR2(8) NOT NULL,
         placeholder_only VARCHAR2(8) NOT NULL,
         reason_code VARCHAR2(4000),
         map_version VARCHAR2(64),
         computed_at VARCHAR2(64)
       )`,
      "CREATE UNIQUE INDEX ux_profile_visibility_map_scope ON profile_visibility_map(viewer_person_id, target_person_id)",
      "CREATE INDEX ix_profile_visibility_map_viewer ON profile_visibility_map(viewer_person_id, computed_at)",
      `CREATE TABLE profile_subscription_map (
         map_id VARCHAR2(128) PRIMARY KEY,
         viewer_person_id VARCHAR2(128) NOT NULL,
         target_person_id VARCHAR2(128) NOT NULL,
         is_subscribed VARCHAR2(8) NOT NULL,
         reason_code VARCHAR2(4000),
         map_version VARCHAR2(64),
         computed_at VARCHAR2(64)
       )`,
      "CREATE UNIQUE INDEX ux_profile_subscription_map_scope ON profile_subscription_map(viewer_person_id, target_person_id)",
      "CREATE INDEX ix_profile_subscription_map_viewer ON profile_subscription_map(viewer_person_id, computed_at)",
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
    ];

    for (const statement of statements) {
      await safeExecute(connection, statement);
    }
    await connection.commit();
  });

  schemaEnsured = true;
}

export async function listSubscriptionDefaults(viewerPersonId: string): Promise<SubscriptionDefaultRule[]> {
  await ensureSchema();

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT rule_id, viewer_person_id, relationship_category, lineage_side, is_subscribed, is_active, created_at, updated_at
         FROM subscription_default_rules
        WHERE viewer_person_id = :viewerPersonId
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST`,
      { viewerPersonId: normalize(viewerPersonId) },
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return sortByUpdatedDesc(
      rows.map((row) => ({
        ruleId: getCell(row, "RULE_ID"),
        viewerPersonId: getCell(row, "VIEWER_PERSON_ID"),
        relationshipCategory: getCell(row, "RELATIONSHIP_CATEGORY") as RelationshipCategory,
        lineageSide: getCell(row, "LINEAGE_SIDE") as LineageSide,
        isSubscribed: asBool(getCell(row, "IS_SUBSCRIBED")),
        isActive: asBool(getCell(row, "IS_ACTIVE")),
        createdAt: getCell(row, "CREATED_AT"),
        updatedAt: getCell(row, "UPDATED_AT"),
      })),
    );
  });
}

export async function replaceSubscriptionDefaults(
  viewerPersonId: string,
  rows: Array<{
    relationshipCategory: RelationshipCategory;
    lineageSide: LineageSide;
    isSubscribed: boolean;
    isActive?: boolean;
  }>,
) {
  await ensureSchema();

  const timestamp = nowIso();
  const normalizedViewer = normalize(viewerPersonId);
  await withConnection(async (connection) => {
    await connection.execute(
      "DELETE FROM subscription_default_rules WHERE viewer_person_id = :viewerPersonId",
      { viewerPersonId: normalizedViewer },
      { autoCommit: false },
    );

    for (const row of rows) {
      await connection.execute(
        `INSERT INTO subscription_default_rules (
           rule_id, viewer_person_id, relationship_category, lineage_side, is_subscribed, is_active, created_at, updated_at
         ) VALUES (
           :ruleId, :viewerPersonId, :relationshipCategory, :lineageSide, :isSubscribed, :isActive, :createdAt, :updatedAt
         )`,
        {
          ruleId: `fm-sub-default-${randomUUID()}`,
          viewerPersonId: normalizedViewer,
          relationshipCategory: row.relationshipCategory,
          lineageSide: row.lineageSide,
          isSubscribed: toDbBool(Boolean(row.isSubscribed)),
          isActive: toDbBool(row.isActive ?? true),
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        { autoCommit: false },
      );
    }

    await connection.commit();
  });
}

export async function listSubscriptionPersonExceptions(
  viewerPersonId: string,
): Promise<SubscriptionPersonException[]> {
  await ensureSchema();

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT exception_id, viewer_person_id, target_person_id, effect, created_at, updated_at
         FROM subscription_person_exceptions
        WHERE viewer_person_id = :viewerPersonId
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST`,
      { viewerPersonId: normalize(viewerPersonId) },
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return sortByUpdatedDesc(
      rows.map((row) => ({
        exceptionId: getCell(row, "EXCEPTION_ID"),
        viewerPersonId: getCell(row, "VIEWER_PERSON_ID"),
        targetPersonId: getCell(row, "TARGET_PERSON_ID"),
        effect: getCell(row, "EFFECT") as EffectType,
        createdAt: getCell(row, "CREATED_AT"),
        updatedAt: getCell(row, "UPDATED_AT"),
      })),
    );
  });
}

export async function replaceSubscriptionPersonExceptions(
  viewerPersonId: string,
  rows: Array<{ targetPersonId: string; effect: EffectType }>,
) {
  await ensureSchema();

  const timestamp = nowIso();
  const normalizedViewer = normalize(viewerPersonId);
  await withConnection(async (connection) => {
    await connection.execute(
      "DELETE FROM subscription_person_exceptions WHERE viewer_person_id = :viewerPersonId",
      { viewerPersonId: normalizedViewer },
      { autoCommit: false },
    );

    for (const row of rows) {
      await connection.execute(
        `INSERT INTO subscription_person_exceptions (
           exception_id, viewer_person_id, target_person_id, effect, created_at, updated_at
         ) VALUES (
           :exceptionId, :viewerPersonId, :targetPersonId, :effect, :createdAt, :updatedAt
         )`,
        {
          exceptionId: `fm-sub-person-${randomUUID()}`,
          viewerPersonId: normalizedViewer,
          targetPersonId: normalize(row.targetPersonId),
          effect: row.effect,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        { autoCommit: false },
      );
    }

    await connection.commit();
  });
}

export async function listShareDefaults(ownerPersonId: string): Promise<ShareDefaultRule[]> {
  await ensureSchema();

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT rule_id, owner_person_id, relationship_category, lineage_side, share_vitals, share_stories, share_media, share_conversations, is_active, created_at, updated_at
         FROM owner_share_default_rules
        WHERE owner_person_id = :ownerPersonId
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST`,
      { ownerPersonId: normalize(ownerPersonId) },
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return sortByUpdatedDesc(
      rows.map((row) => ({
        ruleId: getCell(row, "RULE_ID"),
        ownerPersonId: getCell(row, "OWNER_PERSON_ID"),
        relationshipCategory: getCell(row, "RELATIONSHIP_CATEGORY") as RelationshipCategory,
        lineageSide: getCell(row, "LINEAGE_SIDE") as LineageSide,
        shareVitals: asBool(getCell(row, "SHARE_VITALS")),
        shareStories: asBool(getCell(row, "SHARE_STORIES")),
        shareMedia: asBool(getCell(row, "SHARE_MEDIA")),
        shareConversations: asBool(getCell(row, "SHARE_CONVERSATIONS")),
        isActive: asBool(getCell(row, "IS_ACTIVE")),
        createdAt: getCell(row, "CREATED_AT"),
        updatedAt: getCell(row, "UPDATED_AT"),
      })),
    );
  });
}

export async function listAllShareDefaults(): Promise<ShareDefaultRule[]> {
  await ensureSchema();

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT rule_id, owner_person_id, relationship_category, lineage_side, share_vitals, share_stories, share_media, share_conversations, is_active, created_at, updated_at
         FROM owner_share_default_rules`,
      {},
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return sortByUpdatedDesc(
      rows.map((row) => ({
        ruleId: getCell(row, "RULE_ID"),
        ownerPersonId: getCell(row, "OWNER_PERSON_ID"),
        relationshipCategory: getCell(row, "RELATIONSHIP_CATEGORY") as RelationshipCategory,
        lineageSide: getCell(row, "LINEAGE_SIDE") as LineageSide,
        shareVitals: asBool(getCell(row, "SHARE_VITALS")),
        shareStories: asBool(getCell(row, "SHARE_STORIES")),
        shareMedia: asBool(getCell(row, "SHARE_MEDIA")),
        shareConversations: asBool(getCell(row, "SHARE_CONVERSATIONS")),
        isActive: asBool(getCell(row, "IS_ACTIVE")),
        createdAt: getCell(row, "CREATED_AT"),
        updatedAt: getCell(row, "UPDATED_AT"),
      })),
    );
  });
}

export async function replaceShareDefaults(
  ownerPersonId: string,
  rows: Array<{
    relationshipCategory: RelationshipCategory;
    lineageSide: LineageSide;
    shareVitals: boolean;
    shareStories: boolean;
    shareMedia: boolean;
    shareConversations: boolean;
    isActive?: boolean;
  }>,
) {
  await ensureSchema();

  const timestamp = nowIso();
  const normalizedOwner = normalize(ownerPersonId);
  await withConnection(async (connection) => {
    await connection.execute(
      "DELETE FROM owner_share_default_rules WHERE owner_person_id = :ownerPersonId",
      { ownerPersonId: normalizedOwner },
      { autoCommit: false },
    );

    for (const row of rows) {
      await connection.execute(
        `INSERT INTO owner_share_default_rules (
           rule_id, owner_person_id, relationship_category, lineage_side,
           share_vitals, share_stories, share_media, share_conversations,
           is_active, created_at, updated_at
         ) VALUES (
           :ruleId, :ownerPersonId, :relationshipCategory, :lineageSide,
           :shareVitals, :shareStories, :shareMedia, :shareConversations,
           :isActive, :createdAt, :updatedAt
         )`,
        {
          ruleId: `fm-share-default-${randomUUID()}`,
          ownerPersonId: normalizedOwner,
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
        { autoCommit: false },
      );
    }

    await connection.commit();
  });
}

export async function listSharePersonExceptions(ownerPersonId: string): Promise<SharePersonException[]> {
  await ensureSchema();

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT exception_id, owner_person_id, target_person_id, effect, share_vitals, share_stories, share_media, share_conversations, created_at, updated_at
         FROM owner_share_person_exceptions
        WHERE owner_person_id = :ownerPersonId
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST`,
      { ownerPersonId: normalize(ownerPersonId) },
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return sortByUpdatedDesc(
      rows.map((row) => ({
        exceptionId: getCell(row, "EXCEPTION_ID"),
        ownerPersonId: getCell(row, "OWNER_PERSON_ID"),
        targetPersonId: getCell(row, "TARGET_PERSON_ID"),
        effect: getCell(row, "EFFECT") as EffectType,
        shareVitals: asNullableBool(getCell(row, "SHARE_VITALS")),
        shareStories: asNullableBool(getCell(row, "SHARE_STORIES")),
        shareMedia: asNullableBool(getCell(row, "SHARE_MEDIA")),
        shareConversations: asNullableBool(getCell(row, "SHARE_CONVERSATIONS")),
        createdAt: getCell(row, "CREATED_AT"),
        updatedAt: getCell(row, "UPDATED_AT"),
      })),
    );
  });
}

export async function listAllSharePersonExceptions(): Promise<SharePersonException[]> {
  await ensureSchema();

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT exception_id, owner_person_id, target_person_id, effect, share_vitals, share_stories, share_media, share_conversations, created_at, updated_at
         FROM owner_share_person_exceptions`,
      {},
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return sortByUpdatedDesc(
      rows.map((row) => ({
        exceptionId: getCell(row, "EXCEPTION_ID"),
        ownerPersonId: getCell(row, "OWNER_PERSON_ID"),
        targetPersonId: getCell(row, "TARGET_PERSON_ID"),
        effect: getCell(row, "EFFECT") as EffectType,
        shareVitals: asNullableBool(getCell(row, "SHARE_VITALS")),
        shareStories: asNullableBool(getCell(row, "SHARE_STORIES")),
        shareMedia: asNullableBool(getCell(row, "SHARE_MEDIA")),
        shareConversations: asNullableBool(getCell(row, "SHARE_CONVERSATIONS")),
        createdAt: getCell(row, "CREATED_AT"),
        updatedAt: getCell(row, "UPDATED_AT"),
      })),
    );
  });
}

export async function replaceSharePersonExceptions(
  ownerPersonId: string,
  rows: Array<{
    targetPersonId: string;
    effect: EffectType;
    shareVitals: boolean | null;
    shareStories: boolean | null;
    shareMedia: boolean | null;
    shareConversations: boolean | null;
  }>,
) {
  await ensureSchema();

  const timestamp = nowIso();
  const normalizedOwner = normalize(ownerPersonId);
  await withConnection(async (connection) => {
    await connection.execute(
      "DELETE FROM owner_share_person_exceptions WHERE owner_person_id = :ownerPersonId",
      { ownerPersonId: normalizedOwner },
      { autoCommit: false },
    );

    for (const row of rows) {
      await connection.execute(
        `INSERT INTO owner_share_person_exceptions (
           exception_id, owner_person_id, target_person_id, effect,
           share_vitals, share_stories, share_media, share_conversations,
           created_at, updated_at
         ) VALUES (
           :exceptionId, :ownerPersonId, :targetPersonId, :effect,
           :shareVitals, :shareStories, :shareMedia, :shareConversations,
           :createdAt, :updatedAt
         )`,
        {
          exceptionId: `fm-share-person-${randomUUID()}`,
          ownerPersonId: normalizedOwner,
          targetPersonId: normalize(row.targetPersonId),
          effect: row.effect,
          shareVitals: toDbNullableBool(row.shareVitals),
          shareStories: toDbNullableBool(row.shareStories),
          shareMedia: toDbNullableBool(row.shareMedia),
          shareConversations: toDbNullableBool(row.shareConversations),
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        { autoCommit: false },
      );
    }

    await connection.commit();
  });
}

export async function listProfileVisibilityMap(viewerPersonId: string): Promise<ProfileVisibilityMapRow[]> {
  await ensureSchema();

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT map_id, viewer_person_id, target_person_id, tree_visible, can_vitals, can_stories, can_media, can_conversations, placeholder_only, reason_code, map_version, computed_at
         FROM profile_visibility_map
        WHERE viewer_person_id = :viewerPersonId
        ORDER BY target_person_id`,
      { viewerPersonId: normalize(viewerPersonId) },
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      mapId: getCell(row, "MAP_ID"),
      viewerPersonId: getCell(row, "VIEWER_PERSON_ID"),
      targetPersonId: getCell(row, "TARGET_PERSON_ID"),
      treeVisible: asBool(getCell(row, "TREE_VISIBLE")),
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

export async function replaceProfileVisibilityMap(
  viewerPersonId: string,
  rows: Array<Omit<ProfileVisibilityMapRow, "mapId">>,
) {
  await ensureSchema();

  const normalizedViewer = normalize(viewerPersonId);
  await withConnection(async (connection) => {
    await connection.execute(
      "DELETE FROM profile_visibility_map WHERE viewer_person_id = :viewerPersonId",
      { viewerPersonId: normalizedViewer },
      { autoCommit: false },
    );

    for (const row of rows) {
      await connection.execute(
        `INSERT INTO profile_visibility_map (
           map_id, viewer_person_id, target_person_id, tree_visible, can_vitals, can_stories, can_media, can_conversations, placeholder_only, reason_code, map_version, computed_at
         ) VALUES (
           :mapId, :viewerPersonId, :targetPersonId, :treeVisible, :canVitals, :canStories, :canMedia, :canConversations, :placeholderOnly, :reasonCode, :mapVersion, :computedAt
         )`,
        {
          mapId: `fm-vis-map-${randomUUID()}`,
          viewerPersonId: normalizedViewer,
          targetPersonId: normalize(row.targetPersonId),
          treeVisible: toDbBool(Boolean(row.treeVisible)),
          canVitals: toDbBool(Boolean(row.canVitals)),
          canStories: toDbBool(Boolean(row.canStories)),
          canMedia: toDbBool(Boolean(row.canMedia)),
          canConversations: toDbBool(Boolean(row.canConversations)),
          placeholderOnly: toDbBool(Boolean(row.placeholderOnly)),
          reasonCode: normalize(row.reasonCode),
          mapVersion: normalize(row.mapVersion),
          computedAt: normalize(row.computedAt),
        },
        { autoCommit: false },
      );
    }

    await connection.commit();
  });
}

export async function listProfileSubscriptionMap(viewerPersonId: string): Promise<ProfileSubscriptionMapRow[]> {
  await ensureSchema();

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT map_id, viewer_person_id, target_person_id, is_subscribed, reason_code, map_version, computed_at
         FROM profile_subscription_map
        WHERE viewer_person_id = :viewerPersonId
        ORDER BY target_person_id`,
      { viewerPersonId: normalize(viewerPersonId) },
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      mapId: getCell(row, "MAP_ID"),
      viewerPersonId: getCell(row, "VIEWER_PERSON_ID"),
      targetPersonId: getCell(row, "TARGET_PERSON_ID"),
      isSubscribed: asBool(getCell(row, "IS_SUBSCRIBED")),
      reasonCode: getCell(row, "REASON_CODE"),
      mapVersion: getCell(row, "MAP_VERSION"),
      computedAt: getCell(row, "COMPUTED_AT"),
    }));
  });
}

export async function replaceProfileSubscriptionMap(
  viewerPersonId: string,
  rows: Array<Omit<ProfileSubscriptionMapRow, "mapId">>,
) {
  await ensureSchema();

  const normalizedViewer = normalize(viewerPersonId);
  await withConnection(async (connection) => {
    await connection.execute(
      "DELETE FROM profile_subscription_map WHERE viewer_person_id = :viewerPersonId",
      { viewerPersonId: normalizedViewer },
      { autoCommit: false },
    );

    for (const row of rows) {
      await connection.execute(
        `INSERT INTO profile_subscription_map (
           map_id, viewer_person_id, target_person_id, is_subscribed, reason_code, map_version, computed_at
         ) VALUES (
           :mapId, :viewerPersonId, :targetPersonId, :isSubscribed, :reasonCode, :mapVersion, :computedAt
         )`,
        {
          mapId: `fm-sub-map-${randomUUID()}`,
          viewerPersonId: normalizedViewer,
          targetPersonId: normalize(row.targetPersonId),
          isSubscribed: toDbBool(Boolean(row.isSubscribed)),
          reasonCode: normalize(row.reasonCode),
          mapVersion: normalize(row.mapVersion),
          computedAt: normalize(row.computedAt),
        },
        { autoCommit: false },
      );
    }

    await connection.commit();
  });
}

export async function listRecomputeJobs(viewerPersonId: string): Promise<AccessRecomputeJob[]> {
  await ensureSchema();

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT job_id, viewer_person_id, reason, status, dedupe_key, requested_at, started_at, completed_at, error_message
         FROM access_recompute_jobs
        WHERE viewer_person_id = :viewerPersonId
        ORDER BY requested_at DESC`,
      { viewerPersonId: normalize(viewerPersonId) },
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      jobId: getCell(row, "JOB_ID"),
      viewerPersonId: getCell(row, "VIEWER_PERSON_ID"),
      reason: getCell(row, "REASON"),
      status: getCell(row, "STATUS") as AccessRecomputeJob["status"],
      dedupeKey: getCell(row, "DEDUPE_KEY"),
      requestedAt: getCell(row, "REQUESTED_AT"),
      startedAt: getCell(row, "STARTED_AT"),
      completedAt: getCell(row, "COMPLETED_AT"),
      errorMessage: getCell(row, "ERROR_MESSAGE"),
    }));
  });
}

export async function enqueueRecomputeJob(input: {
  viewerPersonId: string;
  reason: string;
  dedupeKey?: string;
}) {
  await ensureSchema();

  const viewerPersonId = normalize(input.viewerPersonId);
  const reason = normalize(input.reason) || "manual";
  const dedupeKey = normalize(input.dedupeKey) || `${viewerPersonId}:${normalizeLower(reason)}`;
  const existing = await listRecomputeJobs(viewerPersonId);
  const pending = existing.find((job) => {
    const sameStatus = job.status === "queued" || job.status === "running";
    return sameStatus && normalize(job.dedupeKey) === dedupeKey;
  });
  if (pending) return pending;

  const job: AccessRecomputeJob = {
    jobId: `fm-job-${randomUUID()}`,
    viewerPersonId,
    reason,
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
         :jobId, :viewerPersonId, :reason, :status, :dedupeKey, :requestedAt, :startedAt, :completedAt, :errorMessage
       )`,
      {
        jobId: job.jobId,
        viewerPersonId: job.viewerPersonId,
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

export async function updateRecomputeJob(jobId: string, patch: Partial<AccessRecomputeJob>) {
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

export async function listRecomputeRuns(viewerPersonId: string): Promise<AccessRecomputeRun[]> {
  await ensureSchema();

  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT run_id, job_id, viewer_person_id, status, started_at, completed_at, processed_count, changed_count, error_message
         FROM access_recompute_runs
        WHERE viewer_person_id = :viewerPersonId
        ORDER BY started_at DESC`,
      { viewerPersonId: normalize(viewerPersonId) },
      OUT_FORMAT,
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      runId: getCell(row, "RUN_ID"),
      jobId: getCell(row, "JOB_ID"),
      viewerPersonId: getCell(row, "VIEWER_PERSON_ID"),
      status: getCell(row, "STATUS") as AccessRecomputeRun["status"],
      startedAt: getCell(row, "STARTED_AT"),
      completedAt: getCell(row, "COMPLETED_AT"),
      processedCount: Number.parseInt(getCell(row, "PROCESSED_COUNT") || "0", 10) || 0,
      changedCount: Number.parseInt(getCell(row, "CHANGED_COUNT") || "0", 10) || 0,
      errorMessage: getCell(row, "ERROR_MESSAGE"),
    }));
  });
}

export async function createRecomputeRun(run: AccessRecomputeRun) {
  await ensureSchema();

  await withConnection(async (connection) => {
    await connection.execute(
      `INSERT INTO access_recompute_runs (
         run_id, job_id, viewer_person_id, status, started_at, completed_at, processed_count, changed_count, error_message
       ) VALUES (
         :runId, :jobId, :viewerPersonId, :status, :startedAt, :completedAt, :processedCount, :changedCount, :errorMessage
       )`,
      {
        runId: run.runId,
        jobId: run.jobId,
        viewerPersonId: run.viewerPersonId,
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

export async function buildDerivedSummary(viewerPersonId: string): Promise<AccessDerivedSummary | null> {
  const [visibilityRows, subscriptionRows] = await Promise.all([
    listProfileVisibilityMap(viewerPersonId),
    listProfileSubscriptionMap(viewerPersonId),
  ]);

  if (!visibilityRows.length && !subscriptionRows.length) {
    return null;
  }

  const mostRecentVisibility = visibilityRows.reduce(
    (current, row) => (Date.parse(row.computedAt || "") > Date.parse(current.computedAt || "") ? row : current),
    visibilityRows[0],
  );
  const mostRecentSubscription = subscriptionRows.reduce(
    (current, row) => (Date.parse(row.computedAt || "") > Date.parse(current.computedAt || "") ? row : current),
    subscriptionRows[0],
  );
  const latestComputedAt = [mostRecentVisibility?.computedAt ?? "", mostRecentSubscription?.computedAt ?? ""]
    .filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? "";
  const mapVersion =
    (mostRecentVisibility && Date.parse(mostRecentVisibility.computedAt || "") >= Date.parse(mostRecentSubscription?.computedAt || "")
      ? mostRecentVisibility.mapVersion
      : mostRecentSubscription?.mapVersion) || "";
  const sharedCount = visibilityRows.filter((row) => row.canVitals || row.canStories || row.canMedia || row.canConversations).length;
  const placeholderOnlyCount = visibilityRows.filter((row) => row.placeholderOnly).length;
  const subscribedCount = subscriptionRows.filter((row) => row.isSubscribed).length;

  return {
    visibilityRowCount: visibilityRows.length,
    subscriptionRowCount: subscriptionRows.length,
    subscribedCount,
    sharedCount,
    placeholderOnlyCount,
    lastComputedAt: latestComputedAt,
    mapVersion,
  };
}
