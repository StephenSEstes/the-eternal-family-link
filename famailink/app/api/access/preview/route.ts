import { NextRequest, NextResponse } from "next/server";
import { buildAccessPreview } from "@/lib/access/preview";
import { parsePreviewTarget } from "@/lib/access/validation";
import { requireRouteSession } from "@/lib/auth/guards";

export async function POST(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  try {
    const payload = await request.json().catch(() => null);
    const parsed = parsePreviewTarget(payload);
    const preview = await buildAccessPreview(session.personId, parsed.targetPersonId);
    if (!preview) {
      return NextResponse.json({ error: "target_not_found" }, { status: 404 });
    }
    return NextResponse.json({ preview });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "invalid_payload" },
      { status: 400 },
    );
  }
}
