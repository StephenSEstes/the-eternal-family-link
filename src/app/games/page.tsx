import { AppHeader } from "@/components/AppHeader";
import { requireSession } from "@/lib/auth/session";

export default async function GamesPage() {
  await requireSession();

  return (
    <>
      <AppHeader />
      <main className="section">
        <h1 className="page-title">Games</h1>
        <p className="page-subtitle">Coming soon.</p>

        <section className="card">
          <p style={{ fontSize: "1.2rem", margin: 0 }}>Simple memory games will be added here.</p>
        </section>
      </main>
    </>
  );
}