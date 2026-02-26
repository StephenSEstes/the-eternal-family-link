import { AppHeader } from "@/components/AppHeader";
import { TreeGraph } from "@/components/TreeGraph";
import { requireFamilyGroupSession } from "@/lib/auth/session";
import { getHouseholds, getRelationships } from "@/lib/google/family";
import { getPeople } from "@/lib/google/sheets";
import { getTenantBasePath } from "@/lib/family-group/context";

export default async function TreePage() {
  const { tenant } = await requireFamilyGroupSession();
  const basePath = getTenantBasePath(tenant.tenantKey);
  const people = await getPeople(tenant.tenantKey);
  const relationships = await getRelationships(tenant.tenantKey);
  const households = await getHouseholds(tenant.tenantKey);

  const edges = [
    ...relationships.map((rel) => ({
      id: `rel-${rel.id}`,
      fromPersonId: rel.fromPersonId,
      toPersonId: rel.toPersonId,
      label: rel.relationshipType,
    })),
    ...households.map((unit) => ({
      id: `fu-${unit.id}`,
      fromPersonId: unit.partner1PersonId,
      toPersonId: unit.partner2PersonId,
      label: "family",
    })),
  ];

  return (
    <>
      <AppHeader />
      <main className="section">
        <h1 className="page-title">Family Tree</h1>
        <p className="page-subtitle">Graph view from Relationships + Households.</p>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Interactive Family Graph</h2>
          {people.length > 0 ? (
            <TreeGraph
              basePath={basePath}
              nodes={people.map((person) => ({ personId: person.personId, displayName: person.displayName }))}
              edges={edges}
              households={households.map((unit) => ({
                id: unit.id,
                partner1PersonId: unit.partner1PersonId,
                partner2PersonId: unit.partner2PersonId,
                label: unit.label,
                notes: unit.notes,
              }))}
            />
          ) : (
            <p>No people yet. Add people first, then relationships/households to build the graph.</p>
          )}
        </section>
      </main>
    </>
  );
}

