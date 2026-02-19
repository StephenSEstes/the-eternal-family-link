import { NextResponse } from "next/server";
import { getPhotoContent } from "@/lib/google/drive";
import { getTenantConfig } from "@/lib/google/sheets";
import { normalizeTenantRouteKey } from "@/lib/tenant/context";

type TenantPhotoRouteProps = {
  params: Promise<{ tenantKey: string; fileId: string }>;
};

export async function GET(_: Request, { params }: TenantPhotoRouteProps) {
  try {
    const { fileId, tenantKey } = await params;
    const normalizedTenantKey = normalizeTenantRouteKey(tenantKey);
    const config = await getTenantConfig(normalizedTenantKey);
    const photo = await getPhotoContent(fileId, { photosFolderId: config.photosFolderId });
    const blob = new Blob([photo.data], { type: photo.mimeType });

    return new NextResponse(blob, {
      headers: {
        "Content-Type": photo.mimeType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("Photo not found", { status: 404 });
  }
}
