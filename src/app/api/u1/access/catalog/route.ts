import { NextResponse } from "next/server";
import { listHouseholdsLite, listPeopleLite } from "@/lib/u1/access-store";
import { requireU1Actor } from "@/lib/u1/api";

export async function GET() {
  const resolved = await requireU1Actor();
  if ("error" in resolved) return resolved.error;
  const [people, households] = await Promise.all([listPeopleLite(), listHouseholdsLite()]);
  return NextResponse.json({
    viewerPersonId: resolved.actorPersonId,
    people,
    households,
  });
}
