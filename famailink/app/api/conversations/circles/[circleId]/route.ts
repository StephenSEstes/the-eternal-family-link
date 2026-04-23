import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth/guards";
import { deleteConversationCircle, getConversationCircleForPerson, updateConversationCircleMemberName } from "@/lib/conversations/store";
import { actorFromSession, isRecord, jsonError, normalize } from "@/lib/conversations/route-helpers";

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

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const { circleId } = await context.params;
  const payload = await request.json().catch(() => null);
  if (!isRecord(payload)) {
    return NextResponse.json({ error: "payload_must_be_object" }, { status: 400 });
  }

  try {
    const circle = await updateConversationCircleMemberName({
      actor: actorFromSession(session),
      circleId,
      title: normalize(payload.title),
    });
    return NextResponse.json({ circle });
  } catch (error) {
    return jsonError(error, "update_group_name_failed", 400);
  }
}
