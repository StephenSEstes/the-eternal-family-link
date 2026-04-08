import { AppHeader } from "@/components/AppHeader";
import { U1AccessLabClient } from "@/components/u1/U1AccessLabClient";
import { requireSession } from "@/lib/auth/session";

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

export default async function U1Page() {
  const session = await requireSession();
  const actorPersonId = normalize(session.user?.person_id ?? session.user?.tenantAccesses?.[0]?.personId ?? "");

  return (
    <>
      <AppHeader />
      <main className="section">
        <h1 className="page-title">Unit 1 Access Policy Lab</h1>
        <p className="page-subtitle">Configure subscription and profile-sharing defaults, then resync and preview outcomes.</p>
        {!actorPersonId ? (
          <section className="card">
            <p className="status-warn">Missing actor person id in session. Sign out and sign in again, then retry.</p>
          </section>
        ) : (
          <U1AccessLabClient actorPersonId={actorPersonId} />
        )}
      </main>
    </>
  );
}
