import "server-only";

import { Readable } from "node:stream";
import { models as ObjectStorageModels, ObjectStorageClient } from "oci-objectstorage";
import { getOciAuthenticationProvider } from "@/lib/oci/auth";

type OciObjectConfig = {
  region: string;
  namespace: string;
  bucketName: string;
};

type ObjectContent = {
  mimeType: string;
  data: ArrayBuffer;
};

type PutObjectInput = {
  objectKey: string;
  data: Buffer | Uint8Array;
  mimeType?: string;
};

type OciDirectObjectUrlFactory = (objectKey: string) => string;
type OciPreauthenticatedReadAccess = {
  endpoint: string;
  accessUri: string;
  expiresAtMs: number;
};

let cachedClient: ObjectStorageClient | null = null;
let cachedConfigKey = "";
let cachedPreauthenticatedReadAccess: OciPreauthenticatedReadAccess | null = null;
let preauthenticatedReadFailureUntilMs = 0;

const PREAUTH_REFRESH_SKEW_MS = 60_000;
const PREAUTH_FAILURE_BACKOFF_MS = 60_000;

function readOptionalEnv(name: string) {
  const value = String(process.env[name] ?? "").trim();
  return value || "";
}

function readOptionalBooleanEnv(name: string, fallback: boolean) {
  const raw = readOptionalEnv(name).toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (["1", "true", "yes", "y", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(raw)) {
    return false;
  }
  return fallback;
}

function readPreauthenticatedUrlTtlMs() {
  const rawSeconds = Number.parseInt(readOptionalEnv("OCI_OBJECT_DIRECT_URL_TTL_SECONDS"), 10);
  if (!Number.isFinite(rawSeconds) || rawSeconds <= 0) {
    return 12 * 60 * 60 * 1000;
  }
  return Math.max(5 * 60 * 1000, Math.min(7 * 24 * 60 * 60 * 1000, rawSeconds * 1000));
}

function isDirectUrlModeEnabled() {
  return readOptionalBooleanEnv("OCI_OBJECT_DIRECT_URLS_ENABLED", true);
}

function encodeObjectKeyPath(objectKey: string) {
  return objectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function trimSurroundingSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, "");
}

function buildObjectStorageEndpoint(region: string) {
  return `https://objectstorage.${region}.oraclecloud.com`;
}

function buildDirectObjectUrlFromPublicBase(publicBaseUrl: string, objectKey: string) {
  const normalizedBase = publicBaseUrl.replace(/\/+$/g, "");
  return `${normalizedBase}/${encodeObjectKeyPath(objectKey)}`;
}

function buildDirectObjectUrlFromPar(endpoint: string, accessUri: string, objectKey: string) {
  const normalizedEndpoint = endpoint.replace(/\/+$/g, "");
  const normalizedAccessUri = accessUri.startsWith("/") ? accessUri : `/${accessUri}`;
  const suffix = normalizedAccessUri.endsWith("/") ? normalizedAccessUri : `${normalizedAccessUri}/`;
  return `${normalizedEndpoint}${suffix}${encodeObjectKeyPath(objectKey)}`;
}

function readConfig(): OciObjectConfig | null {
  const region = readOptionalEnv("OCI_REGION");
  const namespace = readOptionalEnv("OCI_OBJECT_NAMESPACE");
  const bucketName = readOptionalEnv("OCI_OBJECT_BUCKET");
  if (!region || !namespace || !bucketName) {
    return null;
  }
  return {
    region,
    namespace,
    bucketName,
  };
}

type ArrayBufferViewLike = {
  buffer: ArrayBufferLike;
  byteOffset: number;
  byteLength: number;
};

function isArrayBufferViewLike(value: unknown): value is ArrayBufferViewLike {
  return Boolean(
    value
    && typeof value === "object"
    && "buffer" in value
    && "byteOffset" in value
    && "byteLength" in value,
  );
}

function isWebReadableStreamLike(value: unknown): value is ReadableStream<Uint8Array> {
  return Boolean(
    value
    && typeof value === "object"
    && "getReader" in value
    && typeof (value as { getReader?: unknown }).getReader === "function",
  );
}

function isNodeReadableLike(value: unknown): value is Readable {
  return value instanceof Readable;
}

function describeBodyType(value: unknown) {
  if (value == null) {
    return String(value);
  }
  if (typeof value === "string") {
    return "string";
  }
  if (typeof value !== "object") {
    return typeof value;
  }
  return value.constructor?.name || "object";
}

async function coerceChunkToBuffer(chunk: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }

  if (typeof chunk === "string") {
    return Buffer.from(chunk);
  }

  if (chunk instanceof ArrayBuffer) {
    return Buffer.from(chunk);
  }

  if (ArrayBuffer.isView(chunk) || isArrayBufferViewLike(chunk)) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }

  const chunkAny = chunk as {
    arrayBuffer?: () => Promise<ArrayBuffer>;
  };
  if (typeof chunkAny.arrayBuffer === "function") {
    return Buffer.from(await chunkAny.arrayBuffer());
  }

  if (isWebReadableStreamLike(chunk)) {
    return Buffer.from(await new Response(chunk).arrayBuffer());
  }

  if (isNodeReadableLike(chunk)) {
    const chunks: Buffer[] = [];
    for await (const nestedChunk of chunk) {
      chunks.push(await coerceChunkToBuffer(nestedChunk));
    }
    return Buffer.concat(chunks);
  }

  throw new Error(`Unsupported OCI object body chunk type: ${describeBodyType(chunk)}`);
}

async function readObjectBodyBytes(body: unknown) {
  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (typeof body === "string") {
    return Buffer.from(body);
  }

  if (body instanceof ArrayBuffer) {
    return Buffer.from(body);
  }

  if (ArrayBuffer.isView(body) || isArrayBufferViewLike(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }

  const bodyAny = body as {
    arrayBuffer?: () => Promise<ArrayBuffer>;
  };
  if (typeof bodyAny.arrayBuffer === "function") {
    return Buffer.from(await bodyAny.arrayBuffer());
  }

  if (isNodeReadableLike(body)) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(await coerceChunkToBuffer(chunk));
    }
    return Buffer.concat(chunks);
  }

  if (isWebReadableStreamLike(body)) {
    return Buffer.from(await new Response(body).arrayBuffer());
  }

  throw new Error(`Unsupported OCI object body type: ${describeBodyType(body)}`);
}

function getClient(config: OciObjectConfig) {
  const auth = getOciAuthenticationProvider();
  const cacheKey = `${config.region}|${config.namespace}|${config.bucketName}|${auth.cacheKey}`;
  if (cachedClient && cachedConfigKey === cacheKey) {
    return cachedClient;
  }
  const client = new ObjectStorageClient({ authenticationDetailsProvider: auth.provider });
  client.endpoint = `https://objectstorage.${config.region}.oraclecloud.com`;
  cachedClient = client;
  cachedConfigKey = cacheKey;
  return client;
}

async function getPreauthenticatedReadAccess(config: OciObjectConfig): Promise<OciPreauthenticatedReadAccess | null> {
  const now = Date.now();
  if (cachedPreauthenticatedReadAccess && cachedPreauthenticatedReadAccess.expiresAtMs - PREAUTH_REFRESH_SKEW_MS > now) {
    return cachedPreauthenticatedReadAccess;
  }
  if (preauthenticatedReadFailureUntilMs > now) {
    return null;
  }

  try {
    const client = getClient(config);
    const ttlMs = readPreauthenticatedUrlTtlMs();
    const expiresAtMs = now + ttlMs;
    const response = await client.createPreauthenticatedRequest({
      namespaceName: config.namespace,
      bucketName: config.bucketName,
      createPreauthenticatedRequestDetails: {
        name: `efl-media-read-${now}`,
        accessType: ObjectStorageModels.CreatePreauthenticatedRequestDetails.AccessType.AnyObjectRead,
        bucketListingAction: "Deny",
        timeExpires: new Date(expiresAtMs),
      },
    });
    const accessUri = String(response.preauthenticatedRequest?.accessUri ?? "").trim();
    if (!accessUri) {
      throw new Error("Missing OCI preauthenticated request accessUri.");
    }
    const nextValue: OciPreauthenticatedReadAccess = {
      endpoint: buildObjectStorageEndpoint(config.region),
      accessUri,
      expiresAtMs,
    };
    cachedPreauthenticatedReadAccess = nextValue;
    preauthenticatedReadFailureUntilMs = 0;
    return nextValue;
  } catch (error) {
    preauthenticatedReadFailureUntilMs = now + PREAUTH_FAILURE_BACKOFF_MS;
    console.warn("[oci-object-storage] preauthenticated URL generation failed", error);
    return null;
  }
}

export function isOciObjectStorageConfigured() {
  return readConfig() != null;
}

export function getOciObjectStorageLocation() {
  const config = readConfig();
  if (!config) {
    return null;
  }
  return {
    region: config.region,
    namespace: config.namespace,
    bucketName: config.bucketName,
    objectPrefix: readOptionalEnv("OCI_OBJECT_MEDIA_PREFIX") || "efl-media",
  };
}

export async function getOciDirectObjectUrlFactory(): Promise<OciDirectObjectUrlFactory | null> {
  const config = readConfig();
  if (!config) {
    return null;
  }
  const publicBaseUrl = readOptionalEnv("OCI_OBJECT_PUBLIC_BASE_URL");
  if (publicBaseUrl) {
    const normalizedBase = publicBaseUrl.includes("://")
      ? publicBaseUrl
      : `${buildObjectStorageEndpoint(config.region)}/${trimSurroundingSlashes(publicBaseUrl)}`;
    return (objectKey: string) => {
      const normalizedObjectKey = String(objectKey ?? "").trim();
      if (!normalizedObjectKey) {
        return "";
      }
      return buildDirectObjectUrlFromPublicBase(normalizedBase, normalizedObjectKey);
    };
  }
  if (!isDirectUrlModeEnabled()) {
    return null;
  }
  const preauthenticatedRead = await getPreauthenticatedReadAccess(config);
  if (!preauthenticatedRead) {
    return null;
  }
  return (objectKey: string) => {
    const normalizedObjectKey = String(objectKey ?? "").trim();
    if (!normalizedObjectKey) {
      return "";
    }
    return buildDirectObjectUrlFromPar(
      preauthenticatedRead.endpoint,
      preauthenticatedRead.accessUri,
      normalizedObjectKey,
    );
  };
}

export async function getOciObjectContentByKey(objectKey: string, fallbackMimeType = "application/octet-stream"): Promise<ObjectContent> {
  const config = readConfig();
  if (!config) {
    throw new Error("OCI object storage is not configured for runtime reads.");
  }
  const key = String(objectKey ?? "").trim();
  if (!key) {
    throw new Error("Object key is required.");
  }
  const client = getClient(config);
  const response = await client.getObject({
    namespaceName: config.namespace,
    bucketName: config.bucketName,
    objectName: key,
  });

  const contentType = String(response.contentType ?? "").trim() || fallbackMimeType;
  const body = response.value;

  if (body == null) {
    throw new Error("OCI object body was empty.");
  }

  const bytes = await readObjectBodyBytes(body);

  return {
    mimeType: contentType,
    data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}

export async function putOciObjectByKey(input: PutObjectInput): Promise<void> {
  const config = readConfig();
  if (!config) {
    throw new Error("OCI object storage is not configured for runtime writes.");
  }
  const key = String(input.objectKey ?? "").trim();
  if (!key) {
    throw new Error("Object key is required.");
  }
  const bytes = Buffer.isBuffer(input.data) ? input.data : Buffer.from(input.data);
  const client = getClient(config);
  await client.putObject({
    namespaceName: config.namespace,
    bucketName: config.bucketName,
    objectName: key,
    putObjectBody: bytes,
    contentType: String(input.mimeType ?? "").trim() || "application/octet-stream",
    contentLength: bytes.length,
  });
}
