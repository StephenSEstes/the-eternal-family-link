import "server-only";

import sharp from "sharp";
import * as common from "oci-common";
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
  vertices?: Array<{ x: number; y: number }>;
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
  prepareLatencyMs: number;
  visionRequestLatencyMs: number;
  totalLatencyMs: number;
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

type DirectVisionClient = AIServiceVisionClient & {
  _httpClient: {
    send(
      request: unknown,
      forceExcludeBody?: boolean,
      targetService?: string,
      operationName?: string,
      timestamp?: string,
      endpoint?: string,
      apiReferenceLink?: string,
    ): Promise<Response>;
  };
};

type OciVisionErrorShape = {
  code: string;
  statusCode: number;
  serviceCode: string;
  opcRequestId: string;
  rawBody: string;
};

const OCI_VISION_ANALYZE_IMAGE_REFERENCE =
  "https://docs.oracle.com/iaas/api/#/en/vision/20220125/AnalyzeImageResult/AnalyzeImage";

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

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function stringifyOciErrorBody(body: unknown) {
  if (typeof body === "string") {
    return body.trim();
  }
  if (body == null) {
    return "";
  }
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function buildDirectVisionError(response: Response, body: unknown): Error & OciVisionErrorShape {
  const statusCode = Number(response.status ?? -1);
  const serviceCode =
    body && typeof body === "object" && "code" in body
      ? String((body as { code?: unknown }).code ?? "UnknownServiceCode").trim() || "UnknownServiceCode"
      : "UnknownServiceCode";
  const messageFromBody =
    body && typeof body === "object" && "message" in body
      ? String((body as { message?: unknown }).message ?? "").trim()
      : "";
  const statusText = String(response.statusText ?? "").trim();
  const opcRequestId = String(response.headers.get("opc-request-id") ?? "").trim();
  const rawBody = stringifyOciErrorBody(body);
  const message = [
    `OCI Vision service rejected the request (status=${statusCode}, serviceCode=${serviceCode})`,
    messageFromBody ? `message=${messageFromBody}` : "",
    statusText ? `statusText=${statusText}` : "",
    opcRequestId ? `opcRequestId=${opcRequestId}` : "",
    rawBody ? `rawBody=${rawBody}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return Object.assign(new Error(message), {
    code: serviceCode,
    statusCode,
    serviceCode,
    opcRequestId,
    rawBody,
  });
}

async function sendAnalyzeImageRequest(input: {
  client: AIServiceVisionClient;
  analyzeImageDetails: models.AnalyzeImageDetails;
}): Promise<models.AnalyzeImageResult> {
  const request = await common.composeRequest({
    baseEndpoint: input.client.endpoint,
    defaultHeaders: {},
    path: "/actions/analyzeImage",
    method: "POST",
    bodyContent: common.ObjectSerializer.serialize(
      input.analyzeImageDetails,
      "AnalyzeImageDetails",
      models.AnalyzeImageDetails.getJsonObj,
    ),
    pathParams: {},
    headerParams: {
      "Content-Type": common.Constants.APPLICATION_JSON,
    },
    queryParams: {},
  });
  const response = await (input.client as DirectVisionClient)._httpClient.send(
    request,
    false,
    "AIServiceVision",
    "analyzeImage",
    new Date().toISOString(),
    `${request.method} ${request.uri}`,
    OCI_VISION_ANALYZE_IMAGE_REFERENCE,
  );
  const rawText = await response.text();
  const parsedBody = parseMaybeJson(rawText);
  if (!response.ok) {
    throw buildDirectVisionError(response, parsedBody);
  }
  if (!parsedBody || typeof parsedBody !== "object") {
    throw new Error("OCI Vision returned a non-JSON response.");
  }
  return parsedBody as models.AnalyzeImageResult;
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
    vertices,
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
        vertices: Array.isArray(item?.boundingPolygon?.normalizedVertices)
          ? (item.boundingPolygon?.normalizedVertices ?? [])
              .map((v) => ({ x: Number(v?.x ?? 0), y: Number(v?.y ?? 0) }))
              .filter((v) => Number.isFinite(v.x) && Number.isFinite(v.y))
          : undefined,
      }))
      .filter((item) => item.boundingBox.width > 0 && item.boundingBox.height > 0)
      .sort((a, b) => b.qualityScore - a.qualityScore)
    : [];
}

async function analyzeInlineImageWithEmbedding(input: {
  imageBytes: Buffer;
}): Promise<OciVisionInsight> {
  const config = readVisionConfig();
  if (!config) {
    throw new Error("OCI Vision is not configured.");
  }
  const totalStartedAt = Date.now();
  const client = getVisionClient(config);
  const prepareStartedAt = Date.now();
  const prepared = await prepareImageBytesForVision(input.imageBytes);
  const prepareLatencyMs = Date.now() - prepareStartedAt;
  const preparedImageBytes = prepared.imageBytes;

  let visionRequestLatencyMs = 0;
  const requestStartedAt = Date.now();
  const embeddingAttempted = true;
  let embeddingSucceeded = false;
  try {
    const result = await sendAnalyzeImageRequest({
      client,
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
    visionRequestLatencyMs = Date.now() - requestStartedAt;
    embeddingSucceeded = true;
    const labels: Array<{ name: string; confidence: number }> = [];
    const objects: Array<{ name: string; confidence: number }> = [];
    const faces = extractFaces(result);
    let embeddingErrorMessage = "";
    const embeddingFacesReturned = faces.length;
    const embeddingFacesWithVectors = faces.filter((face) => face.embedding.length > 0).length;
    if (faces.length > 0 && embeddingFacesWithVectors === 0) {
      embeddingErrorMessage = "FACE_EMBEDDING returned faces without embedding vectors.";
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
      prepareLatencyMs,
      visionRequestLatencyMs,
      totalLatencyMs: Date.now() - totalStartedAt,
    };
  } catch (error) {
    visionRequestLatencyMs = Date.now() - requestStartedAt;
    const typed = error as Partial<OciVisionErrorShape> & { message?: string };
    const message = String(typed.message ?? "").trim();
    if (typed.rawBody || typed.statusCode || typed.serviceCode || typed.opcRequestId) {
      throw error;
    }
    throw Object.assign(
      new Error(
        [
          message || "OCI Vision request failed before returning a readable service error.",
          `originalFormat=${prepared.originalFormat}`,
          `preparedFormat=${prepared.preparedFormat}`,
          `normalizedFormat=${String(prepared.normalizedFormat)}`,
          `originalBytes=${input.imageBytes.length}`,
          `preparedBytes=${preparedImageBytes.length}`,
        ].join(" "),
      ),
      {
        code: "",
        statusCode: -1,
        serviceCode: "",
        opcRequestId: "",
      },
    );
  }
}

export async function analyzeInlineImageWithVision(input: {
  imageBytes: Buffer;
}): Promise<OciVisionInsight> {
  return analyzeInlineImageWithEmbedding({
    imageBytes: input.imageBytes,
  });
}

export async function detectFacesInlineWithVision(input: {
  imageBytes: Buffer;
}): Promise<OciVisionInsight> {
  const config = readVisionConfig();
  if (!config) {
    throw new Error("OCI Vision is not configured.");
  }
  const totalStartedAt = Date.now();
  const client = getVisionClient(config);
  const prepareStartedAt = Date.now();
  const prepared = await prepareImageBytesForVision(input.imageBytes);
  const prepareLatencyMs = Date.now() - prepareStartedAt;
  const preparedImageBytes = prepared.imageBytes;
  const primaryRequest: models.AnalyzeImageDetails = {
    compartmentId: config.compartmentId,
    image: {
      source: "INLINE",
      data: preparedImageBytes.toString("base64"),
    },
    features: [
      { featureType: "IMAGE_CLASSIFICATION", maxResults: 6 } as models.ImageClassificationFeature,
      { featureType: "OBJECT_DETECTION", maxResults: 8 } as models.ImageObjectDetectionFeature,
      { featureType: "FACE_DETECTION", maxResults: 20, shouldReturnLandmarks: false } as models.FaceDetectionFeature,
    ],
  };

  let visionRequestLatencyMs = 0;
  const requestStartedAt = Date.now();
  try {
    const result = await sendAnalyzeImageRequest({
      client,
      analyzeImageDetails: primaryRequest,
    });
    visionRequestLatencyMs = Date.now() - requestStartedAt;
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
    const faces = extractFaces(result);
    return {
      labels,
      objects,
      faces,
      faceCount: faces.length,
      embeddingAttempted: false,
      embeddingSucceeded: false,
      embeddingErrorMessage: "",
      embeddingFacesReturned: 0,
      embeddingFacesWithVectors: 0,
      prepareLatencyMs,
      visionRequestLatencyMs,
      totalLatencyMs: Date.now() - totalStartedAt,
    };
  } catch (error) {
    visionRequestLatencyMs = Date.now() - requestStartedAt;
    const typed = error as Partial<OciVisionErrorShape> & { message?: string };
    const message = String(typed.message ?? "").trim();
    if (typed.rawBody || typed.statusCode || typed.serviceCode || typed.opcRequestId) {
      throw error;
    }
    throw Object.assign(
      new Error(
        [
          message || "OCI Vision request failed before returning a readable service error.",
          `originalFormat=${prepared.originalFormat}`,
          `preparedFormat=${prepared.preparedFormat}`,
          `normalizedFormat=${String(prepared.normalizedFormat)}`,
          `originalBytes=${input.imageBytes.length}`,
          `preparedBytes=${preparedImageBytes.length}`,
        ].join(" "),
      ),
      {
        code: "",
        statusCode: -1,
        serviceCode: "",
        opcRequestId: "",
      },
    );
  }
}
