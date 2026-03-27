import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const ACTIVE_TENANT_COOKIE = "active_tenant";
const ACTIVE_FAMILY_GROUP_COOKIE = "active_family_group";

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
  if ((parts[0] !== "t" && parts[0] !== "f") || !parts[1]) {
    return null;
  }

  return {
    routePrefix: parts[0],
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

  const rewrittenPath =
    tenantPath.routePrefix === "f"
      ? `/t/${encodeURIComponent(tenantPath.tenantKey)}${tenantPath.subPath.length ? `/${tenantPath.subPath.join("/")}` : ""}`
      : pathname;
  const response =
    rewrittenPath === pathname ? NextResponse.next() : NextResponse.rewrite(new URL(rewrittenPath, request.url));
  response.cookies.set(ACTIVE_TENANT_COOKIE, tenantPath.tenantKey, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  response.cookies.set(ACTIVE_FAMILY_GROUP_COOKIE, tenantPath.tenantKey, {
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

  const multiTenantEnabled = process.env.ENABLE_MULTI_TENANT_SESSION === "true";
  if (!hasTenantAccess(token, tenantPath.tenantKey)) {
    if (!multiTenantEnabled) {
      const deniedUrl = request.nextUrl.clone();
      deniedUrl.pathname = "/access-denied";
      deniedUrl.searchParams.set("tenantKey", tenantPath.tenantKey);
      deniedUrl.searchParams.set("from", pathname);
      deniedUrl.searchParams.set("reason", "missing_tenant_access");
      return NextResponse.redirect(deniedUrl);
    }
    // When multi-tenant session refresh is enabled, allow the request to continue.
    // The server-side tenant guard will refresh access from the database and return 403 if truly unauthorized.
  }

  return response;
}

export const config = {
  matcher: ["/t/:path*", "/f/:path*"],
};
