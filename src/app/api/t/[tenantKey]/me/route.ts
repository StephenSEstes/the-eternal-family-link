import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import {
  getTenantContext,
  hasTenantAccess,
  normalizeTenantRouteKey,
} from "@/lib/tenant/context";

type TenantMeRouteProps = {
  params: Promise<{ tenantKey: string }>;
};

export async function GET(_: Request, { params }: TenantMeRouteProps) {
  const session = await getAppSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { tenantKey } = await params;
  const normalized = normalizeTenantRouteKey(tenantKey);
  if (!hasTenantAccess(session, normalized)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const tenant = getTenantContext(session, normalized);
  return NextResponse.json({
    user: {
      email: session.user.email ?? null,
      name: session.user.name ?? null,
      role: tenant.role,
      personId: tenant.personId,
    },
    tenant: {
      key: tenant.tenantKey,
      name: tenant.tenantName,
    },
  });
}
