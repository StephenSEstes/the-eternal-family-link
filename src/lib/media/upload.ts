export type MediaKind = "image" | "video" | "audio" | "document" | "unknown";
export type SupportedMediaKind = Exclude<MediaKind, "unknown">;
export type MediaMetadataParsed = Record<string, unknown> & {
  mediaKind?: string;
  thumbnailFileId?: string;
  thumbFileId?: string;
};

const DEFAULT_MAX_MEDIA_BYTES = 40 * 1024 * 1024;
const FALLBACK_MIME_TYPE = "application/octet-stream";
const DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/rtf",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
]);
const DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "txt",
  "rtf",
  "md",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "ppt",
  "pptx",
  "odt",
  "ods",
]);

function compactMediaMetadataObject(value: Record<string, unknown>) {
  const metadata = { ...value };
  delete metadata.fileName;
  delete metadata.mimeType;
  delete metadata.sizeBytes;
  delete metadata.createdAt;
  delete metadata.width;
  delete metadata.height;
  delete metadata.durationSec;
  delete metadata.sourceProvider;
  delete metadata.sourceFileId;
  delete metadata.originalObjectKey;
  delete metadata.thumbnailObjectKey;
  delete metadata.checksumSha256;
  delete metadata.objectStorage;

  return Object.fromEntries(
    Object.entries(metadata).filter(([, entry]) => entry !== undefined),
  );
}

export function normalizeMediaKind(mimeType: string | undefined, fileName?: string): MediaKind {
  return inferMediaKindFromMimeTypeOrFileName(mimeType, fileName);
}

function normalizeFileExtension(fileName: string | undefined) {
  const normalized = String(fileName ?? "").trim().toLowerCase();
  const match = normalized.match(/\.([a-z0-9]{1,10})$/i);
  return match?.[1] ?? "";
}

function isDocumentMimeType(mimeType: string) {
  return mimeType.startsWith("text/") || DOCUMENT_MIME_TYPES.has(mimeType);
}

export function inferMediaKindFromMimeTypeOrFileName(mimeType: string | undefined, fileName?: string): MediaKind {
  const normalized = String(mimeType ?? "").trim().toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("audio/")) return "audio";
  if (isDocumentMimeType(normalized) || DOCUMENT_EXTENSIONS.has(normalizeFileExtension(fileName))) return "document";
  return "unknown";
}

export function inferStoredMediaKind(fileId: string, rawMetadata?: string): SupportedMediaKind {
  const metadataText = String(rawMetadata ?? "").trim();
  if (metadataText) {
    try {
      const parsed = JSON.parse(metadataText) as { mediaKind?: string; mimeType?: string; fileName?: string };
      const byKind = String(parsed.mediaKind ?? "").trim().toLowerCase();
      if (byKind === "image" || byKind === "video" || byKind === "audio" || byKind === "document") {
        return byKind;
      }
      const inferred = inferMediaKindFromMimeTypeOrFileName(parsed.mimeType, parsed.fileName);
      if (inferred !== "unknown") {
        return inferred;
      }
    } catch {
      // Ignore malformed metadata and fall back to file ID.
    }
  }
  const inferred = inferMediaKindFromMimeTypeOrFileName("", fileId);
  return inferred === "unknown" ? "image" : inferred;
}

export function fallbackUploadExtension(mediaKind: MediaKind, mimeType?: string, fileName?: string) {
  const existing = normalizeFileExtension(fileName);
  if (existing) {
    return existing;
  }
  const normalizedMime = String(mimeType ?? "").trim().toLowerCase();
  if (mediaKind === "image") return "jpg";
  if (mediaKind === "video") return "mp4";
  if (mediaKind === "audio") return "mp3";
  if (mediaKind === "document") {
    if (normalizedMime === "application/pdf") return "pdf";
    if (normalizedMime.startsWith("text/")) return "txt";
    if (normalizedMime.includes("wordprocessingml") || normalizedMime === "application/msword") return "docx";
    if (normalizedMime.includes("spreadsheetml") || normalizedMime === "application/vnd.ms-excel") return "xlsx";
    if (normalizedMime.includes("presentationml") || normalizedMime === "application/vnd.ms-powerpoint") return "pptx";
    return "bin";
  }
  return "bin";
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

export function validateUploadInput(input: { byteLength: number; mimeType?: string; fileName?: string }) {
  const mimeType = String(input.mimeType ?? "").trim().toLowerCase() || FALLBACK_MIME_TYPE;
  const mediaKind = inferMediaKindFromMimeTypeOrFileName(mimeType, input.fileName);
  const maxBytes = readMaxMediaBytes();
  if (input.byteLength <= 0) {
    return { ok: false as const, error: "file is empty" };
  }
  if (input.byteLength > maxBytes) {
    return { ok: false as const, error: `file exceeds max size (${maxBytes} bytes)` };
  }
  if (mediaKind === "unknown") {
    return { ok: false as const, error: "unsupported media type; only image/video/audio/document files are allowed" };
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
  const metadata = compactMediaMetadataObject({
    mediaKind: input.mediaKind,
    captureSource: String(input.captureSource ?? "").trim() || undefined,
    ...input.extra,
  });
  return JSON.stringify(metadata);
}

export function parseMediaMetadata(rawMetadata: string | undefined): MediaMetadataParsed | null {
  const value = String(rawMetadata ?? "").trim();
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as MediaMetadataParsed;
  } catch {
    return null;
  }
}

export function compactMediaMetadata(rawMetadata: string | undefined) {
  const parsed = parseMediaMetadata(rawMetadata);
  if (!parsed) {
    return String(rawMetadata ?? "").trim();
  }
  return JSON.stringify(compactMediaMetadataObject(parsed));
}

export function resolvePreviewFileId(fileId: string, rawMetadata?: string) {
  const fallback = String(fileId ?? "").trim();
  if (!fallback) return "";
  const parsed = parseMediaMetadata(rawMetadata);
  if (!parsed) return fallback;
  const mediaKind = String(parsed.mediaKind ?? "").trim().toLowerCase();
  if (mediaKind !== "image") return fallback;
  const thumbnail = String(parsed.thumbnailFileId ?? parsed.thumbFileId ?? "").trim();
  return thumbnail || fallback;
}
