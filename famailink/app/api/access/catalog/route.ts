import { NextRequest, NextResponse } from "next/server";
import { buildAccessCatalog } from "@/lib/access/preview";
import { requireRouteSession } from "@/lib/auth/guards";

export async function GET(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const catalog = await buildAccessCatalog(session.personId);
  return NextResponse.json(catalog);
}
