import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { listTables } from "@/lib/data/runtime";
import { DEFAULT_TENANT_KEY } from "@/lib/family-group/context";
import { getRequestTenantContext } from "@/lib/family-group/context";

export async function GET() {
  const session = await getAppSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const tenant = await getRequestTenantContext(session);

  const tables = await listTables();
  const tenantKey = tenant.tenantKey.trim().toLowerCase() || DEFAULT_TENANT_KEY;
  const scopedPrefix = `${tenantKey}__`;
  const filtered =
    tenantKey === DEFAULT_TENANT_KEY
      ? tables.filter((table) => !table.includes("__"))
      : tables.filter((table) => table.startsWith(scopedPrefix) || !table.includes("__"));

  return NextResponse.json({ tables: filtered });
}
