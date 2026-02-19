import { AppHeader } from "@/components/AppHeader";
import { requireSession } from "@/lib/auth/session";
import { getPeople } from "@/lib/google/sheets";

export default async function TreePage() {
  await requireSession();
  const people = await getPeople();
  const relationships = people
    .flatMap((person) => person.relationships.map((rel) => `${person.displayName} -> ${rel}`))
    .slice(0, 30);

  return (
    <>
      <AppHeader />
      <main className="section">
        <h1 className="page-title">Family Tree</h1>
        <p className="page-subtitle">Coming soon.</p>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Simple relationships</h2>
          {relationships.length > 0 ? (
            <ul>
              {relationships.map((relationship) => (
                <li key={relationship}>{relationship}</li>
              ))}
            </ul>
          ) : (
            <p>No relationship data yet.</p>
          )}
        </section>
      </main>
    </>
  );
}