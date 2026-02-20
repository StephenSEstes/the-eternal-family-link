import Link from "next/link";
import { AddPersonCard } from "@/components/AddPersonCard";
import { AppHeader } from "@/components/AppHeader";
import { requireTenantSession } from "@/lib/auth/session";
import { getPhotoProxyPath } from "@/lib/google/photo-path";
import { getPeople } from "@/lib/google/sheets";

export default async function PeoplePage() {
  const { tenant } = await requireTenantSession();
  const people = await getPeople(tenant.tenantKey);

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
                src={person.photoFileId ? getPhotoProxyPath(person.photoFileId) : "/globe.svg"}
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
