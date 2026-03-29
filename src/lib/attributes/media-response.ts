import type { AttributeMediaLink, AttributeRecord } from "@/lib/attributes/types";

export type AttributeWithMedia = AttributeRecord & {
  media?: AttributeMediaLink[];
};

export type PersonMediaAttributeRecord = {
  attributeId: string;
  attributeType: string;
  valueText: string;
  valueJson: string;
  mediaMetadata: string;
  label: string;
  isPrimary: boolean;
  sortOrder: number;
  startDate: string;
  notes: string;
  sourceProvider: string;
  originalObjectKey: string;
  thumbnailObjectKey: string;
  previewUrl: string;
  originalUrl: string;
};

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export function isMediaAttributeType(value: string | undefined) {
  const normalized = normalize(value);
  return normalized === "photo" || normalized === "video" || normalized === "audio" || normalized === "media";
}

function sortMediaLinks(a: AttributeMediaLink, b: AttributeMediaLink) {
  if (a.sortOrder !== b.sortOrder) {
    return a.sortOrder - b.sortOrder;
  }
  const aDate = (a.createdAt ?? "").trim();
  const bDate = (b.createdAt ?? "").trim();
  return aDate.localeCompare(bDate);
}

function getPrimaryMediaLink(input: AttributeWithMedia) {
  const media = Array.isArray(input.media) ? input.media.slice().sort(sortMediaLinks) : [];
  return media[0] ?? null;
}

export function matchesCanonicalMediaFileId(input: AttributeWithMedia, fileId: string) {
  if (!isMediaAttributeType(input.attributeType || input.typeKey)) {
    return false;
  }
  const normalizedFileId = fileId.trim();
  if (!normalizedFileId) {
    return false;
  }
  if ((input.attributeDetail || input.valueText || "").trim() === normalizedFileId) {
    return true;
  }
  return (input.media ?? []).some((item) => item.fileId.trim() === normalizedFileId);
}

export function toPersonMediaAttribute(input: AttributeWithMedia, canonicalPrimaryFileId = ""): PersonMediaAttributeRecord | null {
  if (!isMediaAttributeType(input.attributeType || input.typeKey)) {
    return null;
  }
  const media = getPrimaryMediaLink(input);
  const fileId = (media?.fileId || input.attributeDetail || input.valueText || "").trim();
  if (!fileId) {
    return null;
  }
  return {
    attributeId: input.attributeId,
    attributeType: (input.attributeType || input.typeKey || "").trim().toLowerCase(),
    valueText: fileId,
    valueJson: media?.mediaMetadata || "",
    mediaMetadata: media?.mediaMetadata || "",
    label: (media?.label || input.label || "").trim(),
    isPrimary: canonicalPrimaryFileId.trim() ? fileId === canonicalPrimaryFileId.trim() : Boolean(media?.isPrimary),
    sortOrder: media?.sortOrder ?? 0,
    startDate: (media?.photoDate || input.attributeDate || input.dateStart || "").trim(),
    notes: (media?.description || input.attributeNotes || input.notes || "").trim(),
    sourceProvider: media?.sourceProvider || "",
    originalObjectKey: media?.originalObjectKey || "",
    thumbnailObjectKey: media?.thumbnailObjectKey || "",
    previewUrl: media?.previewUrl || "",
    originalUrl: media?.originalUrl || "",
  };
}

export function toPersonMediaAttributes(input: AttributeWithMedia[], canonicalPrimaryFileId = "") {
  return input
    .map((item) => toPersonMediaAttribute(item, canonicalPrimaryFileId))
    .filter((item): item is PersonMediaAttributeRecord => Boolean(item));
}
