import { NextResponse } from "next/server";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { getAppSession } from "@/lib/auth/session";
import { getRequestTenantContext } from "@/lib/family-group/context";
import {
  deleteAttribute,
  getAttributeById,
  getAttributeMediaLinks,
  removeAttributeMediaLink,
  updateAttribute,
} from "@/lib/attributes/store";
import { isLegacyInLawAttributeType } from "@/lib/family-group/relationship-type";
import { attributeMediaPatchSchema, attributeUpdateSchema } from "@/lib/validation/attributes";

type RouteProps = {
  params: Promise<{ attributeId: string }>;
};

export async function PATCH(request: Request, { params }: RouteProps) {
  const { attributeId } = await params;
  const session = await getAppSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const tenant = await getRequestTenantContext(session);
  const existing = await getAttributeById(tenant.tenantKey, attributeId);
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const mediaPatch = attributeMediaPatchSchema.safeParse(body);
  if (mediaPatch.success) {
    const ok = await removeAttributeMediaLink(tenant.tenantKey, attributeId, mediaPatch.data.removeMediaLinkId);
    if (!ok) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    await appendSessionAuditLog(session, {
      action: "DELETE",
      entityType: "ATTRIBUTE_MEDIA",
      entityId: attributeId,
      familyGroupKey: tenant.tenantKey,
      status: "SUCCESS",
      details: `Removed media link ${mediaPatch.data.removeMediaLinkId} from attribute=${attributeId}.`,
    });
    const refreshed = await getAttributeById(tenant.tenantKey, attributeId);
    return NextResponse.json({
      tenantKey: tenant.tenantKey,
      attribute: refreshed,
      media: await getAttributeMediaLinks(tenant.tenantKey, attributeId),
    });
  }

  const parsed = attributeUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }
  if (
    isLegacyInLawAttributeType(existing.attributeType || existing.typeKey) ||
    isLegacyInLawAttributeType(parsed.data.attributeType || parsed.data.typeKey)
  ) {
    return NextResponse.json(
      {
        error: "system_managed_attribute",
        message: "Legacy in_law attributes are not supported. Family-group relationship type is system-managed.",
      },
      { status: 403 },
    );
  }

  const updated = await updateAttribute(tenant.tenantKey, attributeId, {
    category: parsed.data.category,
    attributeKind: parsed.data.attributeKind ?? parsed.data.category,
    attributeType: parsed.data.attributeType,
    attributeTypeCategory: parsed.data.attributeTypeCategory,
    attributeDate: parsed.data.attributeDate,
    dateIsEstimated: parsed.data.dateIsEstimated,
    estimatedTo: parsed.data.estimatedTo,
    attributeDetail: parsed.data.attributeDetail,
    attributeNotes: parsed.data.attributeNotes,
    endDate: parsed.data.endDate,
    typeKey: parsed.data.typeKey,
    label: parsed.data.label,
    valueText: parsed.data.valueText,
    dateStart: parsed.data.dateStart,
    dateEnd: parsed.data.dateEnd,
    location: parsed.data.location,
    notes: parsed.data.notes,
  });
  if (!updated) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  await appendSessionAuditLog(session, {
    action: "UPDATE",
    entityType: "ATTRIBUTE",
    entityId: attributeId,
    familyGroupKey: tenant.tenantKey,
    status: "SUCCESS",
    details: `Updated ${existing.entityType} attribute type=${updated.attributeType || parsed.data.attributeType || parsed.data.typeKey || ""} for entity=${existing.entityId}.`,
  });
  return NextResponse.json({
    tenantKey: tenant.tenantKey,
    attribute: updated,
    media: await getAttributeMediaLinks(tenant.tenantKey, attributeId),
  });
}

export async function DELETE(_: Request, { params }: RouteProps) {
  const { attributeId } = await params;
  const session = await getAppSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const tenant = await getRequestTenantContext(session);
  const existing = await getAttributeById(tenant.tenantKey, attributeId);
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (isLegacyInLawAttributeType(existing.attributeType || existing.typeKey)) {
    return NextResponse.json(
      {
        error: "system_managed_attribute",
        message: "Legacy in_law attributes are not supported. Family-group relationship type is system-managed.",
      },
      { status: 403 },
    );
  }
  const ok = await deleteAttribute(tenant.tenantKey, attributeId);
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  await appendSessionAuditLog(session, {
    action: "DELETE",
    entityType: "ATTRIBUTE",
    entityId: attributeId,
    familyGroupKey: tenant.tenantKey,
    status: "SUCCESS",
    details: `Deleted ${existing.entityType} attribute type=${existing.attributeType || existing.typeKey || ""} for entity=${existing.entityId}.`,
  });
  return NextResponse.json({ ok: true, tenantKey: tenant.tenantKey, attributeId });
}
