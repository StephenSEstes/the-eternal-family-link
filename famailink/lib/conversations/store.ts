import "server-only";

import { createHash, randomUUID } from "node:crypto";
import oracledb from "oracledb";
import { withConnection } from "@/lib/oci/client";

const OUT_FORMAT = { outFormat: oracledb.OUT_FORMAT_OBJECT };
const FAMAILINK_SHARE_KEY = "famailink-person";

let tablesEnsured = false;

type DbConnection = {
  execute: (
    sql: string,
    binds?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<{ rows?: Record<string, unknown>[]; rowsAffected?: number }>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
};

export type ConversationMember = {
  personId: string;
  displayName: string;
  groupDisplayName: string;
  role: string;
};

export type ConversationCircle = {
  circleId: string;
  title: string;
  defaultTitle: string;
  description: string;
  familyGroupKey: string;
  ownerPersonId: string;
  createdByPersonId: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  unreadCount: number;
  memberLastReadAt: string;
  viewerRole: string;
  canDelete: boolean;
  members: ConversationMember[];
};

export type CircleConversation = {
  conversationId: string;
  circleId: string;
  title: string;
  ownerPersonId: string;
  createdByPersonId: string;
  createdByEmail: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  unreadCount: number;
  memberLastReadAt: string;
};

export type ConversationComment = {
  commentId: string;
  postId: string;
  parentCommentId: string;
  authorPersonId: string;
  authorDisplayName: string;
  authorEmail: string;
  commentText: string;
  createdAt: string;
  updatedAt: string;
};

export type ConversationPost = {
  postId: string;
  circleId: string;
  conversationId: string;
  fileId: string;
  caption: string;
  authorPersonId: string;
  authorDisplayName: string;
  authorEmail: string;
  createdAt: string;
  updatedAt: string;
  comments: ConversationComment[];
};

export type PersonConversationSummary = {
  targetPersonId: string;
  conversationId: string;
  circleId: string;
  circleTitle: string;
  title: string;
  lastActivityAt: string;
  unreadCount: number;
};

type SessionActor = {
  personId: string;
  username: string;
  userEmail: string;
};

function normalize(value?: unknown) {
  return String(value ?? "").trim();
}

function normalizeLower(value?: unknown) {
  return normalize(value).toLowerCase();
}

function getCell(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function getNumber(row: Record<string, unknown>, key: string) {
  const parsed = Number.parseInt(getCell(row, key), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix: string) {
  return `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

function uniquePersonIds(values: Iterable<string>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalize(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function memberSignature(personIds: Iterable<string>) {
  return uniquePersonIds(personIds).sort((left, right) => left.localeCompare(right)).join("|");
}

function groupAudienceKey(signature: string) {
  const digest = createHash("sha256").update(signature).digest("hex").slice(0, 40);
  return `members:${digest}`;
}

function bindList(prefix: string, values: string[], binds: Record<string, unknown>) {
  return values
    .map((value, index) => {
      const key = `${prefix}${index}`;
      binds[key] = value;
      return `:${key}`;
    })
    .join(", ");
}

function isCompatibleDdlError(message: string) {
  return /ORA-00955|ORA-01408|ORA-01430|ORA-01442|name is already used|such column list already indexed/i.test(message);
}

async function tryExecuteDdl(connection: DbConnection, sql: string) {
  try {
    await connection.execute(sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isCompatibleDdlError(message)) throw error;
  }
}

async function ensureShareTables(connection: DbConnection) {
  if (tablesEnsured) return;

  await tryExecuteDdl(
    connection,
    `CREATE TABLE share_threads (
       thread_id VARCHAR2(128) PRIMARY KEY,
       family_group_key VARCHAR2(128) NOT NULL,
       group_id VARCHAR2(128),
       audience_type VARCHAR2(64) NOT NULL,
       audience_key VARCHAR2(256) NOT NULL,
       audience_label VARCHAR2(512),
       group_description CLOB,
       owner_person_id VARCHAR2(128),
       created_by_person_id VARCHAR2(128),
       created_by_email VARCHAR2(320),
       created_at VARCHAR2(64),
       updated_at VARCHAR2(64),
       last_post_at VARCHAR2(64),
       thread_status VARCHAR2(32)
     )`,
  );
  await tryExecuteDdl(
    connection,
    "ALTER TABLE share_threads ADD group_description CLOB",
  );
  await tryExecuteDdl(
    connection,
    `CREATE TABLE share_thread_members (
       thread_member_id VARCHAR2(128) PRIMARY KEY,
       thread_id VARCHAR2(128) NOT NULL,
       family_group_key VARCHAR2(128) NOT NULL,
       person_id VARCHAR2(128) NOT NULL,
       group_display_name VARCHAR2(512),
       member_role VARCHAR2(64),
       joined_at VARCHAR2(64),
       last_read_at VARCHAR2(64),
       muted_until VARCHAR2(64),
       is_active VARCHAR2(8)
     )`,
  );
  await tryExecuteDdl(
    connection,
    "ALTER TABLE share_thread_members ADD group_display_name VARCHAR2(512)",
  );
  await tryExecuteDdl(
    connection,
    `CREATE TABLE share_conversations (
       conversation_id VARCHAR2(128) PRIMARY KEY,
       thread_id VARCHAR2(128) NOT NULL,
       family_group_key VARCHAR2(128) NOT NULL,
       title VARCHAR2(512) NOT NULL,
       conversation_kind VARCHAR2(32),
       owner_person_id VARCHAR2(128),
       created_by_person_id VARCHAR2(128),
       created_by_email VARCHAR2(320),
       created_at VARCHAR2(64),
       updated_at VARCHAR2(64),
       last_activity_at VARCHAR2(64),
       conversation_status VARCHAR2(32)
     )`,
  );
  await tryExecuteDdl(
    connection,
    `CREATE TABLE share_conversation_members (
       conversation_member_id VARCHAR2(128) PRIMARY KEY,
       conversation_id VARCHAR2(128) NOT NULL,
       thread_id VARCHAR2(128) NOT NULL,
       family_group_key VARCHAR2(128) NOT NULL,
       person_id VARCHAR2(128) NOT NULL,
       member_role VARCHAR2(64),
       joined_at VARCHAR2(64),
       last_read_at VARCHAR2(64),
       is_active VARCHAR2(8)
     )`,
  );
  await tryExecuteDdl(
    connection,
    `CREATE TABLE share_posts (
       post_id VARCHAR2(128) PRIMARY KEY,
       thread_id VARCHAR2(128) NOT NULL,
       conversation_id VARCHAR2(128),
       family_group_key VARCHAR2(128) NOT NULL,
       file_id VARCHAR2(512),
       caption_text CLOB,
       author_person_id VARCHAR2(128),
       author_display_name VARCHAR2(512),
       author_email VARCHAR2(320),
       created_at VARCHAR2(64),
       updated_at VARCHAR2(64),
       post_status VARCHAR2(32)
     )`,
  );
  await tryExecuteDdl(
    connection,
    `CREATE TABLE share_post_comments (
       comment_id VARCHAR2(128) PRIMARY KEY,
       post_id VARCHAR2(128) NOT NULL,
       thread_id VARCHAR2(128) NOT NULL,
       family_group_key VARCHAR2(128) NOT NULL,
       parent_comment_id VARCHAR2(128),
       author_person_id VARCHAR2(128),
       author_display_name VARCHAR2(512),
       author_email VARCHAR2(320),
       comment_text CLOB,
       comment_status VARCHAR2(32),
       created_at VARCHAR2(64),
       updated_at VARCHAR2(64),
       deleted_at VARCHAR2(64)
     )`,
  );

  const indexStatements = [
    "CREATE UNIQUE INDEX ux_share_threads_scope ON share_threads(family_group_key, audience_type, audience_key)",
    "CREATE INDEX ix_share_threads_member ON share_thread_members(person_id, is_active, thread_id)",
    "CREATE UNIQUE INDEX ux_share_thread_members_person ON share_thread_members(thread_id, person_id)",
    "CREATE INDEX ix_share_conversations_thread ON share_conversations(thread_id, last_activity_at, created_at)",
    "CREATE UNIQUE INDEX ux_share_conversation_members_person ON share_conversation_members(conversation_id, person_id)",
    "CREATE INDEX ix_share_conversation_members_lookup ON share_conversation_members(thread_id, person_id, is_active)",
    "CREATE INDEX ix_share_posts_conversation ON share_posts(conversation_id, thread_id, created_at)",
    "CREATE INDEX ix_share_post_comments_post ON share_post_comments(post_id, created_at)",
  ];
  for (const sql of indexStatements) {
    await tryExecuteDdl(connection, sql);
  }

  await connection.commit();
  tablesEnsured = true;
}

function mapCircle(row: Record<string, unknown>): ConversationCircle {
  const lastActivityAt = getCell(row, "LAST_POST_AT") || getCell(row, "UPDATED_AT") || getCell(row, "CREATED_AT");
  const viewerRole = normalizeLower(getCell(row, "VIEWER_ROLE")) || "member";
  const ownerPersonId = getCell(row, "OWNER_PERSON_ID");
  const createdByPersonId = getCell(row, "CREATED_BY_PERSON_ID");
  return {
    circleId: getCell(row, "THREAD_ID"),
    title: getCell(row, "VIEWER_GROUP_DISPLAY_NAME") || getCell(row, "AUDIENCE_LABEL") || "Family Group",
    defaultTitle: getCell(row, "AUDIENCE_LABEL") || "Family Group",
    description: getCell(row, "GROUP_DESCRIPTION"),
    familyGroupKey: getCell(row, "FAMILY_GROUP_KEY"),
    ownerPersonId,
    createdByPersonId,
    createdAt: getCell(row, "CREATED_AT"),
    updatedAt: getCell(row, "UPDATED_AT"),
    lastActivityAt,
    unreadCount: getNumber(row, "UNREAD_COUNT"),
    memberLastReadAt: getCell(row, "MEMBER_LAST_READ_AT"),
    viewerRole,
    canDelete: viewerRole === "owner",
    members: [],
  };
}

function mapConversation(row: Record<string, unknown>): CircleConversation {
  return {
    conversationId: getCell(row, "CONVERSATION_ID"),
    circleId: getCell(row, "THREAD_ID"),
    title: getCell(row, "TITLE") || "Conversation",
    ownerPersonId: getCell(row, "OWNER_PERSON_ID"),
    createdByPersonId: getCell(row, "CREATED_BY_PERSON_ID"),
    createdByEmail: getCell(row, "CREATED_BY_EMAIL"),
    createdAt: getCell(row, "CREATED_AT"),
    updatedAt: getCell(row, "UPDATED_AT"),
    lastActivityAt: getCell(row, "LAST_ACTIVITY_AT") || getCell(row, "UPDATED_AT") || getCell(row, "CREATED_AT"),
    unreadCount: getNumber(row, "UNREAD_COUNT"),
    memberLastReadAt: getCell(row, "MEMBER_LAST_READ_AT"),
  };
}

function mapPost(row: Record<string, unknown>): ConversationPost {
  return {
    postId: getCell(row, "POST_ID"),
    circleId: getCell(row, "THREAD_ID"),
    conversationId: getCell(row, "CONVERSATION_ID"),
    fileId: getCell(row, "FILE_ID"),
    caption: getCell(row, "CAPTION_TEXT"),
    authorPersonId: getCell(row, "AUTHOR_PERSON_ID"),
    authorDisplayName: getCell(row, "AUTHOR_DISPLAY_NAME"),
    authorEmail: getCell(row, "AUTHOR_EMAIL"),
    createdAt: getCell(row, "CREATED_AT"),
    updatedAt: getCell(row, "UPDATED_AT"),
    comments: [],
  };
}

function mapComment(row: Record<string, unknown>): ConversationComment {
  return {
    commentId: getCell(row, "COMMENT_ID"),
    postId: getCell(row, "POST_ID"),
    parentCommentId: getCell(row, "PARENT_COMMENT_ID"),
    authorPersonId: getCell(row, "AUTHOR_PERSON_ID"),
    authorDisplayName: getCell(row, "AUTHOR_DISPLAY_NAME"),
    authorEmail: getCell(row, "AUTHOR_EMAIL"),
    commentText: getCell(row, "COMMENT_TEXT"),
    createdAt: getCell(row, "CREATED_AT"),
    updatedAt: getCell(row, "UPDATED_AT"),
  };
}

async function listMembersForCircles(connection: DbConnection, circleIds: string[]) {
  const ids = uniquePersonIds(circleIds);
  const byCircle = new Map<string, ConversationMember[]>();
  if (!ids.length) return byCircle;
  const binds: Record<string, unknown> = {};
  const inList = bindList("circle", ids, binds);
  const result = await connection.execute(
    `SELECT
       m.thread_id,
       m.person_id,
       TRIM(NVL(m.group_display_name, '')) AS group_display_name,
       LOWER(TRIM(NVL(m.member_role, 'member'))) AS member_role,
       COALESCE(NULLIF(TRIM(p.display_name), ''), TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), m.person_id) AS display_name
     FROM share_thread_members m
     LEFT JOIN people p
       ON TRIM(p.person_id) = TRIM(m.person_id)
     WHERE TRIM(m.thread_id) IN (${inList})
       AND LOWER(TRIM(NVL(m.is_active, 'TRUE'))) <> 'false'
     ORDER BY m.thread_id, display_name`,
    binds,
    OUT_FORMAT,
  );
  for (const row of result.rows ?? []) {
    const circleId = getCell(row, "THREAD_ID");
    const members = byCircle.get(circleId) ?? [];
    members.push({
      personId: getCell(row, "PERSON_ID"),
      displayName: getCell(row, "DISPLAY_NAME"),
      groupDisplayName: getCell(row, "GROUP_DISPLAY_NAME"),
      role: getCell(row, "MEMBER_ROLE") || "member",
    });
    byCircle.set(circleId, members);
  }
  return byCircle;
}

export async function listConversationCirclesForPerson(personId: string): Promise<ConversationCircle[]> {
  const viewerPersonId = normalize(personId);
  if (!viewerPersonId) return [];
  return withConnection(async (rawConnection) => {
    const connection = rawConnection as DbConnection;
    await ensureShareTables(connection);
    const result = await connection.execute(
      `SELECT
         t.thread_id,
         t.family_group_key,
         t.audience_label,
         COALESCE(NULLIF(TRIM(m.group_display_name), ''), NULLIF(TRIM(t.audience_label), ''), 'Family Group') AS viewer_group_display_name,
         DBMS_LOB.SUBSTR(t.group_description, 4000, 1) AS group_description,
         t.owner_person_id,
         t.created_by_person_id,
         t.created_at,
         t.updated_at,
         t.last_post_at,
         LOWER(TRIM(NVL(m.member_role, 'member'))) AS viewer_role,
         m.last_read_at AS member_last_read_at,
         (
           SELECT COUNT(*)
           FROM share_posts p
           INNER JOIN share_conversation_members cm
             ON TRIM(cm.conversation_id) = TRIM(NVL(p.conversation_id, ''))
            AND TRIM(cm.person_id) = :personId
           WHERE TRIM(p.thread_id) = TRIM(t.thread_id)
             AND LOWER(TRIM(NVL(p.post_status, 'active'))) <> 'deleted'
             AND (
               NULLIF(TRIM(cm.last_read_at), '') IS NULL
               OR TRIM(p.created_at) > TRIM(cm.last_read_at)
             )
         ) +
         (
           SELECT COUNT(*)
           FROM share_post_comments sc
           INNER JOIN share_posts p
             ON TRIM(p.post_id) = TRIM(sc.post_id)
           INNER JOIN share_conversation_members cm
             ON TRIM(cm.conversation_id) = TRIM(NVL(p.conversation_id, ''))
            AND TRIM(cm.person_id) = :personId
           WHERE TRIM(sc.thread_id) = TRIM(t.thread_id)
             AND LOWER(TRIM(NVL(sc.comment_status, 'active'))) <> 'deleted'
             AND (
               NULLIF(TRIM(cm.last_read_at), '') IS NULL
               OR TRIM(sc.created_at) > TRIM(cm.last_read_at)
             )
         ) AS unread_count
       FROM share_thread_members m
       INNER JOIN share_threads t
         ON TRIM(t.thread_id) = TRIM(m.thread_id)
       WHERE TRIM(m.person_id) = :personId
         AND TRIM(t.family_group_key) = :familyGroupKey
         AND LOWER(TRIM(NVL(t.audience_type, 'person_group'))) IN ('person_group', 'person_circle')
         AND LOWER(TRIM(NVL(m.is_active, 'TRUE'))) <> 'false'
         AND LOWER(TRIM(NVL(t.thread_status, 'active'))) <> 'archived'
       ORDER BY COALESCE(NULLIF(TRIM(t.last_post_at), ''), NULLIF(TRIM(t.updated_at), ''), t.created_at) DESC,
                t.audience_label`,
      { personId: viewerPersonId, familyGroupKey: FAMAILINK_SHARE_KEY },
      OUT_FORMAT,
    );
    const circles = (result.rows ?? []).map(mapCircle);
    const membersByCircle = await listMembersForCircles(
      connection,
      circles.map((circle) => circle.circleId),
    );
    return circles.map((circle) => ({
      ...circle,
      members: membersByCircle.get(circle.circleId) ?? [],
    }));
  });
}

export async function getConversationCircleForPerson(circleId: string, personId: string): Promise<ConversationCircle | null> {
  const normalizedCircleId = normalize(circleId);
  const viewerPersonId = normalize(personId);
  if (!normalizedCircleId || !viewerPersonId) return null;
  return withConnection(async (rawConnection) => {
    const connection = rawConnection as DbConnection;
    await ensureShareTables(connection);
    const result = await connection.execute(
      `SELECT
         t.thread_id,
         t.family_group_key,
         t.audience_label,
         COALESCE(NULLIF(TRIM(m.group_display_name), ''), NULLIF(TRIM(t.audience_label), ''), 'Family Group') AS viewer_group_display_name,
         DBMS_LOB.SUBSTR(t.group_description, 4000, 1) AS group_description,
         t.owner_person_id,
         t.created_by_person_id,
         t.created_at,
         t.updated_at,
         t.last_post_at,
         LOWER(TRIM(NVL(m.member_role, 'member'))) AS viewer_role,
         m.last_read_at AS member_last_read_at,
         0 AS unread_count
       FROM share_thread_members m
       INNER JOIN share_threads t
         ON TRIM(t.thread_id) = TRIM(m.thread_id)
       WHERE TRIM(t.thread_id) = :circleId
         AND TRIM(t.family_group_key) = :familyGroupKey
         AND LOWER(TRIM(NVL(t.audience_type, 'person_group'))) IN ('person_group', 'person_circle')
         AND TRIM(m.person_id) = :personId
         AND LOWER(TRIM(NVL(m.is_active, 'TRUE'))) <> 'false'
         AND LOWER(TRIM(NVL(t.thread_status, 'active'))) <> 'archived'
       FETCH FIRST 1 ROWS ONLY`,
      { circleId: normalizedCircleId, personId: viewerPersonId, familyGroupKey: FAMAILINK_SHARE_KEY },
      OUT_FORMAT,
    );
    const row = result.rows?.[0] ?? null;
    if (!row) return null;
    const circle = mapCircle(row);
    const members = await listMembersForCircles(connection, [circle.circleId]);
    return { ...circle, members: members.get(circle.circleId) ?? [] };
  });
}

async function findCircleBySignature(connection: DbConnection, signature: string, memberCount: number, viewerPersonId: string) {
  const result = await connection.execute(
    `SELECT *
     FROM (
       SELECT
         t.thread_id,
         t.family_group_key,
         t.audience_label,
         COALESCE(NULLIF(TRIM(viewer_m.group_display_name), ''), NULLIF(TRIM(t.audience_label), ''), 'Family Group') AS viewer_group_display_name,
         DBMS_LOB.SUBSTR(t.group_description, 4000, 1) AS group_description,
         t.owner_person_id,
         t.created_by_person_id,
         t.created_at,
         t.updated_at,
         t.last_post_at,
         LOWER(TRIM(NVL(viewer_m.member_role, 'member'))) AS viewer_role,
         '' AS member_last_read_at,
         0 AS unread_count,
         LISTAGG(TRIM(m.person_id), '|') WITHIN GROUP (ORDER BY TRIM(m.person_id)) AS member_signature
       FROM share_threads t
       INNER JOIN share_thread_members m
         ON TRIM(m.thread_id) = TRIM(t.thread_id)
       INNER JOIN share_thread_members viewer_m
         ON TRIM(viewer_m.thread_id) = TRIM(t.thread_id)
        AND TRIM(viewer_m.person_id) = :viewerPersonId
        AND LOWER(TRIM(NVL(viewer_m.is_active, 'TRUE'))) <> 'false'
       WHERE LOWER(TRIM(NVL(t.thread_status, 'active'))) <> 'archived'
         AND TRIM(t.family_group_key) = :familyGroupKey
         AND LOWER(TRIM(NVL(t.audience_type, 'person_group'))) IN ('person_group', 'person_circle')
         AND LOWER(TRIM(NVL(m.is_active, 'TRUE'))) <> 'false'
       GROUP BY t.thread_id, t.family_group_key, t.audience_label, viewer_m.group_display_name, DBMS_LOB.SUBSTR(t.group_description, 4000, 1), t.owner_person_id,
                t.created_by_person_id, t.created_at, t.updated_at, t.last_post_at, viewer_m.member_role
       HAVING COUNT(*) = :memberCount
     )
     WHERE member_signature = :signature
     FETCH FIRST 1 ROWS ONLY`,
    { signature, memberCount, viewerPersonId, familyGroupKey: FAMAILINK_SHARE_KEY },
    OUT_FORMAT,
  );
  const row = result.rows?.[0] ?? null;
  return row ? mapCircle(row) : null;
}

export async function createConversationCircle(input: {
  actor: SessionActor;
  title: string;
  description?: string;
  memberPersonIds: string[];
  memberGroupNames?: Record<string, string>;
}): Promise<{ circle: ConversationCircle; duplicate: boolean }> {
  const actorPersonId = normalize(input.actor.personId);
  const title = normalize(input.title) || "Family Group";
  const description = normalize(input.description);
  const members = uniquePersonIds([actorPersonId, ...input.memberPersonIds]);
  if (!actorPersonId || members.length < 2) {
    throw new Error("group_requires_at_least_two_people");
  }
  const signature = memberSignature(members);
  const memberGroupNames = input.memberGroupNames ?? {};
  return withConnection(async (rawConnection) => {
    const connection = rawConnection as DbConnection;
    await ensureShareTables(connection);

    const existing = await findCircleBySignature(connection, signature, members.length, actorPersonId);
    if (existing) {
      const membersByCircle = await listMembersForCircles(connection, [existing.circleId]);
      return { circle: { ...existing, members: membersByCircle.get(existing.circleId) ?? [] }, duplicate: true };
    }

    const createdAt = nowIso();
    const circleId = newId("circle");
    const audienceKey = groupAudienceKey(signature);
    try {
      await connection.execute(
        `INSERT INTO share_threads (
           thread_id,
           family_group_key,
           audience_type,
           audience_key,
           audience_label,
           group_description,
           owner_person_id,
           created_by_person_id,
           created_by_email,
           created_at,
           updated_at,
           last_post_at,
           thread_status
         ) VALUES (
           :circleId,
           :familyGroupKey,
           :audienceType,
           :audienceKey,
           :title,
           :description,
           :ownerPersonId,
           :createdByPersonId,
           :createdByEmail,
           :createdAt,
           :updatedAt,
           :lastPostAt,
           :threadStatus
         )`,
        {
          circleId,
          familyGroupKey: FAMAILINK_SHARE_KEY,
          audienceType: "person_group",
          audienceKey,
          title,
          description,
          ownerPersonId: actorPersonId,
          createdByPersonId: actorPersonId,
          createdByEmail: normalizeLower(input.actor.userEmail),
          createdAt,
          updatedAt: createdAt,
          lastPostAt: "",
          threadStatus: "active",
        },
        { autoCommit: false },
      );
      for (const memberPersonId of members) {
        await connection.execute(
          `INSERT INTO share_thread_members (
             thread_member_id,
             thread_id,
             family_group_key,
             person_id,
             group_display_name,
             member_role,
             joined_at,
             last_read_at,
             muted_until,
             is_active
           ) VALUES (
             :memberId,
             :circleId,
             :familyGroupKey,
             :personId,
             :groupDisplayName,
             :memberRole,
             :joinedAt,
             :lastReadAt,
             :mutedUntil,
             :isActive
           )`,
          {
            memberId: newId("ctm"),
            circleId,
            familyGroupKey: FAMAILINK_SHARE_KEY,
            personId: memberPersonId,
            groupDisplayName: normalize(memberGroupNames[memberPersonId]) || title,
            memberRole: memberPersonId === actorPersonId ? "owner" : "member",
            joinedAt: createdAt,
            lastReadAt: memberPersonId === actorPersonId ? createdAt : "",
            mutedUntil: "",
            isActive: "TRUE",
          },
          { autoCommit: false },
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }

    const created = await getConversationCircleForPerson(circleId, actorPersonId);
    if (!created) throw new Error("created_group_not_found");
    return { circle: created, duplicate: false };
  });
}

export async function deleteConversationCircle(input: {
  actor: SessionActor;
  circleId: string;
}) {
  const actorPersonId = normalize(input.actor.personId);
  const circleId = normalize(input.circleId);
  if (!actorPersonId || !circleId) throw new Error("group_not_found");

  return withConnection(async (rawConnection) => {
    const connection = rawConnection as DbConnection;
    await ensureShareTables(connection);
    const check = await connection.execute(
      `SELECT
         t.thread_id,
         t.owner_person_id,
         LOWER(TRIM(NVL(m.member_role, 'member'))) AS viewer_role
       FROM share_threads t
       INNER JOIN share_thread_members m
         ON TRIM(m.thread_id) = TRIM(t.thread_id)
       WHERE TRIM(t.thread_id) = :circleId
         AND TRIM(t.family_group_key) = :familyGroupKey
         AND LOWER(TRIM(NVL(t.audience_type, 'person_group'))) IN ('person_group', 'person_circle')
         AND LOWER(TRIM(NVL(t.thread_status, 'active'))) <> 'archived'
         AND TRIM(m.person_id) = :personId
         AND LOWER(TRIM(NVL(m.is_active, 'TRUE'))) <> 'false'
       FETCH FIRST 1 ROWS ONLY`,
      { circleId, familyGroupKey: FAMAILINK_SHARE_KEY, personId: actorPersonId },
      OUT_FORMAT,
    );
    const row = check.rows?.[0] ?? null;
    if (!row) throw new Error("group_not_found_or_not_member");
    const isOwner = getCell(row, "OWNER_PERSON_ID") === actorPersonId || normalizeLower(getCell(row, "VIEWER_ROLE")) === "owner";
    if (!isOwner) throw new Error("group_delete_requires_owner");

    const archivedAt = nowIso();
    const archivedAudienceKey = `archived:${circleId}:${Date.now()}`;
    try {
      await connection.execute(
        `UPDATE share_threads
         SET thread_status = 'archived',
             audience_key = :archivedAudienceKey,
             updated_at = :updatedAt
         WHERE TRIM(thread_id) = :circleId`,
        { archivedAudienceKey, updatedAt: archivedAt, circleId },
        { autoCommit: false },
      );
      await connection.execute(
        `UPDATE share_conversations
         SET conversation_status = 'archived',
             updated_at = :updatedAt,
             last_activity_at = COALESCE(NULLIF(TRIM(last_activity_at), ''), :updatedAt)
         WHERE TRIM(thread_id) = :circleId
           AND LOWER(TRIM(NVL(conversation_status, 'active'))) <> 'archived'`,
        { updatedAt: archivedAt, circleId },
        { autoCommit: false },
      );
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

export async function updateConversationCircleMemberName(input: {
  actor: SessionActor;
  circleId: string;
  title: string;
}): Promise<ConversationCircle> {
  const actorPersonId = normalize(input.actor.personId);
  const circleId = normalize(input.circleId);
  const title = normalize(input.title);
  if (!actorPersonId || !circleId) throw new Error("group_not_found");
  if (!title) throw new Error("group_name_required");

  return withConnection(async (rawConnection) => {
    const connection = rawConnection as DbConnection;
    await ensureShareTables(connection);
    const circle = await getConversationCircleForPerson(circleId, actorPersonId);
    if (!circle) throw new Error("group_not_found_or_not_member");

    await connection.execute(
      `UPDATE share_thread_members
       SET group_display_name = :title
       WHERE TRIM(thread_id) = :circleId
         AND TRIM(person_id) = :personId
         AND LOWER(TRIM(NVL(is_active, 'TRUE'))) <> 'false'`,
      { title, circleId: circle.circleId, personId: actorPersonId },
      { autoCommit: true },
    );

    const updated = await getConversationCircleForPerson(circle.circleId, actorPersonId);
    if (!updated) throw new Error("updated_group_not_found");
    return updated;
  });
}

export async function listCircleConversations(input: {
  circleId: string;
  personId: string;
}): Promise<CircleConversation[]> {
  const circle = await getConversationCircleForPerson(input.circleId, input.personId);
  if (!circle) return [];
  return withConnection(async (rawConnection) => {
    const connection = rawConnection as DbConnection;
    await ensureShareTables(connection);
    const result = await connection.execute(
      `SELECT
         c.conversation_id,
         c.thread_id,
         c.title,
         c.owner_person_id,
         c.created_by_person_id,
         c.created_by_email,
         c.created_at,
         c.updated_at,
         c.last_activity_at,
         cm.last_read_at AS member_last_read_at,
         (
           SELECT COUNT(*)
           FROM share_posts p
           WHERE TRIM(p.conversation_id) = TRIM(c.conversation_id)
             AND LOWER(TRIM(NVL(p.post_status, 'active'))) <> 'deleted'
             AND (
               NULLIF(TRIM(cm.last_read_at), '') IS NULL
               OR TRIM(p.created_at) > TRIM(cm.last_read_at)
             )
         ) +
         (
           SELECT COUNT(*)
           FROM share_post_comments sc
           INNER JOIN share_posts p
             ON TRIM(p.post_id) = TRIM(sc.post_id)
           WHERE TRIM(p.conversation_id) = TRIM(c.conversation_id)
             AND LOWER(TRIM(NVL(sc.comment_status, 'active'))) <> 'deleted'
             AND (
               NULLIF(TRIM(cm.last_read_at), '') IS NULL
               OR TRIM(sc.created_at) > TRIM(cm.last_read_at)
             )
         ) AS unread_count
       FROM share_conversation_members cm
       INNER JOIN share_conversations c
         ON TRIM(c.conversation_id) = TRIM(cm.conversation_id)
       WHERE TRIM(cm.thread_id) = :circleId
         AND TRIM(cm.person_id) = :personId
         AND LOWER(TRIM(NVL(cm.is_active, 'TRUE'))) <> 'false'
         AND LOWER(TRIM(NVL(c.conversation_status, 'active'))) <> 'archived'
       ORDER BY COALESCE(NULLIF(TRIM(c.last_activity_at), ''), NULLIF(TRIM(c.updated_at), ''), c.created_at) DESC,
                c.title`,
      { circleId: circle.circleId, personId: normalize(input.personId) },
      OUT_FORMAT,
    );
    return (result.rows ?? []).map(mapConversation);
  });
}

async function insertPost(
  connection: DbConnection,
  input: {
    circleId: string;
    conversationId: string;
    familyGroupKey: string;
    actor: SessionActor;
    caption: string;
    createdAt: string;
  },
) {
  const postId = newId("post");
  await connection.execute(
    `INSERT INTO share_posts (
       post_id,
       thread_id,
       conversation_id,
       family_group_key,
       file_id,
       caption_text,
       author_person_id,
       author_display_name,
       author_email,
       created_at,
       updated_at,
       post_status
     ) VALUES (
       :postId,
       :circleId,
       :conversationId,
       :familyGroupKey,
       :fileId,
       :captionText,
       :authorPersonId,
       :authorDisplayName,
       :authorEmail,
       :createdAt,
       :updatedAt,
       :postStatus
     )`,
    {
      postId,
      circleId: input.circleId,
      conversationId: input.conversationId,
      familyGroupKey: input.familyGroupKey,
      fileId: "",
      captionText: input.caption,
      authorPersonId: input.actor.personId,
      authorDisplayName: input.actor.username,
      authorEmail: normalizeLower(input.actor.userEmail),
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      postStatus: "active",
    },
    { autoCommit: false },
  );
  return postId;
}

export async function createCircleConversation(input: {
  actor: SessionActor;
  circleId: string;
  title: string;
  initialMessage?: string;
}): Promise<CircleConversation> {
  const actorPersonId = normalize(input.actor.personId);
  const title = normalize(input.title);
  if (!title) throw new Error("conversation_title_required");
  const circle = await getConversationCircleForPerson(input.circleId, actorPersonId);
  if (!circle) throw new Error("group_not_found_or_not_member");
  const memberIds = circle.members.map((member) => member.personId);
  const createdAt = nowIso();
  const conversationId = newId("conv");
  const initialMessage = normalize(input.initialMessage);

  return withConnection(async (rawConnection) => {
    const connection = rawConnection as DbConnection;
    await ensureShareTables(connection);
    try {
      await connection.execute(
        `INSERT INTO share_conversations (
           conversation_id,
           thread_id,
           family_group_key,
           title,
           conversation_kind,
           owner_person_id,
           created_by_person_id,
           created_by_email,
           created_at,
           updated_at,
           last_activity_at,
           conversation_status
         ) VALUES (
           :conversationId,
           :circleId,
           :familyGroupKey,
           :title,
           :conversationKind,
           :ownerPersonId,
           :createdByPersonId,
           :createdByEmail,
           :createdAt,
           :updatedAt,
           :lastActivityAt,
           :conversationStatus
         )`,
        {
          conversationId,
          circleId: circle.circleId,
          familyGroupKey: circle.familyGroupKey || FAMAILINK_SHARE_KEY,
          title,
          conversationKind: "topic",
          ownerPersonId: actorPersonId,
          createdByPersonId: actorPersonId,
          createdByEmail: normalizeLower(input.actor.userEmail),
          createdAt,
          updatedAt: createdAt,
          lastActivityAt: createdAt,
          conversationStatus: "active",
        },
        { autoCommit: false },
      );
      for (const memberPersonId of memberIds) {
        await connection.execute(
          `INSERT INTO share_conversation_members (
             conversation_member_id,
             conversation_id,
             thread_id,
             family_group_key,
             person_id,
             member_role,
             joined_at,
             last_read_at,
             is_active
           ) VALUES (
             :memberId,
             :conversationId,
             :circleId,
             :familyGroupKey,
             :personId,
             :memberRole,
             :joinedAt,
             :lastReadAt,
             :isActive
           )`,
          {
            memberId: newId("cvm"),
            conversationId,
            circleId: circle.circleId,
            familyGroupKey: circle.familyGroupKey || FAMAILINK_SHARE_KEY,
            personId: memberPersonId,
            memberRole: memberPersonId === actorPersonId ? "owner" : "member",
            joinedAt: createdAt,
            lastReadAt: memberPersonId === actorPersonId ? createdAt : "",
            isActive: "TRUE",
          },
          { autoCommit: false },
        );
      }
      if (initialMessage) {
        await insertPost(connection, {
          circleId: circle.circleId,
          conversationId,
          familyGroupKey: circle.familyGroupKey || FAMAILINK_SHARE_KEY,
          actor: input.actor,
          caption: initialMessage,
          createdAt,
        });
      }
      await connection.execute(
        `UPDATE share_threads
         SET updated_at = :updatedAt,
             last_post_at = :lastPostAt
         WHERE TRIM(thread_id) = :circleId`,
        { updatedAt: createdAt, lastPostAt: initialMessage ? createdAt : "", circleId: circle.circleId },
        { autoCommit: false },
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }

    const conversations = await listCircleConversations({ circleId: circle.circleId, personId: actorPersonId });
    const created = conversations.find((conversation) => conversation.conversationId === conversationId);
    if (!created) throw new Error("created_conversation_not_found");
    return created;
  });
}

async function getConversationForPerson(connection: DbConnection, input: { circleId: string; conversationId: string; personId: string }) {
  const result = await connection.execute(
    `SELECT
       c.conversation_id,
       c.thread_id,
       c.family_group_key,
       c.title,
       c.owner_person_id,
       c.created_by_person_id,
       c.created_by_email,
       c.created_at,
       c.updated_at,
       c.last_activity_at,
       cm.last_read_at AS member_last_read_at,
       0 AS unread_count
     FROM share_conversation_members cm
     INNER JOIN share_conversations c
       ON TRIM(c.conversation_id) = TRIM(cm.conversation_id)
     INNER JOIN share_threads t
       ON TRIM(t.thread_id) = TRIM(c.thread_id)
     WHERE TRIM(c.thread_id) = :circleId
       AND TRIM(c.conversation_id) = :conversationId
       AND TRIM(t.family_group_key) = :familyGroupKey
       AND LOWER(TRIM(NVL(t.audience_type, 'person_group'))) IN ('person_group', 'person_circle')
       AND TRIM(cm.person_id) = :personId
       AND LOWER(TRIM(NVL(cm.is_active, 'TRUE'))) <> 'false'
       AND LOWER(TRIM(NVL(c.conversation_status, 'active'))) <> 'archived'
       AND LOWER(TRIM(NVL(t.thread_status, 'active'))) <> 'archived'
     FETCH FIRST 1 ROWS ONLY`,
    {
      circleId: normalize(input.circleId),
      conversationId: normalize(input.conversationId),
      personId: normalize(input.personId),
      familyGroupKey: FAMAILINK_SHARE_KEY,
    },
    OUT_FORMAT,
  );
  const row = result.rows?.[0] ?? null;
  return row
    ? {
        ...mapConversation(row),
        familyGroupKey: getCell(row, "FAMILY_GROUP_KEY"),
      }
    : null;
}

export async function listConversationPosts(input: {
  circleId: string;
  conversationId: string;
  personId: string;
}): Promise<ConversationPost[]> {
  const viewerPersonId = normalize(input.personId);
  return withConnection(async (rawConnection) => {
    const connection = rawConnection as DbConnection;
    await ensureShareTables(connection);
    const conversation = await getConversationForPerson(connection, {
      circleId: input.circleId,
      conversationId: input.conversationId,
      personId: viewerPersonId,
    });
    if (!conversation) return [];
    const result = await connection.execute(
      `SELECT
         post_id,
         thread_id,
         conversation_id,
         family_group_key,
         file_id,
         caption_text,
         author_person_id,
         author_display_name,
         author_email,
         created_at,
         updated_at
       FROM share_posts
       WHERE TRIM(thread_id) = :circleId
         AND TRIM(conversation_id) = :conversationId
         AND LOWER(TRIM(NVL(post_status, 'active'))) <> 'deleted'
       ORDER BY created_at, post_id`,
      { circleId: conversation.circleId, conversationId: conversation.conversationId },
      OUT_FORMAT,
    );
    const posts = (result.rows ?? []).map(mapPost);
    const postIds = posts.map((post) => post.postId);
    if (!postIds.length) return posts;
    const binds: Record<string, unknown> = {};
    const inList = bindList("post", postIds, binds);
    const commentsResult = await connection.execute(
      `SELECT
         comment_id,
         post_id,
         parent_comment_id,
         author_person_id,
         author_display_name,
         author_email,
         comment_text,
         created_at,
         updated_at
       FROM share_post_comments
       WHERE TRIM(post_id) IN (${inList})
         AND LOWER(TRIM(NVL(comment_status, 'active'))) <> 'deleted'
       ORDER BY created_at, comment_id`,
      binds,
      OUT_FORMAT,
    );
    const commentsByPost = new Map<string, ConversationComment[]>();
    for (const row of commentsResult.rows ?? []) {
      const comment = mapComment(row);
      const comments = commentsByPost.get(comment.postId) ?? [];
      comments.push(comment);
      commentsByPost.set(comment.postId, comments);
    }
    return posts.map((post) => ({
      ...post,
      comments: commentsByPost.get(post.postId) ?? [],
    }));
  });
}

export async function createConversationPost(input: {
  actor: SessionActor;
  circleId: string;
  conversationId: string;
  caption: string;
}): Promise<ConversationPost> {
  const caption = normalize(input.caption);
  if (!caption) throw new Error("post_text_required");
  return withConnection(async (rawConnection) => {
    const connection = rawConnection as DbConnection;
    await ensureShareTables(connection);
    const conversation = await getConversationForPerson(connection, {
      circleId: input.circleId,
      conversationId: input.conversationId,
      personId: input.actor.personId,
    });
    if (!conversation) throw new Error("conversation_not_found_or_not_member");
    const createdAt = nowIso();
    let postId = "";
    try {
      postId = await insertPost(connection, {
        circleId: conversation.circleId,
        conversationId: conversation.conversationId,
        familyGroupKey: conversation.familyGroupKey || FAMAILINK_SHARE_KEY,
        actor: input.actor,
        caption,
        createdAt,
      });
      await connection.execute(
        `UPDATE share_conversations
         SET updated_at = :updatedAt,
             last_activity_at = :lastActivityAt
         WHERE TRIM(conversation_id) = :conversationId`,
        { updatedAt: createdAt, lastActivityAt: createdAt, conversationId: conversation.conversationId },
        { autoCommit: false },
      );
      await connection.execute(
        `UPDATE share_threads
         SET updated_at = :updatedAt,
             last_post_at = :lastPostAt
         WHERE TRIM(thread_id) = :circleId`,
        { updatedAt: createdAt, lastPostAt: createdAt, circleId: conversation.circleId },
        { autoCommit: false },
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
    const posts = await listConversationPosts({
      circleId: conversation.circleId,
      conversationId: conversation.conversationId,
      personId: input.actor.personId,
    });
    const created = posts.find((post) => post.postId === postId);
    if (!created) throw new Error("created_post_not_found");
    return created;
  });
}

export async function createConversationComment(input: {
  actor: SessionActor;
  circleId: string;
  conversationId: string;
  postId: string;
  commentText: string;
}): Promise<ConversationComment> {
  const commentText = normalize(input.commentText);
  if (!commentText) throw new Error("comment_text_required");
  return withConnection(async (rawConnection) => {
    const connection = rawConnection as DbConnection;
    await ensureShareTables(connection);
    const conversation = await getConversationForPerson(connection, {
      circleId: input.circleId,
      conversationId: input.conversationId,
      personId: input.actor.personId,
    });
    if (!conversation) throw new Error("conversation_not_found_or_not_member");
    const postCheck = await connection.execute(
      `SELECT post_id
       FROM share_posts
       WHERE TRIM(post_id) = :postId
         AND TRIM(thread_id) = :circleId
         AND TRIM(conversation_id) = :conversationId
         AND LOWER(TRIM(NVL(post_status, 'active'))) <> 'deleted'
       FETCH FIRST 1 ROWS ONLY`,
      { postId: normalize(input.postId), circleId: conversation.circleId, conversationId: conversation.conversationId },
      OUT_FORMAT,
    );
    if (!postCheck.rows?.[0]) throw new Error("post_not_found");

    const createdAt = nowIso();
    const commentId = newId("comment");
    try {
      await connection.execute(
        `INSERT INTO share_post_comments (
           comment_id,
           post_id,
           thread_id,
           family_group_key,
           parent_comment_id,
           author_person_id,
           author_display_name,
           author_email,
           comment_text,
           comment_status,
           created_at,
           updated_at,
           deleted_at
         ) VALUES (
           :commentId,
           :postId,
           :circleId,
           :familyGroupKey,
           :parentCommentId,
           :authorPersonId,
           :authorDisplayName,
           :authorEmail,
           :commentText,
           :commentStatus,
           :createdAt,
           :updatedAt,
           :deletedAt
         )`,
        {
          commentId,
          postId: normalize(input.postId),
          circleId: conversation.circleId,
          familyGroupKey: conversation.familyGroupKey || FAMAILINK_SHARE_KEY,
          parentCommentId: "",
          authorPersonId: input.actor.personId,
          authorDisplayName: input.actor.username,
          authorEmail: normalizeLower(input.actor.userEmail),
          commentText,
          commentStatus: "active",
          createdAt,
          updatedAt: createdAt,
          deletedAt: "",
        },
        { autoCommit: false },
      );
      await connection.execute(
        `UPDATE share_conversations
         SET updated_at = :updatedAt,
             last_activity_at = :lastActivityAt
         WHERE TRIM(conversation_id) = :conversationId`,
        { updatedAt: createdAt, lastActivityAt: createdAt, conversationId: conversation.conversationId },
        { autoCommit: false },
      );
      await connection.execute(
        `UPDATE share_threads
         SET updated_at = :updatedAt,
             last_post_at = :lastPostAt
         WHERE TRIM(thread_id) = :circleId`,
        { updatedAt: createdAt, lastPostAt: createdAt, circleId: conversation.circleId },
        { autoCommit: false },
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
    const posts = await listConversationPosts({
      circleId: conversation.circleId,
      conversationId: conversation.conversationId,
      personId: input.actor.personId,
    });
    const created = posts.flatMap((post) => post.comments).find((comment) => comment.commentId === commentId);
    if (!created) throw new Error("created_comment_not_found");
    return created;
  });
}

export async function markConversationRead(input: {
  circleId: string;
  conversationId: string;
  personId: string;
}) {
  const viewerPersonId = normalize(input.personId);
  return withConnection(async (rawConnection) => {
    const connection = rawConnection as DbConnection;
    await ensureShareTables(connection);
    const conversation = await getConversationForPerson(connection, {
      circleId: input.circleId,
      conversationId: input.conversationId,
      personId: viewerPersonId,
    });
    if (!conversation) return false;
    const readAt = nowIso();
    const result = await connection.execute(
      `UPDATE share_conversation_members
       SET last_read_at = :readAt
       WHERE TRIM(conversation_id) = :conversationId
         AND TRIM(person_id) = :personId`,
      { readAt, conversationId: conversation.conversationId, personId: viewerPersonId },
      { autoCommit: true },
    );
    return Boolean(result.rowsAffected);
  });
}

export async function listPersonConversationSummaries(input: {
  viewerPersonId: string;
  targetPersonIds: string[];
}): Promise<Record<string, PersonConversationSummary[]>> {
  const viewerPersonId = normalize(input.viewerPersonId);
  const targetIds = uniquePersonIds(input.targetPersonIds);
  if (!viewerPersonId || !targetIds.length) return {};
  return withConnection(async (rawConnection) => {
    const connection = rawConnection as DbConnection;
    await ensureShareTables(connection);
    const binds: Record<string, unknown> = { viewerPersonId, familyGroupKey: FAMAILINK_SHARE_KEY };
    const targetList = bindList("target", targetIds, binds);
    const result = await connection.execute(
      `SELECT *
       FROM (
         SELECT
           target_cm.person_id AS target_person_id,
           c.conversation_id,
           c.thread_id,
           c.title,
           c.last_activity_at,
           t.audience_label AS circle_title,
           (
             SELECT COUNT(*)
             FROM share_posts p
             WHERE TRIM(p.conversation_id) = TRIM(c.conversation_id)
               AND LOWER(TRIM(NVL(p.post_status, 'active'))) <> 'deleted'
               AND (
                 NULLIF(TRIM(viewer_cm.last_read_at), '') IS NULL
                 OR TRIM(p.created_at) > TRIM(viewer_cm.last_read_at)
               )
           ) +
           (
             SELECT COUNT(*)
             FROM share_post_comments sc
             INNER JOIN share_posts p
               ON TRIM(p.post_id) = TRIM(sc.post_id)
             WHERE TRIM(p.conversation_id) = TRIM(c.conversation_id)
               AND LOWER(TRIM(NVL(sc.comment_status, 'active'))) <> 'deleted'
               AND (
                 NULLIF(TRIM(viewer_cm.last_read_at), '') IS NULL
                 OR TRIM(sc.created_at) > TRIM(viewer_cm.last_read_at)
               )
           ) AS unread_count,
           ROW_NUMBER() OVER (
             PARTITION BY target_cm.person_id, c.conversation_id
             ORDER BY COALESCE(NULLIF(TRIM(c.last_activity_at), ''), NULLIF(TRIM(c.updated_at), ''), c.created_at) DESC
           ) AS rn
         FROM share_conversation_members target_cm
         INNER JOIN share_conversation_members viewer_cm
           ON TRIM(viewer_cm.conversation_id) = TRIM(target_cm.conversation_id)
          AND TRIM(viewer_cm.person_id) = :viewerPersonId
          AND LOWER(TRIM(NVL(viewer_cm.is_active, 'TRUE'))) <> 'false'
         INNER JOIN share_conversations c
           ON TRIM(c.conversation_id) = TRIM(target_cm.conversation_id)
         INNER JOIN share_threads t
           ON TRIM(t.thread_id) = TRIM(c.thread_id)
         WHERE TRIM(target_cm.person_id) IN (${targetList})
           AND LOWER(TRIM(NVL(target_cm.is_active, 'TRUE'))) <> 'false'
           AND LOWER(TRIM(NVL(c.conversation_status, 'active'))) <> 'archived'
           AND LOWER(TRIM(NVL(t.thread_status, 'active'))) <> 'archived'
           AND TRIM(t.family_group_key) = :familyGroupKey
           AND LOWER(TRIM(NVL(t.audience_type, 'person_group'))) IN ('person_group', 'person_circle')
       )
       WHERE rn = 1
       ORDER BY target_person_id, last_activity_at DESC, title`,
      binds,
      OUT_FORMAT,
    );
    const out: Record<string, PersonConversationSummary[]> = {};
    for (const row of result.rows ?? []) {
      const targetPersonId = getCell(row, "TARGET_PERSON_ID");
      const current = out[targetPersonId] ?? [];
      current.push({
        targetPersonId,
        conversationId: getCell(row, "CONVERSATION_ID"),
        circleId: getCell(row, "THREAD_ID"),
        circleTitle: getCell(row, "CIRCLE_TITLE") || "Family Group",
        title: getCell(row, "TITLE") || "Conversation",
        lastActivityAt: getCell(row, "LAST_ACTIVITY_AT"),
        unreadCount: getNumber(row, "UNREAD_COUNT"),
      });
      out[targetPersonId] = current.slice(0, 12);
    }
    return out;
  });
}
