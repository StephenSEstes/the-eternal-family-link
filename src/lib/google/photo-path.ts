export function getPhotoProxyPath(fileId: string) {
  return `/viewer/photo/${encodeURIComponent(fileId)}`;
}
