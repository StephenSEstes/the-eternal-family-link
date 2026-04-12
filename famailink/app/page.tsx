import { redirect } from "next/navigation";
import { getSessionFromCookieStore } from "@/lib/auth/session";

export default async function HomePage() {
  const session = await getSessionFromCookieStore();
  redirect(session ? "/tree" : "/login");
}
