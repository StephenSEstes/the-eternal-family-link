import { z } from "zod";
import { NextResponse } from "next/server";
import { requestPasswordReset } from "@/lib/auth/password-reset";

const requestSchema = z.object({
  tenantKey: z.string().trim().min(1),
  email: z.string().trim().email(),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: true, message: "If that email matches an active user, a password reset email has been sent." },
      { status: 200 },
    );
  }

  try {
    const result = await requestPasswordReset({
      tenantKey: parsed.data.tenantKey,
      email: parsed.data.email,
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
