import { z } from "zod";
import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { appendAuditLog } from "@/lib/data/runtime";
import { acceptInviteWithGoogle, acceptInviteWithLocal, getInvitePresentationByToken } from "@/lib/invite/store";

const acceptInviteSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("accept_google"),
  }),
  z.object({
    action: z.literal("accept_local"),
    username: z.string().trim().min(3).max(80),
    password: z.string().min(1).max(256),
  }),
]);

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await getAppSession();
  const invite = await getInvitePresentationByToken(token, session?.user?.email ?? "");
  if (!invite) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ invite });
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = acceptInviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    if (parsed.data.action === "accept_google") {
      const session = await getAppSession();
      const sessionEmail = session?.user?.email ?? "";
      if (!sessionEmail) {
        return NextResponse.json({ error: "unauthorized", message: "Sign in with Google first." }, { status: 401 });
      }
      const invite = await acceptInviteWithGoogle(token, sessionEmail);
      await appendAuditLog({
        actorEmail: sessionEmail,
        actorPersonId: session?.user?.person_id ?? invite.personId,
        action: "ACCEPT",
        entityType: "INVITE",
        entityId: invite.inviteId,
        familyGroupKey: invite.familyGroupKey,
        status: "SUCCESS",
        details: "Invite accepted with Google sign-in.",
      }).catch(() => undefined);
      return NextResponse.json({ ok: true, invite });
    }

    const accepted = await acceptInviteWithLocal(token, parsed.data.username, parsed.data.password);
    await appendAuditLog({
      actorEmail: accepted.invite.inviteEmail,
      actorPersonId: accepted.invite.personId,
      action: "ACCEPT",
      entityType: "INVITE",
      entityId: accepted.invite.inviteId,
      familyGroupKey: accepted.invite.familyGroupKey,
      status: "SUCCESS",
      details: "Invite accepted with local credentials.",
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, ...accepted });
  } catch (error) {
    return NextResponse.json(
      { error: "invite_accept_failed", message: error instanceof Error ? error.message : "Invite acceptance failed." },
      { status: 400 },
    );
  }
}
