import { AppHeader } from "@/components/AppHeader";
import { TreeGraph } from "@/components/TreeGraph";
import { requireFamilyGroupSession } from "@/lib/auth/session";
import { classifyOperationalError, createRequestId, logRoute, maskEmail } from "@/lib/diagnostics/route";
import { loadTreePageData, type TreePageData } from "@/lib/tree/load-tree-page-data";

type TenantTreePageProps = {
  params: Promise<{ tenantKey: string }>;
};

export default async function TenantTreePage({ params }: TenantTreePageProps) {
  const { tenantKey } = await params;
  const { tenant, session } = await requireFamilyGroupSession(tenantKey);
  const requestId = createRequestId();
  const route = "page/t/[tenantKey]/tree";
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

  let people: TreePageData["people"] = [];
  let relationships: TreePageData["relationships"] = [];
  let households: TreePageData["households"] = [];

  try {
    ({ people, relationships, households } = await runStep("load_tree_page_data", async () =>
      loadTreePageData(tenant.tenantKey),
    ));
  } catch (error) {
    const classified = classifyOperationalError(error);
    return (
      <>
        <AppHeader tenantKey={tenant.tenantKey} />
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
      <AppHeader tenantKey={tenant.tenantKey} />
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
