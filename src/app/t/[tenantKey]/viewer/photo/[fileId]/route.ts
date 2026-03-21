import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { normalizeTenantRouteKey } from "@/lib/family-group/context";
import { hasTenantAccess } from "@/lib/tenant/context";
import { resolvePhotoContentAcrossFamilies } from "@/lib/google/photo-resolver";

type TenantPhotoRouteProps = {
  params: Promise<{ tenantKey: string; fileId: string }>;
};

export async function GET(request: Request, { params }: TenantPhotoRouteProps) {
  try {
    const { fileId, tenantKey } = await params;
    const normalizedTenantKey = normalizeTenantRouteKey(tenantKey);
    const session = await getServerSession(authOptions);
    const cookieStore = await cookies();
    const viewerUnlocked = cookieStore.get(`viewer_access_${normalizedTenantKey}`)?.value === "granted";
    const allowed = viewerUnlocked || hasTenantAccess(session, normalizedTenantKey);
    if (!allowed) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const requestUrl = new URL(request.url);
    const variant = requestUrl.searchParams.get("variant")?.trim().toLowerCase() === "preview" ? "preview" : "original";
    const photo = await resolvePhotoContentAcrossFamilies(fileId, normalizedTenantKey, { variant });
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
