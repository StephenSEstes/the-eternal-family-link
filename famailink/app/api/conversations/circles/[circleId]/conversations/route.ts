import { after, NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth/guards";
import { createCircleConversation, listCircleConversations } from "@/lib/conversations/store";
import { actorFromSession, isRecord, jsonError, normalize } from "@/lib/conversations/route-helpers";
import { dispatchPendingPushNotifications, queueConversationActivityNotifications } from "@/lib/notifications/store";

type RouteContext = {
  params: Promise<{ circleId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const { circleId } = await context.params;
  try {
    const conversations = await listCircleConversations({
      circleId,
      personId: session.personId,
    });
    return NextResponse.json({ conversations });
  } catch (error) {
    return jsonError(error, "load_conversations_failed");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const { circleId } = await context.params;
  const payload = await request.json().catch(() => null);
  if (!isRecord(payload)) {
    return NextResponse.json({ error: "payload_must_be_object" }, { status: 400 });
  }

  try {
    const actor = actorFromSession(session);
    const conversation = await createCircleConversation({
      actor,
      circleId,
      title: normalize(payload.title),
      initialMessage: normalize(payload.initialMessage),
    });
    after(async () => {
      try {
        await queueConversationActivityNotifications({
          actor,
          circleId,
          conversationId: conversation.conversationId,
          eventType: "conversation_created",
          entityType: "share_conversation",
          entityId: conversation.conversationId,
          previewText: normalize(payload.initialMessage) || conversation.title,
        });
        await dispatchPendingPushNotifications(25);
      } catch {
        // Best-effort background delivery only.
      }
    });
    return NextResponse.json({ conversation });
  } catch (error) {
    return jsonError(error, "create_conversation_failed", 400);
  }
}
