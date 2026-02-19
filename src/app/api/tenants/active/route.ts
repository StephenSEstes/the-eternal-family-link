import { z } from "zod";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { ACTIVE_TENANT_COOKIE, getTenantAccesses, getTenantContext } from "@/lib/tenant/context";

const payloadSchema = z.object({
  tenantKey: z.string().trim().min(1).max(80),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const tenants = getTenantAccesses(session);
  const selected = tenants.find((entry) => entry.tenantKey === parsed.data.tenantKey);
  if (!selected) {
    return NextResponse.json({ error: "unknown_tenant" }, { status: 403 });
  }

  const context = getTenantContext(session, selected.tenantKey);
  const response = NextResponse.json({
    ok: true,
    activeTenantKey: context.tenantKey,
  });

  response.cookies.set(ACTIVE_TENANT_COOKIE, context.tenantKey, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
