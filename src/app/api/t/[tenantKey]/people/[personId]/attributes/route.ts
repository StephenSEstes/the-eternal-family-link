import { NextResponse } from "next/server";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { toPersonMediaAttribute, type AttributeWithMedia } from "@/lib/attributes/media-response";
import { normalizePersonMediaAttributeType, syncPersonMediaAssociations } from "@/lib/attributes/person-media";
import {
  createAttribute,
  getAttributesForEntityWithMedia,
  getPrimaryPhotoFileIdForPerson,
} from "@/lib/attributes/store";
import {
  getPersonById,
  PEOPLE_TABLE,
  updateTableRecordById,
} from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { isLegacyInLawAttributeType } from "@/lib/family-group/relationship-type";
import { attributeCreateSchema } from "@/lib/validation/attributes";
import { personAttributeCreateSchema } from "@/lib/validation/person-attributes";

type PersonAttributeRouteProps = {
  params: Promise<{ tenantKey: string; personId: string }>;
};

function toCompatibilityAttribute(
  tenantKey: string,
  personId: string,
  item: AttributeWithMedia,
  index: number,
) {
  const media = toPersonMediaAttribute(item);
  const attributeType = String(item.attributeType || item.typeKey || "").trim().toLowerCase();
  if (isLegacyInLawAttributeType(attributeType)) {
    return null;
  }
  const attributeDate = String(item.attributeDate || item.dateStart || "").trim();
  const endDate = String(item.endDate || item.dateEnd || "").trim();
  const attributeDetail = String(item.attributeDetail || item.valueText || "").trim();
  const valueText = (media?.valueText || attributeDetail || attributeDate).trim();
  if (!attributeType || !(valueText || attributeDate)) {
    return null;
  }
  return {
    attributeId: item.attributeId,
    tenantKey,
    personId,
    attributeType,
    valueText,
    valueJson: media?.valueJson || "",
    mediaMetadata: media?.mediaMetadata || "",
    label: (media?.label || item.label || item.attributeTypeCategory || attributeType).trim(),
    isPrimary: media?.isPrimary ?? false,
    sortOrder: media?.sortOrder ?? index,
    startDate: media?.startDate || attributeDate,
    endDate,
    visibility: "family",
    notes: media?.notes || item.attributeNotes || item.notes || "",
    shareScope: "both_families" as const,
    shareFamilyGroupKey: "",
  };
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

  const attributes = (await getAttributesForEntityWithMedia(resolved.tenant.tenantKey, "person", personId))
    .map((item, index) => toCompatibilityAttribute(resolved.tenant.tenantKey, personId, item, index))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  return NextResponse.json({ tenantKey: resolved.tenant.tenantKey, personId, attributes });
}

export async function POST(request: Request, { params }: PersonAttributeRouteProps) {
  const { tenantKey, personId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const person = await getPersonById(personId, resolved.tenant.tenantKey);
  if (!person) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = personAttributeCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }
  if (isLegacyInLawAttributeType(parsed.data.attributeType)) {
    return NextResponse.json(
      {
        error: "system_managed_attribute",
        message: "Legacy in_law attributes are not supported. Family-group relationship type is system-managed.",
      },
      { status: 403 },
    );
  }

  const canonical = attributeCreateSchema.safeParse({
    entityType: "person",
    entityId: personId,
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

  const created = await createAttribute(resolved.tenant.tenantKey, {
    entityType: "person",
    entityId: personId,
    category: canonical.data.category,
    attributeKind: canonical.data.attributeKind ?? canonical.data.category,
    attributeType: canonical.data.attributeType || canonical.data.typeKey,
    attributeTypeCategory: canonical.data.attributeTypeCategory,
    attributeDate: canonical.data.attributeDate || canonical.data.dateStart,
    dateIsEstimated: canonical.data.dateIsEstimated,
    estimatedTo: canonical.data.estimatedTo ?? "",
    attributeDetail: canonical.data.attributeDetail || canonical.data.valueText,
    attributeNotes: canonical.data.attributeNotes || canonical.data.notes,
    endDate: canonical.data.endDate || canonical.data.dateEnd,
    typeKey: canonical.data.typeKey,
    label: canonical.data.label,
    valueText: canonical.data.valueText,
    dateStart: canonical.data.dateStart,
    dateEnd: canonical.data.dateEnd,
    location: canonical.data.location,
    notes: canonical.data.notes,
  });

  const mediaAttributeType = normalizePersonMediaAttributeType(parsed.data.attributeType);
  if (mediaAttributeType && parsed.data.valueText.trim()) {
    const fileId = parsed.data.valueText.trim();
    await syncPersonMediaAssociations({
      tenantKey: resolved.tenant.tenantKey,
      personId,
      attributeId: created.attributeId,
      attributeType: mediaAttributeType,
      fileId,
      label: parsed.data.label,
      description: parsed.data.notes,
      photoDate: parsed.data.startDate,
      isPrimary: parsed.data.isPrimary,
      sortOrder: parsed.data.sortOrder,
      mediaMetadata: parsed.data.valueJson,
    });
    if (mediaAttributeType === "photo") {
      const primaryPhotoFileId = parsed.data.isPrimary
        ? fileId
        : ((await getPrimaryPhotoFileIdForPerson(resolved.tenant.tenantKey, personId)) ?? "");
      await updateTableRecordById(
        PEOPLE_TABLE,
        personId,
        { photo_file_id: primaryPhotoFileId },
        "person_id",
        resolved.tenant.tenantKey,
      );
    }
  }

  await appendSessionAuditLog(resolved.session, {
    action: "CREATE",
    entityType: "ATTRIBUTE",
    entityId: created.attributeId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `Created person attribute type=${created.attributeType || parsed.data.attributeType} for person=${personId}.`,
  });

  return NextResponse.json({ tenantKey: resolved.tenant.tenantKey, personId, attribute: created }, { status: 201 });
}
