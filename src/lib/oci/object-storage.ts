import "server-only";

import { Readable } from "node:stream";
import { ObjectStorageClient } from "oci-objectstorage";
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

let cachedClient: ObjectStorageClient | null = null;
let cachedConfigKey = "";

function readOptionalEnv(name: string) {
  const value = String(process.env[name] ?? "").trim();
  return value || "";
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

function isWebReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof ReadableStream !== "undefined" && value instanceof ReadableStream;
}

async function readObjectBodyBytes(body: unknown) {
  if (Buffer.isBuffer(body)) {
    return body;
  }

  const bodyAny = body as {
    arrayBuffer?: () => Promise<ArrayBuffer>;
  };
  if (typeof bodyAny.arrayBuffer === "function") {
    return Buffer.from(await bodyAny.arrayBuffer());
  }

  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  if (isWebReadableStream(body)) {
    return Buffer.from(await new Response(body).arrayBuffer());
  }

  return Buffer.from(body as Uint8Array);
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
