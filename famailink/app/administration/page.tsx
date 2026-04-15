import Link from "next/link";
import { redirect } from "next/navigation";
import { FamailinkChrome } from "@/components/FamailinkChrome";
import { getSessionFromCookieStore } from "@/lib/auth/session";

export default async function AdministrationPage() {
  const session = await getSessionFromCookieStore();
  if (!session) {
    redirect("/login");
  }

  return (
    <main className="shell">
      <FamailinkChrome active="administration" username={session.username} personId={session.personId} />
      <section className="masthead admin-masthead">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 className="title">Preference Administration</h1>
          <p className="lead">
            Use these tools for broad relationship defaults and diagnostics. Person-specific inclusion and exclusion
            belongs on the Family Tree person detail.
          </p>
        </div>
      </section>

      <section className="admin-option-grid">
        <Link className="admin-option-card" href="/rules-tree">
          <span className="admin-option-kicker">Default Rules</span>
          <strong>Rules Tree</strong>
          <span>Graphical relationship defaults for subscriptions and sharing.</span>
        </Link>
        <Link className="admin-option-card" href="/preferences">
          <span className="admin-option-kicker">Diagnostics</span>
          <strong>Full Preferences</strong>
          <span>Table fallback, preview, recompute status, and detailed exception tables.</span>
        </Link>
      </section>
    </main>
  );
}
