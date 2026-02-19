import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireTenantSession } from "@/lib/auth/session";
import { getTenantBasePath } from "@/lib/tenant/context";

type TenantHomeProps = {
  params: Promise<{ tenantKey: string }>;
};

export default async function TenantHomePage({ params }: TenantHomeProps) {
  await params;
  const { tenant } = await requireTenantSession();
  const basePath = getTenantBasePath(tenant.tenantKey);

  const tiles = [
    { href: `${basePath}/people`, title: "People", subtitle: "View and update profiles" },
    { href: `${basePath}/tree`, title: "Family Tree", subtitle: "Relationship map" },
    { href: `${basePath}/today`, title: "Today", subtitle: "Daily reminders and events" },
    { href: `${basePath}/games`, title: "Games", subtitle: "Memory activities" },
    { href: `${basePath}/viewer`, title: "Viewer", subtitle: "PIN-gated read-only mode" },
  ];

  return (
    <>
      <AppHeader />
      <main className="section">
        <h1 className="page-title">{tenant.tenantName}</h1>
        <p className="page-subtitle">Tenant workspace.</p>

        <section className="tile-grid">
          {tiles.map((tile) => (
            <Link key={tile.title} href={tile.href} className="tile">
              <strong>{tile.title}</strong>
              <span>{tile.subtitle}</span>
            </Link>
          ))}
        </section>
      </main>
    </>
  );
}
