import { AppHeader } from "@/components/AppHeader";
import { PeopleDirectory } from "@/components/PeopleDirectory";
import { requireFamilyGroupSession } from "@/lib/auth/session";
import { getTenantBasePath } from "@/lib/family-group/context";
import { getPeople, getPersonAttributes } from "@/lib/google/sheets";

export default async function PeoplePage() {
  const { tenant } = await requireFamilyGroupSession();
  const people = await getPeople(tenant.tenantKey);
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
          birthDate: person.birthDate,
          photoFileId: person.photoFileId,
        }))}
        photoByPersonId={photoByPersonId}
      />
    </>
  );
}
