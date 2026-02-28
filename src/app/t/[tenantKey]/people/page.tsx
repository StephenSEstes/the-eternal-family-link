import { AppHeader } from "@/components/AppHeader";
import { PeopleDirectory } from "@/components/PeopleDirectory";
import { requireFamilyGroupSession } from "@/lib/auth/session";
import { getHouseholds, getRelationships } from "@/lib/google/family";
import { getPeople, getPersonAttributes } from "@/lib/google/sheets";
import { getTenantBasePath } from "@/lib/family-group/context";

type TenantPeoplePageProps = {
  params: Promise<{ tenantKey: string }>;
};

export default async function TenantPeoplePage({ params }: TenantPeoplePageProps) {
  await params;
  const { tenant } = await requireFamilyGroupSession();
  const people = await getPeople(tenant.tenantKey);
  const [relationships, households] = await Promise.all([getRelationships(), getHouseholds(tenant.tenantKey)]);
  const peopleInFamily = new Set(people.map((person) => person.personId));
  const filteredRelationships = relationships.filter(
    (edge) => peopleInFamily.has(edge.fromPersonId) && peopleInFamily.has(edge.toPersonId),
  );
  const attributes = await getPersonAttributes(tenant.tenantKey);
  const photoByPersonId = attributes
    .filter((item) => item.attributeType === "photo" && item.valueText)
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder)
    .reduce<Record<string, string>>((acc, item) => {
      if (!acc[item.personId]) {
        acc[item.personId] = item.valueText;
      }
      return acc;
    }, {});
  const basePath = getTenantBasePath(tenant.tenantKey);

  return (
    <>
      <AppHeader />
      <PeopleDirectory
        tenantKey={tenant.tenantKey}
        basePath={basePath}
        canManage={tenant.role === "ADMIN"}
        people={people.map((person) => ({
          personId: person.personId,
          displayName: person.displayName,
          firstName: person.firstName,
          middleName: person.middleName,
          lastName: person.lastName,
          nickName: person.nickName,
          birthDate: person.birthDate,
          gender: person.gender,
          photoFileId: person.photoFileId,
          phones: person.phones,
          address: person.address,
          hobbies: person.hobbies,
          notes: person.notes,
        }))}
        photoByPersonId={photoByPersonId}
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
        }))}
      />
    </>
  );
}
