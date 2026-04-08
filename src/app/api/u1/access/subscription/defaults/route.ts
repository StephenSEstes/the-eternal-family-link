import { NextResponse } from "next/server";
import { z } from "zod";
import { replaceSubscriptionDefaults, listSubscriptionDefaults } from "@/lib/u1/access-store";
import { requireU1Actor, triggerViewerRecompute } from "@/lib/u1/api";
import { U1_LINEAGE_SIDES, U1_RELATIONSHIP_CATEGORIES } from "@/lib/u1/types";

const updateSchema = z.object({
  rules: z
    .array(
      z.object({
        relationshipCategory: z.enum(U1_RELATIONSHIP_CATEGORIES),
        lineageSide: z.enum(U1_LINEAGE_SIDES),
        isSubscribed: z.boolean(),
        isActive: z.boolean().optional(),
      }),
    )
    .max(300),
});

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function validateNoDuplicates(rows: Array<{ relationshipCategory: string; lineageSide: string }>) {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${normalize(row.relationshipCategory).toLowerCase()}|${normalize(row.lineageSide).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

export async function GET() {
  const resolved = await requireU1Actor();
  if ("error" in resolved) return resolved.error;
  const rows = await listSubscriptionDefaults(resolved.actorPersonId);
  return NextResponse.json({
    viewerPersonId: resolved.actorPersonId,
    rules: rows,
  });
}

export async function PUT(request: Request) {
  const resolved = await requireU1Actor();
  if ("error" in resolved) return resolved.error;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }
  if (!validateNoDuplicates(parsed.data.rules)) {
    return NextResponse.json({ error: "duplicate_rules" }, { status: 400 });
  }
  await replaceSubscriptionDefaults(resolved.actorPersonId, parsed.data.rules);
  triggerViewerRecompute(resolved.actorPersonId, "subscription_defaults_updated");
  const rows = await listSubscriptionDefaults(resolved.actorPersonId);
  return NextResponse.json({
    viewerPersonId: resolved.actorPersonId,
    rulesSaved: rows.length,
    recompute: "scheduled",
    rules: rows,
  });
}
