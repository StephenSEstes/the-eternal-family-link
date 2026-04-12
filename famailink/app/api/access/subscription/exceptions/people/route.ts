import { NextRequest, NextResponse } from "next/server";
import { listSubscriptionPersonExceptions, replaceSubscriptionPersonExceptions } from "@/lib/access/store";
import { parseSubscriptionPersonExceptionRows } from "@/lib/access/validation";
import { requireRouteSession } from "@/lib/auth/guards";

export async function GET(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const rows = await listSubscriptionPersonExceptions(session.personId);
  return NextResponse.json({ rows });
}

export async function PUT(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  try {
    const payload = await request.json().catch(() => null);
    const rows = parseSubscriptionPersonExceptionRows(payload);
    await replaceSubscriptionPersonExceptions(session.personId, rows);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "invalid_payload" },
      { status: 400 },
    );
  }
}
