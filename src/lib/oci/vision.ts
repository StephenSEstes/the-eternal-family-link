import "server-only";

import sharp from "sharp";
import { AIServiceVisionClient, models } from "oci-aivision";
import { getOciAuthenticationProvider } from "@/lib/oci/auth";

export type OciVisionFace = {
  confidence: number;
  qualityScore: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  embedding: number[];
};

export type OciVisionInsight = {
  labels: Array<{ name: string; confidence: number }>;
  objects: Array<{ name: string; confidence: number }>;
  faces: OciVisionFace[];
  faceCount: number;
  embeddingAttempted: boolean;
  embeddingSucceeded: boolean;
  embeddingErrorMessage: string;
  embeddingFacesReturned: number;
  embeddingFacesWithVectors: number;
};

type OciVisionConfig = {
  region: string;
  compartmentId: string;
};

let cachedClient: AIServiceVisionClient | null = null;
let cachedConfigKey = "";

const OCI_VISION_INLINE_TARGET_BYTES = 4_500_000;
const OCI_VISION_SUPPORTED_FORMATS = new Set(["jpeg", "jpg", "png"]);
const OCI_VISION_PREPARE_STEPS = [
  { maxEdge: 2048, quality: 84 },
  { maxEdge: 1600, quality: 80 },
  { maxEdge: 1280, quality: 76 },
  { maxEdge: 960, quality: 72 },
  { maxEdge: 720, quality: 68 },
] as const;

type PreparedVisionImage = {
  imageBytes: Buffer;
  originalFormat: string;
  preparedFormat: string;
  normalizedFormat: boolean;
};

function readOptionalEnv(name: string) {
  const value = String(process.env[name] ?? "").trim();
  return value || "";
}

function readVisionConfig(): OciVisionConfig | null {
  const region = readOptionalEnv("OCI_REGION");
  const compartmentId = readOptionalEnv("OCI_VISION_COMPARTMENT_OCID") || readOptionalEnv("OCI_TENANCY_OCID");
  if (!region || !compartmentId) {
    return null;
  }
  return {
    region,
    compartmentId,
  };
}

function getVisionClient(config: OciVisionConfig) {
  const auth = getOciAuthenticationProvider();
  const key = `${config.region}|${config.compartmentId}|${auth.cacheKey}`;
  if (cachedClient && key === cachedConfigKey) {
    return cachedClient;
  }
  const client = new AIServiceVisionClient({
    authenticationDetailsProvider: auth.provider,
  });
  client.regionId = config.region;
  cachedClient = client;
  cachedConfigKey = key;
  return client;
}

export function isOciVisionConfigured() {
  return readVisionConfig() != null;
}

async function prepareImageBytesForVision(imageBytes: Buffer): Promise<PreparedVisionImage> {
  const metadata = await sharp(imageBytes, { failOn: "none", animated: false }).metadata();
  const originalFormat = String(metadata.format ?? "").trim().toLowerCase();
  const needsFormatNormalization = !OCI_VISION_SUPPORTED_FORMATS.has(originalFormat);
  if (!needsFormatNormalization && imageBytes.length <= OCI_VISION_INLINE_TARGET_BYTES) {
    return {
      imageBytes,
      originalFormat: originalFormat || "unknown",
      preparedFormat: originalFormat || "unknown",
      normalizedFormat: false,
    };
  }

  let smallestCandidate = imageBytes;
  for (const step of OCI_VISION_PREPARE_STEPS) {
    const candidate = await sharp(imageBytes, { failOn: "none", animated: false })
      .rotate()
      .resize({
        width: step.maxEdge,
        height: step.maxEdge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: step.quality, mozjpeg: true })
      .toBuffer();
    if (candidate.length < smallestCandidate.length) {
      smallestCandidate = candidate;
    }
    if (candidate.length <= OCI_VISION_INLINE_TARGET_BYTES) {
      return {
        imageBytes: candidate,
        originalFormat: originalFormat || "unknown",
        preparedFormat: "jpeg",
        normalizedFormat: needsFormatNormalization || originalFormat !== "jpeg",
      };
    }
  }

  if (smallestCandidate.length <= OCI_VISION_INLINE_TARGET_BYTES) {
    return {
      imageBytes: smallestCandidate,
      originalFormat: originalFormat || "unknown",
      preparedFormat: "jpeg",
      normalizedFormat: needsFormatNormalization || originalFormat !== "jpeg",
    };
  }

  throw new Error(
    `OCI Vision inline image could not be reduced below ${OCI_VISION_INLINE_TARGET_BYTES} bytes (originalFormat=${originalFormat || "unknown"} prepared=${smallestCandidate.length}).`,
  );
}

function normalizeVisionError(error: unknown, context: {
  originalBytes: number;
  preparedBytes: number;
  originalFormat: string;
  preparedFormat: string;
  normalizedFormat: boolean;
}) {
  const typed = error as { message?: string };
  const message = String(typed?.message ?? "");
  if (message.includes("toLowerCase is not a function")) {
    return new Error(
      `OCI Vision request failed before returning a readable service error. originalFormat=${context.originalFormat} preparedFormat=${context.preparedFormat} normalizedFormat=${String(context.normalizedFormat)} originalBytes=${context.originalBytes} preparedBytes=${context.preparedBytes}`,
    );
  }
  return error;
}

function toBoundingBox(item: {
  boundingPolygon?: {
    normalizedVertices?: Array<{ x?: number; y?: number }>;
  };
}) {
  const vertices = Array.isArray(item?.boundingPolygon?.normalizedVertices)
    ? item.boundingPolygon.normalizedVertices
      .map((vertex) => ({
        x: Number(vertex?.x ?? 0),
        y: Number(vertex?.y ?? 0),
      }))
      .filter((vertex) => Number.isFinite(vertex.x) && Number.isFinite(vertex.y))
    : [];
  const minX = vertices.length > 0 ? Math.min(...vertices.map((vertex) => vertex.x)) : 0;
  const minY = vertices.length > 0 ? Math.min(...vertices.map((vertex) => vertex.y)) : 0;
  const maxX = vertices.length > 0 ? Math.max(...vertices.map((vertex) => vertex.x)) : 0;
  const maxY = vertices.length > 0 ? Math.max(...vertices.map((vertex) => vertex.y)) : 0;
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function extractFaces(result: models.AnalyzeImageResult | undefined): OciVisionFace[] {
  return Array.isArray(result?.detectedFaces)
    ? result.detectedFaces
      .map((item) => ({
        confidence: Number(item?.confidence ?? 0),
        qualityScore: Number(item?.qualityScore ?? 0),
        boundingBox: toBoundingBox(item ?? {}),
        embedding: Array.isArray(item?.embeddings)
          ? item.embeddings
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value))
          : [],
      }))
      .filter((item) => item.boundingBox.width > 0 && item.boundingBox.height > 0)
      .sort((a, b) => b.qualityScore - a.qualityScore)
    : [];
}

function intersectionOverUnion(left: OciVisionFace["boundingBox"], right: OciVisionFace["boundingBox"]) {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  const intersectionWidth = Math.max(0, x2 - x1);
  const intersectionHeight = Math.max(0, y2 - y1);
  const intersectionArea = intersectionWidth * intersectionHeight;
  if (intersectionArea <= 0) {
    return 0;
  }
  const leftArea = Math.max(0, left.width) * Math.max(0, left.height);
  const rightArea = Math.max(0, right.width) * Math.max(0, right.height);
  const unionArea = leftArea + rightArea - intersectionArea;
  if (unionArea <= 0) {
    return 0;
  }
  return intersectionArea / unionArea;
}

function mergeFaceEmbeddings(baseFaces: OciVisionFace[], embeddingFaces: OciVisionFace[]) {
  if (baseFaces.length === 0 || embeddingFaces.length === 0) {
    return baseFaces;
  }
  const usedEmbeddingIndexes = new Set<number>();
  return baseFaces.map((face) => {
    let bestIndex = -1;
    let bestScore = -1;
    for (let index = 0; index < embeddingFaces.length; index += 1) {
      if (usedEmbeddingIndexes.has(index)) {
        continue;
      }
      const candidate = embeddingFaces[index];
      const iou = intersectionOverUnion(face.boundingBox, candidate.boundingBox);
      if (iou > bestScore) {
        bestScore = iou;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0) {
      usedEmbeddingIndexes.add(bestIndex);
      const matched = embeddingFaces[bestIndex];
      return {
        ...face,
        embedding: matched.embedding.length > 0 ? matched.embedding : face.embedding,
      };
    }
    return face;
  });
}

export async function analyzeInlineImageWithVision(input: {
  imageBytes: Buffer;
}): Promise<OciVisionInsight> {
  const config = readVisionConfig();
  if (!config) {
    throw new Error("OCI Vision is not configured.");
  }
  const client = getVisionClient(config);
  const prepared = await prepareImageBytesForVision(input.imageBytes);
  const preparedImageBytes = prepared.imageBytes;

  const primaryFeatures: models.ImageFeature[] = [
    { featureType: "IMAGE_CLASSIFICATION", maxResults: 6 } as models.ImageClassificationFeature,
    { featureType: "OBJECT_DETECTION", maxResults: 8 } as models.ImageObjectDetectionFeature,
    { featureType: "FACE_DETECTION", maxResults: 20, shouldReturnLandmarks: false } as models.FaceDetectionFeature,
  ];

  const primaryRequest: models.AnalyzeImageDetails = {
    compartmentId: config.compartmentId,
    image: {
      source: "INLINE",
      data: preparedImageBytes.toString("base64"),
    },
    features: primaryFeatures,
  };

  let response;
  try {
    response = await client.analyzeImage({
      analyzeImageDetails: primaryRequest,
    });
  } catch (error) {
    throw normalizeVisionError(error, {
      originalBytes: input.imageBytes.length,
      preparedBytes: preparedImageBytes.length,
      originalFormat: prepared.originalFormat,
      preparedFormat: prepared.preparedFormat,
      normalizedFormat: prepared.normalizedFormat,
    });
  }
  const result = response.analyzeImageResult;
  const labels = Array.isArray(result?.labels)
    ? result.labels
      .map((item) => ({
        name: String(item?.name ?? "").trim(),
        confidence: Number(item?.confidence ?? 0),
      }))
      .filter((item) => item.name)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 6)
    : [];
  const objects = Array.isArray(result?.imageObjects)
    ? result.imageObjects
      .map((item) => ({
        name: String(item?.name ?? "").trim(),
        confidence: Number(item?.confidence ?? 0),
      }))
      .filter((item) => item.name)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 8)
    : [];
  let faces = extractFaces(result);
  let embeddingAttempted = false;
  let embeddingSucceeded = false;
  let embeddingErrorMessage = "";
  let embeddingFacesReturned = 0;
  let embeddingFacesWithVectors = 0;
  if (faces.length > 0) {
    try {
      embeddingAttempted = true;
      const embeddingResponse = await client.analyzeImage({
        analyzeImageDetails: {
          compartmentId: config.compartmentId,
          image: {
            source: "INLINE",
            data: preparedImageBytes.toString("base64"),
          },
          features: [
            { featureType: "FACE_EMBEDDING", maxResults: 20, shouldReturnLandmarks: true } as models.FaceEmbeddingFeature,
          ],
        },
      });
      const embeddingFaces = extractFaces(embeddingResponse.analyzeImageResult);
      embeddingSucceeded = true;
      embeddingFacesReturned = embeddingFaces.length;
      embeddingFacesWithVectors = embeddingFaces.filter((face) => face.embedding.length > 0).length;
      if (embeddingFacesWithVectors === 0) {
        embeddingErrorMessage = "FACE_EMBEDDING returned faces without embedding vectors.";
      }
      faces = mergeFaceEmbeddings(faces, embeddingFaces);
    } catch (embeddingError) {
      embeddingErrorMessage = embeddingError instanceof Error ? embeddingError.message : "Face embedding request failed.";
      console.warn("[vision] face embedding request skipped; continuing without embeddings", embeddingError);
    }
  }
  const faceCount = faces.length;
  return {
    labels,
    objects,
    faces,
    faceCount,
    embeddingAttempted,
    embeddingSucceeded,
    embeddingErrorMessage,
    embeddingFacesReturned,
    embeddingFacesWithVectors,
  };
}
