import { NextResponse } from "next/server";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { toPersonMediaAttribute } from "@/lib/attributes/media-response";
import {
  normalizePersonMediaAttributeType,
  removePersonMediaAssociations,
  syncPersonMediaAssociations,
} from "@/lib/attributes/person-media";
import {
  deleteAttribute,
  getAttributeWithMediaById,
  getPrimaryPhotoFileIdForPerson,
  updateAttribute,
} from "@/lib/attributes/store";
import {
  getPersonById,
  PEOPLE_TABLE,
  updateTableRecordById,
} from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { isLegacyInLawAttributeType } from "@/lib/family-group/relationship-type";
import { attributeUpdateSchema } from "@/lib/validation/attributes";
import { personAttributeUpdateSchema } from "@/lib/validation/person-attributes";

type PersonAttributeItemRouteProps = {
  params: Promise<{ tenantKey: string; personId: string; attributeId: string }>;
};

export async function PATCH(request: Request, { params }: PersonAttributeItemRouteProps) {
  const { tenantKey, personId, attributeId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const person = await getPersonById(personId, resolved.tenant.tenantKey);
  if (!person) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const existing = await getAttributeWithMediaById(resolved.tenant.tenantKey, attributeId);
  if (!existing || existing.entityType !== "person" || existing.entityId !== personId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const existingMedia = toPersonMediaAttribute(existing);

  const parsed = personAttributeUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const existingAttributeType = (existing.attributeType || existing.typeKey || "").trim().toLowerCase();
  const nextType = parsed.data.attributeType?.toLowerCase() ?? existingAttributeType;
  if (isLegacyInLawAttributeType(existingAttributeType) || isLegacyInLawAttributeType(nextType)) {
    return NextResponse.json(
      {
        error: "system_managed_attribute",
        message: "Legacy in_law attributes are not supported. Family-group relationship type is system-managed.",
      },
      { status: 403 },
    );
  }
  const canonical = attributeUpdateSchema.safeParse({
    typeKey: parsed.data.attributeType,
    attributeType: parsed.data.attributeType,
    valueText: parsed.data.valueText,
    attributeDetail: parsed.data.valueText,
    notes: parsed.data.notes,
    attributeNotes: parsed.data.notes,
    dateStart: parsed.data.startDate,
    attributeDate: parsed.data.startDate,
    dateEnd: parsed.data.endDate,
    endDate: parsed.data.endDate,
    label: parsed.data.label,
  });
  if (!canonical.success) {
    return NextResponse.json({ error: "invalid_payload", issues: canonical.error.flatten() }, { status: 400 });
  }

  const updated = await updateAttribute(resolved.tenant.tenantKey, attributeId, {
    category: canonical.data.category,
    attributeKind: canonical.data.attributeKind ?? canonical.data.category,
    attributeType: canonical.data.attributeType,
    attributeTypeCategory: canonical.data.attributeTypeCategory,
    attributeDate: canonical.data.attributeDate,
    dateIsEstimated: canonical.data.dateIsEstimated,
    estimatedTo: canonical.data.estimatedTo,
    attributeDetail: canonical.data.attributeDetail,
    attributeNotes: canonical.data.attributeNotes,
    endDate: canonical.data.endDate,
    typeKey: canonical.data.typeKey,
    label: canonical.data.label,
    valueText: canonical.data.valueText,
    dateStart: canonical.data.dateStart,
    dateEnd: canonical.data.dateEnd,
    location: canonical.data.location,
    notes: canonical.data.notes,
  });
  if (!updated) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const existingMediaType = normalizePersonMediaAttributeType(existingAttributeType);
  const nextMediaType = normalizePersonMediaAttributeType(nextType);
  const existingFileId = (
    existingMedia?.valueText ||
    existing.attributeDetail ||
    existing.valueText
  ).trim();
  const nextValueText = (
    parsed.data.valueText ??
    existingMedia?.valueText ??
    existing.attributeDetail ??
    existing.valueText
  ).trim();
  const nextLabel = parsed.data.label ?? existingMedia?.label ?? existing.label;
  const nextDescription = parsed.data.notes ?? existingMedia?.notes ?? existing.attributeNotes ?? existing.notes;
  const nextPhotoDate = parsed.data.startDate ?? existingMedia?.startDate ?? existing.attributeDate ?? existing.dateStart;
  const nextSortOrder = parsed.data.sortOrder ?? existingMedia?.sortOrder ?? 0;
  const nextMediaMetadata = parsed.data.valueJson ?? existingMedia?.valueJson ?? "";
  const nextIsPrimary = parsed.data.isPrimary ?? existingMedia?.isPrimary ?? false;
  if (existingMediaType || nextMediaType) {
    await removePersonMediaAssociations({
      tenantKey: resolved.tenant.tenantKey,
      personId,
      attributeId,
      fileIds: existingFileId ? [existingFileId] : [],
    });
    if (nextMediaType && nextValueText) {
      await syncPersonMediaAssociations({
        tenantKey: resolved.tenant.tenantKey,
        personId,
        attributeId,
        attributeType: nextMediaType,
        fileId: nextValueText,
        label: nextLabel,
        description: nextDescription,
        photoDate: nextPhotoDate,
        isPrimary: nextIsPrimary,
        sortOrder: nextSortOrder,
        mediaMetadata: nextMediaMetadata,
        replaceAttributeLinks: false,
      });
    }
  }

  if (
    existingMediaType === "photo" ||
    nextMediaType === "photo" ||
    existingMedia?.isPrimary === true ||
    parsed.data.isPrimary === true
  ) {
    const primaryPhotoFileId =
      nextMediaType === "photo" && nextValueText && (parsed.data.isPrimary === true || existingMedia?.isPrimary === true)
        ? nextValueText
        : ((await getPrimaryPhotoFileIdForPerson(resolved.tenant.tenantKey, personId)) ?? "");
    await updateTableRecordById(
      PEOPLE_TABLE,
      personId,
      { photo_file_id: primaryPhotoFileId },
      "person_id",
      resolved.tenant.tenantKey,
    );
  }

  await appendSessionAuditLog(resolved.session, {
    action: "UPDATE",
    entityType: "ATTRIBUTE",
    entityId: attributeId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `Updated person attribute type=${updated.attributeType || nextType} for person=${personId}.`,
  });

  return NextResponse.json({ tenantKey: resolved.tenant.tenantKey, personId, attribute: updated });
}

export async function DELETE(_: Request, { params }: PersonAttributeItemRouteProps) {
  const { tenantKey, personId, attributeId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const existing = await getAttributeWithMediaById(resolved.tenant.tenantKey, attributeId);
  if (!existing || existing.entityType !== "person" || existing.entityId !== personId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const existingMedia = toPersonMediaAttribute(existing);
  const existingAttributeType = (existing.attributeType || existing.typeKey || "").trim().toLowerCase();
  if (isLegacyInLawAttributeType(existingAttributeType)) {
    return NextResponse.json(
      {
        error: "system_managed_attribute",
        message: "Legacy in_law attributes are not supported. Family-group relationship type is system-managed.",
      },
      { status: 403 },
    );
  }

  const deleted = await deleteAttribute(resolved.tenant.tenantKey, attributeId);
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (normalizePersonMediaAttributeType(existingAttributeType)) {
    await removePersonMediaAssociations({
      tenantKey: resolved.tenant.tenantKey,
      personId,
      attributeId,
      fileIds: existingMedia?.valueText ? [existingMedia.valueText] : [],
    });
  }

  if (normalizePersonMediaAttributeType(existingAttributeType) === "photo") {
    const primaryPhotoFileId = (await getPrimaryPhotoFileIdForPerson(resolved.tenant.tenantKey, personId)) ?? "";
    await updateTableRecordById(
      PEOPLE_TABLE,
      personId,
      { photo_file_id: primaryPhotoFileId },
      "person_id",
      resolved.tenant.tenantKey,
    );
  }

  await appendSessionAuditLog(resolved.session, {
    action: "DELETE",
    entityType: "ATTRIBUTE",
    entityId: attributeId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `Deleted person attribute type=${existing.attributeType || existing.typeKey || ""} for person=${personId}.`,
  });

  return NextResponse.json({ ok: true, tenantKey: resolved.tenant.tenantKey, personId, attributeId });
}
