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

function toPersonMediaRecord(input: AttributeWithMedia, media: AttributeMediaLink | null, canonicalPrimaryFileId: string) {
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
  } satisfies PersonMediaAttributeRecord;
}

function mergePersonMediaRecord(current: PersonMediaAttributeRecord, next: PersonMediaAttributeRecord) {
  return {
    ...current,
    attributeId: current.attributeId || next.attributeId,
    attributeType: current.attributeType || next.attributeType,
    valueJson: current.valueJson || next.valueJson,
    mediaMetadata: current.mediaMetadata || next.mediaMetadata,
    label: current.label || next.label,
    notes: current.notes || next.notes,
    startDate: current.startDate || next.startDate,
    sourceProvider: current.sourceProvider || next.sourceProvider,
    originalObjectKey: current.originalObjectKey || next.originalObjectKey,
    thumbnailObjectKey: current.thumbnailObjectKey || next.thumbnailObjectKey,
    previewUrl: current.previewUrl || next.previewUrl,
    originalUrl: current.originalUrl || next.originalUrl,
    isPrimary: current.isPrimary || next.isPrimary,
    sortOrder: Math.min(current.sortOrder, next.sortOrder),
  };
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
  return toPersonMediaRecord(input, getPrimaryMediaLink(input), canonicalPrimaryFileId);
}

export function toPersonMediaAttributes(input: AttributeWithMedia[], canonicalPrimaryFileId = "") {
  const byFileId = new Map<string, PersonMediaAttributeRecord>();
  for (const item of input) {
    if (!isMediaAttributeType(item.attributeType || item.typeKey)) {
      continue;
    }
    const mediaLinks = Array.isArray(item.media) ? item.media.slice().sort(sortMediaLinks) : [];
    if (mediaLinks.length === 0) {
      const fallback = toPersonMediaRecord(item, null, canonicalPrimaryFileId);
      if (!fallback) {
        continue;
      }
      const existing = byFileId.get(fallback.valueText);
      byFileId.set(fallback.valueText, existing ? mergePersonMediaRecord(existing, fallback) : fallback);
      continue;
    }
    for (const media of mediaLinks) {
      const record = toPersonMediaRecord(item, media, canonicalPrimaryFileId);
      if (!record) {
        continue;
      }
      const existing = byFileId.get(record.valueText);
      byFileId.set(record.valueText, existing ? mergePersonMediaRecord(existing, record) : record);
    }
  }
  return Array.from(byFileId.values()).sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) {
      return Number(b.isPrimary) - Number(a.isPrimary);
    }
    if (a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder;
    }
    if (a.startDate !== b.startDate) {
      return (b.startDate || "").localeCompare(a.startDate || "");
    }
    return a.valueText.localeCompare(b.valueText);
  });
}
