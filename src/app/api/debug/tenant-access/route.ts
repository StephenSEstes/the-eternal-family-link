import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getFamilyGroupAccesses } from "@/lib/family-group/context";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const requestedTenantKey = request.nextUrl.searchParams.get("tenantKey")?.trim().toLowerCase() ?? "";
  const accessList = getFamilyGroupAccesses(session).map((entry) => ({
    tenantKey: (entry.tenantKey ?? "").trim().toLowerCase(),
    tenantName: entry.tenantName ?? "",
    role: entry.role,
    personId: entry.personId ?? "",
  }));
  const hasRequestedTenantAccess = requestedTenantKey
    ? accessList.some((entry) => entry.tenantKey === requestedTenantKey)
    : null;

  const cookieStore = await cookies();
  const activeFamilyGroupCookie = cookieStore.get("active_family_group")?.value ?? "";
  const activeTenantCookie = cookieStore.get("active_tenant")?.value ?? "";

  return NextResponse.json({
    ok: true,
    user: {
      email: session.user.email ?? null,
      role: session.user.role ?? null,
      personId: session.user.person_id ?? null,
    },
    requestedTenantKey: requestedTenantKey || null,
    hasRequestedTenantAccess,
    activeCookies: {
      activeFamilyGroup: activeFamilyGroupCookie || null,
      activeTenant: activeTenantCookie || null,
    },
    tenantAccesses: accessList,
  });
}
