import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth/guards";
import { createConversationComment } from "@/lib/conversations/store";
import { actorFromSession, isRecord, jsonError, normalize } from "@/lib/conversations/route-helpers";

type RouteContext = {
  params: Promise<{ circleId: string; conversationId: string; postId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const { circleId, conversationId, postId } = await context.params;
  const payload = await request.json().catch(() => null);
  if (!isRecord(payload)) {
    return NextResponse.json({ error: "payload_must_be_object" }, { status: 400 });
  }

  try {
    const comment = await createConversationComment({
      actor: actorFromSession(session),
      circleId,
      conversationId,
      postId,
      commentText: normalize(payload.commentText),
    });
    return NextResponse.json({ comment });
  } catch (error) {
    return jsonError(error, "create_comment_failed", 400);
  }
}
