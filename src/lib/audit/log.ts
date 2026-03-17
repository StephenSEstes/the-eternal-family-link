import "server-only";

import { appendAuditLog, type AuditLogInput } from "@/lib/data/runtime";

type AuditSessionLike = {
  user?: {
    email?: string | null;
    person_id?: string | null;
  };
} | null | undefined;

function localUsernameFromEmail(email?: string | null) {
  const normalized = String(email ?? "").trim().toLowerCase();
  return normalized.endsWith("@local") ? normalized.slice(0, -6) : "";
}

export function getSessionAuditActor(session: AuditSessionLike) {
  return {
    actorEmail: session?.user?.email ?? "",
    actorUsername: localUsernameFromEmail(session?.user?.email),
    actorPersonId: session?.user?.person_id ?? "",
  };
}

export async function appendSessionAuditLog(session: AuditSessionLike, input: AuditLogInput) {
  await appendAuditLog({
    ...getSessionAuditActor(session),
    ...input,
  }).catch(() => undefined);
}
