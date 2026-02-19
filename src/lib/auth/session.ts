import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth/options";

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