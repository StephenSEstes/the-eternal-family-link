import "server-only";

import { google } from "googleapis";
import { getEnv } from "@/lib/env";
import { getServiceAccountAuth } from "@/lib/google/auth";

async function getDriveClient() {
  const auth = getServiceAccountAuth();
  return google.drive({ version: "v3", auth });
}

export async function ensureTenantPhotosFolder(tenantKey: string, tenantName: string): Promise<string> {
  const drive = await getDriveClient();
  const env = getEnv();
  const rootFolderId = env.PHOTOS_FOLDER_ID;
  const folderName = `${tenantKey} - ${tenantName}`.slice(0, 120);
  const escapedName = folderName.replace(/'/g, "\\'");

  const existing = await drive.files.list({
    q: `mimeType = 'application/vnd.google-apps.folder' and trashed = false and name = '${escapedName}' and '${rootFolderId}' in parents`,
    fields: "files(id,name)",
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const found = existing.data.files?.[0]?.id;
  if (found) {
    return found;
  }

  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [rootFolderId],
    },
    fields: "id",
    supportsAllDrives: true,
  });
  const folderId = created.data.id;
  if (!folderId) {
    throw new Error("Failed to create tenant photos folder");
  }
  return folderId;
}

export async function uploadPhotoToFolder(input: {
  folderId: string;
  filename: string;
  mimeType: string;
  data: Buffer;
}): Promise<{ fileId: string }> {
  const drive = await getDriveClient();
  const created = await drive.files.create({
    requestBody: {
      name: input.filename,
      parents: [input.folderId],
    },
    media: {
      mimeType: input.mimeType,
      body: Buffer.from(input.data),
    },
    fields: "id",
    supportsAllDrives: true,
  });
  const fileId = created.data.id;
  if (!fileId) {
    throw new Error("Failed to upload photo");
  }
  return { fileId };
}

export async function getPhotoContent(
  fileId: string,
  options?: { photosFolderId?: string },
): Promise<{ mimeType: string; data: ArrayBuffer }> {
  const drive = await getDriveClient();
  const env = getEnv();
  const expectedFolderId = options?.photosFolderId?.trim() || env.PHOTOS_FOLDER_ID;

  const metadata = await drive.files.get({
    fileId,
    fields: "id,mimeType,parents",
    supportsAllDrives: true,
  });

  const parents = metadata.data.parents ?? [];
  if (parents.length > 0 && expectedFolderId && !parents.includes(expectedFolderId)) {
    throw new Error("File is not in the configured photos folder");
  }

  const content = await drive.files.get(
    {
      fileId,
      alt: "media",
      supportsAllDrives: true,
    },
    {
      responseType: "arraybuffer",
    },
  );

  return {
    mimeType: metadata.data.mimeType ?? "application/octet-stream",
    data: content.data as ArrayBuffer,
  };
}
