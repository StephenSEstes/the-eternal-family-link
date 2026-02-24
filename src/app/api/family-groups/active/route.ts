import { z } from "zod";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  ACTIVE_FAMILY_GROUP_COOKIE,
  ACTIVE_TENANT_COOKIE,
  getFamilyGroupAccesses,
  getFamilyGroupContext,
} from "@/lib/family-group/context";

const payloadSchema = z.object({
  familyGroupKey: z.string().trim().min(1).max(80).optional(),
  tenantKey: z.string().trim().min(1).max(80).optional(),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success || (!parsed.data.familyGroupKey && !parsed.data.tenantKey)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const requestedKey = parsed.data.familyGroupKey ?? parsed.data.tenantKey ?? "";
  const familyGroups = getFamilyGroupAccesses(session);
  const selected = familyGroups.find((entry) => entry.tenantKey === requestedKey);
  if (!selected) {
    return NextResponse.json({ error: "unknown_family_group" }, { status: 403 });
  }

  const context = getFamilyGroupContext(session, selected.tenantKey);
  const response = NextResponse.json({
    ok: true,
    activeFamilyGroupKey: context.tenantKey,
    activeTenantKey: context.tenantKey,
  });

  response.cookies.set(ACTIVE_FAMILY_GROUP_COOKIE, context.tenantKey, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  response.cookies.set(ACTIVE_TENANT_COOKIE, context.tenantKey, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
