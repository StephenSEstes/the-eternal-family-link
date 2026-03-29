import { NextResponse } from "next/server";
import { appendSessionAuditLog } from "@/lib/audit/log";
import {
  normalizePersonMediaAttributeType,
  syncPersonMediaAssociations,
} from "@/lib/attributes/person-media";
import {
  getAttributeWithMediaById,
  removeAttributeMediaLink,
} from "@/lib/attributes/store";
import { getPersonById } from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { isLegacyInLawAttributeType } from "@/lib/family-group/relationship-type";

type PersonAttributeMediaLinkRouteProps = {
  params: Promise<{ tenantKey: string; personId: string; attributeId: string }>;
};

type CreateAttributeMediaLinkPayload = {
  fileId?: string;
  label?: string;
  description?: string;
  photoDate?: string;
  mediaMetadata?: string;
};

export async function POST(request: Request, { params }: PersonAttributeMediaLinkRouteProps) {
  const { tenantKey, personId, attributeId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const person = await getPersonById(personId, resolved.tenant.tenantKey);
  if (!person) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const existingAttribute = await getAttributeWithMediaById(resolved.tenant.tenantKey, attributeId);
  if (!existingAttribute || existingAttribute.entityType !== "person" || existingAttribute.entityId !== personId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const attributeType = String(existingAttribute.attributeType || existingAttribute.typeKey || "").trim().toLowerCase();
  if (isLegacyInLawAttributeType(attributeType)) {
    return NextResponse.json(
      {
        error: "system_managed_attribute",
        message: "Legacy in_law attributes are not supported. Family-group relationship type is system-managed.",
      },
      { status: 403 },
    );
  }

  const payload = (await request.json().catch(() => null)) as CreateAttributeMediaLinkPayload | null;
  const fileId = String(payload?.fileId ?? "").trim();
  if (!fileId) {
    return NextResponse.json(
      { error: "invalid_payload", message: "fileId is required." },
      { status: 400 },
    );
  }

  const existingLink = (existingAttribute.media ?? []).find(
    (item) => item.fileId.trim() === fileId,
  );
  if (existingLink) {
    return NextResponse.json({
      ok: true,
      existing: true,
      tenantKey: resolved.tenant.tenantKey,
      personId,
      attributeId,
      fileId,
      linkId: existingLink.linkId,
    });
  }

  const normalizedMediaType =
    normalizePersonMediaAttributeType(attributeType) || "media";
  await syncPersonMediaAssociations({
    tenantKey: resolved.tenant.tenantKey,
    personId,
    attributeId,
    attributeType: normalizedMediaType,
    fileId,
    label: String(payload?.label ?? "").trim(),
    description: String(payload?.description ?? "").trim(),
    photoDate: String(payload?.photoDate ?? "").trim(),
    mediaMetadata: String(payload?.mediaMetadata ?? "").trim(),
    replaceAttributeLinks: false,
  });

  await appendSessionAuditLog(resolved.session, {
    action: "UPDATE",
    entityType: "ATTRIBUTE",
    entityId: attributeId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `Added media link file=${fileId} to attribute=${attributeId} for person=${personId}.`,
  });

  return NextResponse.json({
    ok: true,
    existing: false,
    tenantKey: resolved.tenant.tenantKey,
    personId,
    attributeId,
    fileId,
  });
}

export async function DELETE(request: Request, { params }: PersonAttributeMediaLinkRouteProps) {
  const { tenantKey, personId, attributeId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const person = await getPersonById(personId, resolved.tenant.tenantKey);
  if (!person) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const existingAttribute = await getAttributeWithMediaById(resolved.tenant.tenantKey, attributeId);
  if (!existingAttribute || existingAttribute.entityType !== "person" || existingAttribute.entityId !== personId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const attributeType = String(existingAttribute.attributeType || existingAttribute.typeKey || "").trim().toLowerCase();
  if (isLegacyInLawAttributeType(attributeType)) {
    return NextResponse.json(
      {
        error: "system_managed_attribute",
        message: "Legacy in_law attributes are not supported. Family-group relationship type is system-managed.",
      },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as { linkId?: string } | null;
  const linkId = String(body?.linkId ?? "").trim();
  if (!linkId) {
    return NextResponse.json(
      { error: "invalid_payload", message: "linkId is required." },
      { status: 400 },
    );
  }

  const link = (existingAttribute.media ?? []).find((item) => item.linkId.trim() === linkId);
  if (!link) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const removed = await removeAttributeMediaLink(resolved.tenant.tenantKey, attributeId, linkId);
  if (!removed) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await appendSessionAuditLog(resolved.session, {
    action: "UPDATE",
    entityType: "ATTRIBUTE",
    entityId: attributeId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `Removed media link ${linkId} from attribute=${attributeId} for person=${personId}.`,
  });

  return NextResponse.json({
    ok: true,
    tenantKey: resolved.tenant.tenantKey,
    personId,
    attributeId,
    linkId,
    fileId: link.fileId,
  });
}
