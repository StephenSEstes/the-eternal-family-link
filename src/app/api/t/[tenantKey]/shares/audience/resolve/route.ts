import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { resolveShareAudience, type ShareAudienceType } from "@/lib/shares/audience";

type RouteProps = {
  params: Promise<{ tenantKey: string }>;
};

const schema = z.object({
  audienceType: z.enum(["siblings", "household", "entire_family", "family_group"]),
  targetFamilyGroupKey: z.string().trim().max(80).optional().default(""),
});

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export async function POST(request: Request, { params }: RouteProps) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const actorPersonId = String(resolved.session.user?.person_id ?? resolved.tenant.personId ?? "").trim();
  if (!actorPersonId) {
    return NextResponse.json({ error: "missing_actor_person_id" }, { status: 400 });
  }

  try {
    const resolution = await resolveShareAudience({
      tenantKey: resolved.tenant.tenantKey,
      audienceType: parsed.data.audienceType as ShareAudienceType,
      actorPersonId,
      targetFamilyGroupKey: parsed.data.targetFamilyGroupKey,
      allowedFamilyGroupKeys: resolved.tenant.tenants.map((entry) => normalize(entry.tenantKey)).filter(Boolean),
    });

    return NextResponse.json({
      tenantKey: resolved.tenant.tenantKey,
      audienceType: resolution.audienceType,
      audienceKey: resolution.audienceKey,
      audienceLabel: resolution.audienceLabel,
      familyGroupKey: resolution.familyGroupKey,
      recipientCount: resolution.recipients.length,
      recipients: resolution.recipients,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "audience_resolution_failed";
    const status = message === "target_family_group_not_allowed" ? 403 : 400;
    return NextResponse.json({ error: "audience_resolution_failed", message }, { status });
  }
}
