import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth/guards";
import { deactivatePushSubscriptionByEndpoint, listActivePushSubscriptionsForPerson, upsertPushSubscription } from "@/lib/notifications/store";
import { isRecord, normalize } from "@/lib/conversations/route-helpers";

export async function GET(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  try {
    const subscriptions = await listActivePushSubscriptionsForPerson(session.personId);
    return NextResponse.json({ subscriptions });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "load_push_subscriptions_failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const payload = await request.json().catch(() => null);
  if (!isRecord(payload) || !isRecord(payload.keys)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  try {
    const subscription = await upsertPushSubscription({
      personId: session.personId,
      userEmail: session.userEmail,
      endpoint: normalize(payload.endpoint),
      p256dh: normalize(payload.keys.p256dh),
      auth: normalize(payload.keys.auth),
      deviceLabel: normalize(payload.deviceLabel),
      userAgent: normalize(payload.userAgent || request.headers.get("user-agent")),
    });
    return NextResponse.json({ subscription });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "save_push_subscription_failed" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const payload = await request.json().catch(() => null);
  if (!isRecord(payload)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  try {
    const unsubscribed = await deactivatePushSubscriptionByEndpoint({
      personId: session.personId,
      endpoint: normalize(payload.endpoint),
    });
    return NextResponse.json({ unsubscribed });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "delete_push_subscription_failed" },
      { status: 400 },
    );
  }
}
