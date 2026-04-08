import "server-only";

import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { runViewerRecompute } from "@/lib/u1/access-resolver";

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function actorPersonIdFromSession(session: Session | null): string {
  return normalize(session?.user?.person_id ?? session?.user?.tenantAccesses?.[0]?.personId ?? "");
}

export async function requireU1Actor() {
  const session = await getAppSession();
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const actorPersonId = actorPersonIdFromSession(session);
  if (!actorPersonId) {
    return { error: NextResponse.json({ error: "missing_actor_person_id" }, { status: 400 }) };
  }
  return { session, actorPersonId };
}

export function triggerViewerRecompute(viewerPersonId: string, reason: string) {
  const normalizedViewer = normalize(viewerPersonId);
  const normalizedReason = normalize(reason) || "settings_update";
  if (!normalizedViewer) return;
  void runViewerRecompute({
    viewerPersonId: normalizedViewer,
    reason: normalizedReason,
  }).catch((error) => {
    console.error("[u1][recompute] failed", {
      viewerPersonId: normalizedViewer,
      reason: normalizedReason,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
