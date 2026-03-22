import "server-only";

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
};

type OciVisionConfig = {
  region: string;
  compartmentId: string;
};

let cachedClient: AIServiceVisionClient | null = null;
let cachedConfigKey = "";

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

export async function analyzeInlineImageWithVision(input: {
  imageBytes: Buffer;
}): Promise<OciVisionInsight> {
  const config = readVisionConfig();
  if (!config) {
    throw new Error("OCI Vision is not configured.");
  }
  const client = getVisionClient(config);

  const features: models.ImageFeature[] = [
    { featureType: "IMAGE_CLASSIFICATION", maxResults: 6 } as models.ImageClassificationFeature,
    { featureType: "OBJECT_DETECTION", maxResults: 8 } as models.ImageObjectDetectionFeature,
    { featureType: "FACE_EMBEDDING", maxResults: 20, shouldReturnLandmarks: false } as models.FaceEmbeddingFeature,
  ];

  const request: models.AnalyzeImageDetails = {
    compartmentId: config.compartmentId,
    image: {
      source: "INLINE",
      data: input.imageBytes.toString("base64"),
    },
    features,
  };

  const response = await client.analyzeImage({
    analyzeImageDetails: request,
  });
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
  const faces = Array.isArray(result?.detectedFaces)
    ? result.detectedFaces
      .map((item) => {
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
        const embedding = Array.isArray(item?.embeddings)
          ? item.embeddings
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value))
          : [];
        return {
          confidence: Number(item?.confidence ?? 0),
          qualityScore: Number(item?.qualityScore ?? 0),
          boundingBox: {
            x: minX,
            y: minY,
            width: Math.max(0, maxX - minX),
            height: Math.max(0, maxY - minY),
          },
          embedding,
        } satisfies OciVisionFace;
      })
      .filter((item) => item.boundingBox.width > 0 && item.boundingBox.height > 0)
      .sort((a, b) => b.qualityScore - a.qualityScore)
    : [];
  const faceCount = faces.length;
  return { labels, objects, faces, faceCount };
}
