import "server-only";

import { getPhotoContent } from "@/lib/google/drive";
import { getTableRecords, getTenantConfig } from "@/lib/data/runtime";
import { getOciObjectContentByKey, isOciObjectStorageConfigured } from "@/lib/oci/object-storage";

type FolderCache = {
  expiresAt: number;
  folderIds: string[];
};
type ObjectKeyCache = {
  expiresAt: number;
  byFileId: Map<string, { objectKey: string; mimeType: string }>;
};

const FOLDER_CACHE_TTL_MS = 5 * 60 * 1000;
const OBJECT_KEY_CACHE_TTL_MS = 5 * 60 * 1000;
let folderCache: FolderCache | null = null;
let objectKeyCache: ObjectKeyCache | null = null;

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

function normalizeObjectStorageObjectKey(rawMetadata: string) {
  const raw = String(rawMetadata ?? "").trim();
  if (!raw || (!raw.startsWith("{") && !raw.startsWith("["))) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const objectStorage = parsed.objectStorage as Record<string, unknown> | undefined;
    const value = String(objectStorage?.originalObjectKey ?? "").trim();
    return value;
  } catch {
    return "";
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
  if (!objectKeyCache || objectKeyCache.expiresAt <= now) {
    const rows = await getTableRecords("MediaAssets").catch(() => []);
    const byFileId = new Map<string, { objectKey: string; mimeType: string }>();
    for (const row of rows) {
      const fileIdKey = String(row.data.file_id ?? "").trim();
      if (!fileIdKey) continue;
      const storageProvider = String(row.data.storage_provider ?? "").trim().toLowerCase();
      if (storageProvider !== "oci_object") continue;
      const objectKey = normalizeObjectStorageObjectKey(String(row.data.media_metadata ?? ""));
      if (!objectKey) continue;
      byFileId.set(fileIdKey, {
        objectKey,
        mimeType: String(row.data.mime_type ?? "").trim() || "application/octet-stream",
      });
    }
    objectKeyCache = {
      expiresAt: now + OBJECT_KEY_CACHE_TTL_MS,
      byFileId,
    };
  }
  return objectKeyCache.byFileId.get(normalizedFileId) ?? null;
}

export async function resolvePhotoContentAcrossFamilies(fileId: string, preferredTenantKey?: string) {
  const objectTarget = await getObjectKeyByFileId(fileId);
  if (objectTarget) {
    try {
      return await getOciObjectContentByKey(objectTarget.objectKey, objectTarget.mimeType);
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
