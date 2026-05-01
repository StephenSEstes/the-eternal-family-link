import "server-only";

import { createHash, randomUUID } from "node:crypto";
import oracledb from "oracledb";
import { getConversationCircleForPerson, listCircleConversations } from "@/lib/conversations/store";
import { withConnection } from "@/lib/oci/client";
import {
  getWebPushPublicKey,
  isExpiredPushSubscriptionError,
  isWebPushConfigured,
  sendWebPushMessage,
  summarizePushError,
  type PushPayload,
} from "@/lib/notifications/webpush";

const OUT_FORMAT = { outFormat: oracledb.OUT_FORMAT_OBJECT };
const FAMAILINK_SHARE_KEY = "famailink-person";
const DEFAULT_RETRY_SECONDS = 300;

let notificationTablesEnsured = false;

type DbConnection = {
  execute: (
    sql: string,
    binds?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<{ rows?: Record<string, unknown>[]; rowsAffected?: number }>;
  commit: () => Promise<void>;
};

type SessionActor = {
  personId: string;
  username: string;
  userEmail: string;
};

type PushSubscriptionRow = {
  subscriptionId: string;
  familyGroupKey: string;
  personId: string;
  userEmail: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceLabel: string;
  userAgent: string;
  lastSeenAt: string;
  createdAt: string;
  isActive: boolean;
};

type NotificationOutboxRow = {
  notificationId: string;
  familyGroupKey: string;
  personId: string;
  userEmail: string;
  channel: string;
  eventType: string;
  entityType: string;
  entityId: string;
  payloadJson: string;
  status: string;
  attemptCount: number;
  nextAttemptAt: string;
  lastError: string;
  createdAt: string;
  sentAt: string;
};

function normalize(value?: unknown) {
  return String(value ?? "").trim();
}

function normalizeLower(value?: unknown) {
  return normalize(value).toLowerCase();
}

function getCell(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return value === undefined || value === null ? "" : String(value).trim();
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

function buildSubscriptionId(endpoint: string, personId: string) {
  const seed = `${normalizeLower(endpoint)}|${normalizeLower(personId)}`;
  return `psub-${createHash("sha1").update(seed).digest("hex").slice(0, 24)}`;
}

function buildNotificationUrl(circleId: string, conversationId: string) {
  const params = new URLSearchParams();
  if (normalize(circleId)) params.set("circleId", normalize(circleId));
  if (normalize(circleId) && normalize(conversationId)) params.set("conversationId", normalize(conversationId));
  const query = params.toString();
  return query ? `/conversations?${query}` : "/conversations";
}

function truncateForNotification(value: string, max = 140) {
  const normalized = normalize(value).replace(/\s+/g, " ");
  if (!normalized) return "";
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function nextAttemptIso(delaySeconds = DEFAULT_RETRY_SECONDS) {
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

function isCompatibleDdlError(message: string) {
  return /ORA-00955|ORA-01408|ORA-01430|ORA-01442|name is already used|such column list already indexed/i.test(message);
}

function isColumnAlreadyCompatibleError(message: string) {
  return /ORA-01430|ORA-01442|duplicate column name|column already exists/i.test(message);
}

async function tryExecuteDdl(connection: DbConnection, sql: string) {
  try {
    await connection.execute(sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isCompatibleDdlError(message)) throw error;
  }
}

async function ensureNotificationTables(connection: DbConnection) {
  if (notificationTablesEnsured) return;

  await tryExecuteDdl(
    connection,
    `CREATE TABLE push_subscriptions (
       subscription_id VARCHAR2(128) PRIMARY KEY,
       family_group_key VARCHAR2(128) NOT NULL,
       person_id VARCHAR2(128) NOT NULL,
       user_email VARCHAR2(320),
       endpoint VARCHAR2(2000) NOT NULL,
       p256dh VARCHAR2(2000),
       auth VARCHAR2(1024),
       device_label VARCHAR2(256),
       user_agent VARCHAR2(2000),
       last_seen_at VARCHAR2(64),
       created_at VARCHAR2(64),
       is_active VARCHAR2(8)
     )`,
  );

  for (const columnSql of [
    "family_group_key VARCHAR2(128)",
    "person_id VARCHAR2(128)",
    "user_email VARCHAR2(320)",
    "endpoint VARCHAR2(2000)",
    "p256dh VARCHAR2(2000)",
    "auth VARCHAR2(1024)",
    "device_label VARCHAR2(256)",
    "user_agent VARCHAR2(2000)",
    "last_seen_at VARCHAR2(64)",
    "created_at VARCHAR2(64)",
    "is_active VARCHAR2(8)",
  ]) {
    try {
      await connection.execute(`ALTER TABLE push_subscriptions ADD (${columnSql})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isColumnAlreadyCompatibleError(message)) throw error;
    }
  }

  await tryExecuteDdl(connection, "CREATE UNIQUE INDEX ux_push_subscriptions_endpoint ON push_subscriptions(endpoint)");
  await tryExecuteDdl(connection, "CREATE INDEX ix_push_subscriptions_person ON push_subscriptions(family_group_key, person_id, is_active)");

  await tryExecuteDdl(
    connection,
    `CREATE TABLE notification_outbox (
       notification_id VARCHAR2(128) PRIMARY KEY,
       family_group_key VARCHAR2(128) NOT NULL,
       person_id VARCHAR2(128) NOT NULL,
       user_email VARCHAR2(320),
       channel VARCHAR2(32),
       event_type VARCHAR2(64),
       entity_type VARCHAR2(64),
       entity_id VARCHAR2(256),
       payload_json CLOB,
       status VARCHAR2(32),
       attempt_count NUMBER,
       next_attempt_at VARCHAR2(64),
       last_error VARCHAR2(2000),
       created_at VARCHAR2(64),
       sent_at VARCHAR2(64)
     )`,
  );

  for (const columnSql of [
    "family_group_key VARCHAR2(128)",
    "person_id VARCHAR2(128)",
    "user_email VARCHAR2(320)",
    "channel VARCHAR2(32)",
    "event_type VARCHAR2(64)",
    "entity_type VARCHAR2(64)",
    "entity_id VARCHAR2(256)",
    "payload_json CLOB",
    "status VARCHAR2(32)",
    "attempt_count NUMBER",
    "next_attempt_at VARCHAR2(64)",
    "last_error VARCHAR2(2000)",
    "created_at VARCHAR2(64)",
    "sent_at VARCHAR2(64)",
  ]) {
    try {
      await connection.execute(`ALTER TABLE notification_outbox ADD (${columnSql})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isColumnAlreadyCompatibleError(message)) throw error;
    }
  }

  await tryExecuteDdl(connection, "CREATE INDEX ix_notification_outbox_status ON notification_outbox(status, next_attempt_at, created_at)");
  await tryExecuteDdl(connection, "CREATE INDEX ix_notification_outbox_person ON notification_outbox(family_group_key, person_id, created_at)");

  await connection.commit();
  notificationTablesEnsured = true;
}

function mapPushSubscription(row: Record<string, unknown>): PushSubscriptionRow {
  return {
    subscriptionId: getCell(row, "SUBSCRIPTION_ID"),
    familyGroupKey: getCell(row, "FAMILY_GROUP_KEY"),
    personId: getCell(row, "PERSON_ID"),
    userEmail: getCell(row, "USER_EMAIL"),
    endpoint: getCell(row, "ENDPOINT"),
    p256dh: getCell(row, "P256DH"),
    auth: getCell(row, "AUTH"),
    deviceLabel: getCell(row, "DEVICE_LABEL"),
    userAgent: getCell(row, "USER_AGENT"),
    lastSeenAt: getCell(row, "LAST_SEEN_AT"),
    createdAt: getCell(row, "CREATED_AT"),
    isActive: normalizeLower(getCell(row, "IS_ACTIVE")) !== "false",
  };
}

function mapNotificationOutbox(row: Record<string, unknown>): NotificationOutboxRow {
  return {
    notificationId: getCell(row, "NOTIFICATION_ID"),
    familyGroupKey: getCell(row, "FAMILY_GROUP_KEY"),
    personId: getCell(row, "PERSON_ID"),
    userEmail: getCell(row, "USER_EMAIL"),
    channel: getCell(row, "CHANNEL"),
    eventType: getCell(row, "EVENT_TYPE"),
    entityType: getCell(row, "ENTITY_TYPE"),
    entityId: getCell(row, "ENTITY_ID"),
    payloadJson: getCell(row, "PAYLOAD_JSON"),
    status: getCell(row, "STATUS"),
    attemptCount: getNumber(row, "ATTEMPT_COUNT"),
    nextAttemptAt: getCell(row, "NEXT_ATTEMPT_AT"),
    lastError: getCell(row, "LAST_ERROR"),
    createdAt: getCell(row, "CREATED_AT"),
    sentAt: getCell(row, "SENT_AT"),
  };
}

export function getPushSupportStatus() {
  const publicKey = getWebPushPublicKey();
  return {
    supported: Boolean(publicKey && isWebPushConfigured()),
    publicKey,
  };
}

export async function listActivePushSubscriptionsForPerson(personId: string) {
  const normalizedPersonId = normalize(personId);
  if (!normalizedPersonId) return [] as PushSubscriptionRow[];
  return withConnection(async (rawConnection) => {
    const connection = rawConnection as DbConnection;
    await ensureNotificationTables(connection);
    const result = await connection.execute(
      `SELECT
         subscription_id,
         family_group_key,
         person_id,
         user_email,
         endpoint,
         p256dh,
         auth,
         device_label,
         user_agent,
         last_seen_at,
         created_at,
         is_active
       FROM push_subscriptions
       WHERE LOWER(TRIM(family_group_key)) = :familyGroupKey
         AND TRIM(person_id) = :personId
         AND LOWER(TRIM(NVL(is_active, 'TRUE'))) <> 'false'
       ORDER BY created_at DESC`,
      {
        familyGroupKey: FAMAILINK_SHARE_KEY,
        personId: normalizedPersonId,
      },
      OUT_FORMAT,
    );
    return (result.rows ?? []).map(mapPushSubscription);
  });
}

export async function upsertPushSubscription(input: {
  personId: string;
  userEmail?: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceLabel?: string;
  userAgent?: string;
}) {
  const personId = normalize(input.personId);
  const endpoint = normalize(input.endpoint);
  if (!personId || !endpoint) {
    throw new Error("person_id_and_endpoint_required");
  }

  const now = nowIso();
  const subscriptionId = buildSubscriptionId(endpoint, personId);
  return withConnection(async (rawConnection) => {
    const connection = rawConnection as DbConnection;
    await ensureNotificationTables(connection);
    await connection.execute(
      `MERGE INTO push_subscriptions target
       USING (
         SELECT
           :subscriptionId AS subscription_id,
           :familyGroupKey AS family_group_key,
           :personId AS person_id,
           :userEmail AS user_email,
           :endpoint AS endpoint,
           :p256dh AS p256dh,
           :auth AS auth,
           :deviceLabel AS device_label,
           :userAgent AS user_agent,
           :lastSeenAt AS last_seen_at,
           :createdAt AS created_at,
           :isActive AS is_active
         FROM dual
       ) source
       ON (TRIM(target.endpoint) = TRIM(source.endpoint))
       WHEN MATCHED THEN UPDATE SET
         target.family_group_key = source.family_group_key,
         target.person_id = source.person_id,
         target.user_email = source.user_email,
         target.p256dh = source.p256dh,
         target.auth = source.auth,
         target.device_label = source.device_label,
         target.user_agent = source.user_agent,
         target.last_seen_at = source.last_seen_at,
         target.is_active = source.is_active
       WHEN NOT MATCHED THEN INSERT (
         subscription_id,
         family_group_key,
         person_id,
         user_email,
         endpoint,
         p256dh,
         auth,
         device_label,
         user_agent,
         last_seen_at,
         created_at,
         is_active
       ) VALUES (
         source.subscription_id,
         source.family_group_key,
         source.person_id,
         source.user_email,
         source.endpoint,
         source.p256dh,
         source.auth,
         source.device_label,
         source.user_agent,
         source.last_seen_at,
         source.created_at,
         source.is_active
       )`,
      {
        subscriptionId,
        familyGroupKey: FAMAILINK_SHARE_KEY,
        personId,
        userEmail: normalizeLower(input.userEmail) || null,
        endpoint,
        p256dh: normalize(input.p256dh) || null,
        auth: normalize(input.auth) || null,
        deviceLabel: normalize(input.deviceLabel) || null,
        userAgent: normalize(input.userAgent) || null,
        lastSeenAt: now,
        createdAt: now,
        isActive: "TRUE",
      },
      { autoCommit: true },
    );

    const subscriptions = await listActivePushSubscriptionsForPerson(personId);
    const saved = subscriptions.find((entry) => entry.endpoint === endpoint);
    if (!saved) throw new Error("push_subscription_save_failed");
    return saved;
  });
}

export async function deactivatePushSubscriptionByEndpoint(input: { personId: string; endpoint: string }) {
  const personId = normalize(input.personId);
  const endpoint = normalize(input.endpoint);
  if (!personId || !endpoint) return false;
  return withConnection(async (rawConnection) => {
    const connection = rawConnection as DbConnection;
    await ensureNotificationTables(connection);
    const result = await connection.execute(
      `UPDATE push_subscriptions
       SET is_active = 'FALSE'
       WHERE LOWER(TRIM(family_group_key)) = :familyGroupKey
         AND TRIM(person_id) = :personId
         AND TRIM(endpoint) = :endpoint`,
      {
        familyGroupKey: FAMAILINK_SHARE_KEY,
        personId,
        endpoint,
      },
      { autoCommit: true },
    );
    return Boolean(result.rowsAffected);
  });
}

async function createNotificationOutboxEntries(input: Array<{
  notificationId: string;
  personId: string;
  userEmail?: string;
  eventType: string;
  entityType: string;
  entityId: string;
  payloadJson: string;
  createdAt: string;
}>) {
  if (!input.length) return 0;
  return withConnection(async (rawConnection) => {
    const connection = rawConnection as DbConnection;
    await ensureNotificationTables(connection);
    let inserted = 0;
    for (const item of input) {
      try {
        await connection.execute(
          `INSERT INTO notification_outbox (
             notification_id,
             family_group_key,
             person_id,
             user_email,
             channel,
             event_type,
             entity_type,
             entity_id,
             payload_json,
             status,
             attempt_count,
             next_attempt_at,
             last_error,
             created_at,
             sent_at
           ) VALUES (
             :notificationId,
             :familyGroupKey,
             :personId,
             :userEmail,
             :channel,
             :eventType,
             :entityType,
             :entityId,
             :payloadJson,
             :status,
             :attemptCount,
             :nextAttemptAt,
             :lastError,
             :createdAt,
             :sentAt
           )`,
          {
            notificationId: normalize(item.notificationId),
            familyGroupKey: FAMAILINK_SHARE_KEY,
            personId: normalize(item.personId),
            userEmail: normalizeLower(item.userEmail) || null,
            channel: "webpush",
            eventType: normalizeLower(item.eventType) || "share_update",
            entityType: normalizeLower(item.entityType) || "share_post",
            entityId: normalize(item.entityId),
            payloadJson: normalize(item.payloadJson) || "{}",
            status: "pending",
            attemptCount: 0,
            nextAttemptAt: null,
            lastError: null,
            createdAt: normalize(item.createdAt) || nowIso(),
            sentAt: null,
          },
          { autoCommit: false },
        );
        inserted += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/ORA-00001/i.test(message)) throw error;
      }
    }
    await connection.commit();
    return inserted;
  });
}

async function getPendingNotificationOutbox(limit = 50) {
  return withConnection(async (rawConnection) => {
    const connection = rawConnection as DbConnection;
    await ensureNotificationTables(connection);
    const result = await connection.execute(
      `SELECT * FROM (
         SELECT
           notification_id,
           family_group_key,
           person_id,
           user_email,
           channel,
           event_type,
           entity_type,
           entity_id,
           payload_json,
           status,
           attempt_count,
           next_attempt_at,
           last_error,
           created_at,
           sent_at
         FROM notification_outbox
         WHERE LOWER(TRIM(NVL(status, 'pending'))) = 'pending'
           AND LOWER(TRIM(NVL(channel, 'webpush'))) = 'webpush'
           AND LOWER(TRIM(family_group_key)) = :familyGroupKey
           AND (
             NULLIF(TRIM(next_attempt_at), '') IS NULL
             OR TRIM(next_attempt_at) <= :nowIso
           )
         ORDER BY created_at, notification_id
       )
       WHERE ROWNUM <= :limit`,
      {
        familyGroupKey: FAMAILINK_SHARE_KEY,
        nowIso: nowIso(),
        limit: Math.max(1, Math.min(200, Math.trunc(limit))),
      },
      OUT_FORMAT,
    );
    return (result.rows ?? []).map(mapNotificationOutbox);
  });
}

async function markNotificationOutboxSent(notificationId: string) {
  const normalized = normalize(notificationId);
  if (!normalized) return false;
  return withConnection(async (rawConnection) => {
    const connection = rawConnection as DbConnection;
    await ensureNotificationTables(connection);
    const result = await connection.execute(
      `UPDATE notification_outbox
       SET status = 'sent',
           sent_at = :sentAt,
           last_error = NULL
       WHERE TRIM(notification_id) = :notificationId`,
      {
        notificationId: normalized,
        sentAt: nowIso(),
      },
      { autoCommit: true },
    );
    return Boolean(result.rowsAffected);
  });
}

async function markNotificationOutboxFailed(notificationId: string, errorMessage: string) {
  const normalized = normalize(notificationId);
  if (!normalized) return false;
  return withConnection(async (rawConnection) => {
    const connection = rawConnection as DbConnection;
    await ensureNotificationTables(connection);
    const result = await connection.execute(
      `UPDATE notification_outbox
       SET status = 'pending',
           attempt_count = NVL(attempt_count, 0) + 1,
           next_attempt_at = :nextAttemptAt,
           last_error = :lastError
       WHERE TRIM(notification_id) = :notificationId`,
      {
        notificationId: normalized,
        nextAttemptAt: nextAttemptIso(),
        lastError: truncateForNotification(errorMessage, 1800),
      },
      { autoCommit: true },
    );
    return Boolean(result.rowsAffected);
  });
}

function buildConversationNotificationPayload(input: {
  actor: SessionActor;
  circleTitle: string;
  conversationTitle: string;
  circleId: string;
  conversationId: string;
  eventType: string;
  previewText: string;
  notificationId: string;
}): PushPayload {
  const actorName = normalize(input.actor.username) || "Someone";
  const conversationTitle = normalize(input.conversationTitle) || "Conversation";
  const circleTitle = normalize(input.circleTitle) || "Family Group";
  const preview = truncateForNotification(input.previewText);
  if (input.eventType === "conversation_created") {
    return {
      title: `${conversationTitle} · ${circleTitle}`,
      body: preview ? `${actorName} started a conversation: ${preview}` : `${actorName} started a new conversation.`,
      url: buildNotificationUrl(input.circleId, input.conversationId),
      tag: `conversation:${input.conversationId}`,
      notificationId: input.notificationId,
    };
  }
  if (input.eventType === "comment_posted") {
    return {
      title: `${conversationTitle} · ${circleTitle}`,
      body: preview ? `${actorName} commented: ${preview}` : `${actorName} added a comment.`,
      url: buildNotificationUrl(input.circleId, input.conversationId),
      tag: `conversation:${input.conversationId}`,
      notificationId: input.notificationId,
    };
  }
  return {
    title: `${conversationTitle} · ${circleTitle}`,
    body: preview ? `${actorName}: ${preview}` : `${actorName} posted a new message.`,
    url: buildNotificationUrl(input.circleId, input.conversationId),
    tag: `conversation:${input.conversationId}`,
    notificationId: input.notificationId,
  };
}

export async function queueConversationActivityNotifications(input: {
  actor: SessionActor;
  circleId: string;
  conversationId: string;
  eventType: "conversation_created" | "message_posted" | "comment_posted";
  entityType: "share_conversation" | "share_post" | "share_comment";
  entityId: string;
  previewText: string;
}) {
  const circle = await getConversationCircleForPerson(input.circleId, input.actor.personId);
  if (!circle) return 0;
  const conversations = await listCircleConversations({
    circleId: input.circleId,
    personId: input.actor.personId,
  });
  const conversation = conversations.find((entry) => entry.conversationId === normalize(input.conversationId));
  if (!conversation) return 0;

  const createdAt = nowIso();
  const entries = circle.members
    .filter((member) => normalize(member.personId) && normalize(member.personId) !== normalize(input.actor.personId))
    .map((member) => {
      const notificationId = newId("notif");
      const payload = buildConversationNotificationPayload({
        actor: input.actor,
        circleTitle: circle.title,
        conversationTitle: conversation.title,
        circleId: circle.circleId,
        conversationId: conversation.conversationId,
        eventType: input.eventType,
        previewText: input.previewText,
        notificationId,
      });
      return {
        notificationId,
        personId: member.personId,
        eventType: input.eventType,
        entityType: input.entityType,
        entityId: input.entityId,
        payloadJson: JSON.stringify(payload),
        createdAt,
      };
    });

  return createNotificationOutboxEntries(entries);
}

export async function dispatchPendingPushNotifications(limit = 50) {
  if (!isWebPushConfigured()) {
    return { configured: false, processed: 0, sent: 0, failed: 0 };
  }

  const pending = await getPendingNotificationOutbox(limit);
  let sent = 0;
  let failed = 0;

  for (const entry of pending) {
    let payload: PushPayload;
    try {
      payload = JSON.parse(entry.payloadJson || "{}") as PushPayload;
      if (!normalize(payload.title) || !normalize(payload.body) || !normalize(payload.url)) {
        throw new Error("invalid_push_payload");
      }
    } catch (error) {
      await markNotificationOutboxFailed(entry.notificationId, summarizePushError(error));
      failed += 1;
      continue;
    }

    const subscriptions = await listActivePushSubscriptionsForPerson(entry.personId);
    if (!subscriptions.length) {
      await markNotificationOutboxSent(entry.notificationId);
      sent += 1;
      continue;
    }

    let delivered = false;
    let transientError = "";

    for (const subscription of subscriptions) {
      try {
        await sendWebPushMessage(
          {
            endpoint: subscription.endpoint,
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
          payload,
        );
        delivered = true;
      } catch (error) {
        if (isExpiredPushSubscriptionError(error)) {
          await deactivatePushSubscriptionByEndpoint({
            personId: subscription.personId,
            endpoint: subscription.endpoint,
          });
          continue;
        }
        transientError = summarizePushError(error);
      }
    }

    if (!delivered && transientError) {
      await markNotificationOutboxFailed(entry.notificationId, transientError);
      failed += 1;
      continue;
    }

    await markNotificationOutboxSent(entry.notificationId);
    sent += 1;
  }

  return {
    configured: true,
    processed: pending.length,
    sent,
    failed,
  };
}
