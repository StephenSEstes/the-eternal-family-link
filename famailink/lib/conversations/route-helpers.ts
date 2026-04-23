import { NextResponse } from "next/server";
import type { FamailinkSession } from "@/lib/auth/session";

export function actorFromSession(session: FamailinkSession) {
  return {
    personId: session.personId,
    username: session.username,
    userEmail: session.userEmail,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalize(value: unknown) {
  return String(value ?? "").trim();
}

export function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => normalize(entry)).filter(Boolean);
}

export function readStringRecord(value: unknown) {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalize(key);
    const normalizedEntry = normalize(entry);
    if (!normalizedKey || !normalizedEntry) continue;
    out[normalizedKey] = normalizedEntry;
  }
  return out;
}

export function jsonError(error: unknown, fallback: string, status = 500) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status },
  );
}
