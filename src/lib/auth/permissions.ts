import type { Session } from "next-auth";

export function canEditPerson(session: Session | null, personId: string) {
  if (!session?.user) {
    return false;
  }

  return session.user.role === "ADMIN" || session.user.person_id === personId;
}