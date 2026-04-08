import { NextResponse } from "next/server";
import { z } from "zod";
import { runViewerRecompute } from "@/lib/u1/access-resolver";
import { requireU1Actor } from "@/lib/u1/api";

const resyncSchema = z
  .object({
    reason: z.string().trim().max(120).optional(),
    runAudit: z.boolean().optional(),
  })
  .default({});

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: Request) {
  const resolved = await requireU1Actor();
  if ("error" in resolved) return resolved.error;
  const parsed = resyncSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }
  const result = await runViewerRecompute({
    viewerPersonId: resolved.actorPersonId,
    reason: normalize(parsed.data.reason) || "manual_resync",
    runAudit: Boolean(parsed.data.runAudit),
  });
  return NextResponse.json({
    viewerPersonId: resolved.actorPersonId,
    mode: result.mode,
    job: result.job,
    run: result.run,
  });
}
