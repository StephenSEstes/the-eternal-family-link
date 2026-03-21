import { DEFAULT_FAMILY_GROUP_KEY } from "@/lib/family-group/constants";
import { resolvePreviewFileId } from "@/lib/media/upload";

export function getPhotoProxyPath(fileId: string, tenantKey?: string) {
  const encodedId = encodeURIComponent(fileId);
  if (tenantKey && tenantKey.trim().length > 0 && tenantKey !== DEFAULT_FAMILY_GROUP_KEY) {
    return `/t/${encodeURIComponent(tenantKey)}/viewer/photo/${encodedId}`;
  }
  return `/viewer/photo/${encodedId}`;
}

export function getPhotoPreviewProxyPath(fileId: string, rawMetadata?: string, tenantKey?: string) {
  const previewFileId = resolvePreviewFileId(fileId, rawMetadata);
  const basePath = getPhotoProxyPath(previewFileId || fileId, tenantKey);
  const metadataText = String(rawMetadata ?? "").trim();
  if (previewFileId && previewFileId !== fileId) {
    return basePath;
  }
  if (!metadataText || (!metadataText.startsWith("{") && !metadataText.startsWith("["))) {
    return basePath;
  }
  try {
    const parsed = JSON.parse(metadataText) as Record<string, unknown>;
    const objectStorage = parsed.objectStorage as Record<string, unknown> | undefined;
    const thumbnailObjectKey = String(objectStorage?.thumbnailObjectKey ?? "").trim();
    if (thumbnailObjectKey) {
      return `${basePath}${basePath.includes("?") ? "&" : "?"}variant=preview`;
    }
  } catch {
    // Ignore malformed metadata and fall back to base path.
  }
  return basePath;
}
