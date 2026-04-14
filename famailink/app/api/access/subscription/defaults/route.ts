import { NextRequest, NextResponse } from "next/server";
import { runViewerRecompute } from "@/lib/access/recompute";
import { listSubscriptionDefaults, replaceSubscriptionDefaults } from "@/lib/access/store";
import { parseSubscriptionDefaultRows } from "@/lib/access/validation";
import { requireRouteSession } from "@/lib/auth/guards";

export async function GET(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const rows = await listSubscriptionDefaults(session.personId);
  return NextResponse.json({ rows });
}

export async function PUT(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const payload = await request.json().catch(() => null);
  let rows: ReturnType<typeof parseSubscriptionDefaultRows>;
  try {
    rows = parseSubscriptionDefaultRows(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "invalid_payload" },
      { status: 400 },
    );
  }

  try {
    await replaceSubscriptionDefaults(session.personId, rows);
    const recompute = await runViewerRecompute({
      viewerPersonId: session.personId,
      reason: "subscription_defaults_saved",
    });
    return NextResponse.json({ ok: true, recompute });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "save_failed" },
      { status: 500 },
    );
  }
}
