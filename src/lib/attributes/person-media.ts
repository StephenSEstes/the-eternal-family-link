import { buildMediaId, buildMediaLinkId } from "@/lib/media/ids";
import { inferStoredMediaKind } from "@/lib/media/upload";
import { deleteOciMediaLink, getOciMediaLinksForEntity, upsertOciMediaAsset, upsertOciMediaLink } from "@/lib/oci/tables";

export type PersonMediaAttributeType = "photo" | "video" | "audio" | "media";

export function normalizePersonMediaAttributeType(value: string): PersonMediaAttributeType | "" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "photo") return "photo";
  if (normalized === "video") return "video";
  if (normalized === "audio") return "audio";
  if (normalized === "media") return "media";
  return "";
}

async function deleteAttributeLinks(tenantKey: string, attributeId: string) {
  const links = await getOciMediaLinksForEntity({
    familyGroupKey: tenantKey,
    entityType: "attribute",
    entityId: attributeId,
  });
  await Promise.all(links.map((item) => deleteOciMediaLink(item.linkId)));
}

async function deletePersonLinksForFiles(tenantKey: string, personId: string, fileIds: string[]) {
  const normalizedFileIds = new Set(fileIds.map((value) => value.trim()).filter(Boolean));
  if (!normalizedFileIds.size) {
    return;
  }
  const links = await getOciMediaLinksForEntity({
    familyGroupKey: tenantKey,
    entityType: "person",
    entityId: personId,
  });
  const matches = links.filter((item) => normalizedFileIds.has(item.fileId.trim()));
  await Promise.all(matches.map((item) => deleteOciMediaLink(item.linkId)));
}

export async function removePersonMediaAssociations(input: {
  tenantKey: string;
  personId: string;
  attributeId: string;
  fileIds?: string[];
}) {
  await Promise.all([
    deleteAttributeLinks(input.tenantKey, input.attributeId),
    deletePersonLinksForFiles(input.tenantKey, input.personId, input.fileIds ?? []),
  ]);
}

export async function syncPersonMediaAssociations(input: {
  tenantKey: string;
  personId: string;
  attributeId: string;
  attributeType: PersonMediaAttributeType;
  fileId: string;
  mediaKind?: string;
  label?: string;
  description?: string;
  photoDate?: string;
  isPrimary?: boolean;
  sortOrder?: number;
  mediaMetadata?: string;
  sourceProvider?: string;
  sourceFileId?: string;
  originalObjectKey?: string;
  thumbnailObjectKey?: string;
  checksumSha256?: string;
  mimeType?: string;
  fileName?: string;
  fileSizeBytes?: string;
  mediaWidth?: number;
  mediaHeight?: number;
  mediaDurationSec?: number;
  createdAt?: string;
  exifExtractedAt?: string;
  exifSourceTag?: string;
  exifCaptureDate?: string;
  exifCaptureTimestampRaw?: string;
  exifMake?: string;
  exifModel?: string;
  exifSoftware?: string;
  exifWidth?: number;
  exifHeight?: number;
  exifOrientation?: number;
  exifFingerprint?: string;
  replaceAttributeLinks?: boolean;
  replacePersonLinksForFileIds?: string[];
}) {
  const fileId = input.fileId.trim();
  if (!fileId) {
    return;
  }

  const createdAt = (input.createdAt ?? new Date().toISOString()).trim() || new Date().toISOString();
  const mediaMetadata = (input.mediaMetadata ?? "").trim();
  const replacePersonLinksForFileIds = Array.from(
    new Set([fileId, ...(input.replacePersonLinksForFileIds ?? [])].map((value) => value.trim()).filter(Boolean)),
  );
  const persistedIsPrimary = false;
  const mediaKind = String(input.mediaKind ?? "").trim().toLowerCase() || inferStoredMediaKind(fileId, input.mediaMetadata);

  await Promise.all([
    input.replaceAttributeLinks === false ? Promise.resolve() : deleteAttributeLinks(input.tenantKey, input.attributeId),
    deletePersonLinksForFiles(input.tenantKey, input.personId, replacePersonLinksForFileIds),
  ]);

  const mediaId = buildMediaId(fileId);
  const attributeUsageType = input.attributeType === "photo" ? "photo" : "media";
  const personUsageType = input.attributeType === "photo" ? "photo" : "media";
  const attributeLinkId = buildMediaLinkId(
    input.tenantKey,
    "attribute",
    input.attributeId,
    fileId,
    attributeUsageType,
  );
  const personLinkId = buildMediaLinkId(
    input.tenantKey,
    "person",
    input.personId,
    fileId,
    personUsageType,
  );

  await upsertOciMediaAsset({
    mediaId,
    fileId,
    mediaKind,
    label: input.label,
    description: input.description,
    photoDate: input.photoDate,
    sourceProvider: input.sourceProvider,
    sourceFileId: input.sourceFileId,
    originalObjectKey: input.originalObjectKey,
    thumbnailObjectKey: input.thumbnailObjectKey,
    checksumSha256: input.checksumSha256,
    mimeType: (input.mimeType ?? "").trim(),
    fileName: (input.fileName ?? "").trim(),
    fileSizeBytes: (input.fileSizeBytes ?? "").trim(),
    mediaWidth: input.mediaWidth,
    mediaHeight: input.mediaHeight,
    mediaDurationSec: input.mediaDurationSec,
    createdAt,
    exifExtractedAt: input.exifExtractedAt,
    exifSourceTag: input.exifSourceTag,
    exifCaptureDate: input.exifCaptureDate,
    exifCaptureTimestampRaw: input.exifCaptureTimestampRaw,
    exifMake: input.exifMake,
    exifModel: input.exifModel,
    exifSoftware: input.exifSoftware,
    exifWidth: input.exifWidth,
    exifHeight: input.exifHeight,
    exifOrientation: input.exifOrientation,
    exifFingerprint: input.exifFingerprint,
  });
  await Promise.all([
    upsertOciMediaLink({
      familyGroupKey: input.tenantKey,
      linkId: attributeLinkId,
      mediaId,
      entityType: "attribute",
      entityId: input.attributeId,
      usageType: attributeUsageType,
      label: input.label,
      description: input.description,
      photoDate: input.photoDate,
      isPrimary: persistedIsPrimary,
      sortOrder: input.sortOrder ?? 0,
      mediaMetadata,
      createdAt,
    }),
    upsertOciMediaLink({
      familyGroupKey: input.tenantKey,
      linkId: personLinkId,
      mediaId,
      entityType: "person",
      entityId: input.personId,
      usageType: personUsageType,
      label: input.label,
      description: input.description,
      photoDate: input.photoDate,
      isPrimary: persistedIsPrimary,
      sortOrder: input.sortOrder ?? 0,
      mediaMetadata,
      createdAt,
    }),
  ]);
}
