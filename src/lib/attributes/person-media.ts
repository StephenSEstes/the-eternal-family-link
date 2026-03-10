import { buildMediaId, buildMediaLinkId } from "@/lib/media/ids";
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
  label?: string;
  description?: string;
  photoDate?: string;
  isPrimary?: boolean;
  sortOrder?: number;
  mediaMetadata?: string;
  createdAt?: string;
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

  await Promise.all([
    input.replaceAttributeLinks === false ? Promise.resolve() : deleteAttributeLinks(input.tenantKey, input.attributeId),
    deletePersonLinksForFiles(input.tenantKey, input.personId, replacePersonLinksForFileIds),
  ]);

  const mediaId = buildMediaId(fileId);
  const attributeUsageType = input.attributeType === "photo" ? "photo" : "media";
  const personUsageType = input.attributeType === "photo" ? (input.isPrimary ? "profile" : "gallery") : "media";
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
    storageProvider: "gdrive",
    mediaMetadata,
    createdAt,
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
      isPrimary: Boolean(input.isPrimary),
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
      isPrimary: Boolean(input.isPrimary),
      sortOrder: input.sortOrder ?? 0,
      mediaMetadata,
      createdAt,
    }),
  ]);
}
