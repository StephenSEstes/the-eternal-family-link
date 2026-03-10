import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { canEditPerson } from "@/lib/auth/permissions";
import { buildEntityId } from "@/lib/entity-id";
import { uploadPhotoToFolder } from "@/lib/google/drive";
import { buildMediaId, buildMediaLinkId } from "@/lib/media/ids";
import { buildMediaMetadata, sanitizeUploadFileName, validateUploadInput } from "@/lib/media/upload";
import { setOciPrimaryMediaLink, upsertOciMediaAsset, upsertOciMediaLink } from "@/lib/oci/tables";
import { getAttributeById } from "@/lib/attributes/store";
import {
  createTableRecord,
  getPersonAttributes,
  getPersonById,
  getTenantConfig,
  PEOPLE_TAB,
  PERSON_ATTRIBUTES_TAB,
  updateTableRecordById,
} from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";

type UploadRouteProps = {
  params: Promise<{ tenantKey: string; personId: string }>;
};

function buildAttributeId(tenantKey: string, personId: string, attributeType: string) {
  return buildEntityId("attr", `${tenantKey}|${personId}|${attributeType}|${Date.now()}`);
}

function normalizeDateFromTimestamp(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function normalizeShareScope(raw: string) {
  const normalized = raw.trim().toLowerCase();
  return normalized === "one_family" || normalized === "single_family" ? "one_family" : "both_families";
}

export async function POST(request: Request, { params }: UploadRouteProps) {
  try {
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

    const formData = await request.formData().catch(() => null);
    const fileField = formData?.get("file");
    if (!fileField || typeof fileField === "string" || typeof (fileField as Blob).arrayBuffer !== "function") {
      return NextResponse.json({ error: "invalid_payload", message: "file is required" }, { status: 400 });
    }
    const file = fileField as Blob & { name?: string; type?: string };

    const label = String(formData?.get("label") ?? "gallery").trim() || "gallery";
    const requestedAttributeType = String(formData?.get("attributeType") ?? "photo")
      .trim()
      .toLowerCase();
    const attributeType = ["photo", "video", "audio", "media"].includes(requestedAttributeType)
      ? requestedAttributeType
      : "photo";
    const requestedHeadshot = String(formData?.get("isHeadshot") ?? "").trim().toLowerCase() === "true";
    const description = String(formData?.get("description") ?? "").trim();
    const requestedPhotoDate = String(formData?.get("photoDate") ?? "").trim();
    const fileCreatedAt = String(formData?.get("fileCreatedAt") ?? "").trim();
    const mediaWidth = String(formData?.get("mediaWidth") ?? "").trim();
    const mediaHeight = String(formData?.get("mediaHeight") ?? "").trim();
    const mediaDurationSec = String(formData?.get("mediaDurationSec") ?? "").trim();
    const captureSource = String(formData?.get("captureSource") ?? "").trim();
    const targetAttributeId = String(formData?.get("attributeId") ?? "").trim();
    const requestedShareScope = normalizeShareScope(String(formData?.get("shareScope") ?? ""));
    const requestedShareFamilyGroupKey = String(formData?.get("shareFamilyGroupKey") ?? "").trim().toLowerCase();
    const shareScope = requestedShareScope;
    const shareFamilyGroupKey =
      shareScope === "one_family"
        ? (requestedShareFamilyGroupKey || resolved.tenant.tenantKey)
        : "";
    const arrayBuffer = await file.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    const validated = validateUploadInput({ byteLength: bytes.length, mimeType: file.type });
    if (!validated.ok) {
      return NextResponse.json({ error: "invalid_payload", message: validated.error }, { status: 400 });
    }

    const tenantConfig = await getTenantConfig(resolved.tenant.tenantKey);
    const safeFileName = sanitizeUploadFileName(
      file.name || "",
      `${personId}-${Date.now()}.${validated.mediaKind === "image" ? "jpg" : validated.mediaKind === "video" ? "mp4" : "bin"}`,
    );
    const uploaded = await uploadPhotoToFolder({
      folderId: tenantConfig.photosFolderId,
      filename: safeFileName,
      mimeType: validated.mimeType,
      data: bytes,
    });

    const createdAtIso = !Number.isNaN(new Date(fileCreatedAt).getTime())
      ? new Date(fileCreatedAt).toISOString()
      : new Date().toISOString();
    const effectivePhotoDate = requestedPhotoDate || normalizeDateFromTimestamp(createdAtIso);
    const mediaMetadata = buildMediaMetadata({
      fileName: safeFileName,
      mimeType: validated.mimeType,
      sizeBytes: bytes.length,
      createdAt: createdAtIso,
      mediaKind: validated.mediaKind,
      width: mediaWidth,
      height: mediaHeight,
      durationSec: mediaDurationSec,
      captureSource,
      extra: {
        checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      },
    });

    const existingPhotos = attributeType === "photo"
      ? (await getPersonAttributes(resolved.tenant.tenantKey, personId)).filter(
      (item) => item.attributeType === "photo",
      )
      : [];
    const shouldBePrimary =
      !targetAttributeId &&
      attributeType === "photo" &&
      validated.mediaKind === "image" &&
      (requestedHeadshot || existingPhotos.length === 0);

    if (shouldBePrimary) {
      await Promise.all(
        existingPhotos
          .filter((item) => item.isPrimary)
          .map((item) =>
            updateTableRecordById(
              PERSON_ATTRIBUTES_TAB,
              item.attributeId,
              { is_primary: "FALSE" },
              "attribute_id",
              resolved.tenant.tenantKey,
            ),
          ),
      );
    }

    const attributeId = targetAttributeId || buildAttributeId(resolved.tenant.tenantKey, personId, attributeType);
    if (!targetAttributeId) {
      await createTableRecord(
        PERSON_ATTRIBUTES_TAB,
        {
          attribute_id: attributeId,
          entity_type: "person",
          entity_id: personId,
          person_id: personId,
          attribute_type: attributeType,
          value_text: uploaded.fileId,
          value_json: mediaMetadata,
          label: shouldBePrimary ? "headshot" : label,
          is_primary: shouldBePrimary ? "TRUE" : "FALSE",
          sort_order: "0",
          start_date: effectivePhotoDate,
          end_date: "",
          visibility: "family",
          share_scope: shareScope,
          share_family_group_key: shareFamilyGroupKey,
          notes: description,
        },
        resolved.tenant.tenantKey,
      );
    } else {
      const targetAttribute = await getAttributeById(resolved.tenant.tenantKey, targetAttributeId);
      if (!targetAttribute || targetAttribute.entityType !== "person" || targetAttribute.entityId !== personId) {
        return NextResponse.json({ error: "invalid_payload", message: "attributeId is not valid for this person" }, { status: 400 });
      }
    }

    const mediaId = buildMediaId(uploaded.fileId);
    const personUsageType = shouldBePrimary ? "profile" : attributeType === "photo" ? "gallery" : "media";
    const personLinkId = buildMediaLinkId(
      resolved.tenant.tenantKey,
      "person",
      personId,
      uploaded.fileId,
      personUsageType,
    );
    const attributeLinkId = buildMediaLinkId(
      resolved.tenant.tenantKey,
      "attribute",
      attributeId,
      uploaded.fileId,
      attributeType === "photo" ? "photo" : "media",
    );

    await upsertOciMediaAsset({
      mediaId,
      fileId: uploaded.fileId,
      storageProvider: "gdrive",
      mimeType: validated.mimeType,
      fileName: safeFileName,
      fileSizeBytes: String(bytes.length),
      mediaMetadata,
      createdAt: createdAtIso,
    });
    if (!targetAttributeId) {
      await upsertOciMediaLink({
        familyGroupKey: resolved.tenant.tenantKey,
        linkId: personLinkId,
        mediaId,
        entityType: "person",
        entityId: personId,
        usageType: personUsageType,
        label: shouldBePrimary ? "headshot" : label,
        description,
        photoDate: effectivePhotoDate,
        isPrimary: shouldBePrimary,
        sortOrder: 0,
        mediaMetadata,
        createdAt: createdAtIso,
      });
      if (shouldBePrimary) {
        await setOciPrimaryMediaLink({
          familyGroupKey: resolved.tenant.tenantKey,
          entityType: "person",
          entityId: personId,
          usageType: "profile",
          linkId: personLinkId,
        });
      }
    }
    await upsertOciMediaLink({
      familyGroupKey: resolved.tenant.tenantKey,
      linkId: attributeLinkId,
      mediaId,
      entityType: "attribute",
      entityId: attributeId,
      usageType: attributeType === "photo" ? "photo" : "media",
      label: shouldBePrimary ? "headshot" : label,
      description,
      photoDate: effectivePhotoDate,
      isPrimary: shouldBePrimary,
      sortOrder: 0,
      mediaMetadata,
      createdAt: createdAtIso,
    });

    if (!targetAttributeId && shouldBePrimary) {
      await updateTableRecordById(
        PEOPLE_TAB,
        personId,
        { photo_file_id: uploaded.fileId },
        "person_id",
        resolved.tenant.tenantKey,
      );
    }

    return NextResponse.json({
      ok: true,
      tenantKey: resolved.tenant.tenantKey,
      personId,
      fileId: uploaded.fileId,
      isHeadshot: shouldBePrimary,
      attributeType,
      attributeId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected upload failure";
    console.error("[photos/upload] failed", error);
    return NextResponse.json(
      {
        error: "upload_failed",
        message,
        hint: "Confirm service account Drive access to the target photos folder.",
      },
      { status: 500 },
    );
  }
}
