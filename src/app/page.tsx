import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireSession } from "@/lib/auth/session";

const tiles = [
  { href: "/people", title: "People", subtitle: "View and update profiles" },
  { href: "/tree", title: "Family Tree", subtitle: "Relationship map" },
  { href: "/today", title: "Today", subtitle: "Simple daily snapshot" },
  { href: "/games", title: "Games", subtitle: "Memory activities" },
];

export default async function HomePage() {
  await requireSession();

  return (
    <>
      <AppHeader />
      <main className="section">
        <h1 className="page-title">Welcome Home</h1>
        <p className="page-subtitle">Quick access for family memory and connection.</p>

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
