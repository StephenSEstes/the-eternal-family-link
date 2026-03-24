import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMediaMetadata,
  compactMediaMetadata,
  fallbackUploadExtension,
  inferStoredMediaKind,
  normalizeMediaKind,
  resolvePreviewFileId,
  sanitizeUploadFileName,
  validateUploadInput,
} from "./upload";

test("normalizeMediaKind classifies image/video/audio/document", () => {
  assert.equal(normalizeMediaKind("image/jpeg"), "image");
  assert.equal(normalizeMediaKind("video/mp4"), "video");
  assert.equal(normalizeMediaKind("audio/mpeg"), "audio");
  assert.equal(normalizeMediaKind("application/pdf"), "document");
  assert.equal(normalizeMediaKind("", "story.docx"), "document");
});

test("validateUploadInput rejects empty, oversize, and unsupported mime", () => {
  const empty = validateUploadInput({ byteLength: 0, mimeType: "image/jpeg" });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.match(empty.error, /empty/);

  const original = process.env.EFL_MEDIA_MAX_BYTES;
  process.env.EFL_MEDIA_MAX_BYTES = "10";
  const tooLarge = validateUploadInput({ byteLength: 11, mimeType: "image/jpeg" });
  assert.equal(tooLarge.ok, false);
  if (!tooLarge.ok) assert.match(tooLarge.error, /exceeds max size/);
  process.env.EFL_MEDIA_MAX_BYTES = original;

  const badType = validateUploadInput({ byteLength: 5, mimeType: "application/x-msdownload" });
  assert.equal(badType.ok, false);
  if (!badType.ok) assert.match(badType.error, /unsupported media type/);
});

test("validateUploadInput accepts supported media kinds", () => {
  const allowed = validateUploadInput({ byteLength: 42, mimeType: "audio/mpeg" });
  assert.equal(allowed.ok, true);
  if (allowed.ok) {
    assert.equal(allowed.mediaKind, "audio");
    assert.equal(allowed.mimeType, "audio/mpeg");
  }

  const document = validateUploadInput({ byteLength: 42, mimeType: "application/pdf", fileName: "memory.pdf" });
  assert.equal(document.ok, true);
  if (document.ok) {
    assert.equal(document.mediaKind, "document");
  }
});

test("sanitizeUploadFileName strips unsafe characters", () => {
  assert.equal(sanitizeUploadFileName(" family photo (1).jpg ", "fallback.jpg"), "family_photo_1_.jpg");
  assert.equal(sanitizeUploadFileName("", "fallback.jpg"), "fallback.jpg");
});

test("buildMediaMetadata stores only compact media metadata", () => {
  const payload = buildMediaMetadata({
    fileName: "clip.mp4",
    mimeType: "video/mp4",
    sizeBytes: 100,
    createdAt: "2026-03-05T00:00:00.000Z",
    mediaKind: "video",
    width: "1920",
    height: "1080",
    durationSec: "8.4",
    captureSource: "camera",
  });
  const parsed = JSON.parse(payload) as Record<string, unknown>;
  assert.equal(parsed.mediaKind, "video");
  assert.equal(parsed.captureSource, "camera");
  assert.equal(parsed.width, undefined);
  assert.equal(parsed.fileName, undefined);
});

test("compactMediaMetadata strips normalized asset fields from legacy JSON", () => {
  const payload = compactMediaMetadata(JSON.stringify({
    fileName: "legacy.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 123,
    createdAt: "2026-03-24T00:00:00.000Z",
    width: 640,
    height: 480,
    durationSec: 0,
    checksumSha256: "abc",
    sourceProvider: "oci_object",
    sourceFileId: "legacy-file",
    originalObjectKey: "obj/original",
    thumbnailObjectKey: "obj/thumb",
    objectStorage: {
      originalObjectKey: "obj/original",
      thumbnailObjectKey: "obj/thumb",
    },
    mediaKind: "image",
    captureSource: "camera",
  }));
  const parsed = JSON.parse(payload) as Record<string, unknown>;
  assert.equal(parsed.mediaKind, "image");
  assert.equal(parsed.captureSource, "camera");
  assert.equal(parsed.fileName, undefined);
  assert.equal(parsed.checksumSha256, undefined);
  assert.equal(parsed.objectStorage, undefined);
});

test("inferStoredMediaKind falls back to metadata and file extensions", () => {
  assert.equal(inferStoredMediaKind("file.pdf"), "document");
  assert.equal(inferStoredMediaKind("ignored", JSON.stringify({ mimeType: "application/pdf" })), "document");
  assert.equal(inferStoredMediaKind("ignored", JSON.stringify({ mediaKind: "document" })), "document");
});

test("fallbackUploadExtension keeps file extension and provides document defaults", () => {
  assert.equal(fallbackUploadExtension("document", "application/pdf", "notes.pdf"), "pdf");
  assert.equal(fallbackUploadExtension("document", "text/plain", ""), "txt");
});

test("resolvePreviewFileId prefers thumbnail metadata for images", () => {
  const metadata = JSON.stringify({
    mediaKind: "image",
    thumbnailFileId: "thumb-123",
  });
  assert.equal(resolvePreviewFileId("full-123", metadata), "thumb-123");
  assert.equal(resolvePreviewFileId("video-1", JSON.stringify({ mediaKind: "video", thumbnailFileId: "thumb-v" })), "video-1");
  assert.equal(resolvePreviewFileId("full-123", "not-json"), "full-123");
});
