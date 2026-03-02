import "server-only";

import { getPhotoContent } from "@/lib/google/drive";
import { getTableRecords, getTenantConfig } from "@/lib/google/sheets";

type FolderCache = {
  expiresAt: number;
  folderIds: string[];
};

const FOLDER_CACHE_TTL_MS = 5 * 60 * 1000;
let folderCache: FolderCache | null = null;

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

export async function resolvePhotoContentAcrossFamilies(fileId: string, preferredTenantKey?: string) {
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
