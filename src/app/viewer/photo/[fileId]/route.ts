import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { DEFAULT_TENANT_KEY, hasTenantAccess } from "@/lib/tenant/context";
import { resolvePhotoContentAcrossFamilies } from "@/lib/google/photo-resolver";

type PhotoRouteProps = {
  params: Promise<{ fileId: string }>;
};

export async function GET(_: Request, { params }: PhotoRouteProps) {
  try {
    const { fileId } = await params;
    const session = await getServerSession(authOptions);
    const cookieStore = await cookies();
    const viewerUnlocked = cookieStore.get("viewer_access")?.value === "granted";
    const allowed = viewerUnlocked || hasTenantAccess(session, DEFAULT_TENANT_KEY);
    if (!allowed) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const photo = await resolvePhotoContentAcrossFamilies(fileId, DEFAULT_TENANT_KEY);
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
