import { AppHeader } from "@/components/AppHeader";
import { GamesClient } from "@/components/GamesClient";
import { requireTenantSession } from "@/lib/auth/session";
import { getImportantDates, getPeople } from "@/lib/google/sheets";

type TenantGamesPageProps = {
  params: Promise<{ tenantKey: string }>;
};

export default async function TenantGamesPage({ params }: TenantGamesPageProps) {
  await params;
  const { tenant } = await requireTenantSession();
  const people = await getPeople(tenant.tenantKey);
  const importantDates = await getImportantDates(tenant.tenantKey);

  return (
    <>
      <AppHeader />
      <main className="section">
        <h1 className="page-title">Games</h1>
        <p className="page-subtitle">Tenant-scoped memory games.</p>
        <GamesClient people={people} importantDates={importantDates} />
      </main>
    </>
  );
}
