import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { ProfileEditor } from "@/components/ProfileEditor";
import { canEditPerson } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { getPhotoProxyPath } from "@/lib/google/photo-path";
import { getPersonById } from "@/lib/google/sheets";

type PersonPageProps = {
  params: Promise<{ personId: string }>;
};

export default async function PersonPage({ params }: PersonPageProps) {
  const { personId } = await params;
  const session = await requireSession();
  const person = await getPersonById(personId);

  if (!person) {
    notFound();
  }

  const canEdit = canEditPerson(session, person.personId);

  return (
    <>
      <AppHeader />
      <main className="section">
        <h1 className="page-title">{person.displayName}</h1>
        <p className="page-subtitle">Profile details and notes.</p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px, 280px) minmax(0, 1fr)",
            gap: "1rem",
            alignItems: "start",
          }}
        >
          <section className="card">
            <img
              src={person.photoFileId ? getPhotoProxyPath(person.photoFileId) : "/globe.svg"}
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
