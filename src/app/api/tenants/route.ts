import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getTenantContext } from "@/lib/tenant/context";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tenant = getTenantContext(session);

  return NextResponse.json({
    tenants: [
      {
        key: tenant.tenantKey,
        name: tenant.tenantName,
      },
    ],
    activeTenantKey: tenant.tenantKey,
  });
}
