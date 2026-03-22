import "server-only";

import { createHash } from "node:crypto";
import exifr from "exifr";
import type { PhotoIntelligenceDateSignal } from "@/lib/media/photo-intelligence";

type ParsedExifDates = Partial<Record<"DateTimeOriginal" | "CreateDate" | "ModifyDate" | "DateTimeDigitized", unknown>>;

type ParsedExifPayload =
  ParsedExifDates &
  Partial<Record<"Make" | "Model" | "Software" | "ExifImageWidth" | "ExifImageHeight" | "ImageWidth" | "ImageHeight" | "Orientation", unknown>>;

export type PersistedExifData = {
  extractedAt: string;
  sourceTag: string;
  captureDate: string;
  captureTimestampRaw: string;
  make: string;
  model: string;
  software: string;
  width: number;
  height: number;
  orientation: number;
  fingerprint: string;
};

const EXIF_DATE_TAGS: Array<keyof ParsedExifDates> = ["DateTimeOriginal", "CreateDate", "DateTimeDigitized", "ModifyDate"];
const EXIF_PICK_TAGS: string[] = [
  ...EXIF_DATE_TAGS,
  "Make",
  "Model",
  "Software",
  "ExifImageWidth",
  "ExifImageHeight",
  "ImageWidth",
  "ImageHeight",
  "Orientation",
];

function formatDateParts(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return "";
  if (year < 1800 || year > 2100) return "";
  if (month < 1 || month > 12) return "";
  if (day < 1 || day > 31) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeExifDateValue(value: unknown) {
  if (value instanceof Date) {
    return formatDateParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }

  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const exifLike = raw.match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})(?:\s+\d{2}:\d{2}:\d{2})?/);
  if (exifLike) {
    return formatDateParts(Number(exifLike[1]), Number(exifLike[2]), Number(exifLike[3]));
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return formatDateParts(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
}

function normalizePositiveInteger(value: unknown) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function buildExifFingerprint(input: Omit<PersistedExifData, "fingerprint">) {
  const parts = [
    input.sourceTag,
    input.captureDate,
    input.captureTimestampRaw,
    input.make,
    input.model,
    input.software,
    input.width > 0 ? String(input.width) : "",
    input.height > 0 ? String(input.height) : "",
    input.orientation > 0 ? String(input.orientation) : "",
  ].filter(Boolean);
  if (parts.length === 0) {
    return "";
  }
  return createHash("sha1").update(parts.join("|").toLowerCase()).digest("hex");
}

function emptyPersistedExifData(extractedAt: string): PersistedExifData {
  return {
    extractedAt,
    sourceTag: "",
    captureDate: "",
    captureTimestampRaw: "",
    make: "",
    model: "",
    software: "",
    width: 0,
    height: 0,
    orientation: 0,
    fingerprint: "",
  };
}

export function readPersistedExifData(input: Partial<Record<keyof PersistedExifData, unknown>> | null | undefined): PersistedExifData | null {
  const extractedAt = normalizeText(input?.extractedAt);
  if (!extractedAt) {
    return null;
  }
  const normalizedWithoutFingerprint = {
    extractedAt,
    sourceTag: normalizeText(input?.sourceTag),
    captureDate: normalizeText(input?.captureDate),
    captureTimestampRaw: normalizeText(input?.captureTimestampRaw),
    make: normalizeText(input?.make),
    model: normalizeText(input?.model),
    software: normalizeText(input?.software),
    width: normalizePositiveInteger(input?.width),
    height: normalizePositiveInteger(input?.height),
    orientation: normalizePositiveInteger(input?.orientation),
  };
  return {
    ...normalizedWithoutFingerprint,
    fingerprint: normalizeText(input?.fingerprint) || buildExifFingerprint(normalizedWithoutFingerprint),
  };
}

export function buildDateSignalFromPersistedExif(exif: PersistedExifData | null): PhotoIntelligenceDateSignal | null {
  if (!exif?.captureDate) {
    return null;
  }
  return {
    date: exif.captureDate,
    source: "exif",
    confidence: "high",
    notes: exif.sourceTag
      ? `Date inferred from EXIF ${exif.sourceTag}.`
      : "Date inferred from persisted EXIF metadata.",
  };
}

export async function collectPersistedExifData(imageBytes: Buffer): Promise<PersistedExifData> {
  const extractedAt = new Date().toISOString();
  const empty = emptyPersistedExifData(extractedAt);
  try {
    const parsed = await exifr.parse(imageBytes, {
      pick: EXIF_PICK_TAGS,
      reviveValues: false,
      translateKeys: false,
      translateValues: false,
    }) as ParsedExifPayload | null;
    if (!parsed || typeof parsed !== "object") {
      return empty;
    }

    let sourceTag = "";
    let captureDate = "";
    let captureTimestampRaw = "";
    for (const tag of EXIF_DATE_TAGS) {
      const normalized = normalizeExifDateValue(parsed[tag]);
      if (!normalized) {
        continue;
      }
      sourceTag = tag;
      captureDate = normalized;
      captureTimestampRaw = normalizeText(parsed[tag]);
      break;
    }

    const normalizedWithoutFingerprint = {
      extractedAt,
      sourceTag,
      captureDate,
      captureTimestampRaw,
      make: normalizeText(parsed.Make),
      model: normalizeText(parsed.Model),
      software: normalizeText(parsed.Software),
      width: normalizePositiveInteger(parsed.ExifImageWidth ?? parsed.ImageWidth),
      height: normalizePositiveInteger(parsed.ExifImageHeight ?? parsed.ImageHeight),
      orientation: normalizePositiveInteger(parsed.Orientation),
    };
    return {
      ...normalizedWithoutFingerprint,
      fingerprint: buildExifFingerprint(normalizedWithoutFingerprint),
    };
  } catch (error) {
    console.warn("[photo-intelligence] exif extraction skipped", error);
    return empty;
  }
}
