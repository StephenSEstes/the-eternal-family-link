import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth/guards";
import { listSubscriptionPersonExceptions, replaceSubscriptionPersonExceptions } from "@/lib/u1/store";
import type { U1EffectType } from "@/lib/u1/types";

type BodyRow = {
  targetPersonId?: string;
  effect?: U1EffectType;
};

export async function GET(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized!;
  const rows = await listSubscriptionPersonExceptions(session.personId);
  return NextResponse.json({ ok: true, rows });
}

export async function PUT(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized!;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const rows = Array.isArray(payload) ? (payload as BodyRow[]) : [];
  await replaceSubscriptionPersonExceptions(
    session.personId,
    rows.map((row) => ({
      targetPersonId: String(row.targetPersonId ?? ""),
      effect: String(row.effect ?? "deny") as U1EffectType,
    })),
  );
  return NextResponse.json({ ok: true });
}

