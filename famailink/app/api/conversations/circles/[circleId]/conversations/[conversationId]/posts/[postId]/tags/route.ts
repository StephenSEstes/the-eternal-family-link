import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth/guards";
import { replaceConversationPostTags } from "@/lib/conversations/store";
import { actorFromSession, isRecord, jsonError, readStringArray } from "@/lib/conversations/route-helpers";

type RouteContext = {
  params: Promise<{ circleId: string; conversationId: string; postId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const payload = await request.json().catch(() => ({}));
  const personIds = isRecord(payload) ? readStringArray(payload.personIds) : [];
  const { circleId, conversationId, postId } = await context.params;
  try {
    const taggedPeople = await replaceConversationPostTags({
      actor: actorFromSession(session),
      circleId,
      conversationId,
      postId,
      personIds,
    });
    return NextResponse.json({ taggedPeople });
  } catch (error) {
    return jsonError(error, "update_post_tags_failed", 400);
  }
}
