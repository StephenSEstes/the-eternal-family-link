import { createHash, timingSafeEqual } from "crypto";

function sha256Hex(input: string) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function verifyViewerPin(pin: string, storedHash: string) {
  const normalizedHash = (storedHash ?? "").trim().toLowerCase().replace(/^sha256:/, "");
  if (!normalizedHash) {
    return false;
  }

  const digest = sha256Hex(pin.trim());
  const left = Buffer.from(digest, "utf8");
  const right = Buffer.from(normalizedHash, "utf8");
  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

export function viewerPinHash(pin: string) {
  return `sha256:${sha256Hex(pin.trim())}`;
}
