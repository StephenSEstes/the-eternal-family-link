import { NextResponse } from "next/server";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { refinePhotoCaptionWithOpenAi } from "@/lib/ai/photo-caption";
import { getPeople } from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";
import {
  buildPhotoIntelligenceSuggestion,
  canRunPhotoIntelligence,
  readPhotoIntelligenceDebug,
  readPhotoIntelligenceSuggestion,
  type PhotoIntelligenceDebug,
} from "@/lib/media/photo-intelligence";
import { extractExifDateSignal } from "@/lib/media/exif";
import { getOciObjectContentByKey } from "@/lib/oci/object-storage";
import {
  getOciMediaAssetByFileId,
  getOciMediaLinksForFile,
  updateOciMediaMetadataForFile,
} from "@/lib/oci/tables";
import { analyzeInlineImageWithVision, isOciVisionConfigured, type OciVisionInsight } from "@/lib/oci/vision";

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

function readOriginalObjectKey(metadata: Record<string, unknown>) {
  const objectStorage = metadata.objectStorage;
  if (objectStorage && typeof objectStorage === "object") {
    const key = String((objectStorage as Record<string, unknown>).originalObjectKey ?? "").trim();
    if (key) return key;
  }
  const fallback = String(metadata.originalObjectKey ?? "").trim();
  return fallback;
}

export async function POST(request: Request, { params }: RouteProps) {
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
      cached: true,
    });
  }

  const peopleById = new Map(people.map((item) => [item.personId, item.displayName]));
  const linkedPeople = links
    .filter((item) => norm(item.entityType) === "person")
    .map((item) => peopleById.get(item.entityId) || item.entityId)
    .filter((value, index, array) => Boolean(value) && array.indexOf(value) === index);

  const originalObjectKey = readOriginalObjectKey(parsedMetadata);
  let sourceBytes: Buffer | null = null;
  let sourceReadErrorMessage = "";
  if (originalObjectKey) {
    try {
      const source = await getOciObjectContentByKey(originalObjectKey);
      sourceBytes = Buffer.from(source.data);
    } catch (sourceError) {
      sourceReadErrorMessage = sourceError instanceof Error ? sourceError.message : "Unable to read OCI object bytes.";
      console.warn("[photo-intelligence] failed to load OCI object bytes", sourceError);
    }
  }

  const exifDateSignal = sourceBytes ? await extractExifDateSignal(sourceBytes) : null;
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
  if (visionConfigured) {
    try {
      if (sourceBytes) {
        visionAttempted = true;
        vision = await analyzeInlineImageWithVision({
          imageBytes: sourceBytes,
        });
        visionSucceeded = true;
        visionRawResult = JSON.stringify(
          {
            labels: vision.labels,
            objects: vision.objects,
            faceCount: vision.faceCount,
          },
          null,
          2,
        );
      } else if (sourceReadErrorMessage) {
        visionErrorMessage = sourceReadErrorMessage;
      } else {
        visionErrorMessage = "Missing originalObjectKey in media metadata.";
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
  };

  const fileName = String(parsedMetadata.fileName ?? links[0]?.fileName ?? normalizedFileId).trim() || normalizedFileId;
  const initialGenerated = buildPhotoIntelligenceSuggestion({
    fileId: normalizedFileId,
    fileName,
    createdAt: String(parsedMetadata.createdAt ?? "").trim(),
    linkedPeople,
    existingMetadata: baseMetadata,
    dateSignal: exifDateSignal,
    vision,
    debug,
  });
  let generated = initialGenerated;
  if (visionSucceeded && vision) {
    try {
      const captionRefinement = await refinePhotoCaptionWithOpenAi({
        tenantName: resolved.tenant.tenantName,
        fileName,
        linkedPeople,
        vision,
        fallbackLabel: initialGenerated.suggestion.labelSuggestion,
        fallbackDescription: initialGenerated.suggestion.descriptionSuggestion,
      });
      if (captionRefinement) {
        generated = buildPhotoIntelligenceSuggestion({
          fileId: normalizedFileId,
          fileName,
          createdAt: String(parsedMetadata.createdAt ?? "").trim(),
          linkedPeople,
          existingMetadata: baseMetadata,
          dateSignal: exifDateSignal,
          captionRefinement,
          vision,
          debug,
        });
      }
    } catch (captionError) {
      console.warn("[photo-intelligence] openai caption refinement skipped", captionError);
    }
  }

  await updateOciMediaMetadataForFile({
    familyGroupKey: resolved.tenant.tenantKey,
    fileId: normalizedFileId,
    mediaMetadata: generated.mediaMetadata,
  });

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
    cached: false,
  });
}
