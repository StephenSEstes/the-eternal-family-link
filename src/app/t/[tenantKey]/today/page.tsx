import { AppHeader } from "@/components/AppHeader";
import { requireTenantSession } from "@/lib/auth/session";

type TenantTodayPageProps = {
  params: Promise<{ tenantKey: string }>;
};

export default async function TenantTodayPage({ params }: TenantTodayPageProps) {
  await params;
  const { tenant } = await requireTenantSession();

  const date = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <>
      <AppHeader />
      <main className="section">
        <h1 className="page-title">Today</h1>
        <p className="page-subtitle">{date}</p>
        <section className="card">
          <p style={{ margin: 0, fontSize: "1.1rem" }}>Tenant: {tenant.tenantName}</p>
        </section>
      </main>
    </>
  );
}
