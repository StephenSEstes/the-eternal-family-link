import { NextRequest, NextResponse } from "next/server";
import { runViewerRecompute } from "@/lib/access/recompute";
import { requireRouteSession } from "@/lib/auth/guards";

export async function POST(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  let reason = "manual";
  try {
    const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const rawReason = String(payload?.reason ?? "").trim();
    if (rawReason) {
      reason = rawReason.slice(0, 64);
    }
  } catch {
    reason = "manual";
  }

  try {
    const result = await runViewerRecompute({
      viewerPersonId: session.personId,
      reason,
    });
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "recompute_failed" },
      { status: 500 },
    );
  }
}
