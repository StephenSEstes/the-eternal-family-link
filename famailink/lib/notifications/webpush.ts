import "server-only";

import webpush from "web-push";

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag?: string;
  notificationId?: string;
};

export type PushDeliverySubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

function normalize(value?: unknown) {
  return String(value ?? "").trim();
}

function currentConfig() {
  return {
    publicKey: normalize(process.env.FAMAILINK_WEB_PUSH_PUBLIC_KEY),
    privateKey: normalize(process.env.FAMAILINK_WEB_PUSH_PRIVATE_KEY),
    subject: normalize(process.env.FAMAILINK_WEB_PUSH_SUBJECT),
  };
}

export function isWebPushConfigured() {
  const config = currentConfig();
  return Boolean(config.publicKey && config.privateKey && config.subject);
}

export function getWebPushPublicKey() {
  return currentConfig().publicKey;
}

function ensureWebPushConfigured() {
  const config = currentConfig();
  if (!config.publicKey || !config.privateKey || !config.subject) {
    throw new Error("web_push_not_configured");
  }
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  return config;
}

export async function sendWebPushMessage(subscription: PushDeliverySubscription, payload: PushPayload) {
  ensureWebPushConfigured();
  return webpush.sendNotification(
    {
      endpoint: normalize(subscription.endpoint),
      keys: {
        p256dh: normalize(subscription.p256dh),
        auth: normalize(subscription.auth),
      },
    },
    JSON.stringify(payload),
    {
      TTL: 60 * 60,
      urgency: "normal",
    },
  );
}

export function isExpiredPushSubscriptionError(error: unknown) {
  const statusCode = Number(
    (error as { statusCode?: number; status_code?: number } | null)?.statusCode ??
      (error as { statusCode?: number; status_code?: number } | null)?.status_code ??
      0,
  );
  return statusCode === 404 || statusCode === 410;
}

export function summarizePushError(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 1800);
  }
  return String(error ?? "push_send_failed").slice(0, 1800);
}
