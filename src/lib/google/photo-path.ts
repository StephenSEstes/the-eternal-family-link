export function getPhotoProxyPath(fileId: string, tenantKey?: string) {
  const encodedId = encodeURIComponent(fileId);
  if (tenantKey && tenantKey.trim().length > 0 && tenantKey !== "default") {
    return `/t/${encodeURIComponent(tenantKey)}/viewer/photo/${encodedId}`;
  }
  return `/viewer/photo/${encodedId}`;
}
