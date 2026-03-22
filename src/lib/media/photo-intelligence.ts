import { inferStoredMediaKind, parseMediaMetadata } from "@/lib/media/upload";

export type PhotoVisionInsight = {
  labels: Array<{ name: string; confidence: number }>;
  objects: Array<{ name: string; confidence: number }>;
  faceCount: number;
};

export type PhotoIntelligenceSuggestion = {
  status: "completed" | "failed";
  generatedAt: string;
  labelSuggestion: string;
  descriptionSuggestion: string;
  dateSuggestion: string;
  dateSource: "exif" | "filename" | "capture_timestamp" | "none";
  dateConfidence: "high" | "medium" | "low";
  notes: string;
  captionSource?: "deterministic" | "openai_vision";
  captionModel?: string;
  visionLabels?: string[];
  visionObjects?: string[];
  detectedFaceCount?: number;
};

export type PhotoIntelligenceDebug = {
  generatedAt: string;
  visionConfigured: boolean;
  visionAttempted: boolean;
  visionSucceeded: boolean;
  visionErrorMessage: string;
  visionErrorCode: string;
  visionStatusCode: string;
  visionServiceCode: string;
  visionOpcRequestId: string;
  visionRawResult: string;
};

export type PhotoIntelligenceDateSignal = {
  date: string;
  source: Exclude<PhotoIntelligenceSuggestion["dateSource"], "none">;
  confidence: PhotoIntelligenceSuggestion["dateConfidence"];
  notes: string;
};

export type PhotoIntelligenceCaptionRefinement = {
  labelSuggestion: string;
  descriptionSuggestion: string;
  source: NonNullable<PhotoIntelligenceSuggestion["captionSource"]>;
  model: string;
  notes: string;
};

type BuildPhotoIntelligenceInput = {
  fileId: string;
  fileName: string;
  createdAt: string;
  linkedPeople: string[];
  existingMetadata: string;
  dateSignal?: PhotoIntelligenceDateSignal | null;
  captionRefinement?: PhotoIntelligenceCaptionRefinement | null;
  vision?: PhotoVisionInsight | null;
  debug?: PhotoIntelligenceDebug | null;
};

const GENERIC_NAME_PATTERNS = [
  /^img[_-]?\d+$/i,
  /^dsc[_-]?\d+$/i,
  /^p(xl|ic)?[_-]?\d+$/i,
  /^image[_-]?\d+$/i,
  /^photo[_-]?\d+$/i,
  /^screenshot[_-]?\d+$/i,
];

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function titleCaseWords(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function sanitizeFileStem(fileName: string) {
  const withoutExt = fileName.replace(/\.[^.]+$/, "");
  const normalized = normalizeWhitespace(
    withoutExt
      .replace(/[_-]+/g, " ")
      .replace(/[^\w\s]+/g, " ")
      .replace(/\b(copy|edited|final|new)\b/gi, " "),
  );
  return normalized;
}

function looksGenericStem(stem: string) {
  const compact = stem.replace(/\s+/g, "");
  return GENERIC_NAME_PATTERNS.some((pattern) => pattern.test(compact));
}

function parseDateFromFileName(fileName: string) {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const isoMatch = stem.match(/\b(19\d{2}|20\d{2})[-_ ](0[1-9]|1[0-2])[-_ ]([0-2]\d|3[01])\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  const compactMatch = stem.match(/\b(19\d{2}|20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])\b/);
  if (compactMatch) {
    return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;
  }
  return "";
}

function normalizeDate(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function clampText(value: string, max: number) {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= max) {
    return normalized;
  }
  return normalized.slice(0, max).trim();
}

function buildLabel(fileName: string) {
  const stem = sanitizeFileStem(fileName);
  if (!stem || looksGenericStem(stem)) {
    return "Family Photo";
  }
  return titleCaseWords(stem).slice(0, 80);
}

function buildLabelFromVision(vision: PhotoVisionInsight | null | undefined) {
  if (!vision) return "";
  const candidates = [...vision.labels, ...vision.objects]
    .filter((item) => item.confidence >= 0.5)
    .map((item) => item.name.trim())
    .filter(Boolean);
  if (candidates.length === 0) return "";
  const distinct = Array.from(new Set(candidates.map((item) => item.toLowerCase())));
  const preferred = distinct.slice(0, 2).map((item) => titleCaseWords(item));
  if (preferred.length === 1) {
    return `${preferred[0]} Memory`;
  }
  return `${preferred[0]} and ${preferred[1]}`;
}

function buildDescription(label: string, linkedPeople: string[]) {
  const people = linkedPeople.map((item) => item.trim()).filter(Boolean);
  if (people.length === 0) {
    return label;
  }
  if (people.length === 1) {
    return `${label} featuring ${people[0]}`;
  }
  if (people.length === 2) {
    return `${label} featuring ${people[0]} and ${people[1]}`;
  }
  return `${label} featuring ${people[0]} and family`;
}

function buildFallbackDateSignal(fileName: string, createdAt: string): PhotoIntelligenceDateSignal | null {
  const fileNameDate = parseDateFromFileName(fileName);
  if (fileNameDate) {
    return {
      date: fileNameDate,
      source: "filename",
      confidence: "high",
      notes: "Date inferred from file name pattern.",
    };
  }

  const createdAtDate = normalizeDate(createdAt);
  if (createdAtDate) {
    return {
      date: createdAtDate,
      source: "capture_timestamp",
      confidence: "medium",
      notes: "Date inferred from capture timestamp metadata.",
    };
  }

  return null;
}

export function buildPhotoIntelligenceSuggestion(input: BuildPhotoIntelligenceInput): {
  mediaMetadata: string;
  suggestion: PhotoIntelligenceSuggestion;
} {
  const current = parseMediaMetadata(input.existingMetadata) ?? {};
  const existing = current as Record<string, unknown>;
  const fileName = input.fileName.trim() || input.fileId.trim();
  const labelFromVision = buildLabelFromVision(input.vision);
  const fallbackLabel = labelFromVision || buildLabel(fileName);
  const fallbackDescription = buildDescription(fallbackLabel, input.linkedPeople);
  const resolvedCaption = input.captionRefinement
    ? {
      labelSuggestion: clampText(input.captionRefinement.labelSuggestion || fallbackLabel, 80),
      descriptionSuggestion: clampText(input.captionRefinement.descriptionSuggestion || fallbackDescription, 180),
      source: input.captionRefinement.source,
      model: input.captionRefinement.model,
      notes: input.captionRefinement.notes,
    }
    : {
      labelSuggestion: clampText(fallbackLabel, 80),
      descriptionSuggestion: clampText(fallbackDescription, 180),
      source: "deterministic" as const,
      model: "",
      notes: labelFromVision
        ? "Caption inferred deterministically from OCI Vision labels."
        : "Caption inferred deterministically from file name and linked people.",
    };
  const resolvedDateSignal = input.dateSignal ?? buildFallbackDateSignal(fileName, input.createdAt);
  const dateSuggestion = resolvedDateSignal?.date ?? "";
  const dateSource = resolvedDateSignal?.source ?? "none";
  const dateConfidence = resolvedDateSignal?.confidence ?? "low";
  const noteParts = [resolvedDateSignal?.notes ?? "No date signal found in EXIF, file name, or capture timestamp.", resolvedCaption.notes]
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);

  const suggestion: PhotoIntelligenceSuggestion = {
    status: "completed",
    generatedAt: new Date().toISOString(),
    labelSuggestion: resolvedCaption.labelSuggestion,
    descriptionSuggestion: resolvedCaption.descriptionSuggestion,
    dateSuggestion,
    dateSource,
    dateConfidence,
    notes: noteParts.join(" "),
    captionSource: resolvedCaption.source,
    captionModel: resolvedCaption.model || undefined,
    visionLabels: input.vision?.labels?.map((item) => item.name).slice(0, 6) ?? [],
    visionObjects: input.vision?.objects?.map((item) => item.name).slice(0, 8) ?? [],
    detectedFaceCount: input.vision?.faceCount ?? 0,
  };

  const merged = {
    ...existing,
    photoIntelligence: suggestion,
    photoIntelligenceDebug: input.debug ?? null,
  };
  return {
    suggestion,
    mediaMetadata: JSON.stringify(merged),
  };
}

export function readPhotoIntelligenceSuggestion(rawMetadata: string | undefined): PhotoIntelligenceSuggestion | null {
  const parsed = parseMediaMetadata(rawMetadata);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const suggestionRaw = (parsed as Record<string, unknown>).photoIntelligence;
  if (!suggestionRaw || typeof suggestionRaw !== "object") {
    return null;
  }
  const suggestion = suggestionRaw as Record<string, unknown>;
  const status = String(suggestion.status ?? "").trim().toLowerCase();
  if (status !== "completed" && status !== "failed") {
    return null;
  }
  const output: PhotoIntelligenceSuggestion = {
    status,
    generatedAt: String(suggestion.generatedAt ?? "").trim(),
    labelSuggestion: String(suggestion.labelSuggestion ?? "").trim(),
    descriptionSuggestion: String(suggestion.descriptionSuggestion ?? "").trim(),
    dateSuggestion: String(suggestion.dateSuggestion ?? "").trim(),
    dateSource: ["exif", "filename", "capture_timestamp", "none"].includes(String(suggestion.dateSource ?? ""))
      ? (String(suggestion.dateSource) as PhotoIntelligenceSuggestion["dateSource"])
      : "none",
    dateConfidence: ["high", "medium", "low"].includes(String(suggestion.dateConfidence ?? ""))
      ? (String(suggestion.dateConfidence) as PhotoIntelligenceSuggestion["dateConfidence"])
      : "low",
    notes: String(suggestion.notes ?? "").trim(),
    captionSource: ["deterministic", "openai_vision"].includes(String(suggestion.captionSource ?? ""))
      ? (String(suggestion.captionSource) as NonNullable<PhotoIntelligenceSuggestion["captionSource"]>)
      : undefined,
    captionModel: String(suggestion.captionModel ?? "").trim() || undefined,
    visionLabels: Array.isArray(suggestion.visionLabels)
      ? suggestion.visionLabels.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [],
    visionObjects: Array.isArray(suggestion.visionObjects)
      ? suggestion.visionObjects.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [],
    detectedFaceCount: Number.isFinite(Number(suggestion.detectedFaceCount ?? 0))
      ? Number(suggestion.detectedFaceCount)
      : 0,
  };
  return output;
}

export function readPhotoIntelligenceDebug(rawMetadata: string | undefined): PhotoIntelligenceDebug | null {
  const parsed = parseMediaMetadata(rawMetadata);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const debugRaw = (parsed as Record<string, unknown>).photoIntelligenceDebug;
  if (!debugRaw || typeof debugRaw !== "object") {
    return null;
  }
  const debug = debugRaw as Record<string, unknown>;
  return {
    generatedAt: String(debug.generatedAt ?? "").trim(),
    visionConfigured: String(debug.visionConfigured ?? "").trim().toLowerCase() === "true",
    visionAttempted: String(debug.visionAttempted ?? "").trim().toLowerCase() === "true",
    visionSucceeded: String(debug.visionSucceeded ?? "").trim().toLowerCase() === "true",
    visionErrorMessage: String(debug.visionErrorMessage ?? "").trim(),
    visionErrorCode: String(debug.visionErrorCode ?? "").trim(),
    visionStatusCode: String(debug.visionStatusCode ?? "").trim(),
    visionServiceCode: String(debug.visionServiceCode ?? "").trim(),
    visionOpcRequestId: String(debug.visionOpcRequestId ?? "").trim(),
    visionRawResult: String(debug.visionRawResult ?? "").trim(),
  };
}

export function canRunPhotoIntelligence(fileId: string, rawMetadata?: string) {
  return inferStoredMediaKind(fileId, rawMetadata) === "image";
}
