import { NextRequest, NextResponse } from "next/server";
import { getRecomputeStatus } from "@/lib/access/recompute";
import { requireRouteSession } from "@/lib/auth/guards";

export async function GET(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const status = await getRecomputeStatus(session.personId);
  return NextResponse.json({ status });
}
