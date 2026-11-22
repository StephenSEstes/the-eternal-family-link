import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth/guards";
import { replaceConversationPostTags } from "@/lib/conversations/store";
import { actorFromSession, isRecord, jsonError, normalize, readStringArray } from "@/lib/conversations/route-helpers";

type RouteContext = {
  params: Promise<{ circleId: string; conversationId: string; postId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const payload: unknown = await request.json().catch(() => null);
  // The store replaces the entire form, including person links. Only explicit empties may clear it.
  if (!isRecord(payload) || !Array.isArray(payload.personIds)
    || !payload.personIds.every((id) => typeof id === "string" && id.trim())
    || typeof payload.label !== "string" || typeof payload.description !== "string" || typeof payload.photoDate !== "string") {
    return NextResponse.json({ error: "A complete photo details form is required. Reopen the photo and try again." }, { status: 400 });
  }
  const { circleId, conversationId, postId } = await context.params;
  try {
    const result = await replaceConversationPostTags({
      actor: actorFromSession(session),
      circleId,
      conversationId,
      postId,
      personIds: readStringArray(payload.personIds),
      label: normalize(payload.label),
      description: normalize(payload.description),
      photoDate: normalize(payload.photoDate),
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error, "update_post_tags_failed", 400);
  }
}
