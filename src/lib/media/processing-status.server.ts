import "server-only";

import { buildMediaProcessingStatus, type MediaProcessingStatus } from "@/lib/media/processing-status";
import { readPhotoIntelligenceDebug } from "@/lib/media/photo-intelligence";
import {
  getOciFaceInstancesForFile,
  getOciFaceMatchesForFile,
  getOciMediaAssetByFileId,
  getOciPersonFaceProfilesBySourceFile,
  type OciMediaAssetLookup,
} from "@/lib/oci/tables";

type MediaProcessingStatusInput = {
  familyGroupKey: string;
  fileId: string;
  mediaMetadata?: string;
  asset?: OciMediaAssetLookup | null;
};

function countFaceVectorsFromInstances(embeddingJsonRows: string[]) {
  return embeddingJsonRows.reduce((count, raw) => {
    const value = String(raw ?? "").trim();
    if (!value || value === "[]") {
      return count;
    }
    return count + 1;
  }, 0);
}

export async function getMediaProcessingStatusForFile(input: MediaProcessingStatusInput): Promise<MediaProcessingStatus> {
  const familyGroupKey = input.familyGroupKey.trim().toLowerCase();
  const fileId = input.fileId.trim();
  const asset =
    input.asset === undefined
      ? await getOciMediaAssetByFileId(fileId).catch(() => null)
      : input.asset;
  const mediaMetadata = String(input.mediaMetadata ?? asset?.mediaMetadata ?? "").trim();
  const [faceInstances, faceMatches, profileRows] = await Promise.all([
    getOciFaceInstancesForFile({ familyGroupKey, fileId }).catch(() => []),
    getOciFaceMatchesForFile({ familyGroupKey, fileId }).catch(() => []),
    getOciPersonFaceProfilesBySourceFile({ familyGroupKey, fileId }).catch(() => []),
  ]);
  const confirmedIdentityCount = new Set(
    faceMatches
      .filter((row) => row.matchStatus.trim().toLowerCase() === "confirmed")
      .map((row) => row.faceId.trim())
      .filter(Boolean),
  ).size;

  return buildMediaProcessingStatus({
    fileId,
    rawMetadata: mediaMetadata,
    exifExtractedAt: asset?.exifExtractedAt,
    exifCaptureDate: asset?.exifCaptureDate,
    faceInstanceCount: faceInstances.length,
    faceVectorCount: countFaceVectorsFromInstances(faceInstances.map((row) => row.embeddingJson)),
    confirmedIdentityCount,
    profileVectorCount: profileRows.length,
    debug: readPhotoIntelligenceDebug(mediaMetadata),
  });
}
