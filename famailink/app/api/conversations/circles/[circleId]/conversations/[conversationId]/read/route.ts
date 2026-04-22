import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth/guards";
import { markConversationRead } from "@/lib/conversations/store";
import { jsonError } from "@/lib/conversations/route-helpers";

type RouteContext = {
  params: Promise<{ circleId: string; conversationId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const { circleId, conversationId } = await context.params;
  try {
    const ok = await markConversationRead({
      circleId,
      conversationId,
      personId: session.personId,
    });
    return NextResponse.json({ ok });
  } catch (error) {
    return jsonError(error, "mark_read_failed");
  }
}
