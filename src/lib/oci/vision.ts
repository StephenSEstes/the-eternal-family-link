import "server-only";

import { ConfigFileAuthenticationDetailsProvider } from "oci-common";
import { AIServiceVisionClient, models } from "oci-aivision";

export type OciVisionInsight = {
  labels: Array<{ name: string; confidence: number }>;
  objects: Array<{ name: string; confidence: number }>;
  faceCount: number;
};

type OciVisionConfig = {
  region: string;
  compartmentId: string;
  configFile?: string;
  profile?: string;
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
    configFile: readOptionalEnv("OCI_CONFIG_FILE") || undefined,
    profile: readOptionalEnv("OCI_CONFIG_PROFILE") || undefined,
  };
}

function getVisionClient(config: OciVisionConfig) {
  const key = `${config.region}|${config.compartmentId}|${config.configFile || ""}|${config.profile || ""}`;
  if (cachedClient && key === cachedConfigKey) {
    return cachedClient;
  }
  const provider = new ConfigFileAuthenticationDetailsProvider(config.configFile, config.profile);
  const client = new AIServiceVisionClient({
    authenticationDetailsProvider: provider,
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

  const request: models.AnalyzeImageDetails = {
    compartmentId: config.compartmentId,
    image: {
      source: "INLINE",
      data: input.imageBytes.toString("base64"),
    },
    features: [
      { featureType: "IMAGE_CLASSIFICATION", maxResults: 6 },
      { featureType: "OBJECT_DETECTION", maxResults: 8 },
      { featureType: "FACE_DETECTION" },
    ] as models.ImageFeature[],
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
  const faceCount = Array.isArray(result?.detectedFaces) ? result.detectedFaces.length : 0;
  return { labels, objects, faceCount };
}
