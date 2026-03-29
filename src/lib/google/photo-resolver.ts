import "server-only";

import { getPhotoContent } from "@/lib/google/drive";
import { getTableRecords, getTenantConfig } from "@/lib/data/runtime";
import {
  getOciObjectContentByKey,
  getOciObjectStorageLocation,
  isOciObjectStorageConfigured,
  putOciObjectByKey,
} from "@/lib/oci/object-storage";
import { updateOciMediaAssetThumbnailObjectKey, getOciMediaAssetByFileId } from "@/lib/oci/tables";
import { createImageThumbnailVariant } from "@/lib/media/thumbnail.server";

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
const thumbnailBackfillCache = new Map<string, Promise<{
  objectKey: string;
  mimeType: string;
  data: ArrayBuffer;
} | null>>();

function sanitizeObjectNameSegment(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "file";
}

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
  const asset = await getOciMediaAssetByFileId(normalizedFileId, {
    allowLegacyMetadataFallback: false,
  }).catch(() => null);
  const resolvedValue =
    asset
      ? (() => {
          const originalObjectKey = String(asset.originalObjectKey ?? "").trim();
          const thumbnailObjectKey = String(asset.thumbnailObjectKey ?? "").trim();
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
  if (resolvedValue) {
    objectKeyCache.set(normalizedFileId, {
      expiresAt: now + OBJECT_KEY_CACHE_TTL_MS,
      value: resolvedValue,
    });
  } else {
    objectKeyCache.delete(normalizedFileId);
  }
  return resolvedValue;
}

async function backfillMissingThumbnailObjectKey(input: {
  fileId: string;
  originalObjectKey: string;
  mimeType: string;
}) {
  const fileId = String(input.fileId ?? "").trim();
  const originalObjectKey = String(input.originalObjectKey ?? "").trim();
  const mimeType = String(input.mimeType ?? "").trim().toLowerCase();
  if (!fileId || !originalObjectKey || !mimeType.startsWith("image/")) {
    return null;
  }
  if (thumbnailBackfillCache.has(fileId)) {
    return thumbnailBackfillCache.get(fileId) ?? null;
  }

  const inFlight = (async () => {
    const storage = getOciObjectStorageLocation();
    if (!storage) {
      return null;
    }
    const original = await getOciObjectContentByKey(originalObjectKey, input.mimeType);
    const variant = await createImageThumbnailVariant({
      source: Buffer.from(original.data),
      mimeType: original.mimeType,
    });
    if (!variant) {
      return null;
    }
    const thumbnailObjectKey = `${storage.objectPrefix}/thumb/backfill/${sanitizeObjectNameSegment(fileId)}/${sanitizeObjectNameSegment(fileId)}-thumb.${variant.extension}`;
    await putOciObjectByKey({
      objectKey: thumbnailObjectKey,
      data: variant.buffer,
      mimeType: variant.mimeType,
    });
    await updateOciMediaAssetThumbnailObjectKey({
      fileId,
      thumbnailObjectKey,
    }).catch(() => 0);
    return {
      objectKey: thumbnailObjectKey,
      mimeType: variant.mimeType,
      data: variant.buffer.buffer.slice(
        variant.buffer.byteOffset,
        variant.buffer.byteOffset + variant.buffer.byteLength,
      ) as ArrayBuffer,
    };
  })()
    .catch(() => null)
    .finally(() => {
      thumbnailBackfillCache.delete(fileId);
    });
  thumbnailBackfillCache.set(fileId, inFlight);
  return inFlight;
}

export async function resolvePhotoContentAcrossFamilies(
  fileId: string,
  preferredTenantKey?: string,
  options?: { variant?: "original" | "preview" },
) {
  const normalizedFileId = String(fileId ?? "").trim();
  const variant = options?.variant === "preview" ? "preview" : "original";
  const objectTarget = await getObjectKeyByFileId(normalizedFileId);
  if (objectTarget) {
    try {
      if (variant === "preview" && !objectTarget.thumbnailObjectKey) {
        const backfilled = await backfillMissingThumbnailObjectKey({
          fileId: normalizedFileId,
          originalObjectKey: objectTarget.originalObjectKey,
          mimeType: objectTarget.mimeType,
        });
        if (backfilled) {
          objectKeyCache.set(normalizedFileId, {
            expiresAt: Date.now() + OBJECT_KEY_CACHE_TTL_MS,
            value: {
              ...objectTarget,
              thumbnailObjectKey: backfilled.objectKey,
              mimeType: backfilled.mimeType,
            },
          });
          return {
            mimeType: backfilled.mimeType,
            data: backfilled.data,
          };
        }
      }
      const objectKey = variant === "preview" && objectTarget.thumbnailObjectKey
        ? objectTarget.thumbnailObjectKey
        : objectTarget.originalObjectKey;
      return await getOciObjectContentByKey(objectKey, objectTarget.mimeType);
    } catch {
      objectKeyCache.delete(normalizedFileId);
      // Fall back to legacy Drive retrieval.
    }
  }

  const folderIds = await getKnownPhotoFolderIds(preferredTenantKey);

  let lastError: unknown;
  for (const folderId of folderIds) {
    try {
      return await getPhotoContent(normalizedFileId, { photosFolderId: folderId });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Photo not found in configured folders.");
}
