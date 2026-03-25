import { DEFAULT_FAMILY_GROUP_KEY } from "@/lib/family-group/constants";

export function getPhotoProxyPath(fileId: string, tenantKey?: string) {
  const encodedId = encodeURIComponent(fileId);
  if (tenantKey && tenantKey.trim().length > 0 && tenantKey !== DEFAULT_FAMILY_GROUP_KEY) {
    return `/t/${encodeURIComponent(tenantKey)}/viewer/photo/${encodedId}`;
  }
  return `/viewer/photo/${encodedId}`;
}

export function getPhotoPreviewProxyPath(fileId: string, _rawMetadata?: string, tenantKey?: string) {
  const basePath = getPhotoProxyPath(fileId, tenantKey);
  return `${basePath}${basePath.includes("?") ? "&" : "?"}variant=preview`;
}

export function getPhotoAvatarProxyPath(fileId: string, tenantKey?: string) {
  const basePath = getPhotoProxyPath(fileId, tenantKey);
  return `${basePath}${basePath.includes("?") ? "&" : "?"}variant=preview`;
}
