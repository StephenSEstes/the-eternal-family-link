import { NextResponse } from "next/server";
import { getPeople } from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/tenant/guard";
import { resolvePhotoContentAcrossFamilies } from "@/lib/google/photo-resolver";
import {
  getOciFaceInstancesForFile,
  getOciFaceMatchesForFile,
  getOciMediaAssetByFileId,
  replaceOciFaceAnalysisForFile,
} from "@/lib/oci/tables";
import { detectFacesInlineWithVision, isOciVisionConfigured } from "@/lib/oci/vision";

type RouteProps = {
  params: Promise<{ tenantKey: string; fileId: string }>;
};

function buildFaceId(fileId: string, faceIndex: number, bbox: { x: number; y: number; width: number; height: number }) {
  const stable = (value: number) => Number.isFinite(value) ? value.toFixed(6) : "0";
  const seed = `${fileId}|${faceIndex}|${stable(bbox.x)}|${stable(bbox.y)}|${stable(bbox.width)}|${stable(bbox.height)}`;
  return `face-${Buffer.from(seed).toString("hex").slice(0, 12)}`;
}

function parseMatchMetadata(raw: string | null | undefined): Record<string, unknown> {
  const value = String(raw ?? "").trim();
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function listFaces(familyGroupKey: string, fileId: string) {
  const [instances, matches] = await Promise.all([
    getOciFaceInstancesForFile({ familyGroupKey, fileId }).catch(() => []),
    getOciFaceMatchesForFile({ familyGroupKey, fileId }).catch(() => []),
  ]);
  const matchesByFace = new Map<string, typeof matches>();
  for (const match of matches) {
    const list = matchesByFace.get(match.faceId) ?? [];
    list.push(match);
    matchesByFace.set(match.faceId, list);
  }
  return instances.map((instance) => {
    const faceMatches = matchesByFace.get(instance.faceId) ?? [];
    const linked =
      faceMatches.find((m) => m.matchStatus === "linked" || m.matchStatus === "confirmed") ??
      faceMatches.find((m) => m.matchStatus === "not_family") ??
      faceMatches[0];
    const metadata = linked ? parseMatchMetadata(linked.matchMetadata) : {};
    return {
      faceId: instance.faceId,
      bbox: {
        x: instance.bboxX,
        y: instance.bboxY,
        width: instance.bboxW,
        height: instance.bboxH,
      },
      detectionConfidence: instance.detectionConfidence,
      qualityScore: instance.qualityScore,
      embeddingPresent: !!instance.embeddingJson && instance.embeddingJson.trim() !== "[]",
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
      link: linked
        ? {
            personId: linked.candidatePersonId?.trim() || "",
            status: linked.matchStatus,
            label: typeof metadata.label === "string" ? metadata.label : "",
            note: typeof metadata.note === "string" ? metadata.note : "",
            reviewedBy: linked.reviewedBy,
            reviewedAt: linked.reviewedAt,
            confidenceScore: linked.confidenceScore,
          }
        : null,
    };
  });
}

export async function GET(request: Request, { params }: RouteProps) {
  try {
    const { tenantKey, fileId } = await params;
    const resolved = await requireTenantAccess(tenantKey);
    if ("error" in resolved) return resolved.error;
    const faces = await listFaces(resolved.tenant.tenantKey, fileId.trim());
    return NextResponse.json({
      ok: true,
      faces,
      debug: { fetchedAt: new Date().toISOString(), faceCount: faces.length },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "list_failed", message: (error as Error)?.message ?? "unknown_error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, { params }: RouteProps) {
  const routeStartedAt = Date.now();
  const { tenantKey, fileId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) return resolved.error;

  const normalizedFileId = fileId.trim();
  if (!normalizedFileId) {
    return NextResponse.json({ error: "invalid_file_id" }, { status: 400 });
  }
  if (!isOciVisionConfigured()) {
    return NextResponse.json({ error: "vision_not_configured" }, { status: 503 });
  }

  const asset = await getOciMediaAssetByFileId(normalizedFileId).catch(() => null);
  if (!asset) {
    return NextResponse.json({ error: "media_not_found" }, { status: 404 });
  }

  try {
    const [content, people] = await Promise.all([
      resolvePhotoContentAcrossFamilies(normalizedFileId, resolved.tenant.tenantKey, { variant: "original" }),
      getPeople(resolved.tenant.tenantKey).catch(() => []),
    ]);

    const visionStartedAt = Date.now();
    const detection = await detectFacesInlineWithVision({ imageBytes: Buffer.from(content.data) });
    const visionMs = Date.now() - visionStartedAt;

    const timestamp = new Date().toISOString();
    await replaceOciFaceAnalysisForFile({
      familyGroupKey: resolved.tenant.tenantKey,
      fileId: normalizedFileId,
      instances: detection.faces.map((face, index) => ({
        faceId: buildFaceId(normalizedFileId, index, face.boundingBox),
        bboxX: face.boundingBox.x,
        bboxY: face.boundingBox.y,
        bboxW: face.boundingBox.width,
        bboxH: face.boundingBox.height,
        detectionConfidence: face.confidence,
        qualityScore: face.qualityScore,
        embeddingJson: JSON.stringify(face.embedding ?? []),
        createdAt: timestamp,
        updatedAt: timestamp,
        matches: [],
      })),
    });

    const faces = await listFaces(resolved.tenant.tenantKey, normalizedFileId);
    return NextResponse.json({
      ok: true,
      faces,
      debug: {
        routeMs: Date.now() - routeStartedAt,
        visionMs,
        faceCount: detection.faces.length,
        peopleLoaded: people.length,
      },
    });
  } catch (error) {
    const err = error as {
      message?: string;
      statusCode?: number;
      serviceCode?: string;
      opcRequestId?: string;
      rawBody?: string;
      code?: string;
    };
    console.error("[faces] vision_failed", {
      fileId: normalizedFileId,
      tenantKey: resolved.tenant.tenantKey,
      message: err?.message,
      statusCode: err?.statusCode,
      serviceCode: err?.serviceCode ?? err?.code,
      opcRequestId: err?.opcRequestId,
      rawBody: err?.rawBody,
    });
    return NextResponse.json(
      {
        ok: false,
        error: "vision_failed",
        message: err?.message ?? "vision_error",
        debug: {
          routeMs: Date.now() - routeStartedAt,
          statusCode: err?.statusCode ?? null,
          serviceCode: err?.serviceCode ?? err?.code ?? null,
          opcRequestId: err?.opcRequestId ?? null,
          rawBody: err?.rawBody ?? null,
        },
      },
      { status: 500 },
    );
  }
}
