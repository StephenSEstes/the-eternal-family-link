import { NextResponse } from "next/server";
import { getTenantConfig } from "@/lib/google/sheets";
import { verifyViewerPin } from "@/lib/security/pin";
import { normalizeTenantRouteKey } from "@/lib/tenant/context";

type ViewerUnlockRouteProps = {
  params: Promise<{ tenantKey: string }>;
};

function cookieNameForTenant(tenantKey: string) {
  return `viewer_access_${tenantKey}`;
}

export async function POST(request: Request, { params }: ViewerUnlockRouteProps) {
  const { tenantKey } = await params;
  const normalizedTenantKey = normalizeTenantRouteKey(tenantKey);
  const routeBase = `/t/${encodeURIComponent(normalizedTenantKey)}/viewer`;
  const formData = await request.formData().catch(() => null);
  const submittedPin = String(formData?.get("pin") ?? "").trim();

  const config = await getTenantConfig(normalizedTenantKey);
  if (!verifyViewerPin(submittedPin, config.viewerPinHash)) {
    return NextResponse.redirect(`${routeBase}?error=1`, { status: 303 });
  }

  const response = NextResponse.redirect(routeBase, { status: 303 });
  response.cookies.set(cookieNameForTenant(normalizedTenantKey), "granted", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });

  return response;
}
