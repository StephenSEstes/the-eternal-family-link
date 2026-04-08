import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth/guards";
import { listPeopleLite } from "@/lib/u1/store";
import { U1_LINEAGE_SIDES, U1_RELATIONSHIP_CATEGORIES } from "@/lib/u1/types";

export async function GET(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized!;
  const people = await listPeopleLite();
  return NextResponse.json({
    ok: true,
    viewerPersonId: session.personId,
    categories: U1_RELATIONSHIP_CATEGORIES,
    lineageSides: U1_LINEAGE_SIDES,
    people,
  });
}

