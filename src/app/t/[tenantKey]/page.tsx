import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { BirthdaysSection } from "@/components/home/BirthdaysSection";
import { requireFamilyGroupSession } from "@/lib/auth/session";
import { getTenantBasePath } from "@/lib/family-group/context";
import { getPeople } from "@/lib/data/runtime";

type TenantHomeProps = {
  params: Promise<{ tenantKey: string }>;
};

export default async function TenantHomePage({ params }: TenantHomeProps) {
  const { tenantKey } = await params;
  const { tenant } = await requireFamilyGroupSession(tenantKey);
  const basePath = getTenantBasePath(tenant.tenantKey);
  const people = await getPeople(tenant.tenantKey);
  const todayIso = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  })();

  const tiles = [
    { href: `${basePath}/people`, title: "People", subtitle: "View and update profiles" },
    { href: `${basePath}/tree`, title: "Family Tree", subtitle: "Relationship map" },
    { href: `${basePath}/today`, title: "Calendar", subtitle: "Month view and upcoming plans" },
    { href: `${basePath}/games`, title: "Games", subtitle: "Memory activities" },
    { href: `${basePath}/media`, title: "Media", subtitle: "Shared family photo and video library" },
    { href: `${basePath}/help`, title: "Help", subtitle: "Ask how to use the app" },
    { href: `${basePath}/viewer`, title: "Viewer", subtitle: "PIN-gated read-only mode" },
  ];

  return (
    <>
      <AppHeader tenantKey={tenant.tenantKey} />
      <main className="section">
        <h1 className="page-title">{tenant.tenantName}</h1>
        <p className="page-subtitle">Family group workspace.</p>
        <div className="home-stack">
          <BirthdaysSection
            tenantKey={tenant.tenantKey}
            basePath={basePath}
            todayIso={todayIso}
            people={people.map((person) => ({
              personId: person.personId,
              displayName: person.displayName,
              birthDate: person.birthDate,
              gender: person.gender,
              photoFileId: person.photoFileId,
            }))}
          />

          <section className="tile-grid">
            {tiles.map((tile) => (
              <Link key={tile.title} href={tile.href} prefetch={false} className="tile">
                <strong>{tile.title}</strong>
                <span>{tile.subtitle}</span>
              </Link>
            ))}
          </section>
        </div>
      </main>
    </>
  );
}
