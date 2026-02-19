import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";

type SessionWithTenant = {
  tenantKey?: string;
};

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tenantKey = (session as SessionWithTenant).tenantKey ?? "default";

  return NextResponse.json({
    tenants: [
      {
        key: tenantKey,
        name: "The Eternal Family Link",
      },
    ],
    activeTenantKey: tenantKey,
  });
}