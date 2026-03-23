import { NextResponse } from "next/server";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { getPeople } from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";
import {
  buildPhotoIntelligenceSuggestion,
  canRunPhotoIntelligence,
  readPhotoIntelligenceDebug,
  readPhotoIntelligenceSuggestion,
  type PhotoIntelligenceDebug,
} from "@/lib/media/photo-intelligence";
import {
  buildDateSignalFromPersistedExif,
  collectPersistedExifData,
  readPersistedExifData,
} from "@/lib/media/exif";
import { resolvePhotoContentAcrossFamilies } from "@/lib/google/photo-resolver";
import { buildAndPersistFaceSuggestions } from "@/lib/media/face-recognition";
import { resolvePersonDisplayName } from "@/lib/person/display-name";
import {
  getOciMediaAssetByFileId,
  getOciMediaLinksForFile,
  updateOciMediaMetadataForFile,
} from "@/lib/oci/tables";
import { detectFacesInlineWithVision, isOciVisionConfigured, type OciVisionInsight } from "@/lib/oci/vision";

type RouteProps = {
  params: Promise<{ tenantKey: string; fileId: string }>;
};

function norm(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function parseMetadata(raw: string): Record<string, unknown> {
  const value = raw.trim();
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function POST(request: Request, { params }: RouteProps) {
  const routeStartedAt = Date.now();
  const { tenantKey, fileId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const normalizedFileId = fileId.trim();
  if (!normalizedFileId) {
    return NextResponse.json({ error: "invalid_file_id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const forceValue = (body as { force?: string | boolean } | null)?.force;
  const force = forceValue === true || norm(String(forceValue ?? "")) === "true";

  const [asset, links, people] = await Promise.all([
    getOciMediaAssetByFileId(normalizedFileId),
    getOciMediaLinksForFile({
      familyGroupKey: resolved.tenant.tenantKey,
      fileId: normalizedFileId,
    }).catch(() => []),
    getPeople(resolved.tenant.tenantKey),
  ]);

  if (!asset && links.length === 0) {
    return NextResponse.json({ error: "media_not_found" }, { status: 404 });
  }

  const baseMetadata = (asset?.mediaMetadata || links[0]?.mediaMetadata || "").trim();
  const parsedMetadata = parseMetadata(baseMetadata);
  if (!canRunPhotoIntelligence(normalizedFileId, baseMetadata)) {
    return NextResponse.json({
      ok: true,
      fileId: normalizedFileId,
      skipped: true,
      reason: "only_image_supported",
    });
  }

  const existing = readPhotoIntelligenceSuggestion(baseMetadata);
  if (existing && !force) {
    const debug = readPhotoIntelligenceDebug(baseMetadata);
    return NextResponse.json({
      ok: true,
      fileId: normalizedFileId,
      suggestion: existing,
      debug,
      mediaMetadata: baseMetadata,
      cached: true,
    });
  }

  const peopleById = new Map(
    people
      .map((item) => [
        item.personId.trim(),
        resolvePersonDisplayName({
          personId: item.personId,
          displayName: item.displayName,
          firstName: item.firstName,
          middleName: item.middleName,
          lastName: item.lastName,
        }),
      ] as const)
      .filter(([personId]) => Boolean(personId)),
  );
  const linkedPeople = links
    .filter((item) => norm(item.entityType) === "person")
    .map((item) => {
      const personId = item.entityId.trim();
      return peopleById.get(personId) || personId;
    })
    .filter((value, index, array) => Boolean(value) && array.indexOf(value) === index);

  let sourceBytes: Buffer | null = null;
  let sourceReadErrorMessage = "";
  const sourceLoadStartedAt = Date.now();
  try {
    const source = await resolvePhotoContentAcrossFamilies(normalizedFileId, resolved.tenant.tenantKey, { variant: "original" });
    sourceBytes = Buffer.from(source.data);
  } catch (sourceError) {
    sourceReadErrorMessage = sourceError instanceof Error ? sourceError.message : "Unable to load source image bytes.";
    console.warn("[photo-intelligence] failed to load source image bytes", sourceError);
  }
  const sourceLoadLatencyMs = Date.now() - sourceLoadStartedAt;

  const exifStartedAt = Date.now();
  const persistedExif = readPersistedExifData(
    asset
      ? {
        extractedAt: asset.exifExtractedAt,
        sourceTag: asset.exifSourceTag,
        captureDate: asset.exifCaptureDate,
        captureTimestampRaw: asset.exifCaptureTimestampRaw,
        make: asset.exifMake,
        model: asset.exifModel,
        software: asset.exifSoftware,
        width: asset.exifWidth,
        height: asset.exifHeight,
        orientation: asset.exifOrientation,
        fingerprint: asset.exifFingerprint,
      }
      : null,
  );
  const collectedExif = persistedExif ?? (sourceBytes ? await collectPersistedExifData(sourceBytes) : null);
  const exifLatencyMs = Date.now() - exifStartedAt;
  const exifDateSignal = buildDateSignalFromPersistedExif(collectedExif);
  const visionConfigured = isOciVisionConfigured();
  let vision: OciVisionInsight | null = null;
  let visionAttempted = false;
  let visionSucceeded = false;
  let visionErrorMessage = "";
  let visionErrorCode = "";
  let visionStatusCode = "";
  let visionServiceCode = "";
  let visionOpcRequestId = "";
  let visionRawResult = "";
  let visionOuterLatencyMs = 0;
  if (visionConfigured) {
    try {
      if (sourceBytes) {
        visionAttempted = true;
        const visionStartedAt = Date.now();
        try {
          vision = await detectFacesInlineWithVision({
            imageBytes: sourceBytes,
          });
          visionOuterLatencyMs = Date.now() - visionStartedAt;
          visionSucceeded = true;
          visionRawResult = JSON.stringify(
            {
              analysisMode: "face_detection_only",
              labels: vision.labels,
              objects: vision.objects,
              faces: vision.faces.map((face) => ({
                confidence: face.confidence,
                qualityScore: face.qualityScore,
                boundingBox: face.boundingBox,
                embeddingLength: face.embedding.length,
              })),
              faceCount: vision.faceCount,
              embeddingAttempted: vision.embeddingAttempted,
              embeddingSucceeded: vision.embeddingSucceeded,
              embeddingErrorMessage: vision.embeddingErrorMessage,
              embeddingFacesReturned: vision.embeddingFacesReturned,
              embeddingFacesWithVectors: vision.embeddingFacesWithVectors,
              prepareLatencyMs: vision.prepareLatencyMs,
              visionRequestLatencyMs: vision.visionRequestLatencyMs,
              totalLatencyMs: vision.totalLatencyMs,
            },
            null,
            2,
          );
        } catch (visionError) {
          visionOuterLatencyMs = Date.now() - visionStartedAt;
          throw visionError;
        }
      } else if (sourceReadErrorMessage) {
        visionErrorMessage = sourceReadErrorMessage;
      }
    } catch (visionError) {
      const typed = visionError as {
        message?: string;
        code?: string;
        statusCode?: number;
        serviceCode?: string;
        opcRequestId?: string;
      };
      visionErrorMessage = String(typed?.message ?? "Vision analysis failed");
      visionErrorCode = String(typed?.code ?? "");
      visionStatusCode = String(typed?.statusCode ?? "");
      visionServiceCode = String(typed?.serviceCode ?? "");
      visionOpcRequestId = String(typed?.opcRequestId ?? "");
      console.warn("[photo-intelligence] vision analysis failed; falling back to heuristic suggestion", visionError);
    }
  }
  const debug: PhotoIntelligenceDebug = {
    generatedAt: new Date().toISOString(),
    visionConfigured,
    visionAttempted,
    visionSucceeded,
    visionErrorMessage,
    visionErrorCode,
    visionStatusCode,
    visionServiceCode,
    visionOpcRequestId,
    visionRawResult,
    embeddingAttempted: vision?.embeddingAttempted ?? false,
    embeddingSucceeded: vision?.embeddingSucceeded ?? false,
    embeddingErrorMessage: vision?.embeddingErrorMessage ?? "",
    embeddingFacesReturned: vision?.embeddingFacesReturned ?? 0,
    embeddingFacesWithVectors: vision?.embeddingFacesWithVectors ?? 0,
    sourceLoadLatencyMs,
    exifLatencyMs,
    visionPrepareLatencyMs: vision?.prepareLatencyMs ?? 0,
    visionRequestLatencyMs: vision?.visionRequestLatencyMs ?? visionOuterLatencyMs,
    visionTotalLatencyMs: vision?.totalLatencyMs ?? visionOuterLatencyMs,
    facePersistenceLatencyMs: 0,
    captionLatencyMs: 0,
    metadataUpdateLatencyMs: 0,
    routeTotalLatencyMs: 0,
  };

  const previousSuggestion = readPhotoIntelligenceSuggestion(baseMetadata);
  let faceSuggestions = previousSuggestion?.faceSuggestions ?? [];
  const facePersistenceStartedAt = Date.now();
  if (visionSucceeded && vision) {
    try {
      faceSuggestions = await buildAndPersistFaceSuggestions({
        familyGroupKey: resolved.tenant.tenantKey,
        fileId: normalizedFileId,
        faces: vision.faces,
        people,
      });
    } catch (faceError) {
      console.warn("[photo-intelligence] face suggestion persistence skipped", faceError);
    }
  }
  debug.facePersistenceLatencyMs = Date.now() - facePersistenceStartedAt;

  const fileName = String(parsedMetadata.fileName ?? links[0]?.fileName ?? normalizedFileId).trim() || normalizedFileId;
  const initialGenerated = buildPhotoIntelligenceSuggestion({
    fileId: normalizedFileId,
    fileName,
    createdAt: String(parsedMetadata.createdAt ?? "").trim(),
    linkedPeople,
    existingMetadata: baseMetadata,
    dateSignal: exifDateSignal,
    vision,
    faceSuggestions,
    debug,
  });
  const generated = initialGenerated;

  const metadataUpdateStartedAt = Date.now();
  await updateOciMediaMetadataForFile({
    familyGroupKey: resolved.tenant.tenantKey,
    fileId: normalizedFileId,
    mediaMetadata: generated.mediaMetadata,
    exifExtractedAt: persistedExif ? undefined : collectedExif?.extractedAt,
    exifSourceTag: persistedExif ? undefined : collectedExif?.sourceTag,
    exifCaptureDate: persistedExif ? undefined : collectedExif?.captureDate,
    exifCaptureTimestampRaw: persistedExif ? undefined : collectedExif?.captureTimestampRaw,
    exifMake: persistedExif ? undefined : collectedExif?.make,
    exifModel: persistedExif ? undefined : collectedExif?.model,
    exifSoftware: persistedExif ? undefined : collectedExif?.software,
    exifWidth: persistedExif ? undefined : collectedExif?.width,
    exifHeight: persistedExif ? undefined : collectedExif?.height,
    exifOrientation: persistedExif ? undefined : collectedExif?.orientation,
    exifFingerprint: persistedExif ? undefined : collectedExif?.fingerprint,
  });
  debug.metadataUpdateLatencyMs = Date.now() - metadataUpdateStartedAt;
  debug.routeTotalLatencyMs = Date.now() - routeStartedAt;

  await appendSessionAuditLog(resolved.session, {
    action: "UPDATE",
    entityType: "MEDIA_INTELLIGENCE",
    entityId: normalizedFileId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `Generated photo intelligence suggestions for file=${normalizedFileId}.`,
  });

  return NextResponse.json({
    ok: true,
    fileId: normalizedFileId,
    suggestion: generated.suggestion,
    debug,
    mediaMetadata: generated.mediaMetadata,
    cached: false,
  });
}
