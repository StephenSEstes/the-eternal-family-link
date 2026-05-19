export type MediaKind = "image" | "video" | "audio" | "document" | "unknown";
export type SupportedMediaKind = Exclude<MediaKind, "unknown">;

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
