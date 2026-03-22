import "server-only";

import exifr from "exifr";
import type { PhotoIntelligenceDateSignal } from "@/lib/media/photo-intelligence";

type ParsedExifDates = Partial<Record<"DateTimeOriginal" | "CreateDate" | "ModifyDate" | "DateTimeDigitized", unknown>>;

const EXIF_DATE_TAGS: Array<keyof ParsedExifDates> = ["DateTimeOriginal", "CreateDate", "DateTimeDigitized", "ModifyDate"];

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

export async function extractExifDateSignal(imageBytes: Buffer): Promise<PhotoIntelligenceDateSignal | null> {
  try {
    const parsed = await exifr.parse(imageBytes, {
      pick: EXIF_DATE_TAGS,
      reviveValues: false,
      translateKeys: false,
      translateValues: false,
    }) as ParsedExifDates | null;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    for (const tag of EXIF_DATE_TAGS) {
      const normalized = normalizeExifDateValue(parsed[tag]);
      if (!normalized) {
        continue;
      }
      return {
        date: normalized,
        source: "exif",
        confidence: "high",
        notes: `Date inferred from EXIF ${tag}.`,
      };
    }
  } catch (error) {
    console.warn("[photo-intelligence] exif date extraction skipped", error);
  }
  return null;
}
