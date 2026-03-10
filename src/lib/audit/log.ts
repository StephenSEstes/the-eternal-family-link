import "server-only";

import { appendAuditLog, type AuditLogInput } from "@/lib/data/runtime";

type AuditSessionLike = {
  user?: {
    email?: string | null;
    person_id?: string | null;
  };
} | null | undefined;

export function getSessionAuditActor(session: AuditSessionLike) {
  return {
    actorEmail: session?.user?.email ?? "",
    actorPersonId: session?.user?.person_id ?? "",
  };
}

export async function appendSessionAuditLog(session: AuditSessionLike, input: AuditLogInput) {
  await appendAuditLog({
    ...getSessionAuditActor(session),
    ...input,
  }).catch(() => undefined);
}
