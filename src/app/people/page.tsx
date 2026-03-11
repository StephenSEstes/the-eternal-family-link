import { AppHeader } from "@/components/AppHeader";
import { PeopleDirectory } from "@/components/PeopleDirectory";
import { canManageFamilyData } from "@/lib/auth/permissions";
import { requireFamilyGroupSession } from "@/lib/auth/session";
import { classifyOperationalError, createRequestId, logRoute, maskEmail } from "@/lib/diagnostics/route";
import { getHouseholds, getRelationships } from "@/lib/google/family";
import { getPeople } from "@/lib/data/runtime";
import { getOrLoadWithTtl } from "@/lib/server/route-cache";

// Disable caching so person edits reflect immediately across tree and people views.
const PEOPLE_ROUTE_CACHE_TTL_MS = 0;

async function loadPeoplePageBundle(tenantKey: string) {
  return getOrLoadWithTtl(`people_page_bundle:${tenantKey}`, PEOPLE_ROUTE_CACHE_TTL_MS, async () => {
    const [peopleResult, relationshipsResult, householdsResult] = await Promise.allSettled([
      getPeople(tenantKey),
      getRelationships(tenantKey),
      getHouseholds(tenantKey),
    ]);

    if (peopleResult.status !== "fulfilled") {
      throw peopleResult.reason;
    }

    return [
      peopleResult.value,
      relationshipsResult.status === "fulfilled" ? relationshipsResult.value : [],
      householdsResult.status === "fulfilled" ? householdsResult.value : [],
    ] as const;
  });
}

export default async function PeoplePage() {
  const { tenant, session } = await requireFamilyGroupSession();
  const requestId = createRequestId();
  const route = "page/people";
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
    [people, relationships, households] = await runStep("load_people_page_data", () =>
      loadPeoplePageBundle(tenant.tenantKey),
    );
  } catch (error) {
    const classified = classifyOperationalError(error);
    return (
      <>
        <AppHeader />
        <main className="section">
          <section className="card">
            <h1 className="page-title">People Unavailable</h1>
            <p className="status-warn">We could not load people right now. Please retry in 30-60 seconds.</p>
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

  const peopleInFamily = new Set(people.map((person) => person.personId));
  const filteredRelationships = relationships.filter(
    (edge) => peopleInFamily.has(edge.fromPersonId) && peopleInFamily.has(edge.toPersonId),
  );
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
      <PeopleDirectory
        tenantKey={tenant.tenantKey}
        canManage={canManageFamilyData(session, tenant)}
        canManageRelationshipType={tenant.role === "ADMIN"}
        people={people.map((person) => ({
          personId: person.personId,
          displayName: person.displayName,
          firstName: person.firstName,
          middleName: person.middleName,
          lastName: person.lastName,
          maidenName: person.maidenName,
          nickName: person.nickName,
          birthDate: person.birthDate,
          gender: person.gender,
          photoFileId: person.photoFileId,
          phones: person.phones,
          email: person.email,
          address: person.address,
          hobbies: person.hobbies,
          notes: person.notes,
          familyGroupRelationshipType: person.familyGroupRelationshipType,
        }))}
        edges={filteredRelationships.map((edge) => ({
          id: edge.id,
          fromPersonId: edge.fromPersonId,
          toPersonId: edge.toPersonId,
          label: edge.relationshipType,
        }))}
        households={households.map((item) => ({
          id: item.id,
          partner1PersonId: item.partner1PersonId,
          partner2PersonId: item.partner2PersonId,
          label: item.label ?? "",
        }))}
      />
    </>
  );
}
