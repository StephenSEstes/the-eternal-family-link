import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { ProfileEditor } from "@/components/ProfileEditor";
import { canEditPerson } from "@/lib/auth/permissions";
import { requireTenantSession } from "@/lib/auth/session";
import { getPhotoProxyPath } from "@/lib/google/photo-path";
import { getPersonAttributes, getPersonById } from "@/lib/google/sheets";

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
  const attributes = await getPersonAttributes(tenant.tenantKey, person.personId);
  const photoAttributes = attributes.filter((item) => item.attributeType === "photo");
  const primaryPhoto = photoAttributes.find((item) => item.isPrimary)?.valueText || photoAttributes[0]?.valueText || "";
  const displayPhoto = primaryPhoto || person.photoFileId;
  const nonPhotoAttributes = attributes.filter((item) => item.attributeType !== "photo");

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
            {photoAttributes.length > 1 ? (
              <div className="settings-attr-list" style={{ marginTop: "0.7rem" }}>
                {photoAttributes.map((item) => (
                  <img
                    key={item.attributeId}
                    src={getPhotoProxyPath(item.valueText, tenant.tenantKey)}
                    alt={`${person.displayName} photo`}
                    style={{ width: "100%", borderRadius: "10px", border: "1px solid var(--line)" }}
                  />
                ))}
              </div>
            ) : null}
          </section>

          <div className="games-stack">
            <ProfileEditor person={person} canEdit={canEdit} />
            {nonPhotoAttributes.length > 0 ? (
              <section className="card">
                <h3 style={{ marginTop: 0 }}>Person Attributes</h3>
                <div className="settings-attr-list">
                  {nonPhotoAttributes.map((item) => (
                    <div key={item.attributeId} className="settings-attr-row">
                      <div>
                        <strong>{item.attributeType}</strong>: {item.valueText}
                        <div className="settings-attr-meta">
                          {item.label ? `label: ${item.label} | ` : ""}
                          visibility: {item.visibility}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}
