import { createHash } from "crypto";

function shortHash(seed: string) {
  return createHash("sha1").update(seed.trim().toLowerCase()).digest("hex").slice(0, 8);
}

export function buildMediaId(fileId: string) {
  return `media-${shortHash(`file|${fileId}`)}`;
}

export function buildMediaLinkId(
  familyGroupKey: string,
  entityType: "person" | "household" | "attribute",
  entityId: string,
  fileId: string,
  usageType: string,
) {
  return `mlink-${shortHash(`${familyGroupKey}|${entityType}|${entityId}|${fileId}|${usageType}`)}`;
}
