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
    tenants: tenant.tenants.map((item) => ({
      key: item.tenantKey,
      name: item.tenantName,
      role: item.role,
      personId: item.personId,
    })),
    activeTenantKey: tenant.tenantKey,
  });
}
