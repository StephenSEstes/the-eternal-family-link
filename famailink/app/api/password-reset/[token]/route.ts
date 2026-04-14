import { NextResponse } from "next/server";
import { completePasswordReset, getPasswordResetPresentationByToken } from "@/lib/auth/password-reset";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const password = String(body?.password ?? "");
  if (!password.trim()) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  try {
    const completed = await completePasswordReset(token, password);
    const reset = await getPasswordResetPresentationByToken(token);
    return NextResponse.json({
      ok: true,
      reset,
      username: completed.username,
      callbackUrl: "/tree",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "password_reset_failed", message: error instanceof Error ? error.message : "Password reset failed." },
      { status: 400 },
    );
  }
}
