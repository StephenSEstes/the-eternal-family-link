import "server-only";

import sharp from "sharp";

export type ThumbnailVariant = {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
};

function readThumbMaxEdge() {
  const raw = Number.parseInt(String(process.env.EFL_IMAGE_THUMB_MAX_EDGE ?? "").trim(), 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 480;
  }
  return Math.max(120, Math.min(1600, raw));
}

function readThumbQuality() {
  const raw = Number.parseInt(String(process.env.EFL_IMAGE_THUMB_QUALITY ?? "").trim(), 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 78;
  }
  return Math.max(40, Math.min(95, raw));
}

export async function createImageThumbnailVariant(input: { source: Buffer; mimeType: string }): Promise<ThumbnailVariant | null> {
  const normalizedMimeType = String(input.mimeType ?? "").trim().toLowerCase();
  if (!normalizedMimeType.startsWith("image/")) {
    return null;
  }

  const maxEdge = readThumbMaxEdge();
  const quality = readThumbQuality();

  const rendered = await sharp(input.source, { failOn: "none", animated: false })
    .rotate()
    .resize({
      width: maxEdge,
      height: maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const width = Number(rendered.info.width ?? 0);
  const height = Number(rendered.info.height ?? 0);
  if (!width || !height) {
    return null;
  }

  return {
    buffer: rendered.data,
    mimeType: "image/jpeg",
    extension: "jpg",
    width,
    height,
  };
}
