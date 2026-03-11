import { NextResponse } from "next/server";
import { z } from "zod";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { buildMediaId, buildMediaLinkId } from "@/lib/media/ids";
import {
  getOciHouseholdsForTenant,
  getOciMediaLinksForEntity,
  setOciPrimaryMediaLink,
  upsertOciMediaAsset,
  upsertOciMediaLink,
} from "@/lib/oci/tables";

type RouteProps = {
  params: Promise<{ tenantKey: string; householdId: string }>;
};

const payloadSchema = z.object({
  fileId: z.string().trim().min(1).max(512),
  name: z.string().trim().max(256).optional().default(""),
  description: z.string().trim().max(2000).optional().default(""),
  photoDate: z.string().trim().max(32).optional().default(""),
  isPrimary: z.boolean().optional().default(false),
  mediaMetadata: z.string().trim().max(4000).optional().default(""),
});

function readCell(row: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export async function POST(request: Request, { params }: RouteProps) {
  const { tenantKey, householdId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const households = await getOciHouseholdsForTenant(resolved.tenant.tenantKey).catch(() => []);
  const exists = households.some((row) => readCell(row.data, "household_id") === householdId);
  if (!exists) {
    return NextResponse.json({ error: "household_not_found" }, { status: 404 });
  }

  const fileId = parsed.data.fileId.trim();
  const name = parsed.data.name.trim() || "photo";
  const description = parsed.data.description.trim();
  const photoDate = parsed.data.photoDate.trim();
  const mediaMetadata = parsed.data.mediaMetadata.trim();
  const nowIso = new Date().toISOString();

  const existingForHousehold = await getOciMediaLinksForEntity({
    familyGroupKey: resolved.tenant.tenantKey,
    entityType: "household",
    entityId: householdId,
    usageType: "gallery",
  });
  const existingLink = existingForHousehold.find((row) => row.fileId.trim() === fileId);
  if (existingLink) {
    return NextResponse.json({
      ok: true,
      existing: true,
      linkId: existingLink.linkId,
      fileId,
      householdId,
    });
  }

  const shouldBePrimary = parsed.data.isPrimary || existingForHousehold.length === 0;
  const mediaId = buildMediaId(fileId);
  const linkId = buildMediaLinkId(resolved.tenant.tenantKey, "household", householdId, fileId, "gallery");
  await upsertOciMediaAsset({
    mediaId,
    fileId,
    storageProvider: "gdrive",
    mediaMetadata,
    createdAt: nowIso,
  });
  await upsertOciMediaLink({
    familyGroupKey: resolved.tenant.tenantKey,
    linkId,
    mediaId,
    entityType: "household",
    entityId: householdId,
    usageType: "gallery",
    label: name,
    description,
    photoDate,
    isPrimary: shouldBePrimary,
    sortOrder: 0,
    mediaMetadata,
    createdAt: nowIso,
  });
  if (shouldBePrimary) {
    await setOciPrimaryMediaLink({
      familyGroupKey: resolved.tenant.tenantKey,
      entityType: "household",
      entityId: householdId,
      usageType: "gallery",
      linkId,
    });
  }
  await appendSessionAuditLog(resolved.session, {
    action: "CREATE",
    entityType: "HOUSEHOLD_MEDIA",
    entityId: fileId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `Linked existing media to household=${householdId}, primary=${String(shouldBePrimary)}.`,
  });
  return NextResponse.json({ ok: true, linkId, fileId, householdId });
}
