export type MediaKind = "image" | "video" | "audio" | "unknown";

const DEFAULT_MAX_MEDIA_BYTES = 40 * 1024 * 1024;
const FALLBACK_MIME_TYPE = "application/octet-stream";

function toSafeNumber(value: string | undefined) {
  const parsed = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

export function normalizeMediaKind(mimeType: string | undefined): MediaKind {
  const normalized = String(mimeType ?? "").trim().toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("audio/")) return "audio";
  return "unknown";
}

export function sanitizeUploadFileName(input: string, fallback: string) {
  const cleaned = input
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160);
  return cleaned || fallback;
}

export function readMaxMediaBytes() {
  const configured = Number.parseInt(String(process.env.EFL_MEDIA_MAX_BYTES ?? "").trim(), 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_MEDIA_BYTES;
}

export function validateUploadInput(input: { byteLength: number; mimeType?: string }) {
  const mimeType = String(input.mimeType ?? "").trim().toLowerCase() || FALLBACK_MIME_TYPE;
  const mediaKind = normalizeMediaKind(mimeType);
  const maxBytes = readMaxMediaBytes();
  if (input.byteLength <= 0) {
    return { ok: false as const, error: "file is empty" };
  }
  if (input.byteLength > maxBytes) {
    return { ok: false as const, error: `file exceeds max size (${maxBytes} bytes)` };
  }
  if (mediaKind === "unknown") {
    return { ok: false as const, error: "unsupported media type; only image/video/audio are allowed" };
  }
  return { ok: true as const, mediaKind, mimeType, maxBytes };
}

export function buildMediaMetadata(input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  mediaKind: MediaKind;
  width?: string;
  height?: string;
  durationSec?: string;
  captureSource?: string;
  extra?: Record<string, unknown>;
}) {
  const metadata = {
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    createdAt: input.createdAt,
    mediaKind: input.mediaKind,
    width: toSafeNumber(input.width),
    height: toSafeNumber(input.height),
    durationSec: toSafeNumber(input.durationSec),
    captureSource: String(input.captureSource ?? "").trim() || undefined,
    ...input.extra,
  };
  return JSON.stringify(metadata);
}
