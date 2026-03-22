import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { ConfigFileAuthenticationDetailsProvider, SimpleAuthenticationDetailsProvider } from "oci-common";

type OciAuthProviderConfig = {
  mode: "api_key" | "config_file";
  cacheKey: string;
  provider: ConfigFileAuthenticationDetailsProvider | SimpleAuthenticationDetailsProvider;
};

function readOptionalEnv(name: string) {
  const value = String(process.env[name] ?? "").trim();
  return value || "";
}

function normalizeMultilineSecret(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\\n/g, "\n").trim();
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
    path.join(os.homedir(), ".oci", "config"),
    path.join(os.homedir(), ".oraclebmc", "config"),
  ];
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    } catch {
      // Ignore missing default config file candidates.
    }
  }
  return "";
}

function readApiKeyConfig() {
  const tenancyId = readOptionalEnv("OCI_TENANCY_OCID");
  const userId = readOptionalEnv("OCI_USER_OCID");
  const fingerprint = readOptionalEnv("OCI_FINGERPRINT");
  const privateKey = readInlinePrivateKey() || readPrivateKeyFromPath();
  const passphrase = readOptionalEnv("OCI_PRIVATE_KEY_PASSPHRASE");
  if (!tenancyId || !userId || !fingerprint || !privateKey) {
    return null;
  }
  return {
    tenancyId,
    userId,
    fingerprint,
    privateKey,
    passphrase: passphrase || null,
  };
}

function readConfigFileConfig() {
  const configFile = readOptionalEnv("OCI_CONFIG_FILE") || resolveDefaultConfigFile();
  const profile = readOptionalEnv("OCI_CONFIG_PROFILE");
  if (!configFile) {
    return null;
  }
  return {
    configFile,
    profile: profile || undefined,
  };
}

export function getOciAuthenticationProvider(): OciAuthProviderConfig {
  const apiKeyConfig = readApiKeyConfig();
  if (apiKeyConfig) {
    const keyHash = createHash("sha1").update(apiKeyConfig.privateKey).digest("hex");
    return {
      mode: "api_key",
      cacheKey: [
        "api_key",
        apiKeyConfig.tenancyId,
        apiKeyConfig.userId,
        apiKeyConfig.fingerprint,
        keyHash,
      ].join("|"),
      provider: new SimpleAuthenticationDetailsProvider(
        apiKeyConfig.tenancyId,
        apiKeyConfig.userId,
        apiKeyConfig.fingerprint,
        apiKeyConfig.privateKey,
        apiKeyConfig.passphrase,
      ),
    };
  }

  const configFileConfig = readConfigFileConfig();
  if (configFileConfig) {
    return {
      mode: "config_file",
      cacheKey: ["config_file", configFileConfig.configFile, configFileConfig.profile || ""].join("|"),
      provider: new ConfigFileAuthenticationDetailsProvider(configFileConfig.configFile, configFileConfig.profile),
    };
  }

  throw new Error(
    "OCI API auth is not configured. Set OCI_USER_OCID, OCI_FINGERPRINT, and OCI_PRIVATE_KEY_PEM/OCI_PRIVATE_KEY_PATH, or configure OCI_CONFIG_FILE.",
  );
}
