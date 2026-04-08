import { NextResponse } from "next/server";
import { z } from "zod";
import { listSubscriptionHouseholdExceptions, replaceSubscriptionHouseholdExceptions } from "@/lib/u1/access-store";
import { requireU1Actor, triggerViewerRecompute } from "@/lib/u1/api";
import { U1_EFFECT_TYPES } from "@/lib/u1/types";

const updateSchema = z.object({
  exceptions: z
    .array(
      z.object({
        householdId: z.string().trim().min(1).max(128),
        effect: z.enum(U1_EFFECT_TYPES),
      }),
    )
    .max(800),
});

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function validateNoDuplicates(rows: Array<{ householdId: string }>) {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = normalize(row.householdId).toLowerCase();
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

export async function GET() {
  const resolved = await requireU1Actor();
  if ("error" in resolved) return resolved.error;
  const rows = await listSubscriptionHouseholdExceptions(resolved.actorPersonId);
  return NextResponse.json({
    viewerPersonId: resolved.actorPersonId,
    exceptions: rows,
  });
}

export async function PUT(request: Request) {
  const resolved = await requireU1Actor();
  if ("error" in resolved) return resolved.error;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }
  if (!validateNoDuplicates(parsed.data.exceptions)) {
    return NextResponse.json({ error: "duplicate_household_id" }, { status: 400 });
  }
  await replaceSubscriptionHouseholdExceptions(resolved.actorPersonId, parsed.data.exceptions);
  triggerViewerRecompute(resolved.actorPersonId, "subscription_household_exceptions_updated");
  const rows = await listSubscriptionHouseholdExceptions(resolved.actorPersonId);
  return NextResponse.json({
    viewerPersonId: resolved.actorPersonId,
    exceptionsSaved: rows.length,
    recompute: "scheduled",
    exceptions: rows,
  });
}
