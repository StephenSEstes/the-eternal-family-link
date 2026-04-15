import { redirect } from "next/navigation";
import { RulesTreeClient } from "@/components/RulesTreeClient";
import { getSessionFromCookieStore } from "@/lib/auth/session";

export default async function RulesTreePage() {
  const session = await getSessionFromCookieStore();
  if (!session) {
    redirect("/login");
  }

  return (
    <RulesTreeClient
      session={{
        username: session.username,
        personId: session.personId,
      }}
    />
  );
}
