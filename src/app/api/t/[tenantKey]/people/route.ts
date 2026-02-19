import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { getPeople } from "@/lib/google/sheets";
import {
  getTenantContext,
  hasTenantAccess,
  normalizeTenantRouteKey,
} from "@/lib/tenant/context";

type TenantPeopleRouteProps = {
  params: Promise<{ tenantKey: string }>;
};

export async function GET(_: Request, { params }: TenantPeopleRouteProps) {
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
  const people = await getPeople(tenant.tenantKey);
  return NextResponse.json({ tenantKey: tenant.tenantKey, people });
}
