import { NextResponse } from "next/server";
import { acceptInviteWithLocal, getInvitePresentationByToken } from "@/lib/invite/store";
import { buildSession, setSessionCookie } from "@/lib/auth/session";

function normalize(value?: unknown) {
  return String(value ?? "").trim();
}

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await getInvitePresentationByToken(token);
  if (!invite) {
    return NextResponse.json({ error: "not_found", message: "Invite not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, invite });
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json", message: "Invite payload must be valid JSON." }, { status: 400 });
  }

  if (normalize(body.action) !== "accept_local") {
    return NextResponse.json({ error: "invalid_action", message: "Unsupported invite action." }, { status: 400 });
  }

  try {
    const accepted = await acceptInviteWithLocal(token, normalize(body.username), String(body.password ?? ""));
    const response = NextResponse.json({ ok: true, ...accepted });
    setSessionCookie(
      response,
      buildSession({
        userEmail: `${accepted.username}@local`,
        username: accepted.username,
        personId: accepted.invite.personId,
      }),
    );
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error: "invite_accept_failed",
        message: error instanceof Error ? error.message : "Invite acceptance failed.",
      },
      { status: 400 },
    );
  }
}
