import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { ProfileEditor } from "@/components/ProfileEditor";
import { canEditPerson } from "@/lib/auth/permissions";
import { requireTenantSession } from "@/lib/auth/session";
import { getFamilyUnits, getRelationships } from "@/lib/google/family";
import { getPhotoProxyPath } from "@/lib/google/photo-path";
import { getPeople, getPersonAttributes, getPersonById } from "@/lib/google/sheets";

type PersonPageProps = {
  params: Promise<{ personId: string }>;
};

export default async function PersonPage({ params }: PersonPageProps) {
  const { personId } = await params;
  const { session, tenant } = await requireTenantSession();
  const [person, people, relationships, familyUnits, attributes] = await Promise.all([
    getPersonById(personId, tenant.tenantKey),
    getPeople(tenant.tenantKey),
    getRelationships(tenant.tenantKey),
    getFamilyUnits(tenant.tenantKey),
    getPersonAttributes(tenant.tenantKey, personId),
  ]);

  if (!person) {
    notFound();
  }

  const canEdit = canEditPerson(session, person.personId, tenant);
  const marriedToByPersonId = familyUnits.reduce<Record<string, string>>((acc, unit) => {
    acc[unit.partner1PersonId] = unit.partner2PersonId;
    acc[unit.partner2PersonId] = unit.partner1PersonId;
    return acc;
  }, {});
  const initialParentIds = relationships
    .filter((edge) => edge.relationshipType.toLowerCase() === "parent" && edge.toPersonId === person.personId)
    .map((edge) => edge.fromPersonId);
  const initialSpouseId =
    familyUnits.find((unit) => unit.partner1PersonId === person.personId)?.partner2PersonId ??
    familyUnits.find((unit) => unit.partner2PersonId === person.personId)?.partner1PersonId ??
    "";
  const photoAttributes = attributes.filter((item) => item.attributeType === "photo");
  const primaryPhoto = photoAttributes.find((item) => item.isPrimary)?.valueText || photoAttributes[0]?.valueText || "";
  const displayPhoto = primaryPhoto || person.photoFileId;

  return (
    <>
      <AppHeader />
      <main className="section">
        <h1 className="page-title">{person.displayName}</h1>
        <p className="page-subtitle">Profile details and notes.</p>

        <div className="profile-layout">
          <section className="card">
            <img
              src={displayPhoto ? getPhotoProxyPath(displayPhoto, tenant.tenantKey) : "/globe.svg"}
              alt={person.displayName}
              style={{ width: "100%", borderRadius: "12px", border: "2px solid var(--line)" }}
            />
            <p style={{ marginBottom: 0, color: "var(--text-muted)" }}>Person ID: {person.personId}</p>
          </section>

          <ProfileEditor
            person={person}
            tenantKey={tenant.tenantKey}
            people={people.map((item) => ({ personId: item.personId, displayName: item.displayName }))}
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
