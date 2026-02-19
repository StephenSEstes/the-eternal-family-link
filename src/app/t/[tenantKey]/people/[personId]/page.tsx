import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { ProfileEditor } from "@/components/ProfileEditor";
import { canEditPerson } from "@/lib/auth/permissions";
import { requireTenantSession } from "@/lib/auth/session";
import { getPhotoProxyPath } from "@/lib/google/photo-path";
import { getPersonById } from "@/lib/google/sheets";

type TenantPersonPageProps = {
  params: Promise<{ tenantKey: string; personId: string }>;
};

export default async function TenantPersonPage({ params }: TenantPersonPageProps) {
  const { personId } = await params;
  const { session, tenant } = await requireTenantSession();
  const person = await getPersonById(personId, tenant.tenantKey);

  if (!person) {
    notFound();
  }

  const canEdit = canEditPerson(session, person.personId, tenant);

  return (
    <>
      <AppHeader />
      <main className="section">
        <h1 className="page-title">{person.displayName}</h1>
        <p className="page-subtitle">Profile details and notes.</p>

        <div className="profile-layout">
          <section className="card">
            <img
              src={person.photoFileId ? getPhotoProxyPath(person.photoFileId, tenant.tenantKey) : "/globe.svg"}
              alt={person.displayName}
              style={{ width: "100%", borderRadius: "12px", border: "2px solid var(--line)" }}
            />
            <p style={{ marginBottom: 0, color: "var(--text-muted)" }}>Person ID: {person.personId}</p>
          </section>

          <ProfileEditor person={person} canEdit={canEdit} />
        </div>
      </main>
    </>
  );
}
