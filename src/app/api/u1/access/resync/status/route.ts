import { NextResponse } from "next/server";
import { getRecomputeStatus } from "@/lib/u1/access-resolver";
import { requireU1Actor } from "@/lib/u1/api";

export async function GET() {
  const resolved = await requireU1Actor();
  if ("error" in resolved) return resolved.error;
  const status = await getRecomputeStatus(resolved.actorPersonId);
  return NextResponse.json({
    viewerPersonId: resolved.actorPersonId,
    ...status,
  });
}
