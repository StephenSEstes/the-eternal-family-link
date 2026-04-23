import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth/guards";
import { deleteConversationCircle, getConversationCircleForPerson } from "@/lib/conversations/store";
import { actorFromSession, jsonError } from "@/lib/conversations/route-helpers";

type RouteContext = {
  params: Promise<{ circleId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const { circleId } = await context.params;
  try {
    const circle = await getConversationCircleForPerson(circleId, session.personId);
    if (!circle) return NextResponse.json({ error: "group_not_found" }, { status: 404 });
    return NextResponse.json({ circle });
  } catch (error) {
    return jsonError(error, "load_group_failed");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const { circleId } = await context.params;
  try {
    const ok = await deleteConversationCircle({
      actor: actorFromSession(session),
      circleId,
    });
    return NextResponse.json({ ok });
  } catch (error) {
    return jsonError(error, "delete_group_failed", 400);
  }
}
