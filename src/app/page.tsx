import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { BirthdaysSection } from "@/components/home/BirthdaysSection";
import { requireFamilyGroupSession } from "@/lib/auth/session";
import { getTenantBasePath } from "@/lib/family-group/context";
import { loadHomeBirthdayPeople } from "@/lib/home/birthdays";

function resolveWelcomeName(
  sessionName: string,
  person: { nickName?: string; firstName?: string; displayName?: string } | null,
) {
  const candidate =
    person?.nickName?.trim() ||
    person?.firstName?.trim() ||
    sessionName.trim().split(/\s+/)[0] ||
    person?.displayName?.trim().split(/\s+/)[0] ||
    "Family";
  return candidate;
}

function getTodayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export default async function HomePage() {
  const { session, tenant } = await requireFamilyGroupSession();
  const basePath = getTenantBasePath(tenant.tenantKey);
  const { activePeople, birthdayPeople } = await loadHomeBirthdayPeople(session.user?.tenantAccesses ?? [], tenant.tenantKey);
  const currentPerson = activePeople.find((person) => person.personId === tenant.personId) ?? null;
  const welcomeName = resolveWelcomeName(session.user?.name ?? "", currentPerson);
  const tiles = [
    { href: `${basePath}/people`, title: "People", subtitle: "View and update profiles" },
    { href: `${basePath}/tree`, title: "Family Tree", subtitle: "Relationship map" },
    { href: `${basePath}/today`, title: "Calendar", subtitle: "Month view and upcoming plans" },
    { href: `${basePath}/shares`, title: "Shares", subtitle: "Family sharing threads and comments" },
    { href: `${basePath}/games`, title: "Games", subtitle: "Memory activities" },
    { href: `${basePath}/media`, title: "Media", subtitle: "Shared family photo and video library" },
    { href: `${basePath}/help`, title: "Help", subtitle: "Ask how to use the app" },
  ];

  return (
    <>
      <AppHeader />
      <main className="section">
        <h1 className="page-title">Welcome, {welcomeName}</h1>
        <p className="page-subtitle">Quick access for family memory and connection.</p>
        <div className="home-stack">
          <BirthdaysSection
            tenantKey={tenant.tenantKey}
            basePath={basePath}
            returnToPath={basePath || "/"}
            todayIso={getTodayIso()}
            people={birthdayPeople}
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
