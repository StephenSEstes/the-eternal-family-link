import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth/guards";
import { getRecomputeStatus } from "@/lib/u1/resolver";

export async function GET(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized!;
  const status = await getRecomputeStatus(session.personId);
  return NextResponse.json({ ok: true, status });
}

