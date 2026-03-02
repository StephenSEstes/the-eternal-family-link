import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth/options";
import { getFamilyGroupContext, getRequestFamilyGroupContext } from "@/lib/family-group/context";

export async function getAppSession() {
  return getServerSession(authOptions);
}

export async function requireSession() {
  const session = await getAppSession();
  if (!session?.user?.email) {
    redirect("/login");
  }
  return session;
}

export async function requireFamilyGroupSession(requestedTenantKey?: string) {
  const session = await requireSession();
  const tenant = requestedTenantKey
    ? getFamilyGroupContext(session, requestedTenantKey)
    : await getRequestFamilyGroupContext(session);
  return { session, tenant };
}

export const requireTenantSession = requireFamilyGroupSession;
