import { NextResponse } from "next/server";
import { canEditPerson } from "@/lib/auth/permissions";
import { buildMediaId, buildMediaLinkId } from "@/lib/media/ids";
import { deleteOciMediaLink, getOciMediaLinksForEntity, upsertOciMediaAsset, upsertOciMediaLink } from "@/lib/oci/tables";
import {
  deleteTableRecordById,
  getPrimaryPhotoFileIdFromAttributes,
  getPersonAttributes,
  getPersonById,
  PEOPLE_TAB,
  PERSON_ATTRIBUTES_TAB,
  updateTableRecordById,
} from "@/lib/google/sheets";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { personAttributeUpdateSchema } from "@/lib/validation/person-attributes";

type PersonAttributeItemRouteProps = {
  params: Promise<{ tenantKey: string; personId: string; attributeId: string }>;
};

function isOciDataSource() {
  return (process.env.EFL_DATA_SOURCE ?? "").trim().toLowerCase() === "oci";
}

async function clearPrimaryForType(tenantKey: string, personId: string, attributeType: string, keepAttributeId: string) {
  const current = await getPersonAttributes(tenantKey, personId);
  const updates = current.filter(
    (item) => item.attributeId !== keepAttributeId && item.attributeType === attributeType && item.isPrimary,
  );
  await Promise.all(
    updates.map((item) =>
      updateTableRecordById(
        PERSON_ATTRIBUTES_TAB,
        item.attributeId,
        {
          is_primary: "FALSE",
        },
        "attribute_id",
        tenantKey,
      ),
    ),
  );
}

export async function PATCH(request: Request, { params }: PersonAttributeItemRouteProps) {
  const { tenantKey, personId, attributeId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  if (!canEditPerson(resolved.session, personId, resolved.tenant)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const person = await getPersonById(personId, resolved.tenant.tenantKey);
  if (!person) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const existing = (await getPersonAttributes(resolved.tenant.tenantKey, personId)).find(
    (item) => item.attributeId === attributeId,
  );
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = personAttributeUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const nextType = parsed.data.attributeType?.toLowerCase() ?? existing.attributeType;
  const makePrimary = parsed.data.isPrimary ?? false;
  if (makePrimary) {
    await clearPrimaryForType(resolved.tenant.tenantKey, personId, nextType, attributeId);
  }

  const payload: Record<string, string> = {};
  if (parsed.data.attributeType !== undefined) payload.attribute_type = parsed.data.attributeType.toLowerCase();
  if (parsed.data.valueText !== undefined) payload.value_text = parsed.data.valueText;
  if (parsed.data.valueJson !== undefined) payload.value_json = parsed.data.valueJson;
  if (parsed.data.label !== undefined) payload.label = parsed.data.label;
  if (parsed.data.isPrimary !== undefined) payload.is_primary = parsed.data.isPrimary ? "TRUE" : "FALSE";
  if (parsed.data.sortOrder !== undefined) payload.sort_order = String(parsed.data.sortOrder);
  if (parsed.data.startDate !== undefined) payload.start_date = parsed.data.startDate;
  if (parsed.data.endDate !== undefined) payload.end_date = parsed.data.endDate;
  if (parsed.data.visibility !== undefined) payload.visibility = parsed.data.visibility.toLowerCase();
  if (parsed.data.shareScope !== undefined) payload.share_scope = parsed.data.shareScope;
  if (parsed.data.shareFamilyGroupKey !== undefined) {
    payload.share_family_group_key =
      parsed.data.shareScope === "one_family" || payload.share_scope === "one_family"
        ? parsed.data.shareFamilyGroupKey.trim().toLowerCase() || resolved.tenant.tenantKey
        : "";
  }
  if ((parsed.data.shareScope === "one_family" || payload.share_scope === "one_family") && !payload.share_family_group_key) {
    payload.share_family_group_key = resolved.tenant.tenantKey;
  }
  if (parsed.data.notes !== undefined) payload.notes = parsed.data.notes;

  const updated = await updateTableRecordById(
    PERSON_ATTRIBUTES_TAB,
    attributeId,
    payload,
    "attribute_id",
    resolved.tenant.tenantKey,
  );
  if (!updated) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (isOciDataSource() && (existing.attributeType === "photo" || nextType === "photo")) {
    const existingLinks = await getOciMediaLinksForEntity({
      familyGroupKey: resolved.tenant.tenantKey,
      entityType: "attribute",
      entityId: attributeId,
      usageType: "photo",
    });
    await Promise.all(existingLinks.map((item) => deleteOciMediaLink(item.linkId)));

    const nextValueText = (payload.value_text ?? existing.valueText).trim();
    if (nextType === "photo" && nextValueText) {
      const mediaId = buildMediaId(nextValueText);
      const linkId = buildMediaLinkId(resolved.tenant.tenantKey, "attribute", attributeId, nextValueText, "photo");
      const nextLabel = payload.label ?? existing.label;
      const nextDescription = payload.notes ?? existing.notes;
      const nextPhotoDate = payload.start_date ?? existing.startDate;
      const nextSortOrderRaw = payload.sort_order ?? String(existing.sortOrder);
      const nextSortOrder = Number.parseInt(nextSortOrderRaw, 10) || 0;
      const nextMediaMetadata = payload.value_json ?? existing.valueJson;
      await upsertOciMediaAsset({
        mediaId,
        fileId: nextValueText,
        storageProvider: "gdrive",
        mediaMetadata: nextMediaMetadata,
        createdAt: new Date().toISOString(),
      });
      const nextIsPrimaryRaw = payload.is_primary ?? (existing.isPrimary ? "TRUE" : "FALSE");
      await upsertOciMediaLink({
        familyGroupKey: resolved.tenant.tenantKey,
        linkId,
        mediaId,
        entityType: "attribute",
        entityId: attributeId,
        usageType: "photo",
        label: nextLabel,
        description: nextDescription,
        photoDate: nextPhotoDate,
        isPrimary: nextIsPrimaryRaw.trim().toLowerCase() === "true",
        sortOrder: nextSortOrder,
        mediaMetadata: nextMediaMetadata,
        createdAt: new Date().toISOString(),
      });
    }
  }

  if (existing.attributeType === "photo" || nextType === "photo") {
    const primaryPhotoFileId = (await getPrimaryPhotoFileIdFromAttributes(personId, resolved.tenant.tenantKey)) ?? "";
    await updateTableRecordById(
      PEOPLE_TAB,
      personId,
      { photo_file_id: primaryPhotoFileId },
      "person_id",
      resolved.tenant.tenantKey,
    );
  }

  return NextResponse.json({ tenantKey: resolved.tenant.tenantKey, personId, attribute: updated.data });
}

export async function DELETE(_: Request, { params }: PersonAttributeItemRouteProps) {
  const { tenantKey, personId, attributeId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  if (!canEditPerson(resolved.session, personId, resolved.tenant)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const existing = (await getPersonAttributes(resolved.tenant.tenantKey, personId)).find(
    (item) => item.attributeId === attributeId,
  );
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const deleted = await deleteTableRecordById(
    PERSON_ATTRIBUTES_TAB,
    attributeId,
    "attribute_id",
    resolved.tenant.tenantKey,
  );
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (isOciDataSource() && existing.attributeType === "photo") {
    const existingLinks = await getOciMediaLinksForEntity({
      familyGroupKey: resolved.tenant.tenantKey,
      entityType: "attribute",
      entityId: attributeId,
      usageType: "photo",
    });
    await Promise.all(existingLinks.map((item) => deleteOciMediaLink(item.linkId)));
  }

  if (existing.attributeType === "photo") {
    const primaryPhotoFileId = (await getPrimaryPhotoFileIdFromAttributes(personId, resolved.tenant.tenantKey)) ?? "";
    await updateTableRecordById(
      PEOPLE_TAB,
      personId,
      { photo_file_id: primaryPhotoFileId },
      "person_id",
      resolved.tenant.tenantKey,
    );
  }

  return NextResponse.json({ ok: true, tenantKey: resolved.tenant.tenantKey, personId, attributeId });
}
