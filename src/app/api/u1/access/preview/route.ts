import { NextResponse } from "next/server";
import { z } from "zod";
import { previewAccessForTarget } from "@/lib/u1/access-resolver";
import { requireU1Actor } from "@/lib/u1/api";

const previewSchema = z.object({
  targetPersonId: z.string().trim().min(1).max(128),
});

export async function POST(request: Request) {
  const resolved = await requireU1Actor();
  if ("error" in resolved) return resolved.error;
  const parsed = previewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }
  const preview = await previewAccessForTarget(resolved.actorPersonId, parsed.data.targetPersonId);
  if (!preview) {
    return NextResponse.json({ error: "target_not_found" }, { status: 404 });
  }
  return NextResponse.json({
    viewerPersonId: resolved.actorPersonId,
    preview,
  });
}
