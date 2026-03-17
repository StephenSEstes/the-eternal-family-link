import { z } from "zod";
import { NextResponse } from "next/server";
import { appendAuditLog } from "@/lib/data/runtime";
import { acceptInviteWithLocal, getInvitePresentationByToken } from "@/lib/invite/store";

const acceptInviteSchema = z.object({
  action: z.literal("accept_local"),
  username: z.string().trim().min(3).max(80),
  password: z.string().min(1).max(256),
});

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await getInvitePresentationByToken(token);
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
