import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { getImportantDates, getPeople } from "@/lib/google/sheets";
import { getTenantContext, hasTenantAccess, normalizeTenantRouteKey } from "@/lib/tenant/context";

type TenantGamesRouteProps = {
  params: Promise<{ tenantKey: string }>;
};

export async function GET(_: Request, { params }: TenantGamesRouteProps) {
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
  const [people, importantDates] = await Promise.all([getPeople(tenant.tenantKey), getImportantDates(tenant.tenantKey)]);
  const hobbyPeople = people.filter((p) => p.hobbies.trim().length > 0).length;
  const birthdayDates = importantDates.filter((d) => d.title.toLowerCase().includes("birthday")).length;

  return NextResponse.json({
    tenantKey: tenant.tenantKey,
    peopleCount: people.length,
    importantDatesCount: importantDates.length,
    hobbyPeopleCount: hobbyPeople,
    birthdayDatesCount: birthdayDates,
    game1Ready: people.length > 0,
    game2Ready: importantDates.length > 0,
    game3Ready: hobbyPeople > 0,
  });
}
