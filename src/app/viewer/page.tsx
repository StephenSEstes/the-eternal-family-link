import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ViewerPeopleGrid } from "@/components/ViewerPeopleGrid";
import { getEnv } from "@/lib/env";
import { getPeople } from "@/lib/google/sheets";

type ViewerPageProps = {
  searchParams: Promise<{ error?: string }>;
};

async function unlockViewer(formData: FormData) {
  "use server";

  const submittedPin = String(formData.get("pin") ?? "").trim();
  const env = getEnv();

  if (submittedPin !== env.VIEWER_PIN) {
    redirect("/viewer?error=1");
  }

  const cookieStore = await cookies();
  cookieStore.set("viewer_access", "granted", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });

  redirect("/viewer");
}

export default async function ViewerPage({ searchParams }: ViewerPageProps) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const unlocked = cookieStore.get("viewer_access")?.value === "granted";

  if (!unlocked) {
    return (
      <main className="section">
        <section className="card" style={{ maxWidth: "560px", margin: "8vh auto" }}>
          <h1 className="page-title" style={{ fontSize: "2rem" }}>
            Family Viewer
          </h1>
          <p className="page-subtitle">Enter PIN to continue.</p>
          <form action={unlockViewer}>
            <label className="label" htmlFor="pin">
              PIN
            </label>
            <input id="pin" name="pin" className="input" type="password" inputMode="numeric" required />
            <button className="button" type="submit">
              Unlock Viewer
            </button>
          </form>
          {params.error ? <p className="status-warn">Incorrect PIN. Please try again.</p> : null}
        </section>
      </main>
    );
  }

  const people = await getPeople();
  const pinned = people.filter((person) => person.isPinned);

  return (
    <main className="section">
      <h1 className="page-title">Family Viewer</h1>
      <p className="page-subtitle">Read-only mode with large, simple controls.</p>
      <ViewerPeopleGrid people={pinned.length > 0 ? pinned : people.slice(0, 24)} />
    </main>
  );
}