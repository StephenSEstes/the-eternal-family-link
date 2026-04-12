import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth/session";

function buildLogoutResponse(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  clearSessionCookie(response);
  return response;
}

export function GET(request: NextRequest) {
  return buildLogoutResponse(request);
}

export function POST(request: NextRequest) {
  return buildLogoutResponse(request);
}
