import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth/guards";
import { deleteConversationComment } from "@/lib/conversations/store";
import { actorFromSession, jsonError } from "@/lib/conversations/route-helpers";

type RouteContext = {
  params: Promise<{ circleId: string; conversationId: string; postId: string; commentId: string }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const { circleId, conversationId, postId, commentId } = await context.params;
  try {
    const ok = await deleteConversationComment({
      actor: actorFromSession(session),
      circleId,
      conversationId,
      postId,
      commentId,
    });
    return NextResponse.json({ ok });
  } catch (error) {
    return jsonError(error, "delete_comment_failed", 400);
  }
}
