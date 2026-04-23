import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth/guards";
import { createConversationCircle, listConversationCirclesForPerson } from "@/lib/conversations/store";
import { actorFromSession, isRecord, jsonError, normalize, readStringArray, readStringRecord } from "@/lib/conversations/route-helpers";

export async function GET(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  try {
    const circles = await listConversationCirclesForPerson(session.personId);
    return NextResponse.json({ circles });
  } catch (error) {
    return jsonError(error, "load_circles_failed");
  }
}

export async function POST(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const payload = await request.json().catch(() => null);
  if (!isRecord(payload)) {
    return NextResponse.json({ error: "payload_must_be_object" }, { status: 400 });
  }

  try {
    const circle = await createConversationCircle({
      actor: actorFromSession(session),
      title: normalize(payload.title),
      description: normalize(payload.description),
      memberPersonIds: readStringArray(payload.memberPersonIds),
      memberGroupNames: readStringRecord(payload.memberGroupNames),
    });
    return NextResponse.json(circle);
  } catch (error) {
    return jsonError(error, "create_group_failed", 400);
  }
}
