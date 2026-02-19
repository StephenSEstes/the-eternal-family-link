import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getRequestTenantContext } from "@/lib/tenant/context";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tenant = await getRequestTenantContext(session);

  return NextResponse.json({
    user: {
      name: session.user.name ?? null,
      email: session.user.email ?? null,
      image: session.user.image ?? null,
    },
    tenant: {
      key: tenant.tenantKey,
      name: tenant.tenantName,
      role: tenant.role,
      personId: tenant.personId,
    },
    tenants: tenant.tenants,
  });
}
