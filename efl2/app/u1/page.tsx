import { redirect } from "next/navigation";
import { U1PreferencesClient } from "@/components/U1PreferencesClient";
import { getSessionFromCookieStore } from "@/lib/auth/session";

export default async function Unit1Page() {
  const session = await getSessionFromCookieStore();
  if (!session) {
    redirect("/login");
  }

  return (
    <U1PreferencesClient
      session={{
        username: session.username,
        personId: session.personId,
      }}
    />
  );
}

