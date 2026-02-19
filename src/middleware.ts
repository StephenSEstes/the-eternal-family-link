import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const ACTIVE_TENANT_COOKIE = "active_tenant";

function isBypassPath(pathname: string) {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/viewer")
  );
}

function parseTenantPath(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "t" || !parts[1]) {
    return null;
  }

  return {
    tenantKey: decodeURIComponent(parts[1]).trim().toLowerCase(),
    subPath: parts.slice(2),
  };
}

function hasTenantAccess(token: Awaited<ReturnType<typeof getToken>>, tenantKey: string) {
  const accesses = (token as { tenantAccesses?: { tenantKey?: string }[] } | null)?.tenantAccesses ?? [];
  return accesses.some((entry) => (entry.tenantKey ?? "").trim().toLowerCase() === tenantKey);
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isBypassPath(pathname)) {
    return NextResponse.next();
  }

  const tenantPath = parseTenantPath(pathname);
  if (!tenantPath) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  response.cookies.set(ACTIVE_TENANT_COOKIE, tenantPath.tenantKey, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  const isTenantViewer = tenantPath.subPath[0] === "viewer";
  if (isTenantViewer) {
    return response;
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.email) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  if (!hasTenantAccess(token, tenantPath.tenantKey)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  return response;
}

export const config = {
  matcher: ["/t/:path*"],
};
