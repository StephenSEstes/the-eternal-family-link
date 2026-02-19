import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth/options";
import { getTenantContext } from "@/lib/tenant/context";

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

export async function requireTenantSession() {
  const session = await requireSession();
  const tenant = getTenantContext(session);
  return { session, tenant };
}
