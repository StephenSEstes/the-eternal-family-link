import { AppHeader } from "@/components/AppHeader";
import { requireTenantSession } from "@/lib/auth/session";
import { getImportantDates } from "@/lib/google/sheets";

type TenantTodayPageProps = {
  params: Promise<{ tenantKey: string }>;
};

export default async function TenantTodayPage({ params }: TenantTodayPageProps) {
  await params;
  const { tenant } = await requireTenantSession();
  const items = await getImportantDates(tenant.tenantKey);

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
          <p style={{ marginTop: 0, fontSize: "1.1rem" }}>
            Tenant: {tenant.tenantName}
          </p>
          <h2 style={{ margin: "0.6rem 0 0.35rem" }}>Important Dates</h2>
          {items.length === 0 ? (
            <p style={{ margin: 0, color: "var(--text-muted)" }}>No important dates configured.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
              {items.slice(0, 20).map((item) => (
                <li key={item.id} style={{ marginBottom: "0.4rem" }}>
                  <strong>{item.date}</strong>: {item.title}
                  {item.description ? ` - ${item.description}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
