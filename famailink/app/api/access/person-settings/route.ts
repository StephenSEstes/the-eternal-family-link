import { NextRequest, NextResponse } from "next/server";
import { runViewerRecompute } from "@/lib/access/recompute";
import {
  getProfileSubscriptionMapForTarget,
  getProfileVisibilityMapForTarget,
  getSharePersonException,
  getSubscriptionPersonException,
  saveSharePersonExceptionForTarget,
  saveSubscriptionPersonExceptionForTarget,
} from "@/lib/access/store";
import { requireRouteSession } from "@/lib/auth/guards";
import type { EffectType } from "@/lib/model/relationships";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function isEffect(value: unknown): value is EffectType {
  return value === "allow" || value === "deny";
}

function readNullableBoolean(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  throw new Error("share_scope_must_be_boolean_or_null");
}

async function readTargetState(viewerPersonId: string, targetPersonId: string) {
  const [subscriptionException, shareException, subscriptionRow, visibilityRow] = await Promise.all([
    getSubscriptionPersonException(viewerPersonId, targetPersonId),
    getSharePersonException(viewerPersonId, targetPersonId),
    getProfileSubscriptionMapForTarget(viewerPersonId, targetPersonId),
    getProfileVisibilityMapForTarget(viewerPersonId, targetPersonId),
  ]);

  return {
    targetPersonId,
    subscriptionException,
    shareException,
    subscriptionRow,
    visibilityRow,
  };
}

export async function GET(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const targetPersonId = normalize(request.nextUrl.searchParams.get("targetPersonId"));
  if (!targetPersonId) {
    return NextResponse.json({ error: "target_person_id_required" }, { status: 400 });
  }

  try {
    return NextResponse.json(await readTargetState(session.personId, targetPersonId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "load_failed" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const payload = await request.json().catch(() => null);
  if (!isRecord(payload)) {
    return NextResponse.json({ error: "payload_must_be_object" }, { status: 400 });
  }

  const targetPersonId = normalize(payload.targetPersonId);
  if (!targetPersonId) {
    return NextResponse.json({ error: "target_person_id_required" }, { status: 400 });
  }

  const hasSubscriptionPayload = Object.prototype.hasOwnProperty.call(payload, "subscriptionException");
  const hasSharePayload = Object.prototype.hasOwnProperty.call(payload, "shareException");
  if (!hasSubscriptionPayload && !hasSharePayload) {
    return NextResponse.json({ error: "no_settings_to_save" }, { status: 400 });
  }

  let subscriptionException: { effect: EffectType } | null = null;
  let shareException: {
    effect: EffectType;
    shareVitals: boolean | null;
    shareStories: boolean | null;
    shareMedia: boolean | null;
    shareConversations: boolean | null;
  } | null = null;

  try {
    if (hasSubscriptionPayload) {
      if (payload.subscriptionException !== null) {
        if (!isRecord(payload.subscriptionException) || !isEffect(payload.subscriptionException.effect)) {
          throw new Error("invalid_subscription_exception");
        }
        subscriptionException = { effect: payload.subscriptionException.effect };
      }
    }
    if (hasSharePayload) {
      if (payload.shareException !== null) {
        if (!isRecord(payload.shareException) || !isEffect(payload.shareException.effect)) {
          throw new Error("invalid_share_exception");
        }
        shareException = {
          effect: payload.shareException.effect,
          shareVitals: readNullableBoolean(payload.shareException.shareVitals),
          shareStories: readNullableBoolean(payload.shareException.shareStories),
          shareMedia: readNullableBoolean(payload.shareException.shareMedia),
          shareConversations: readNullableBoolean(payload.shareException.shareConversations),
        };
      }
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "invalid_payload" },
      { status: 400 },
    );
  }

  try {
    if (hasSubscriptionPayload) {
      await saveSubscriptionPersonExceptionForTarget(session.personId, targetPersonId, subscriptionException);
    }
    if (hasSharePayload) {
      await saveSharePersonExceptionForTarget(session.personId, targetPersonId, shareException);
    }

    const recompute = await runViewerRecompute({
      viewerPersonId: session.personId,
      reason: "person_settings_saved",
    });

    return NextResponse.json({
      ok: true,
      saved: {
        subscription: hasSubscriptionPayload,
        sharing: hasSharePayload,
      },
      recompute,
      state: await readTargetState(session.personId, targetPersonId),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "save_failed" },
      { status: 500 },
    );
  }
}
