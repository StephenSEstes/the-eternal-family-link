import { NextResponse } from "next/server";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { writeMediaProcessingStatus } from "@/lib/media/processing-status";
import { getMediaProcessingStatusForFile } from "@/lib/media/processing-status.server";
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

  if (!asset && links.length === 0) {
    return NextResponse.json({ error: "media_not_found" }, { status: 404 });
  }

  const baseMetadata = (asset?.mediaMetadata || links[0]?.mediaMetadata || "").trim();
  const processingStatus = await getMediaProcessingStatusForFile({
    familyGroupKey: resolved.tenant.tenantKey,
    fileId: normalizedFileId,
    mediaMetadata: baseMetadata,
    asset,
    preferFresh: true,
  });
  const nextMediaMetadata = writeMediaProcessingStatus(baseMetadata, processingStatus);
  if (nextMediaMetadata !== baseMetadata) {
    await updateOciMediaMetadataForFile({
      familyGroupKey: resolved.tenant.tenantKey,
      fileId: normalizedFileId,
      mediaMetadata: nextMediaMetadata,
    });
  }

  await appendSessionAuditLog(resolved.session, {
    action: "UPDATE",
    entityType: "MEDIA_PROCESSING_STATUS",
    entityId: normalizedFileId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `Refreshed media processing status for file=${normalizedFileId}.`,
  });

  return NextResponse.json({
    ok: true,
    fileId: normalizedFileId,
    processingStatus,
    mediaMetadata: nextMediaMetadata,
    exifExtractedAt: asset?.exifExtractedAt?.trim() || "",
  });
}
