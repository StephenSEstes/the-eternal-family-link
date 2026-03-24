import {
  readPhotoIntelligenceDebug,
  type PhotoIntelligenceDebug,
} from "@/lib/media/photo-intelligence";
import { compactMediaMetadata, inferStoredMediaKind } from "@/lib/media/upload";

export type MediaProcessingStepState = "completed" | "pending" | "failed" | "not_applicable";

export type MediaProcessingStep = {
  label: string;
  state: MediaProcessingStepState;
  detail: string;
  count?: number;
  fileName?: string;
};

export type MediaProcessingStatus = {
  upload: MediaProcessingStep;
  exif: MediaProcessingStep;
  thumbnail: MediaProcessingStep;
  faceCoordinates: MediaProcessingStep;
  faceVectors: MediaProcessingStep;
  faceIdentities: MediaProcessingStep;
};

const PROCESSING_STATUS_METADATA_KEY = "processingStatus";
const VALID_STEP_STATES = new Set<MediaProcessingStepState>(["completed", "pending", "failed", "not_applicable"]);

type BuildMediaProcessingStatusInput = {
  fileId: string;
  rawMetadata?: string;
  fileName?: string;
  originalObjectKey?: string;
  thumbnailObjectKey?: string;
  exifExtractedAt?: string;
  exifCaptureDate?: string;
  faceInstanceCount?: number;
  faceVectorCount?: number;
  confirmedIdentityCount?: number;
  profileVectorCount?: number;
  debug?: PhotoIntelligenceDebug | null;
};

function parseRawMetadata(rawMetadata: string | undefined) {
  const text = String(rawMetadata ?? "").trim();
  if (!text) {
    return {} as Record<string, unknown>;
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

function parseRawMetadataForWrite(rawMetadata: string | undefined) {
  const text = String(rawMetadata ?? "").trim();
  if (!text) {
    return {} as Record<string, unknown>;
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : ({} as Record<string, unknown>);
  } catch {
    return {} as Record<string, unknown>;
  }
}

function step(
  label: string,
  state: MediaProcessingStepState,
  detail: string,
  count?: number,
  fileName?: string,
): MediaProcessingStep {
  return {
    label,
    state,
    detail,
    ...(typeof count === "number" ? { count } : {}),
    ...(fileName ? { fileName } : {}),
  };
}

function isImageMedia(fileId: string, rawMetadata?: string) {
  return inferStoredMediaKind(fileId, rawMetadata) === "image";
}

function normalizeStoredStep(
  value: unknown,
  fallbackLabel: string,
): MediaProcessingStep | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const state = String(raw.state ?? "").trim() as MediaProcessingStepState;
  if (!VALID_STEP_STATES.has(state)) {
    return null;
  }
  const detail = String(raw.detail ?? "").trim();
  if (!detail) {
    return null;
  }
  const countValue = Number(raw.count);
  const fileName = String(raw.fileName ?? "").trim();
  return {
    label: String(raw.label ?? "").trim() || fallbackLabel,
    state,
    detail,
    ...(Number.isFinite(countValue) ? { count: Math.max(0, Math.trunc(countValue)) } : {}),
    ...(fileName ? { fileName } : {}),
  };
}

function extractObjectFileName(objectKey: string) {
  const normalized = objectKey.trim();
  if (!normalized) return "";
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

export function readMediaProcessingStatus(rawMetadata?: string): MediaProcessingStatus | null {
  const metadata = parseRawMetadata(rawMetadata);
  const rawStatus = metadata[PROCESSING_STATUS_METADATA_KEY];
  if (!rawStatus || typeof rawStatus !== "object") {
    return null;
  }
  const parsed = rawStatus as Record<string, unknown>;
  const upload = normalizeStoredStep(parsed.upload, "Upload");
  const exif = normalizeStoredStep(parsed.exif, "EXIF");
  const thumbnail = normalizeStoredStep(parsed.thumbnail, "Thumbnail");
  const faceCoordinates = normalizeStoredStep(parsed.faceCoordinates, "Face Coordinates");
  const faceVectors = normalizeStoredStep(parsed.faceVectors, "Face Vectors");
  const faceIdentities = normalizeStoredStep(parsed.faceIdentities, "Face Identities");
  if (!upload || !exif || !thumbnail || !faceCoordinates || !faceVectors || !faceIdentities) {
    return null;
  }
  return {
    upload,
    exif,
    thumbnail,
    faceCoordinates,
    faceVectors,
    faceIdentities,
  };
}

export function writeMediaProcessingStatus(
  rawMetadata: string | undefined,
  processingStatus: MediaProcessingStatus,
): string {
  const metadata = parseRawMetadataForWrite(rawMetadata);
  metadata[PROCESSING_STATUS_METADATA_KEY] = processingStatus;
  return compactMediaMetadata(JSON.stringify(metadata));
}

export function buildMediaProcessingStatus(input: BuildMediaProcessingStatusInput): MediaProcessingStatus {
  const rawMetadata = String(input.rawMetadata ?? "").trim();
  const metadata = parseRawMetadata(rawMetadata);
  const debug = input.debug ?? readPhotoIntelligenceDebug(rawMetadata);
  const imageMedia = isImageMedia(input.fileId, rawMetadata);
  const objectStorage = metadata.objectStorage && typeof metadata.objectStorage === "object"
    ? (metadata.objectStorage as Record<string, unknown>)
    : null;
  const originalObjectKey = String(
    input.originalObjectKey ?? objectStorage?.originalObjectKey ?? metadata.originalObjectKey ?? "",
  ).trim();
  const thumbnailObjectKey = String(
    input.thumbnailObjectKey ?? objectStorage?.thumbnailObjectKey ?? metadata.thumbnailObjectKey ?? "",
  ).trim();
  const originalFileName = String(input.fileName ?? metadata.fileName ?? "").trim();
  const thumbnailFileName = extractObjectFileName(thumbnailObjectKey);
  const faceInstanceCount = Math.max(0, Math.trunc(input.faceInstanceCount ?? 0));
  const faceVectorCount = Math.max(
    0,
    Math.trunc(Math.max(input.faceVectorCount ?? 0, input.profileVectorCount ?? 0)),
  );
  const confirmedIdentityCount = Math.max(0, Math.trunc(input.confirmedIdentityCount ?? 0));
  const visionAttempted = Boolean(debug?.visionAttempted);
  const visionSucceeded = Boolean(debug?.visionSucceeded);
  const visionErrorMessage = String(debug?.visionErrorMessage ?? "").trim();

  const upload = step(
    "Upload",
    "completed",
    originalObjectKey ? "Original media bytes are stored and linked." : "Media record exists in the library.",
    undefined,
    originalFileName,
  );

  const exif = !imageMedia
    ? step("EXIF", "not_applicable", "EXIF is only collected for image uploads.")
    : String(input.exifExtractedAt ?? "").trim()
      ? step(
        "EXIF",
        "completed",
        String(input.exifCaptureDate ?? "").trim()
          ? `Collected at upload. Capture date ${String(input.exifCaptureDate).trim()}.`
          : "Collected at upload. No capture date was present in EXIF.",
      )
      : step("EXIF", "pending", "EXIF has not been collected for this image yet.");

  const thumbnail = !imageMedia
    ? step("Thumbnail", "not_applicable", "Thumbnail generation only applies to image uploads.")
    : thumbnailObjectKey
      ? step("Thumbnail", "completed", "Preview thumbnail is stored for this image.", undefined, thumbnailFileName)
      : step("Thumbnail", "pending", "Thumbnail has not been generated or stored.");

  const faceCoordinates = !imageMedia
    ? step("Face Coordinates", "not_applicable", "Face detection only applies to image uploads.")
    : faceInstanceCount > 0
      ? step("Face Coordinates", "completed", `${faceInstanceCount} detected face region(s) stored.`, faceInstanceCount)
      : visionAttempted && visionSucceeded
        ? step("Face Coordinates", "completed", "Face analysis ran, but no faces were found.")
        : visionAttempted && !visionSucceeded
          ? step("Face Coordinates", "failed", visionErrorMessage || "Face detection failed before any coordinates were stored.")
          : step("Face Coordinates", "pending", "Generate Suggestions to detect faces and store face coordinates.");

  const faceVectors = !imageMedia
    ? step("Face Vectors", "not_applicable", "Face vectors only apply to image uploads.")
    : faceVectorCount > 0
      ? step("Face Vectors", "completed", `${faceVectorCount} face vector source(s) are stored for this photo.`, faceVectorCount)
      : faceInstanceCount > 0
        ? step("Face Vectors", "pending", "Faces are detected, but no stored vectors exist for this photo yet.")
        : visionAttempted && visionSucceeded
          ? step("Face Vectors", "not_applicable", "No faces were found, so no vectors were created.")
          : visionAttempted && !visionSucceeded
            ? step("Face Vectors", "failed", visionErrorMessage || "Face vector creation could not begin because face analysis failed.")
            : step("Face Vectors", "pending", "Vectors are created after a face is confirmed or a canonical headshot is seeded.");

  const faceIdentities = !imageMedia
    ? step("Face Identities", "not_applicable", "Face identity review only applies to image uploads.")
    : confirmedIdentityCount > 0
      ? step("Face Identities", "completed", `${confirmedIdentityCount} face identity match(es) have been confirmed.`, confirmedIdentityCount)
      : faceInstanceCount > 0
        ? step("Face Identities", "pending", "Faces are detected, but no identities have been confirmed yet.")
        : visionAttempted && visionSucceeded
          ? step("Face Identities", "not_applicable", "No faces were found to verify.")
          : visionAttempted && !visionSucceeded
            ? step("Face Identities", "failed", visionErrorMessage || "Face identities cannot be reviewed until face detection succeeds.")
            : step("Face Identities", "pending", "Run face analysis before confirming identities.");

  return {
    upload,
    exif,
    thumbnail,
    faceCoordinates,
    faceVectors,
    faceIdentities,
  };
}
