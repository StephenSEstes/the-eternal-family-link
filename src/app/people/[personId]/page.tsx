import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { ProfileBackButton } from "@/components/ProfileBackButton";
import { ProfileEditor } from "@/components/ProfileEditor";
import { canEditPerson } from "@/lib/auth/permissions";
import { requireFamilyGroupSession } from "@/lib/auth/session";
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
  const [person, people, allRelationships, households, attributes] = await Promise.all([
    getPersonById(personId, tenant.tenantKey),
    getPeople(tenant.tenantKey),
    getRelationships(),
    getHouseholds(tenant.tenantKey),
    getPersonAttributes(tenant.tenantKey, personId),
  ]);

  if (!person) {
    notFound();
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
            people={people.map((item) => ({ personId: item.personId, displayName: item.displayName, gender: item.gender }))}
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
