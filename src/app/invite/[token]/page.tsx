import { InviteAcceptClient } from "@/components/InviteAcceptClient";
import { getInvitePresentationByToken } from "@/lib/invite/store";

type InvitePageProps = {
  params: Promise<{ token: string }>;
};

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const invite = await getInvitePresentationByToken(token);

  return (
    <main className="section" style={{ maxWidth: "720px", marginTop: "8vh" }}>
      {invite ? (
        <InviteAcceptClient token={token} initialInvite={invite} />
      ) : (
        <section className="card" style={{ maxWidth: "640px", margin: "0 auto" }}>
          <h1 className="page-title" style={{ marginTop: 0 }}>Invite Not Available</h1>
          <p className="page-subtitle" style={{ marginTop: 0 }}>
            This invite link is missing, expired, or no longer valid.
          </p>
        </section>
      )}
    </main>
  );
}
