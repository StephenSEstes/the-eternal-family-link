import { AppHeader } from "@/components/AppHeader";
import { TreeGraph } from "@/components/TreeGraph";
import { requireTenantSession } from "@/lib/auth/session";
import { getFamilyUnits, getRelationships } from "@/lib/google/family";
import { getPeople } from "@/lib/google/sheets";
import { getTenantBasePath } from "@/lib/tenant/context";

type TenantTreePageProps = {
  params: Promise<{ tenantKey: string }>;
};

export default async function TenantTreePage({ params }: TenantTreePageProps) {
  await params;
  const { tenant } = await requireTenantSession();
  const basePath = getTenantBasePath(tenant.tenantKey);
  const people = await getPeople(tenant.tenantKey);
  const relationships = await getRelationships(tenant.tenantKey);
  const familyUnits = await getFamilyUnits(tenant.tenantKey);

  const edges = [
    ...relationships.map((rel) => ({
      id: `rel-${rel.id}`,
      fromPersonId: rel.fromPersonId,
      toPersonId: rel.toPersonId,
      label: rel.relationshipType,
    })),
    ...familyUnits.map((unit) => ({
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
        <p className="page-subtitle">Graph view from Relationships + FamilyUnits.</p>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Interactive Family Graph</h2>
          {people.length > 0 && edges.length > 0 ? (
            <TreeGraph
              basePath={basePath}
              nodes={people.map((person) => ({ personId: person.personId, displayName: person.displayName }))}
              edges={edges}
            />
          ) : (
            <p>No graph data yet. Add people plus relationship/family unit rows.</p>
          )}
        </section>
      </main>
    </>
  );
}
