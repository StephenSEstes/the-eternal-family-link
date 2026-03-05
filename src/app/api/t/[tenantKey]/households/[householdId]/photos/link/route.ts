import { NextResponse } from "next/server";
import { z } from "zod";
import { buildEntityId } from "@/lib/entity-id";
import { requireTenantAdmin } from "@/lib/family-group/guard";
import { buildMediaId, buildMediaLinkId } from "@/lib/media/ids";
import { setOciPrimaryMediaLink, upsertOciMediaAsset, upsertOciMediaLink } from "@/lib/oci/tables";
import { createTableRecord, ensureResolvedTabColumns, getTableRecords, updateTableRecordById } from "@/lib/google/sheets";

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

const HOUSEHOLD_PHOTOS_TAB = "HouseholdPhotos";

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function isOciDataSource() {
  return (process.env.EFL_DATA_SOURCE ?? "").trim().toLowerCase() === "oci";
}

export async function POST(request: Request, { params }: RouteProps) {
  const { tenantKey, householdId } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const households = await getTableRecords("Households", resolved.tenant.tenantKey).catch(() => []);
  const exists = households.some((row) => (row.data.household_id ?? "").trim() === householdId);
  if (!exists) {
    return NextResponse.json({ error: "household_not_found" }, { status: 404 });
  }

  const fileId = parsed.data.fileId.trim();
  const name = parsed.data.name.trim() || "photo";
  const description = parsed.data.description.trim();
  const photoDate = parsed.data.photoDate.trim();
  const mediaMetadata = parsed.data.mediaMetadata.trim();
  const nowIso = new Date().toISOString();

  if (isOciDataSource()) {
    const existing = await getTableRecords("MediaLinks", resolved.tenant.tenantKey).catch(() => []);
    const existingForHousehold = existing.filter(
      (row) =>
        normalize(row.data.family_group_key) === normalize(resolved.tenant.tenantKey) &&
        normalize(row.data.entity_type) === "household" &&
        (row.data.entity_id ?? "").trim() === householdId &&
        normalize(row.data.usage_type) === "gallery",
    );
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
    return NextResponse.json({ ok: true, linkId, fileId, householdId });
  }

  await ensureResolvedTabColumns(
    HOUSEHOLD_PHOTOS_TAB,
    ["family_group_key", "photo_id", "household_id", "file_id", "name", "description", "photo_date", "is_primary", "media_metadata"],
    resolved.tenant.tenantKey,
  );

  const rows = await getTableRecords(HOUSEHOLD_PHOTOS_TAB, resolved.tenant.tenantKey).catch(() => []);
  const existing = rows.find(
    (row) => (row.data.household_id ?? "").trim() === householdId && (row.data.file_id ?? "").trim() === fileId,
  );
  if (existing) {
    return NextResponse.json({ ok: true, existing: true, photoId: String(existing.data.photo_id ?? "").trim(), fileId, householdId });
  }

  const householdRows = rows.filter((row) => (row.data.household_id ?? "").trim() === householdId);
  const shouldBePrimary = parsed.data.isPrimary || householdRows.length === 0;
  if (shouldBePrimary) {
    await Promise.all(
      householdRows
        .filter((row) => normalize(row.data.is_primary) === "true")
        .map((row) =>
          updateTableRecordById(
            HOUSEHOLD_PHOTOS_TAB,
            String(row.data.photo_id ?? "").trim(),
            { is_primary: "FALSE" },
            "photo_id",
            resolved.tenant.tenantKey,
          ),
        ),
    );
  }

  const photoId = buildEntityId("attr", `${resolved.tenant.tenantKey}|${householdId}|${Date.now()}|${fileId}`);
  await createTableRecord(
    HOUSEHOLD_PHOTOS_TAB,
    {
      family_group_key: resolved.tenant.tenantKey,
      photo_id: photoId,
      household_id: householdId,
      file_id: fileId,
      name,
      description,
      photo_date: photoDate,
      is_primary: shouldBePrimary ? "TRUE" : "FALSE",
      media_metadata: mediaMetadata,
    },
    resolved.tenant.tenantKey,
  );
  return NextResponse.json({ ok: true, photoId, fileId, householdId });
}
