import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth/password";
import { buildSession, setSessionCookie } from "@/lib/auth/session";
import { getLocalUserByUsername } from "@/lib/u1/store";

type LoginBody = {
  username?: string;
  password?: string;
};

export async function POST(request: Request) {
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!username || !password) {
    return NextResponse.json({ error: "username_and_password_required" }, { status: 400 });
  }

  const user = await getLocalUserByUsername(username);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const session = buildSession({
    userEmail: user.userEmail,
    username: user.username,
    personId: user.personId,
  });
  const response = NextResponse.json({
    ok: true,
    session: {
      username: session.username,
      personId: session.personId,
      expiresAt: session.expiresAt,
    },
  });
  setSessionCookie(response, session);
  return response;
}

