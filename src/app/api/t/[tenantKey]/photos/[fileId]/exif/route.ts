import { NextResponse } from "next/server";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { resolvePhotoContentAcrossFamilies } from "@/lib/google/photo-resolver";
import { collectPersistedExifData } from "@/lib/media/exif";
import { writeMediaProcessingStatus } from "@/lib/media/processing-status";
import { getMediaProcessingStatusForFile } from "@/lib/media/processing-status.server";
import { inferStoredMediaKind } from "@/lib/media/upload";
import {
  getOciMediaAssetByFileId,
  getOciMediaLinksForFile,
  updateOciMediaMetadataForFile,
} from "@/lib/oci/tables";

type RouteProps = {
  params: Promise<{ tenantKey: string; fileId: string }>;
};

export async function POST(_: Request, { params }: RouteProps) {
  const { tenantKey, fileId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const normalizedFileId = fileId.trim();
  if (!normalizedFileId) {
    return NextResponse.json({ error: "invalid_file_id" }, { status: 400 });
  }

  const [asset, links] = await Promise.all([
    getOciMediaAssetByFileId(normalizedFileId).catch(() => null),
    getOciMediaLinksForFile({
      familyGroupKey: resolved.tenant.tenantKey,
      fileId: normalizedFileId,
    }).catch(() => []),
  ]);

  if (!asset) {
    return NextResponse.json({ error: "media_asset_not_found" }, { status: 404 });
  }

  const baseMetadata = (asset.mediaMetadata || links[0]?.mediaMetadata || "").trim();
  if (inferStoredMediaKind(normalizedFileId, baseMetadata) !== "image") {
    return NextResponse.json(
      {
        error: "unsupported_media_type",
        message: "EXIF can only be loaded for image files.",
      },
      { status: 400 },
    );
  }

  let nextMediaMetadata = baseMetadata;
  let exifExtractedAt = asset.exifExtractedAt?.trim() || "";
  let exifSourceTag = asset.exifSourceTag?.trim() || "";
  let exifCaptureDate = asset.exifCaptureDate?.trim() || "";
  let exifCaptureTimestampRaw = asset.exifCaptureTimestampRaw?.trim() || "";
  let exifMake = asset.exifMake?.trim() || "";
  let exifModel = asset.exifModel?.trim() || "";
  let exifSoftware = asset.exifSoftware?.trim() || "";
  let exifWidth = asset.exifWidth;
  let exifHeight = asset.exifHeight;
  let exifOrientation = asset.exifOrientation;
  let exifFingerprint = asset.exifFingerprint?.trim() || "";

  if (!exifExtractedAt) {
    const source = await resolvePhotoContentAcrossFamilies(normalizedFileId, resolved.tenant.tenantKey, {
      variant: "original",
    });
    const persistedExif = await collectPersistedExifData(Buffer.from(source.data));
    exifExtractedAt = persistedExif.extractedAt;
    exifSourceTag = persistedExif.sourceTag;
    exifCaptureDate = persistedExif.captureDate;
    exifCaptureTimestampRaw = persistedExif.captureTimestampRaw;
    exifMake = persistedExif.make;
    exifModel = persistedExif.model;
    exifSoftware = persistedExif.software;
    exifWidth = persistedExif.width;
    exifHeight = persistedExif.height;
    exifOrientation = persistedExif.orientation;
    exifFingerprint = persistedExif.fingerprint;

    await updateOciMediaMetadataForFile({
      familyGroupKey: resolved.tenant.tenantKey,
      fileId: normalizedFileId,
      mediaMetadata: baseMetadata,
      exifExtractedAt,
      exifSourceTag,
      exifCaptureDate,
      exifCaptureTimestampRaw,
      exifMake,
      exifModel,
      exifSoftware,
      exifWidth,
      exifHeight,
      exifOrientation,
      exifFingerprint,
    });
  }

  const processingStatus = await getMediaProcessingStatusForFile({
    familyGroupKey: resolved.tenant.tenantKey,
    fileId: normalizedFileId,
    mediaMetadata: nextMediaMetadata,
    asset: {
      ...asset,
      mediaMetadata: nextMediaMetadata,
      exifExtractedAt,
      exifSourceTag,
      exifCaptureDate,
      exifCaptureTimestampRaw,
      exifMake,
      exifModel,
      exifSoftware,
      exifWidth,
      exifHeight,
      exifOrientation,
      exifFingerprint,
    },
    preferFresh: true,
  });
  nextMediaMetadata = writeMediaProcessingStatus(nextMediaMetadata, processingStatus);
  if (nextMediaMetadata !== baseMetadata) {
    await updateOciMediaMetadataForFile({
      familyGroupKey: resolved.tenant.tenantKey,
      fileId: normalizedFileId,
      mediaMetadata: nextMediaMetadata,
      exifExtractedAt,
      exifSourceTag,
      exifCaptureDate,
      exifCaptureTimestampRaw,
      exifMake,
      exifModel,
      exifSoftware,
      exifWidth,
      exifHeight,
      exifOrientation,
      exifFingerprint,
    });
  }

  await appendSessionAuditLog(resolved.session, {
    action: "UPDATE",
    entityType: "MEDIA_EXIF",
    entityId: normalizedFileId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `Loaded EXIF for file=${normalizedFileId}.`,
  });

  return NextResponse.json({
    ok: true,
    fileId: normalizedFileId,
    mediaMetadata: nextMediaMetadata,
    processingStatus,
    exifExtractedAt,
  });
}
