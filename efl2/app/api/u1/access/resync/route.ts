import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth/guards";
import { runViewerRecompute } from "@/lib/u1/resolver";

export async function POST(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized!;

  const result = await runViewerRecompute({
    viewerPersonId: session.personId,
    reason: "manual",
  });
  return NextResponse.json({ ok: true, result });
}

