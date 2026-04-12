import { redirect } from "next/navigation";
import { AccessPreferencesClient } from "@/components/AccessPreferencesClient";
import { getSessionFromCookieStore } from "@/lib/auth/session";

export default async function PreferencesPage() {
  const session = await getSessionFromCookieStore();
  if (!session) {
    redirect("/login");
  }

  return (
    <AccessPreferencesClient
      session={{
        username: session.username,
        personId: session.personId,
      }}
    />
  );
}
