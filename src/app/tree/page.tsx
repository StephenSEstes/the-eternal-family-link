import { AppHeader } from "@/components/AppHeader";
import { TreeGraph } from "@/components/TreeGraph";
import { requireFamilyGroupSession } from "@/lib/auth/session";
import { classifyOperationalError, createRequestId, logRoute, maskEmail } from "@/lib/diagnostics/route";
import { getHouseholds, getRelationships } from "@/lib/google/family";
import { getPeople } from "@/lib/google/sheets";

export default async function TreePage() {
  const { tenant, session } = await requireFamilyGroupSession();
  const requestId = createRequestId();
  const route = "page/tree";
  const userEmailMasked = maskEmail(session.user?.email ?? "");
  const routeStart = Date.now();

  const runStep = async <T,>(step: string, fn: () => Promise<T>) => {
    const stepStart = Date.now();
    logRoute(route, { requestId, step, status: "start", tenantKey: tenant.tenantKey, userEmailMasked });
    try {
      const result = await fn();
      logRoute(route, {
        requestId,
        step,
        status: "ok",
        durationMs: Date.now() - stepStart,
        tenantKey: tenant.tenantKey,
        userEmailMasked,
      });
      return result;
    } catch (error) {
      const classified = classifyOperationalError(error);
      logRoute(route, {
        requestId,
        step,
        status: "error",
        durationMs: Date.now() - stepStart,
        tenantKey: tenant.tenantKey,
        userEmailMasked,
        errorCode: classified.errorCode,
        message: classified.message,
      });
      throw error;
    }
  };

  let people: Awaited<ReturnType<typeof getPeople>> = [];
  let relationships: Awaited<ReturnType<typeof getRelationships>> = [];
  let households: Awaited<ReturnType<typeof getHouseholds>> = [];

  try {
    ({ people, relationships, households } = await runStep("load_tree_page_data", async () => {
      const people = await getPeople(tenant.tenantKey);
      const peopleInFamily = new Set(people.map((person) => person.personId));
      const [allRelationships, households] = await Promise.all([getRelationships(), getHouseholds(tenant.tenantKey)]);
      const relationships = allRelationships.filter(
        (rel) => peopleInFamily.has(rel.fromPersonId) && peopleInFamily.has(rel.toPersonId),
      );
      return { people, relationships, households };
    }));
  } catch (error) {
    const classified = classifyOperationalError(error);
    return (
      <>
        <AppHeader />
        <main className="section">
          <section className="card">
            <h1 className="page-title">Family Tree Unavailable</h1>
            <p className="status-warn">We could not load the family tree right now. Please retry in 30-60 seconds.</p>
            {classified.status === 429 ? (
              <p className="page-subtitle">Quota is temporarily exhausted. Close workbook if open, wait 60-90 seconds, then retry.</p>
            ) : null}
            <p className="page-subtitle">
              requestId: {requestId} | errorCode: {classified.errorCode}
            </p>
          </section>
        </main>
      </>
    );
  }

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

  logRoute(route, {
    requestId,
    step: "render",
    status: "ok",
    durationMs: Date.now() - routeStart,
    tenantKey: tenant.tenantKey,
    userEmailMasked,
  });

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
              tenantKey={tenant.tenantKey}
              canManage={tenant.role === "ADMIN"}
              nodes={people.map((person) => ({
                personId: person.personId,
                displayName: person.displayName,
                firstName: person.firstName,
                middleName: person.middleName,
                lastName: person.lastName,
                nickName: person.nickName,
                gender: person.gender,
                photoFileId: person.photoFileId,
                birthDate: person.birthDate,
                phones: person.phones,
                address: person.address,
                hobbies: person.hobbies,
                notes: person.notes,
              }))}
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

