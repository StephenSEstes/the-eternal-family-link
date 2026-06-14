import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth/guards";
import { deleteCircleConversation, updateCircleConversation } from "@/lib/conversations/store";
import { actorFromSession, isRecord, jsonError, normalize } from "@/lib/conversations/route-helpers";

type RouteContext = {
  params: Promise<{ circleId: string; conversationId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const { circleId, conversationId } = await context.params;
  const payload = await request.json().catch(() => null);
  if (!isRecord(payload)) {
    return NextResponse.json({ error: "payload_must_be_object" }, { status: 400 });
  }

  try {
    const conversation = await updateCircleConversation({
      actor: actorFromSession(session),
      circleId,
      conversationId,
      title: normalize(payload.title),
    });
    return NextResponse.json({ conversation });
  } catch (error) {
    return jsonError(error, "update_conversation_failed", 400);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const { circleId, conversationId } = await context.params;
  try {
    const ok = await deleteCircleConversation({
      actor: actorFromSession(session),
      circleId,
      conversationId,
    });
    return NextResponse.json({ ok });
  } catch (error) {
    return jsonError(error, "delete_conversation_failed", 400);
  }
}
