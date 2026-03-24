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
  if (previewFileId && previewFileId !== fileId) {
    return basePath;
  }
  try {
    const parsed = rawMetadata ? JSON.parse(rawMetadata) as Record<string, unknown> : null;
    const mediaKind = String(parsed?.mediaKind ?? "").trim().toLowerCase();
    if (mediaKind === "image") {
      return `${basePath}${basePath.includes("?") ? "&" : "?"}variant=preview`;
    }
  } catch {
    // Ignore malformed metadata and fall back to base path.
  }
  return basePath;
}

export function getPhotoAvatarProxyPath(fileId: string, tenantKey?: string) {
  const basePath = getPhotoProxyPath(fileId, tenantKey);
  return `${basePath}${basePath.includes("?") ? "&" : "?"}variant=preview`;
}
