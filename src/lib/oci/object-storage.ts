import "server-only";

import { Readable } from "node:stream";
import { ObjectStorageClient } from "oci-objectstorage";
import { ConfigFileAuthenticationDetailsProvider } from "oci-common";

type OciObjectConfig = {
  region: string;
  namespace: string;
  bucketName: string;
  configFile?: string;
  profile?: string;
};

type ObjectContent = {
  mimeType: string;
  data: ArrayBuffer;
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
    configFile: readOptionalEnv("OCI_CONFIG_FILE") || undefined,
    profile: readOptionalEnv("OCI_CONFIG_PROFILE") || undefined,
  };
}

function getClient(config: OciObjectConfig) {
  const cacheKey = `${config.region}|${config.namespace}|${config.bucketName}|${config.configFile || ""}|${config.profile || ""}`;
  if (cachedClient && cachedConfigKey === cacheKey) {
    return cachedClient;
  }
  const provider = new ConfigFileAuthenticationDetailsProvider(config.configFile, config.profile);
  const client = new ObjectStorageClient({ authenticationDetailsProvider: provider });
  client.endpoint = `https://objectstorage.${config.region}.oraclecloud.com`;
  cachedClient = client;
  cachedConfigKey = cacheKey;
  return client;
}

export function isOciObjectStorageConfigured() {
  return readConfig() != null;
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

  const bodyAny = body as unknown;
  let bytes: Buffer;
  if (Buffer.isBuffer(body)) {
    bytes = body;
  } else if (typeof (bodyAny as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer === "function") {
    bytes = Buffer.from(await (bodyAny as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer());
  } else if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    bytes = Buffer.concat(chunks);
  } else {
    bytes = Buffer.from(bodyAny as Uint8Array);
  }

  return {
    mimeType: contentType,
    data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}
