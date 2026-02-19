import { z } from "zod";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { upsertTenantAccess } from "@/lib/google/sheets";
import { getRequestTenantContext } from "@/lib/tenant/context";

const payloadSchema = z.object({
  userEmail: z.string().email(),
  tenantKey: z.string().trim().min(1).max(80),
  tenantName: z.string().trim().min(1).max(120),
  role: z.enum(["ADMIN", "USER"]),
  personId: z.string().trim().min(1).max(120),
  isEnabled: z.boolean().default(true),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tenant = await getRequestTenantContext(session);
  if (tenant.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const result = await upsertTenantAccess({
    userEmail: parsed.data.userEmail,
    tenantKey: parsed.data.tenantKey,
    tenantName: parsed.data.tenantName,
    role: parsed.data.role,
    personId: parsed.data.personId,
    isEnabled: parsed.data.isEnabled,
  });

  return NextResponse.json({ ok: true, ...result });
}
