import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { buildEntityId } from "@/lib/entity-id";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { buildMediaFileId, buildMediaId, buildMediaLinkId } from "@/lib/media/ids";
import {
  buildMediaMetadata,
  fallbackUploadExtension,
  sanitizeUploadFileName,
  validateUploadInput,
} from "@/lib/media/upload";
import { collectPersistedExifData } from "@/lib/media/exif";
import { buildMediaProcessingStatus, writeMediaProcessingStatus } from "@/lib/media/processing-status";
import { createImageThumbnailVariant } from "@/lib/media/thumbnail.server";
import { getOciObjectStorageLocation, putOciObjectByKey } from "@/lib/oci/object-storage";
import { setOciPrimaryMediaLink, upsertOciMediaAsset, upsertOciMediaLink } from "@/lib/oci/tables";
import { getAttributeById } from "@/lib/attributes/store";
import {
  getTableRecords,
} from "@/lib/data/runtime";

type UploadRouteProps = {
  params: Promise<{ tenantKey: string; householdId: string }>;
};

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeDateFromTimestamp(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function sanitizeObjectNameSegment(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "file";
}

export async function POST(request: Request, { params }: UploadRouteProps) {
  try {
    const { tenantKey, householdId } = await params;
    const resolved = await requireTenantAccess(tenantKey);
    if ("error" in resolved) {
      return resolved.error;
    }

    const households = await getTableRecords("Households", resolved.tenant.tenantKey);
    const exists = households.some((row) => (row.data.household_id ?? "").trim() === householdId);
    if (!exists) {
      return NextResponse.json({ error: "household_not_found" }, { status: 404 });
    }

    const formData = await request.formData().catch(() => null);
    const fileField = formData?.get("file");
    if (!fileField || typeof fileField === "string" || typeof (fileField as Blob).arrayBuffer !== "function") {
      return NextResponse.json({ error: "invalid_payload", message: "file is required" }, { status: 400 });
    }
    const file = fileField as Blob & { name?: string; type?: string };

    const name = String(formData?.get("name") ?? "").trim();
    const description = String(formData?.get("description") ?? "").trim();
    const requestedPhotoDate = String(formData?.get("photoDate") ?? "").trim();
    const fileCreatedAt = String(formData?.get("fileCreatedAt") ?? "").trim();
    const mediaWidth = String(formData?.get("mediaWidth") ?? "").trim();
    const mediaHeight = String(formData?.get("mediaHeight") ?? "").trim();
    const mediaDurationSec = String(formData?.get("mediaDurationSec") ?? "").trim();
    const captureSource = String(formData?.get("captureSource") ?? "").trim();
    const requestedPrimary = String(formData?.get("isPrimary") ?? "").trim().toLowerCase() === "true";
    const targetAttributeId = String(formData?.get("attributeId") ?? "").trim();

    const bytes = Buffer.from(await file.arrayBuffer());
    const validated = validateUploadInput({ byteLength: bytes.length, mimeType: file.type, fileName: file.name });
    if (!validated.ok) {
      return NextResponse.json({ error: "invalid_payload", message: validated.error }, { status: 400 });
    }

    const createdAtIso = !Number.isNaN(new Date(fileCreatedAt).getTime())
      ? new Date(fileCreatedAt).toISOString()
      : new Date().toISOString();
    const effectivePhotoDate = requestedPhotoDate || normalizeDateFromTimestamp(createdAtIso);
    const safeFileName = sanitizeUploadFileName(
      file.name || "",
      `${householdId}-${Date.now()}.${fallbackUploadExtension(validated.mediaKind, validated.mimeType, file.name)}`,
    );
    const objectStorage = getOciObjectStorageLocation();
    if (!objectStorage) {
      return NextResponse.json(
        { error: "storage_not_configured", message: "OCI object storage is not configured for uploads." },
        { status: 500 },
      );
    }
    const fileId = buildMediaFileId();
    const originalObjectKey = `${objectStorage.objectPrefix}/original/${sanitizeObjectNameSegment(resolved.tenant.tenantKey)}/${sanitizeObjectNameSegment(householdId)}/${sanitizeObjectNameSegment(fileId)}/${safeFileName}`;
    await putOciObjectByKey({
      objectKey: originalObjectKey,
      mimeType: validated.mimeType,
      data: bytes,
    });

    let thumbnailUpload:
      | {
        objectKey: string;
        mimeType: string;
        width: number;
        height: number;
        sizeBytes: number;
      }
      | null = null;
    if (validated.mediaKind === "image") {
      try {
        const thumbVariant = await createImageThumbnailVariant({
          source: bytes,
          mimeType: validated.mimeType,
        });
        if (thumbVariant) {
          const thumbName = sanitizeObjectNameSegment(
            safeFileName.replace(/\.[^.]+$/, "") + `-thumb.${thumbVariant.extension}`,
          );
          const thumbObjectKey = `${objectStorage.objectPrefix}/thumb/${sanitizeObjectNameSegment(resolved.tenant.tenantKey)}/${sanitizeObjectNameSegment(householdId)}/${sanitizeObjectNameSegment(fileId)}/${thumbName}`;
          await putOciObjectByKey({
            objectKey: thumbObjectKey,
            mimeType: thumbVariant.mimeType,
            data: thumbVariant.buffer,
          });
          thumbnailUpload = {
            objectKey: thumbObjectKey,
            mimeType: thumbVariant.mimeType,
            width: thumbVariant.width,
            height: thumbVariant.height,
            sizeBytes: thumbVariant.buffer.length,
          };
        }
      } catch (thumbError) {
        console.warn("[household/photos/upload] thumbnail generation skipped", thumbError);
      }
    }

    const persistedExif = validated.mediaKind === "image"
      ? await collectPersistedExifData(bytes)
      : null;

    const baseMediaMetadata = buildMediaMetadata({
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
        objectStorage: {
          provider: "oci_object",
          namespace: objectStorage.namespace,
          bucketName: objectStorage.bucketName,
          originalObjectKey,
          thumbnailObjectKey: thumbnailUpload?.objectKey || "",
          migratedAt: new Date().toISOString(),
          sourceFileId: fileId,
        },
        thumbnailObjectKey: thumbnailUpload?.objectKey,
        thumbnailMimeType: thumbnailUpload?.mimeType,
        thumbnailWidth: thumbnailUpload?.width,
        thumbnailHeight: thumbnailUpload?.height,
        thumbnailSizeBytes: thumbnailUpload?.sizeBytes,
      },
    });
    const mediaMetadata = writeMediaProcessingStatus(
      baseMediaMetadata,
      buildMediaProcessingStatus({
        fileId,
        rawMetadata: baseMediaMetadata,
        exifExtractedAt: persistedExif?.extractedAt,
        exifCaptureDate: persistedExif?.captureDate,
      }),
    );

    let photoId = buildEntityId("attr", `${resolved.tenant.tenantKey}|${householdId}|${Date.now()}|${fileId}`);
    let shouldBePrimary = !targetAttributeId && requestedPrimary;
    const existing = await getTableRecords("MediaLinks", resolved.tenant.tenantKey).catch(() => []);
    const existingForHousehold = existing.filter(
      (row) =>
        normalize(row.data.family_group_key) === normalize(resolved.tenant.tenantKey) &&
        normalize(row.data.entity_type) === "household" &&
        (row.data.entity_id ?? "").trim() === householdId &&
        normalize(row.data.usage_type) === "gallery",
    );
    shouldBePrimary = !targetAttributeId && (requestedPrimary || existingForHousehold.length === 0);
    const mediaId = buildMediaId(fileId);
    const linkId = buildMediaLinkId(resolved.tenant.tenantKey, "household", householdId, fileId, "gallery");
    photoId = linkId;
    await upsertOciMediaAsset({
      mediaId,
      fileId,
      storageProvider: "oci_object",
      mimeType: validated.mimeType,
      fileName: safeFileName,
      fileSizeBytes: String(bytes.length),
      mediaMetadata,
      createdAt: createdAtIso,
      exifExtractedAt: persistedExif?.extractedAt,
      exifSourceTag: persistedExif?.sourceTag,
      exifCaptureDate: persistedExif?.captureDate,
      exifCaptureTimestampRaw: persistedExif?.captureTimestampRaw,
      exifMake: persistedExif?.make,
      exifModel: persistedExif?.model,
      exifSoftware: persistedExif?.software,
      exifWidth: persistedExif?.width,
      exifHeight: persistedExif?.height,
      exifOrientation: persistedExif?.orientation,
      exifFingerprint: persistedExif?.fingerprint,
    });
    if (!targetAttributeId) {
      await upsertOciMediaLink({
        familyGroupKey: resolved.tenant.tenantKey,
        linkId,
        mediaId,
        entityType: "household",
        entityId: householdId,
        usageType: "gallery",
        label: name || file.name || "photo",
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
          entityType: "household",
          entityId: householdId,
          usageType: "gallery",
          linkId,
        });
      }
    }
    if (targetAttributeId) {
      const targetAttribute = await getAttributeById(resolved.tenant.tenantKey, targetAttributeId);
      if (!targetAttribute || targetAttribute.entityType !== "household" || targetAttribute.entityId !== householdId) {
        return NextResponse.json({ error: "invalid_payload", message: "attributeId is not valid for this household" }, { status: 400 });
      }
      const attributeLinkId = buildMediaLinkId(
        resolved.tenant.tenantKey,
        "attribute",
        targetAttributeId,
        fileId,
        "media",
      );
      await upsertOciMediaLink({
        familyGroupKey: resolved.tenant.tenantKey,
        linkId: attributeLinkId,
        mediaId,
        entityType: "attribute",
        entityId: targetAttributeId,
        usageType: "media",
        label: name || file.name || "photo",
        description,
        photoDate: effectivePhotoDate,
        isPrimary: false,
        sortOrder: 0,
        mediaMetadata,
        createdAt: createdAtIso,
      });
    }

    await appendSessionAuditLog(resolved.session, {
      action: "UPLOAD",
      entityType: targetAttributeId ? "ATTRIBUTE_MEDIA" : "HOUSEHOLD_MEDIA",
      entityId: fileId,
      familyGroupKey: resolved.tenant.tenantKey,
      status: "SUCCESS",
      details: targetAttributeId
        ? `Uploaded media for household attribute=${targetAttributeId}, household=${householdId}.`
        : `Uploaded household media for household=${householdId}, primary=${String(shouldBePrimary)}.`,
    });

    return NextResponse.json({
      ok: true,
      tenantKey: resolved.tenant.tenantKey,
      householdId,
      photoId,
      fileId,
      isPrimary: shouldBePrimary,
      attributeId: targetAttributeId || "",
      mediaMetadata,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected upload failure";
    return NextResponse.json(
      {
        error: "upload_failed",
        message,
        hint: "Confirm OCI object storage configuration and write permissions.",
      },
      { status: 500 },
    );
  }
}
