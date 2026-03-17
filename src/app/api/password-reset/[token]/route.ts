import { z } from "zod";
import { NextResponse } from "next/server";
import { completePasswordReset, getPasswordResetPresentationByToken } from "@/lib/auth/password-reset";
import { getFamilyGroupBasePath } from "@/lib/tenant/context";

const completeSchema = z.object({
  password: z.string().min(1).max(256),
});

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = completeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const completed = await completePasswordReset(token, parsed.data.password);
    const reset = await getPasswordResetPresentationByToken(token);
    return NextResponse.json({
      ok: true,
      reset,
      tenantKey: completed.tenantKey,
      tenantName: completed.tenantName,
      username: completed.username,
      callbackUrl: getFamilyGroupBasePath(completed.tenantKey) || "/",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "password_reset_failed", message: error instanceof Error ? error.message : "Password reset failed." },
      { status: 400 },
    );
  }
}
