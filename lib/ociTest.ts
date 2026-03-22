import { ObjectStorageClient, requests } from "oci-objectstorage";
import {
  ConfigFileAuthenticationDetailsProvider,
} from "oci-common";

type OciObjectStorageConfig = {
  tenancyOcid: string;
  userOcid: string;
  fingerprint: string;
  privateKeyPath: string;
  region: string;
  namespace: string;
  bucketName: string;
};

function readRequiredEnv(name: string): string {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing required OCI Object Storage env var: ${name}`);
  }
  return value;
}

function getOciObjectStorageConfig(): OciObjectStorageConfig {
  return {
    tenancyOcid: readRequiredEnv("OCI_TENANCY_OCID"),
    userOcid: readRequiredEnv("OCI_USER_OCID"),
    fingerprint: readRequiredEnv("OCI_FINGERPRINT"),
    privateKeyPath: readRequiredEnv("OCI_PRIVATE_KEY_PATH"),
    region: readRequiredEnv("OCI_REGION"),
    namespace: readRequiredEnv("OCI_OBJECT_NAMESPACE"),
    bucketName: readRequiredEnv("OCI_OBJECT_BUCKET"),
  };
}

function mask(value: string, keep = 14) {
  if (!value) return "";
  if (value.length <= keep) return value;
  return `${value.slice(0, keep)}...`;
}

function createAuthProvider() {
  const configFilePath = String(process.env.OCI_CONFIG_FILE ?? "").trim() || undefined;
  const profile = String(process.env.OCI_CONFIG_PROFILE ?? "").trim() || undefined;
  const provider = new ConfigFileAuthenticationDetailsProvider(configFilePath, profile);
  return {
    authMode: "config_file",
    provider,
    details: {
      configFilePath: configFilePath ?? "~/.oci/config",
      profile: profile ?? "DEFAULT",
    },
  };
}

async function runObjectStorageTest() {
  const config = getOciObjectStorageConfig();
  const auth = createAuthProvider();

  console.log("CONFIG DEBUG", {
    authMode: auth.authMode,
    region: config.region,
    namespace: config.namespace,
    bucketName: config.bucketName,
    authDetails: auth.details,
    envHints: {
      tenancyOcid: mask(config.tenancyOcid),
      userOcid: mask(config.userOcid),
      fingerprint: mask(config.fingerprint),
      privateKeyPath: config.privateKeyPath,
    },
  });

  const client = new ObjectStorageClient({ authenticationDetailsProvider: auth.provider });
  client.endpoint = `https://objectstorage.${config.region}.oraclecloud.com`;

  const namespaceResponse = await client.getNamespace({});
  console.log("Namespace from OCI:", namespaceResponse.value);

  const bucketsResponse = await client.listBuckets({
    namespaceName: config.namespace,
    compartmentId: config.tenancyOcid,
  });
  console.log(
    "Buckets visible to this identity:",
    (bucketsResponse.items ?? []).map((bucket) => bucket.name),
  );

  const request: requests.ListObjectsRequest = {
    namespaceName: config.namespace,
    bucketName: config.bucketName,
  };

  const response = await client.listObjects(request);
  const objects = response.listObjects?.objects ?? [];

  console.log("OCI Object Storage connection test succeeded.");
  console.log(JSON.stringify(objects, null, 2));
}

runObjectStorageTest().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("OCI Object Storage connection test failed:", message);
  if (error && typeof error === "object") {
    const details = {
      name: (error as { name?: string }).name,
      code: (error as { code?: string }).code,
      statusCode: (error as { statusCode?: number }).statusCode,
      serviceCode: (error as { serviceCode?: string }).serviceCode,
      opcRequestId: (error as { opcRequestId?: string }).opcRequestId,
      message: (error as { message?: string }).message,
    };
    console.error("OCI error details:", JSON.stringify(details, null, 2));
  }
  process.exit(1);
});
