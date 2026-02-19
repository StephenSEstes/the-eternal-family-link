import { AppHeader } from "@/components/AppHeader";
import { requireTenantSession } from "@/lib/auth/session";

type TenantGamesPageProps = {
  params: Promise<{ tenantKey: string }>;
};

export default async function TenantGamesPage({ params }: TenantGamesPageProps) {
  await params;
  await requireTenantSession();

  return (
    <>
      <AppHeader />
      <main className="section">
        <h1 className="page-title">Games</h1>
        <p className="page-subtitle">Tenant-scoped mode.</p>

        <section className="card">
          <p style={{ fontSize: "1.2rem", margin: 0 }}>Simple memory games will be added here.</p>
        </section>
      </main>
    </>
  );
}
