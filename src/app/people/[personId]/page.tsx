import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { ProfileBackButton } from "@/components/ProfileBackButton";
import { ProfileEditor } from "@/components/ProfileEditor";
import { canEditPerson } from "@/lib/auth/permissions";
import { requireFamilyGroupSession } from "@/lib/auth/session";
import { classifyOperationalError, createRequestId, logRoute, maskEmail } from "@/lib/diagnostics/route";
import { getTenantBasePath } from "@/lib/family-group/context";
import { getHouseholds, getRelationships } from "@/lib/google/family";
import { getPhotoProxyPath } from "@/lib/google/photo-path";
import { getPeople, getPersonAttributes, getPersonById } from "@/lib/google/sheets";

type PersonPageProps = {
  params: Promise<{ personId: string }>;
};

export default async function PersonPage({ params }: PersonPageProps) {
  const { personId } = await params;
  const { session, tenant } = await requireFamilyGroupSession();
  const requestId = createRequestId();
  const route = "page/people/[personId]";
  const userEmailMasked = maskEmail(session.user?.email ?? "");
  const routeStart = Date.now();

  let person: Awaited<ReturnType<typeof getPersonById>> = null;
  let people: Awaited<ReturnType<typeof getPeople>> = [];
  let allRelationships: Awaited<ReturnType<typeof getRelationships>> = [];
  let households: Awaited<ReturnType<typeof getHouseholds>> = [];
  let attributes: Awaited<ReturnType<typeof getPersonAttributes>> = [];

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
    [people, allRelationships, households, attributes] = await runStep("load_related", () =>
      Promise.all([
        getPeople(tenant.tenantKey),
        getRelationships(tenant.tenantKey),
        getHouseholds(tenant.tenantKey),
        getPersonAttributes(tenant.tenantKey, personId),
      ]),
    );
  } catch (error) {
    const classified = classifyOperationalError(error);
    return (
      <>
        <AppHeader />
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
  const canEdit = canEditPerson(session, person.personId, tenant);
  const marriedToByPersonId = households.reduce<Record<string, string>>((acc, unit) => {
    acc[unit.partner1PersonId] = unit.partner2PersonId;
    acc[unit.partner2PersonId] = unit.partner1PersonId;
    return acc;
  }, {});
  const initialParentIds = relationships
    .filter((edge) => edge.relationshipType.toLowerCase() === "parent" && edge.toPersonId === person.personId)
    .map((edge) => edge.fromPersonId);
  const initialSpouseId =
    households.find((unit) => unit.partner1PersonId === person.personId)?.partner2PersonId ??
    households.find((unit) => unit.partner2PersonId === person.personId)?.partner1PersonId ??
    "";
  const photoAttributes = attributes.filter((item) => item.attributeType === "photo");
  const primaryPhoto = photoAttributes.find((item) => item.isPrimary)?.valueText || photoAttributes[0]?.valueText || "";
  const displayPhoto = primaryPhoto || person.photoFileId;
  const fallbackAvatar = person.gender === "female" ? "/placeholders/avatar-female.png" : "/placeholders/avatar-male.png";

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
      <AppHeader />
      <main className="section">
        <div className="profile-header-row">
          <div>
            <h1 className="page-title">{person.displayName}</h1>
            <p className="page-subtitle">Profile details and notes.</p>
          </div>
          <ProfileBackButton fallbackHref={`${basePath}/people`} />
        </div>

        <div className="profile-layout">
          <section className="card">
            <img
              src={displayPhoto ? getPhotoProxyPath(displayPhoto, tenant.tenantKey) : fallbackAvatar}
              alt={person.displayName}
              style={{ width: "100%", borderRadius: "12px", border: "2px solid var(--line)" }}
            />
            <p className="profile-photo-caption">{person.displayName}</p>
          </section>

          <ProfileEditor
            person={person}
            tenantKey={tenant.tenantKey}
            people={people.map((item) => ({
              personId: item.personId,
              displayName: item.displayName,
              gender: item.gender,
              birthDate: item.birthDate,
            }))}
            marriedToByPersonId={marriedToByPersonId}
            initialParentIds={initialParentIds}
            initialSpouseId={initialSpouseId}
            initialAttributes={attributes}
            tenantOptions={tenant.tenants.map((option) => ({ tenantKey: option.tenantKey, tenantName: option.tenantName }))}
            canManagePermissions={tenant.role === "ADMIN"}
            canEdit={canEdit}
          />
        </div>
      </main>
    </>
  );
}
