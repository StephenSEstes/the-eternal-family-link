import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { requireTenantAccess } from "@/lib/tenant/guard";
import {
  getOciFaceInstancesForFile,
  getOciMediaAssetByFileId,
  replaceOciFaceMatchesForFace,
  upsertOciMediaLink,
} from "@/lib/oci/tables";

type RouteProps = {
  params: Promise<{ tenantKey: string; fileId: string; faceId: string }>;
};

type Payload = {
  personId?: string;
  label?: string;
  note?: string;
  status?: "linked" | "not_family" | "unknown";
};

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: Request, { params }: RouteProps) {
  const { tenantKey, fileId, faceId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) return resolved.error;

  const normalizedFileId = normalize(fileId);
  const normalizedFaceId = normalize(faceId);
  if (!normalizedFileId || !normalizedFaceId) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const payload = (await request.json().catch(() => ({}))) as Payload;
  const personId = normalize(payload.personId);
  const label = normalize(payload.label);
  const note = normalize(payload.note);
  const status: Payload["status"] =
    payload.status === "not_family" ? "not_family" : payload.status === "unknown" ? "unknown" : "linked";

  const faces = await getOciFaceInstancesForFile({
    familyGroupKey: resolved.tenant.tenantKey,
    fileId: normalizedFileId,
  }).catch(() => []);
  if (!faces.some((face) => normalize(face.faceId) === normalizedFaceId)) {
    return NextResponse.json({ error: "face_not_found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const matchMetadata = {
    label,
    note,
    status,
    updatedBy: resolved.session.user?.email ?? "",
    updatedAt: now,
  };

  await replaceOciFaceMatchesForFace({
    familyGroupKey: resolved.tenant.tenantKey,
    faceId: normalizedFaceId,
    matches: [
      {
        matchId: uuid(),
        candidatePersonId: personId || "",
        confidenceScore: personId ? 1 : 0,
        matchStatus: status,
        reviewedBy: resolved.session.user?.email ?? "",
        reviewedAt: now,
        createdAt: now,
        matchMetadata: JSON.stringify(matchMetadata),
      },
    ],
  });

  if (personId) {
    const asset = await getOciMediaAssetByFileId(normalizedFileId).catch(() => null);
    if (asset?.mediaId) {
      await upsertOciMediaLink({
        familyGroupKey: resolved.tenant.tenantKey,
        linkId: `mlink-${asset.mediaId}-${personId}`,
        mediaId: asset.mediaId,
        entityType: "person",
        entityId: personId,
        label: asset.label || asset.fileId,
        description: asset.description || "",
        photoDate: asset.photoDate || "",
        createdAt: now,
      }).catch(() => undefined);
    }
  }

  return NextResponse.json({
    ok: true,
    faceId: normalizedFaceId,
    personId,
    status,
    label,
    note,
    updatedAt: now,
  });
}
