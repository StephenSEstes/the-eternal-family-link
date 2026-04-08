import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth/guards";
import { listOwnerSharePersonExceptions, replaceOwnerSharePersonExceptions } from "@/lib/u1/store";
import type { U1EffectType } from "@/lib/u1/types";

type BodyRow = {
  targetPersonId?: string;
  effect?: U1EffectType;
  shareVitals?: boolean | null;
  shareStories?: boolean | null;
  shareMedia?: boolean | null;
  shareConversations?: boolean | null;
};

export async function GET(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized!;
  const rows = await listOwnerSharePersonExceptions(session.personId);
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
  await replaceOwnerSharePersonExceptions(
    session.personId,
    rows.map((row) => ({
      targetPersonId: String(row.targetPersonId ?? ""),
      effect: String(row.effect ?? "deny") as U1EffectType,
      shareVitals: row.shareVitals === undefined ? null : row.shareVitals,
      shareStories: row.shareStories === undefined ? null : row.shareStories,
      shareMedia: row.shareMedia === undefined ? null : row.shareMedia,
      shareConversations: row.shareConversations === undefined ? null : row.shareConversations,
    })),
  );
  return NextResponse.json({ ok: true });
}

