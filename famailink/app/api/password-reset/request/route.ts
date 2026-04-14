import { NextResponse } from "next/server";
import { requestPasswordReset } from "@/lib/auth/password-reset";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const email = String(body?.email ?? "").trim();
  if (!email) {
    return NextResponse.json(
      { ok: true, message: "If that email matches an active user, a password reset email has been sent." },
      { status: 200 },
    );
  }

  try {
    const result = await requestPasswordReset({
      email,
      appBaseUrl: new URL(request.url).origin,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { ok: true, message: "If that email matches an active user, a password reset email has been sent." },
      { status: 200 },
    );
  }
}
