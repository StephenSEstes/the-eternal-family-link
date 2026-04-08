import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth/guards";
import { listSubscriptionDefaults, replaceSubscriptionDefaults } from "@/lib/u1/store";
import type { U1LineageSide, U1RelationshipCategory } from "@/lib/u1/types";

type BodyRow = {
  relationshipCategory?: U1RelationshipCategory;
  lineageSide?: U1LineageSide;
  isSubscribed?: boolean;
  isActive?: boolean;
};

export async function GET(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized!;
  const rows = await listSubscriptionDefaults(session.personId);
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
  await replaceSubscriptionDefaults(
    session.personId,
    rows.map((row) => ({
      relationshipCategory: String(row.relationshipCategory ?? "") as U1RelationshipCategory,
      lineageSide: String(row.lineageSide ?? "") as U1LineageSide,
      isSubscribed: Boolean(row.isSubscribed),
      isActive: row.isActive ?? true,
    })),
  );
  return NextResponse.json({ ok: true });
}

