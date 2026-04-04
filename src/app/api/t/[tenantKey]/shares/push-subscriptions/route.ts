import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantAccess } from "@/lib/family-group/guard";
import {
  deactivateOciPushSubscriptionByEndpoint,
  getOciActivePushSubscriptionsForPerson,
  upsertOciPushSubscription,
} from "@/lib/oci/tables";

type RouteProps = {
  params: Promise<{ tenantKey: string }>;
};

const subscriptionSchema = z.object({
  endpoint: z.string().trim().min(1).max(4000),
  keys: z
    .object({
      p256dh: z.string().trim().max(4000).optional().default(""),
      auth: z.string().trim().max(4000).optional().default(""),
    })
    .optional()
    .default({ p256dh: "", auth: "" }),
  deviceLabel: z.string().trim().max(256).optional().default(""),
  userAgent: z.string().trim().max(2000).optional().default(""),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().trim().min(1).max(4000),
});

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeLower(value: unknown) {
  return normalize(value).toLowerCase();
}

function buildSubscriptionId(endpoint: string, personId: string) {
  const seed = `${endpoint.trim().toLowerCase()}|${personId.trim().toLowerCase()}`;
  return `psub-${createHash("sha1").update(seed).digest("hex").slice(0, 24)}`;
}

export async function GET(_: Request, { params }: RouteProps) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const actorPersonId = normalize(resolved.session.user?.person_id ?? resolved.tenant.personId);
  if (!actorPersonId) {
    return NextResponse.json({ error: "missing_actor_person_id" }, { status: 400 });
  }

  const subscriptions = await getOciActivePushSubscriptionsForPerson({
    familyGroupKey: resolved.tenant.tenantKey,
    personId: actorPersonId,
  });

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    personId: actorPersonId,
    subscriptions: subscriptions.map((entry) => ({
      subscriptionId: entry.subscriptionId,
      endpoint: entry.endpoint,
      deviceLabel: entry.deviceLabel,
      userAgent: entry.userAgent,
      lastSeenAt: entry.lastSeenAt,
      createdAt: entry.createdAt,
      isActive: entry.isActive,
    })),
  });
}

export async function POST(request: Request, { params }: RouteProps) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const actorPersonId = normalize(resolved.session.user?.person_id ?? resolved.tenant.personId);
  const actorEmail = normalizeLower(resolved.session.user?.email);
  if (!actorPersonId) {
    return NextResponse.json({ error: "missing_actor_person_id" }, { status: 400 });
  }

  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const endpoint = normalize(parsed.data.endpoint);
  const saved = await upsertOciPushSubscription({
    subscriptionId: buildSubscriptionId(endpoint, actorPersonId),
    familyGroupKey: resolved.tenant.tenantKey,
    personId: actorPersonId,
    userEmail: actorEmail,
    endpoint,
    p256dh: normalize(parsed.data.keys?.p256dh),
    auth: normalize(parsed.data.keys?.auth),
    deviceLabel: normalize(parsed.data.deviceLabel),
    userAgent: normalize(parsed.data.userAgent),
    lastSeenAt: nowIso,
    createdAt: nowIso,
  });

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    personId: actorPersonId,
    subscription: {
      subscriptionId: saved.subscriptionId,
      endpoint: saved.endpoint,
      deviceLabel: saved.deviceLabel,
      userAgent: saved.userAgent,
      lastSeenAt: saved.lastSeenAt,
      createdAt: saved.createdAt,
      isActive: saved.isActive,
    },
  });
}

export async function DELETE(request: Request, { params }: RouteProps) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const actorPersonId = normalize(resolved.session.user?.person_id ?? resolved.tenant.personId);
  if (!actorPersonId) {
    return NextResponse.json({ error: "missing_actor_person_id" }, { status: 400 });
  }

  const parsed = unsubscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await deactivateOciPushSubscriptionByEndpoint({
    familyGroupKey: resolved.tenant.tenantKey,
    personId: actorPersonId,
    endpoint: normalize(parsed.data.endpoint),
  });

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    personId: actorPersonId,
    unsubscribed: updated,
  });
}
