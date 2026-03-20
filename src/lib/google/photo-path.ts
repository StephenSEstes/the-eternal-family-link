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
  return getPhotoProxyPath(previewFileId || fileId, tenantKey);
}
