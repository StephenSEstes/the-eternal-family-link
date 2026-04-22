import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth/guards";
import { createConversationPost, listConversationPosts } from "@/lib/conversations/store";
import { actorFromSession, isRecord, jsonError, normalize } from "@/lib/conversations/route-helpers";

type RouteContext = {
  params: Promise<{ circleId: string; conversationId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const { circleId, conversationId } = await context.params;
  try {
    const posts = await listConversationPosts({
      circleId,
      conversationId,
      personId: session.personId,
    });
    return NextResponse.json({ posts });
  } catch (error) {
    return jsonError(error, "load_posts_failed");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const { circleId, conversationId } = await context.params;
  const payload = await request.json().catch(() => null);
  if (!isRecord(payload)) {
    return NextResponse.json({ error: "payload_must_be_object" }, { status: 400 });
  }

  try {
    const post = await createConversationPost({
      actor: actorFromSession(session),
      circleId,
      conversationId,
      caption: normalize(payload.caption),
    });
    return NextResponse.json({ post });
  } catch (error) {
    return jsonError(error, "create_post_failed", 400);
  }
}
