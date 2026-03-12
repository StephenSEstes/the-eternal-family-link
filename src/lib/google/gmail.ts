import "server-only";

import { Buffer } from "node:buffer";
import { google } from "googleapis";
import { getEnv } from "@/lib/env";

type GmailConfig = {
  senderEmail: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

let oauthClient: InstanceType<typeof google.auth.OAuth2> | null = null;
let oauthClientCacheKey = "";

function getGmailConfig(): GmailConfig | null {
  const env = getEnv();
  const senderEmail = env.GMAIL_SENDER_EMAIL?.trim() ?? "";
  const clientId = env.GMAIL_OAUTH_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GMAIL_OAUTH_CLIENT_SECRET?.trim() ?? "";
  const refreshToken = env.GMAIL_REFRESH_TOKEN?.trim() ?? "";
  if (!senderEmail || !clientId || !clientSecret || !refreshToken) {
    return null;
  }
  return {
    senderEmail,
    clientId,
    clientSecret,
    refreshToken,
  };
}

function sanitizeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function getGmailAuthClient(config: GmailConfig) {
  const cacheKey = `${config.senderEmail}|${config.clientId}|${config.refreshToken}`;
  if (oauthClient && oauthClientCacheKey === cacheKey) {
    return oauthClient;
  }

  oauthClient = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    "https://developers.google.com/oauthplayground",
  );
  oauthClient.setCredentials({ refresh_token: config.refreshToken });
  oauthClientCacheKey = cacheKey;
  return oauthClient;
}

export function isGmailSendingConfigured() {
  return getGmailConfig() !== null;
}

export async function sendPlainTextEmail(input: { to: string; subject: string; text: string }) {
  const config = getGmailConfig();
  if (!config) {
    throw new Error("Outbound Gmail is not configured.");
  }

  const auth = getGmailAuthClient(config);
  const gmail = google.gmail({ version: "v1", auth });
  const rawMessage = [
    `From: The Eternal Family Link <${sanitizeHeader(config.senderEmail)}>`,
    `To: ${sanitizeHeader(input.to)}`,
    `Subject: ${sanitizeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    input.text.replace(/\r?\n/g, "\r\n"),
  ].join("\r\n");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: Buffer.from(rawMessage, "utf8").toString("base64url"),
    },
  });
}
