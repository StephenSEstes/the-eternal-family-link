import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { listTabs } from "@/lib/google/sheets";

export async function GET() {
  const session = await getAppSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tables = await listTabs();
  return NextResponse.json({ tables });
}