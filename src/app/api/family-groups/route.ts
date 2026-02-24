import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getRequestFamilyGroupContext } from "@/lib/family-group/context";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const context = await getRequestFamilyGroupContext(session);
  const familyGroups = context.tenants.map((item) => ({
    key: item.tenantKey,
    name: item.tenantName,
    role: item.role,
    personId: item.personId,
  }));

  return NextResponse.json({
    familyGroups,
    tenants: familyGroups,
    activeFamilyGroupKey: context.tenantKey,
    activeTenantKey: context.tenantKey,
  });
}
