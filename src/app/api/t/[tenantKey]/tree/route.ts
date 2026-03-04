import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { getHouseholds, getRelationships } from "@/lib/google/family";
import { getPeople } from "@/lib/google/sheets";
import { getTenantContext, hasTenantAccess, normalizeTenantRouteKey } from "@/lib/family-group/context";

type TenantTreeRouteProps = {
  params: Promise<{ tenantKey: string }>;
};

export async function GET(_: Request, { params }: TenantTreeRouteProps) {
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
  const [people, allRelationships, households] = await Promise.all([
    getPeople(tenant.tenantKey),
    getRelationships(tenant.tenantKey),
    getHouseholds(tenant.tenantKey),
  ]);
  const peopleInFamily = new Set(people.map((person) => person.personId));
  const relationships = allRelationships.filter(
    (rel) => peopleInFamily.has(rel.fromPersonId) && peopleInFamily.has(rel.toPersonId),
  );

  return NextResponse.json({
    tenantKey: tenant.tenantKey,
    peopleCount: people.length,
    relationshipsCount: relationships.length,
    householdsCount: households.length,
    people,
    relationships,
    households,
  });
}
