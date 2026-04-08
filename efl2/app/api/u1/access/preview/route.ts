import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth/guards";
import { previewAccessForTarget } from "@/lib/u1/resolver";

type PreviewBody = {
  targetPersonId?: string;
};

export async function POST(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized!;

  let body: PreviewBody;
  try {
    body = (await request.json()) as PreviewBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const targetPersonId = String(body.targetPersonId ?? "").trim();
  if (!targetPersonId) {
    return NextResponse.json({ error: "target_person_id_required" }, { status: 400 });
  }

  const preview = await previewAccessForTarget(session.personId, targetPersonId);
  return NextResponse.json({ ok: true, preview });
}

