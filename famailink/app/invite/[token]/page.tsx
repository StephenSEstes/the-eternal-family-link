import { InviteAcceptClient } from "@/components/InviteAcceptClient";
import { getInvitePresentationByToken } from "@/lib/invite/store";

type InvitePageProps = {
  params: Promise<{ token: string }>;
};

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const invite = await getInvitePresentationByToken(token);

  return (
    <main className="login-shell">
      {invite ? (
        <InviteAcceptClient token={token} initialInvite={invite} />
      ) : (
        <section className="login-card invite-accept-card">
          <h1 className="title">Invite Not Available</h1>
          <p className="lead">This invite link is missing, expired, or no longer valid.</p>
          <div className="invite-action-row">
            <a className="secondary-button" href="/login">
              Go To Sign In
            </a>
          </div>
        </section>
      )}
    </main>
  );
}
