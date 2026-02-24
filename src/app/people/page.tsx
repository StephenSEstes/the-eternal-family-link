import Link from "next/link";
import { AddPersonCard } from "@/components/AddPersonCard";
import { AppHeader } from "@/components/AppHeader";
import { requireFamilyGroupSession } from "@/lib/auth/session";
import { getPhotoProxyPath } from "@/lib/google/photo-path";
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

  return (
    <>
      <AppHeader />
      <main className="section">
        <h1 className="page-title">People</h1>
        <p className="page-subtitle">Family members and key details.</p>
        <AddPersonCard tenantKey={tenant.tenantKey} canManage={tenant.role === "ADMIN"} />

        <section className="people-grid">
          {people.map((person) => (
            <Link key={person.personId} href={`/people/${person.personId}`} className="person-card">
              <img
                src={
                  photoByPersonId[person.personId] || person.photoFileId
                    ? getPhotoProxyPath(photoByPersonId[person.personId] || person.photoFileId)
                    : "/globe.svg"
                }
                alt={person.displayName}
              />
              <h3>{person.displayName}</h3>
            </Link>
          ))}
        </section>
      </main>
    </>
  );
}
