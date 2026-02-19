import "server-only";

import { google } from "googleapis";
import { getEnv } from "@/lib/env";
import { getServiceAccountAuth } from "@/lib/google/auth";

async function getDriveClient() {
  const auth = getServiceAccountAuth();
  return google.drive({ version: "v3", auth });
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
