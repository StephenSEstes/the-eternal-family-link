import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getEnv } from "@/lib/env";
import { getServiceAccountAuth } from "@/lib/google/auth";
import { getTenantAccesses } from "@/lib/family-group/context";

function isProductionLikeRuntime() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL_URL);
}

function parseServiceAccountEmail(rawJson: string) {
  try {
    const parsed = JSON.parse(rawJson) as { client_email?: string };
    return parsed.client_email ?? "";
  } catch {
    return "";
  }
}

function formatError(error: unknown) {
  const candidate = error as {
    message?: string;
    code?: number | string;
    response?: { status?: number; data?: unknown };
  };
  return {
    message: candidate?.message ?? String(error),
    code: candidate?.code ?? null,
    status: candidate?.response?.status ?? null,
    data: candidate?.response?.data ?? null,
  };
}

export async function GET() {
  if (!isProductionLikeRuntime()) {
    return NextResponse.json(
      { error: "deployed_only", message: "Run this endpoint only on deployed environments." },
      { status: 403 },
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sessionRole = (session.user.role ?? "USER").toUpperCase();
  const hasAdminAccess =
    sessionRole === "ADMIN" || getTenantAccesses(session).some((entry) => entry.role === "ADMIN");
  if (!hasAdminAccess) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const env = getEnv();
  const serviceAccountEmail = parseServiceAccountEmail(env.GOOGLE_SERVICE_ACCOUNT_JSON);

  try {
    const drive = google.drive({ version: "v3", auth: getServiceAccountAuth() });
    const folder = await drive.files.get({
      fileId: env.PHOTOS_FOLDER_ID,
      fields: "id,name,mimeType,driveId,parents,trashed",
      supportsAllDrives: true,
    });

    return NextResponse.json({
      ok: true,
      runtime: {
        nodeEnv: process.env.NODE_ENV ?? null,
        vercelUrl: process.env.VERCEL_URL ?? null,
      },
      configured: {
        photosFolderId: env.PHOTOS_FOLDER_ID,
        serviceAccountEmail,
      },
      driveLookup: {
        found: true,
        file: folder.data,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        runtime: {
          nodeEnv: process.env.NODE_ENV ?? null,
          vercelUrl: process.env.VERCEL_URL ?? null,
        },
        configured: {
          photosFolderId: env.PHOTOS_FOLDER_ID,
          serviceAccountEmail,
        },
        driveLookup: {
          found: false,
          error: formatError(error),
        },
      },
      { status: 500 },
    );
  }
}

