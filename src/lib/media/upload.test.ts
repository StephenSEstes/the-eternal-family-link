import test from "node:test";
import assert from "node:assert/strict";
import { buildMediaMetadata, normalizeMediaKind, sanitizeUploadFileName, validateUploadInput } from "./upload";

test("normalizeMediaKind classifies image/video/audio", () => {
  assert.equal(normalizeMediaKind("image/jpeg"), "image");
  assert.equal(normalizeMediaKind("video/mp4"), "video");
  assert.equal(normalizeMediaKind("audio/mpeg"), "audio");
  assert.equal(normalizeMediaKind("application/pdf"), "unknown");
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

  const badType = validateUploadInput({ byteLength: 5, mimeType: "application/pdf" });
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
});

test("sanitizeUploadFileName strips unsafe characters", () => {
  assert.equal(sanitizeUploadFileName(" family photo (1).jpg ", "fallback.jpg"), "family_photo_1_.jpg");
  assert.equal(sanitizeUploadFileName("", "fallback.jpg"), "fallback.jpg");
});

test("buildMediaMetadata includes typed media details", () => {
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
  assert.equal(parsed.width, 1920);
  assert.equal(parsed.height, 1080);
  assert.equal(parsed.durationSec, 8.4);
  assert.equal(parsed.captureSource, "camera");
});
