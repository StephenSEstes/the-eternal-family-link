import type { Session } from "next-auth";
import type { TenantContext } from "@/lib/tenant/context";

export function canEditPerson(session: Session | null, personId: string, tenant?: TenantContext) {
  if (!session?.user && !tenant) {
    return false;
  }

  if (tenant) {
    return tenant.role === "ADMIN" || tenant.personId === personId;
  }

  return session?.user?.role === "ADMIN" || session?.user?.person_id === personId;
}
