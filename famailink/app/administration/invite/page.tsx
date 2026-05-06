import Link from "next/link";
import { redirect } from "next/navigation";
import { FamailinkChrome } from "@/components/FamailinkChrome";
import { InviteAdminClient } from "@/components/InviteAdminClient";
import { isGmailSendingConfigured } from "@/lib/auth/email";
import { getSessionFromCookieStore } from "@/lib/auth/session";
import { canAdministerInvites, listInviteDirectoryPeople } from "@/lib/invite/store";

export default async function InviteAdministrationPage() {
  const session = await getSessionFromCookieStore();
  if (!session) {
    redirect("/login");
  }

  const inviteAdmin = await canAdministerInvites(session.personId);
  const invitePeople = inviteAdmin ? await listInviteDirectoryPeople(session.personId) : [];

  return (
    <main className="shell">
      <FamailinkChrome active="administration" username={session.username} personId={session.personId} />

      <section className="masthead admin-masthead">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 className="title">Invite User</h1>
          <p className="lead">
            Create a local Famailink invite for a related person and optionally send the invite email directly.
          </p>
        </div>
        <div className="masthead-actions">
          <Link className="secondary-button" href="/administration">
            Back
          </Link>
        </div>
      </section>

      {inviteAdmin ? (
        <InviteAdminClient people={invitePeople} canSendEmail={isGmailSendingConfigured()} />
      ) : (
        <section className="panel">
          <h2>Admin Access Required</h2>
          <p className="empty-state">Only Famailink admins can create and send invites from this screen.</p>
        </section>
      )}
    </main>
  );
}
