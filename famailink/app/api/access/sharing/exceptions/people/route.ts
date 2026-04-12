import { NextRequest, NextResponse } from "next/server";
import { listSharePersonExceptions, replaceSharePersonExceptions } from "@/lib/access/store";
import { parseSharePersonExceptionRows } from "@/lib/access/validation";
import { requireRouteSession } from "@/lib/auth/guards";

export async function GET(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const rows = await listSharePersonExceptions(session.personId);
  return NextResponse.json({ rows });
}

export async function PUT(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  try {
    const payload = await request.json().catch(() => null);
    const rows = parseSharePersonExceptionRows(payload);
    await replaceSharePersonExceptions(session.personId, rows);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "invalid_payload" },
      { status: 400 },
    );
  }
}
