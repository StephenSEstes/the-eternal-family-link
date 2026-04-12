import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";

export function requireRouteSession(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return {
      session: null,
      unauthorized: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  return { session, unauthorized: null };
}
