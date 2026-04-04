import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantAdmin } from "@/lib/family-group/guard";
import {
  getOciPendingNotificationOutbox,
  markOciNotificationOutboxFailed,
  markOciNotificationOutboxSent,
} from "@/lib/oci/tables";

type RouteProps = {
  params: Promise<{ tenantKey: string }>;
};

const dispatchSchema = z.object({
  limit: z.number().int().min(1).max(500).optional().default(50),
  dryRun: z.boolean().optional().default(true),
  markSent: z.boolean().optional().default(false),
  retryDelaySec: z.number().int().min(30).max(86400).optional().default(300),
});

function buildNextAttemptIso(delaySeconds: number) {
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

export async function POST(request: Request, { params }: RouteProps) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const parsed = dispatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const pending = await getOciPendingNotificationOutbox({
    familyGroupKey: resolved.tenant.tenantKey,
    limit: parsed.data.limit,
  });

  if (parsed.data.dryRun) {
    return NextResponse.json({
      tenantKey: resolved.tenant.tenantKey,
      dryRun: true,
      count: pending.length,
      items: pending.map((entry) => ({
        notificationId: entry.notificationId,
        personId: entry.personId,
        channel: entry.channel,
        eventType: entry.eventType,
        entityType: entry.entityType,
        entityId: entry.entityId,
        attemptCount: entry.attemptCount,
        createdAt: entry.createdAt,
      })),
    });
  }

  let sentCount = 0;
  let deferredCount = 0;
  const nowIso = new Date().toISOString();
  const nextAttemptAt = buildNextAttemptIso(parsed.data.retryDelaySec);

  for (const entry of pending) {
    if (parsed.data.markSent) {
      const markedSent = await markOciNotificationOutboxSent({
        notificationId: entry.notificationId,
        sentAt: nowIso,
      });
      if (markedSent) sentCount += 1;
      continue;
    }

    const deferred = await markOciNotificationOutboxFailed({
      notificationId: entry.notificationId,
      errorMessage: "push_not_configured_dispatch_scaffold",
      nextAttemptAt,
    });
    if (deferred) deferredCount += 1;
  }

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    dryRun: false,
    markSent: parsed.data.markSent,
    processed: pending.length,
    sentCount,
    deferredCount,
    nextAttemptAt: parsed.data.markSent ? "" : nextAttemptAt,
  });
}
