import "server-only";

import { getPhotoContent } from "@/lib/google/drive";
import { getTableRecords, getTenantConfig } from "@/lib/data/runtime";
import { getOciObjectContentByKey, isOciObjectStorageConfigured } from "@/lib/oci/object-storage";
import { getOciMediaAssetByFileId } from "@/lib/oci/tables";

type FolderCache = {
  expiresAt: number;
  folderIds: string[];
};
type ObjectKeyCacheEntry = {
  expiresAt: number;
  value: { originalObjectKey: string; thumbnailObjectKey: string; mimeType: string } | null;
};

const FOLDER_CACHE_TTL_MS = 5 * 60 * 1000;
const OBJECT_KEY_CACHE_TTL_MS = 5 * 60 * 1000;
let folderCache: FolderCache | null = null;
const objectKeyCache = new Map<string, ObjectKeyCacheEntry>();

function normalizeFolderId(value: string | undefined) {
  return String(value ?? "").trim();
}

function dedupe(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeFolderId(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeObjectStorageMetadata(rawMetadata: string) {
  const raw = String(rawMetadata ?? "").trim();
  if (!raw || (!raw.startsWith("{") && !raw.startsWith("["))) {
    return { originalObjectKey: "", thumbnailObjectKey: "" };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const objectStorage = parsed.objectStorage as Record<string, unknown> | undefined;
    const originalObjectKey = String(objectStorage?.originalObjectKey ?? "").trim();
    const thumbnailObjectKey = String(objectStorage?.thumbnailObjectKey ?? "").trim();
    return { originalObjectKey, thumbnailObjectKey };
  } catch {
    return { originalObjectKey: "", thumbnailObjectKey: "" };
  }
}

async function getKnownPhotoFolderIds(preferredTenantKey?: string) {
  const preferredFolderId = preferredTenantKey ? (await getTenantConfig(preferredTenantKey)).photosFolderId : "";
  const now = Date.now();
  if (folderCache && folderCache.expiresAt > now) {
    return dedupe([preferredFolderId, ...folderCache.folderIds]);
  }

  const rows = await getTableRecords(["FamilyConfig", "TenantConfig"]).catch(() => []);
  const folderIds = rows
    .map((row) => normalizeFolderId(row.data.photos_folder_id))
    .filter(Boolean);

  folderCache = {
    expiresAt: now + FOLDER_CACHE_TTL_MS,
    folderIds: dedupe(folderIds),
  };

  return dedupe([preferredFolderId, ...folderCache.folderIds]);
}

async function getObjectKeyByFileId(fileId: string) {
  if (!isOciObjectStorageConfigured()) {
    return null;
  }
  const normalizedFileId = String(fileId ?? "").trim();
  if (!normalizedFileId) return null;
  const now = Date.now();
  const cacheEntry = objectKeyCache.get(normalizedFileId);
  if (cacheEntry && cacheEntry.expiresAt > now) {
    return cacheEntry.value;
  }
  const asset = await getOciMediaAssetByFileId(normalizedFileId).catch(() => null);
  const storageProvider = String(asset?.storageProvider ?? "").trim().toLowerCase();
  const resolvedValue =
    asset && storageProvider === "oci_object"
      ? (() => {
          const objectStorageMetadata = normalizeObjectStorageMetadata(String(asset.mediaMetadata ?? ""));
          const originalObjectKey = String(asset.originalObjectKey ?? "").trim() || objectStorageMetadata.originalObjectKey;
          const thumbnailObjectKey = String(asset.thumbnailObjectKey ?? "").trim() || objectStorageMetadata.thumbnailObjectKey;
          if (!originalObjectKey) {
            return null;
          }
          return {
            originalObjectKey,
            thumbnailObjectKey,
            mimeType: String(asset.mimeType ?? "").trim() || "application/octet-stream",
          };
        })()
      : null;
  objectKeyCache.set(normalizedFileId, {
    expiresAt: now + OBJECT_KEY_CACHE_TTL_MS,
    value: resolvedValue,
  });
  return resolvedValue;
}

export async function resolvePhotoContentAcrossFamilies(
  fileId: string,
  preferredTenantKey?: string,
  options?: { variant?: "original" | "preview" },
) {
  const objectTarget = await getObjectKeyByFileId(fileId);
  if (objectTarget) {
    try {
      const objectKey =
        options?.variant === "preview" && objectTarget.thumbnailObjectKey
          ? objectTarget.thumbnailObjectKey
          : objectTarget.originalObjectKey;
      return await getOciObjectContentByKey(objectKey, objectTarget.mimeType);
    } catch {
      // Fall back to legacy Drive retrieval.
    }
  }

  const folderIds = await getKnownPhotoFolderIds(preferredTenantKey);

  let lastError: unknown;
  for (const folderId of folderIds) {
    try {
      return await getPhotoContent(fileId, { photosFolderId: folderId });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Photo not found in configured folders.");
}
