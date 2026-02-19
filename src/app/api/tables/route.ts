import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { listTabs } from "@/lib/google/sheets";
import { DEFAULT_TENANT_KEY } from "@/lib/tenant/context";

export async function GET() {
  const session = await getAppSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tables = await listTabs();
  const tenantKey = (session.tenantKey ?? DEFAULT_TENANT_KEY).trim().toLowerCase();
  const scopedPrefix = `${tenantKey}__`;
  const filtered =
    tenantKey === DEFAULT_TENANT_KEY
      ? tables.filter((tab) => !tab.includes("__"))
      : tables.filter((tab) => tab.startsWith(scopedPrefix) || !tab.includes("__"));

  return NextResponse.json({ tables: filtered });
}
