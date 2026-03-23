import { NextResponse } from "next/server";
import { z } from "zod";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { getPeople } from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { resolvePhotoContentAcrossFamilies } from "@/lib/google/photo-resolver";
import { associateDetectedFaceToPerson } from "@/lib/media/face-recognition";
import { getOciMediaAssetByFileId, updateOciMediaMetadataForFile } from "@/lib/oci/tables";
import { resolvePersonDisplayName } from "@/lib/person/display-name";

const requestSchema = z.object({
  personId: z.string().trim().min(1),
});

type RouteProps = {
  params: Promise<{ tenantKey: string; fileId: string; faceId: string }>;
};

function parseMetadata(raw: string) {
  const value = String(raw ?? "").trim();
  if (!value) {
    return {} as Record<string, unknown>;
  }
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function POST(request: Request, { params }: RouteProps) {
  const { tenantKey, fileId, faceId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const normalizedFileId = fileId.trim();
  const normalizedFaceId = faceId.trim();
  const normalizedPersonId = parsed.data.personId.trim();
  if (!normalizedFileId || !normalizedFaceId || !normalizedPersonId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const people = await getPeople(resolved.tenant.tenantKey);
  const person = people.find((item) => item.personId.trim() === normalizedPersonId) ?? null;
  if (!person) {
    return NextResponse.json({ error: "person_not_found" }, { status: 404 });
  }
  const personDisplayName = resolvePersonDisplayName({
    personId: person.personId,
    displayName: person.displayName,
    firstName: person.firstName,
    middleName: person.middleName,
    lastName: person.lastName,
  });

  let sourceImageBytes: Buffer | null = null;
  try {
    const source = await resolvePhotoContentAcrossFamilies(normalizedFileId, resolved.tenant.tenantKey, { variant: "original" });
    sourceImageBytes = Buffer.from(source.data);
  } catch (sourceError) {
    console.warn("[face-association] failed to load source image bytes", sourceError);
  }

  let association: Awaited<ReturnType<typeof associateDetectedFaceToPerson>>;
  try {
    association = await associateDetectedFaceToPerson({
      familyGroupKey: resolved.tenant.tenantKey,
      fileId: normalizedFileId,
      faceId: normalizedFaceId,
      personId: normalizedPersonId,
      reviewedBy: resolved.session.user.email ?? "",
      sourceImageBytes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to associate detected face.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const mediaAsset = await getOciMediaAssetByFileId(normalizedFileId).catch(() => null);
  let updatedMediaMetadata = "";
  if (mediaAsset?.mediaMetadata) {
    const metadata = parseMetadata(mediaAsset.mediaMetadata);
    const photoIntelligence = metadata.photoIntelligence;
    if (photoIntelligence && typeof photoIntelligence === "object") {
      const suggestion = photoIntelligence as Record<string, unknown>;
      if (Array.isArray(suggestion.faceSuggestions)) {
        suggestion.faceSuggestions = suggestion.faceSuggestions.map((entry) => {
          if (!entry || typeof entry !== "object") {
            return entry;
          }
          const faceSuggestion = entry as Record<string, unknown>;
          if (String(faceSuggestion.faceId ?? "").trim() !== normalizedFaceId) {
            return faceSuggestion;
          }
          return {
            ...faceSuggestion,
            matches: [
              {
                personId: normalizedPersonId,
                displayName: personDisplayName,
                confidenceScore: 1,
                confidenceBand: "high",
              },
            ],
          };
        });
      }
      metadata.photoIntelligence = suggestion;
      updatedMediaMetadata = JSON.stringify(metadata);
      await updateOciMediaMetadataForFile({
        familyGroupKey: resolved.tenant.tenantKey,
        fileId: normalizedFileId,
        mediaMetadata: updatedMediaMetadata,
      });
    }
  }

  await appendSessionAuditLog(resolved.session, {
    action: "UPDATE",
    entityType: "FACE_MATCH",
    entityId: normalizedFaceId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `Confirmed face ${normalizedFaceId} for person=${normalizedPersonId} on file=${normalizedFileId}.`,
  });

  return NextResponse.json({
    ok: true,
    fileId: normalizedFileId,
    faceId: normalizedFaceId,
    mediaMetadata: updatedMediaMetadata,
    personId: normalizedPersonId,
    personDisplayName,
    sampleCount: association.sampleCount,
  });
}
