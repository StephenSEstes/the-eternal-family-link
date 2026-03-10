import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { PersonProfileRouteClient } from "@/components/PersonProfileRouteClient";
import { canManageFamilyData } from "@/lib/auth/permissions";
import { requireFamilyGroupSession } from "@/lib/auth/session";
import { classifyOperationalError, createRequestId, logRoute, maskEmail } from "@/lib/diagnostics/route";
import { getTenantBasePath } from "@/lib/family-group/context";
import { getHouseholds, getRelationships } from "@/lib/google/family";
import { getPeople, getPersonById } from "@/lib/data/runtime";

type TenantPersonPageProps = {
  params: Promise<{ tenantKey: string; personId: string }>;
};

export default async function TenantPersonPage({ params }: TenantPersonPageProps) {
  const { tenantKey, personId } = await params;
  const { session, tenant } = await requireFamilyGroupSession(tenantKey);
  const requestId = createRequestId();
  const route = "page/t/[tenantKey]/people/[personId]";
  const userEmailMasked = maskEmail(session.user?.email ?? "");
  const routeStart = Date.now();

  let person: Awaited<ReturnType<typeof getPersonById>> = null;
  let people: Awaited<ReturnType<typeof getPeople>> = [];
  let allRelationships: Awaited<ReturnType<typeof getRelationships>> = [];
  let households: Awaited<ReturnType<typeof getHouseholds>> = [];

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

  try {
    person = await runStep("get_person", () => getPersonById(personId, tenant.tenantKey));
    if (!person) {
      notFound();
    }
    [people, allRelationships, households] = await runStep("load_related", () =>
      Promise.all([
        getPeople(tenant.tenantKey),
        getRelationships(tenant.tenantKey),
        getHouseholds(tenant.tenantKey),
      ]),
    );
  } catch (error) {
    const classified = classifyOperationalError(error);
    return (
      <>
        <AppHeader tenantKey={tenant.tenantKey} />
        <main className="section">
          <section className="card">
            <h1 className="page-title">Profile Unavailable</h1>
            <p className="status-warn">
              We could not load this profile right now. Please retry in 30-60 seconds.
            </p>
            <p className="page-subtitle">
              requestId: {requestId} | errorCode: {classified.errorCode}
            </p>
          </section>
        </main>
      </>
    );
  }

  const peopleInFamily = new Set(people.map((item) => item.personId));
  const relationships = allRelationships.filter(
    (edge) => peopleInFamily.has(edge.fromPersonId) && peopleInFamily.has(edge.toPersonId),
  );
  const canEdit = canManageFamilyData(session, tenant);

  logRoute(route, {
    requestId,
    step: "render",
    status: "ok",
    durationMs: Date.now() - routeStart,
    tenantKey: tenant.tenantKey,
    userEmailMasked,
  });
  const basePath = getTenantBasePath(tenant.tenantKey);

  return (
    <>
      <AppHeader tenantKey={tenant.tenantKey} />
      <PersonProfileRouteClient
        tenantKey={tenant.tenantKey}
        canManage={canEdit}
        person={{
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
        }}
        people={people.map((item) => ({
          personId: item.personId,
          displayName: item.displayName,
          firstName: item.firstName,
          middleName: item.middleName,
          lastName: item.lastName,
          maidenName: item.maidenName,
          nickName: item.nickName,
          birthDate: item.birthDate,
          gender: item.gender,
          photoFileId: item.photoFileId,
          phones: item.phones,
          email: item.email,
          address: item.address,
          hobbies: item.hobbies,
          notes: item.notes,
        }))}
        edges={relationships.map((edge) => ({
          id: edge.id,
          fromPersonId: edge.fromPersonId,
          toPersonId: edge.toPersonId,
          label: edge.relationshipType,
        }))}
        households={households.map((unit) => ({
          id: unit.id,
          partner1PersonId: unit.partner1PersonId,
          partner2PersonId: unit.partner2PersonId,
          label: unit.label ?? "",
        }))}
        peopleHref={`${basePath}/people`}
      />
    </>
  );
}
