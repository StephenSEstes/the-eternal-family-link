import { NextResponse } from "next/server";
import { canEditPerson } from "@/lib/auth/permissions";
import { buildEntityId } from "@/lib/entity-id";
import { buildMediaId, buildMediaLinkId } from "@/lib/media/ids";
import { upsertOciMediaAsset, upsertOciMediaLink } from "@/lib/oci/tables";
import {
  createTableRecord,
  getPrimaryPhotoFileIdFromAttributes,
  getPersonAttributes,
  getPersonById,
  PEOPLE_TAB,
  PERSON_ATTRIBUTES_TAB,
  updateTableRecordById,
} from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { personAttributeCreateSchema } from "@/lib/validation/person-attributes";

type PersonAttributeRouteProps = {
  params: Promise<{ tenantKey: string; personId: string }>;
};

function buildAttributeId(tenantKey: string, personId: string, attributeType: string) {
  const typeKey = attributeType.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return buildEntityId("attr", `${tenantKey}|${personId}|${typeKey}|${Date.now()}`);
}

function normalizeMediaAttributeType(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "photo") return "photo";
  if (normalized === "video") return "video";
  if (normalized === "audio") return "audio";
  if (normalized === "media") return "media";
  return "";
}

async function clearPrimaryForType(tenantKey: string, personId: string, attributeType: string) {
  const current = await getPersonAttributes(tenantKey, personId);
  const updates = current.filter((item) => item.attributeType === attributeType && item.isPrimary);
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

export async function GET(_: Request, { params }: PersonAttributeRouteProps) {
  const { tenantKey, personId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const person = await getPersonById(personId, resolved.tenant.tenantKey);
  if (!person) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const attributes = await getPersonAttributes(resolved.tenant.tenantKey, personId);
  return NextResponse.json({ tenantKey: resolved.tenant.tenantKey, personId, attributes });
}

export async function POST(request: Request, { params }: PersonAttributeRouteProps) {
  const { tenantKey, personId } = await params;
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

  const parsed = personAttributeCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  await getPersonAttributes(resolved.tenant.tenantKey, personId);

  if (parsed.data.isPrimary) {
    await clearPrimaryForType(resolved.tenant.tenantKey, personId, parsed.data.attributeType);
  }

  const attributeId = buildAttributeId(resolved.tenant.tenantKey, personId, parsed.data.attributeType);
  const shareScope = parsed.data.shareScope;
  const shareFamilyGroupKey =
    shareScope === "one_family"
      ? (parsed.data.shareFamilyGroupKey.trim().toLowerCase() || resolved.tenant.tenantKey)
      : "";
  const record = await createTableRecord(
    PERSON_ATTRIBUTES_TAB,
    {
      attribute_id: attributeId,
      entity_type: "person",
      entity_id: personId,
      person_id: personId,
      attribute_type: parsed.data.attributeType.toLowerCase(),
      value_text: parsed.data.valueText,
      value_json: parsed.data.valueJson,
      label: parsed.data.label,
      is_primary: parsed.data.isPrimary ? "TRUE" : "FALSE",
      sort_order: String(parsed.data.sortOrder),
      start_date: parsed.data.startDate,
      end_date: parsed.data.endDate,
      visibility: parsed.data.visibility.toLowerCase(),
      share_scope: shareScope,
      share_family_group_key: shareFamilyGroupKey,
      notes: parsed.data.notes,
    },
    resolved.tenant.tenantKey,
  );

  const mediaAttributeType = normalizeMediaAttributeType(parsed.data.attributeType);
  if (mediaAttributeType) {
    if (parsed.data.valueText.trim()) {
      const fileId = parsed.data.valueText.trim();
      const mediaId = buildMediaId(fileId);
      const usageType = mediaAttributeType === "photo" ? "photo" : "media";
      const linkId = buildMediaLinkId(resolved.tenant.tenantKey, "attribute", attributeId, fileId, usageType);
      const personUsageType =
        mediaAttributeType === "photo"
          ? parsed.data.isPrimary
            ? "profile"
            : "gallery"
          : "media";
      const personLinkId = buildMediaLinkId(
        resolved.tenant.tenantKey,
        "person",
        personId,
        fileId,
        personUsageType,
      );
      const createdAt = new Date().toISOString();
      await upsertOciMediaAsset({
        mediaId,
        fileId,
        storageProvider: "gdrive",
        mediaMetadata: parsed.data.valueJson,
        createdAt,
      });
      await upsertOciMediaLink({
        familyGroupKey: resolved.tenant.tenantKey,
        linkId,
        mediaId,
        entityType: "attribute",
        entityId: attributeId,
        usageType,
        label: parsed.data.label,
        description: parsed.data.notes,
        photoDate: parsed.data.startDate,
        isPrimary: parsed.data.isPrimary,
        sortOrder: parsed.data.sortOrder,
        mediaMetadata: parsed.data.valueJson,
        createdAt,
      });
      await upsertOciMediaLink({
        familyGroupKey: resolved.tenant.tenantKey,
        linkId: personLinkId,
        mediaId,
        entityType: "person",
        entityId: personId,
        usageType: personUsageType,
        label: parsed.data.label,
        description: parsed.data.notes,
        photoDate: parsed.data.startDate,
        isPrimary: parsed.data.isPrimary,
        sortOrder: parsed.data.sortOrder,
        mediaMetadata: parsed.data.valueJson,
        createdAt,
      });
    }
    if (mediaAttributeType === "photo") {
      const primaryPhotoFileId = (await getPrimaryPhotoFileIdFromAttributes(personId, resolved.tenant.tenantKey)) ?? "";
      await updateTableRecordById(
        PEOPLE_TAB,
        personId,
        { photo_file_id: primaryPhotoFileId },
        "person_id",
        resolved.tenant.tenantKey,
      );
    }
  }

  return NextResponse.json({ tenantKey: resolved.tenant.tenantKey, personId, attribute: record.data }, { status: 201 });
}
