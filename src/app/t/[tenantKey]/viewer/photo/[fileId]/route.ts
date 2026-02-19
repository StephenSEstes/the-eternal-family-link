import { NextResponse } from "next/server";
import { getPhotoContent } from "@/lib/google/drive";

type TenantPhotoRouteProps = {
  params: Promise<{ tenantKey: string; fileId: string }>;
};

export async function GET(_: Request, { params }: TenantPhotoRouteProps) {
  try {
    const { fileId } = await params;
    const photo = await getPhotoContent(fileId);
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
