import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth/options";
import { getRequestFamilyGroupContext } from "@/lib/family-group/context";

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

export async function requireFamilyGroupSession() {
  const session = await requireSession();
  const tenant = await getRequestFamilyGroupContext(session);
  return { session, tenant };
}

export const requireTenantSession = requireFamilyGroupSession;
