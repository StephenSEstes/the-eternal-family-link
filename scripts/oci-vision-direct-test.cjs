#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const common = require("oci-common");
const { AIServiceVisionClient, models } = require("oci-aivision");
const {
  ConfigFileAuthenticationDetailsProvider,
  SimpleAuthenticationDetailsProvider,
} = require("oci-common");

const OCI_VISION_INLINE_TARGET_BYTES = 4_500_000;
const OCI_VISION_SUPPORTED_FORMATS = new Set(["jpeg", "jpg", "png"]);
const OCI_VISION_PREPARE_STEPS = [
  { maxEdge: 2048, quality: 84 },
  { maxEdge: 1600, quality: 80 },
  { maxEdge: 1280, quality: 76 },
  { maxEdge: 960, quality: 72 },
  { maxEdge: 720, quality: 68 },
];

function loadDotEnv(dotEnvPath) {
  if (!fs.existsSync(dotEnvPath)) return;
  const text = fs.readFileSync(dotEnvPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function readOptionalEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  return value || "";
}

function normalizeMultilineSecret(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\\n/g, "\n").trim();
}

function readInlinePrivateKey() {
  const inline = readOptionalEnv("OCI_PRIVATE_KEY_PEM") || readOptionalEnv("OCI_PRIVATE_KEY");
  return inline ? normalizeMultilineSecret(inline) : "";
}

function readPrivateKeyFromPath() {
  const privateKeyPath = readOptionalEnv("OCI_PRIVATE_KEY_PATH");
  if (!privateKeyPath) {
    return "";
  }
  try {
    const stat = fs.statSync(privateKeyPath);
    if (!stat.isFile()) {
      return "";
    }
    return normalizeMultilineSecret(fs.readFileSync(privateKeyPath, "utf8"));
  } catch {
    return "";
  }
}

function resolveDefaultConfigFile() {
  const candidates = [
    path.join(require("os").homedir(), ".oci", "config"),
    path.join(require("os").homedir(), ".oraclebmc", "config"),
  ];
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    } catch {
      // ignore missing defaults
    }
  }
  return "";
}

function getOciAuthenticationProvider() {
  const tenancyId = readOptionalEnv("OCI_TENANCY_OCID");
  const userId = readOptionalEnv("OCI_USER_OCID");
  const fingerprint = readOptionalEnv("OCI_FINGERPRINT");
  const privateKey = readInlinePrivateKey() || readPrivateKeyFromPath();
  const passphrase = readOptionalEnv("OCI_PRIVATE_KEY_PASSPHRASE");
  if (tenancyId && userId && fingerprint && privateKey) {
    return new SimpleAuthenticationDetailsProvider(
      tenancyId,
      userId,
      fingerprint,
      privateKey,
      passphrase || null,
    );
  }

  const configFile = readOptionalEnv("OCI_CONFIG_FILE") || resolveDefaultConfigFile();
  const profile = readOptionalEnv("OCI_CONFIG_PROFILE");
  if (configFile) {
    return new ConfigFileAuthenticationDetailsProvider(configFile, profile || undefined);
  }

  throw new Error(
    "OCI auth is not configured. Set OCI_USER_OCID, OCI_FINGERPRINT, and OCI_PRIVATE_KEY_PEM/OCI_PRIVATE_KEY_PATH, or configure OCI_CONFIG_FILE.",
  );
}

function printUsage() {
  console.log(`Usage:
  node scripts/oci-vision-direct-test.cjs --image <path> [--feature mixed|detect|embed]

Examples:
  node scripts/oci-vision-direct-test.cjs --image C:\\temp\\photo.jpg --feature mixed
  npm run vision:direct:test -- --image .\\tmp\\face.jpg --feature embed

Notes:
  - Uses the same OCI auth env assumptions as the app.
  - Loads .env.local automatically if present.
  - Bypasses the Vision SDK error formatter and prints raw HTTP status/body/opc-request-id.`);
}

function parseArgs(argv) {
  const args = {
    imagePath: "",
    feature: "mixed",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--image") {
      args.imagePath = String(argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (token === "--feature") {
      args.feature = String(argv[index + 1] ?? "").trim().toLowerCase();
      index += 1;
      continue;
    }
  }
  return args;
}

async function prepareImageBytesForVision(imageBytes) {
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

function buildFeatures(featureMode) {
  if (featureMode === "detect") {
    return [
      { featureType: "FACE_DETECTION", maxResults: 20, shouldReturnLandmarks: false },
    ];
  }
  if (featureMode === "embed") {
    return [
      { featureType: "FACE_EMBEDDING", maxResults: 20, shouldReturnLandmarks: true },
    ];
  }
  return [
    { featureType: "IMAGE_CLASSIFICATION", maxResults: 6 },
    { featureType: "OBJECT_DETECTION", maxResults: 8 },
    { featureType: "FACE_DETECTION", maxResults: 20, shouldReturnLandmarks: false },
  ];
}

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main() {
  loadDotEnv(path.join(process.cwd(), ".env.local"));
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const region = readOptionalEnv("OCI_REGION");
  const compartmentId = readOptionalEnv("OCI_VISION_COMPARTMENT_OCID") || readOptionalEnv("OCI_TENANCY_OCID");
  if (!region || !compartmentId) {
    throw new Error("Missing OCI_REGION or OCI_VISION_COMPARTMENT_OCID/OCI_TENANCY_OCID.");
  }
  if (!args.imagePath) {
    throw new Error("Missing required --image <path>.");
  }
  if (!["mixed", "detect", "embed"].includes(args.feature)) {
    throw new Error("Invalid --feature value. Use mixed, detect, or embed.");
  }

  const resolvedImagePath = path.resolve(process.cwd(), args.imagePath);
  if (!fs.existsSync(resolvedImagePath)) {
    throw new Error(`Image file not found: ${resolvedImagePath}`);
  }

  const authProvider = getOciAuthenticationProvider();
  const client = new AIServiceVisionClient({
    authenticationDetailsProvider: authProvider,
  });
  client.regionId = region;

  const originalImageBytes = fs.readFileSync(resolvedImagePath);
  const prepared = await prepareImageBytesForVision(originalImageBytes);
  const analyzeImageDetails = {
    compartmentId,
    image: {
      source: "INLINE",
      data: prepared.imageBytes.toString("base64"),
    },
    features: buildFeatures(args.feature),
  };

  const request = await common.composeRequest({
    baseEndpoint: client.endpoint,
    defaultHeaders: {},
    path: "/actions/analyzeImage",
    method: "POST",
    bodyContent: common.ObjectSerializer.serialize(
      analyzeImageDetails,
      "AnalyzeImageDetails",
      models.AnalyzeImageDetails.getJsonObj,
    ),
    pathParams: {},
    headerParams: {
      "Content-Type": common.Constants.APPLICATION_JSON,
    },
    queryParams: {},
  });

  const apiReferenceLink = "https://docs.oracle.com/iaas/api/#/en/vision/20220125/AnalyzeImageResult/AnalyzeImage";
  const startedAt = Date.now();
  const response = await client._httpClient.send(
    request,
    false,
    "AIServiceVision",
    "analyzeImage",
    new Date().toISOString(),
    `${request.method} ${request.uri}`,
    apiReferenceLink,
  );
  const elapsedMs = Date.now() - startedAt;
  const rawText = await response.text();
  const parsedBody = parseMaybeJson(rawText);

  console.log("OCI Vision direct test");
  console.log(`image=${resolvedImagePath}`);
  console.log(`feature=${args.feature}`);
  console.log(`endpoint=${request.uri}`);
  console.log(`elapsedMs=${elapsedMs}`);
  console.log(
    `imagePrep originalFormat=${prepared.originalFormat} preparedFormat=${prepared.preparedFormat} normalizedFormat=${String(prepared.normalizedFormat)} originalBytes=${originalImageBytes.length} preparedBytes=${prepared.imageBytes.length}`,
  );
  console.log(`status=${response.status}`);
  console.log(`statusText=${response.statusText || "-"}`);
  console.log(`opc-request-id=${response.headers.get("opc-request-id") || "-"}`);
  console.log("responseBody=");
  if (typeof parsedBody === "string") {
    console.log(parsedBody || "(empty)");
  } else {
    console.log(JSON.stringify(parsedBody, null, 2));
  }

  if (!response.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`OCI Vision direct test failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
