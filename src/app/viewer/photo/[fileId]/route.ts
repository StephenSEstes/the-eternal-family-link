import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { DEFAULT_TENANT_KEY, hasTenantAccess } from "@/lib/tenant/context";
import { resolvePhotoContentAcrossFamilies } from "@/lib/google/photo-resolver";

type PhotoRouteProps = {
  params: Promise<{ fileId: string }>;
};

export async function GET(request: Request, { params }: PhotoRouteProps) {
  try {
    const { fileId } = await params;
    const session = await getServerSession(authOptions);
    const cookieStore = await cookies();
    const viewerUnlocked = cookieStore.get("viewer_access")?.value === "granted";
    const allowed = viewerUnlocked || hasTenantAccess(session, DEFAULT_TENANT_KEY);
    if (!allowed) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const requestUrl = new URL(request.url);
    const variant = requestUrl.searchParams.get("variant")?.trim().toLowerCase() === "preview" ? "preview" : "original";
    const photo = await resolvePhotoContentAcrossFamilies(fileId, DEFAULT_TENANT_KEY, { variant });
    const blob = new Blob([photo.data], { type: photo.mimeType });

    return new NextResponse(blob, {
      headers: {
        "Content-Type": photo.mimeType,
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
      },
    });
  } catch {
    return new NextResponse("Photo not found", { status: 404 });
  }
}
