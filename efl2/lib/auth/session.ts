import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export type Unit1Session = {
  userEmail: string;
  username: string;
  personId: string;
  expiresAt: string;
};

const COOKIE_NAME = "efl2_session";
const TTL_SECONDS = 60 * 60 * 8;

function base64UrlEncode(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input: string) {
  return Buffer.from(input, "base64url");
}

function signingSecret() {
  const secret = (process.env.UNIT1_SESSION_SECRET ?? "").trim();
  if (!secret) {
    throw new Error("UNIT1_SESSION_SECRET is required.");
  }
  return secret;
}

function signPayload(payloadPart: string) {
  return createHmac("sha256", signingSecret()).update(payloadPart).digest("base64url");
}

function encodeSessionPayload(payload: Unit1Session) {
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(payloadPart);
  return `${payloadPart}.${signature}`;
}

function decodeSessionPayload(token: string): Unit1Session | null {
  const [payloadPart, signature] = token.split(".");
  if (!payloadPart || !signature) return null;
  const expected = signPayload(payloadPart);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }
  try {
    const payload = JSON.parse(base64UrlDecode(payloadPart).toString("utf8")) as Unit1Session;
    if (!payload.personId || !payload.username || !payload.expiresAt) return null;
    if (Date.parse(payload.expiresAt) <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function buildSession(user: { userEmail: string; username: string; personId: string }): Unit1Session {
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();
  return {
    userEmail: user.userEmail,
    username: user.username,
    personId: user.personId,
    expiresAt,
  };
}

export function setSessionCookie(response: NextResponse, session: Unit1Session) {
  const token = encodeSessionPayload(session);
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function getSessionFromRequest(request: NextRequest) {
  const raw = request.cookies.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return decodeSessionPayload(raw);
}

export async function getSessionFromCookieStore() {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return decodeSessionPayload(raw);
}

