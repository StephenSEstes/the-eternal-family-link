import { NextResponse } from "next/server";
import { requireTenantAdmin } from "@/lib/family-group/guard";
import { deleteTableRows, getTableRecords, updateTableRecordById } from "@/lib/data/runtime";
import { deleteOciMediaLink, getOciMediaLinksForEntity } from "@/lib/oci/tables";

type RouteProps = {
  params: Promise<{ tenantKey: string; householdId: string; photoId: string }>;
};

export async function DELETE(_: Request, { params }: RouteProps) {
  const { tenantKey, householdId, photoId } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }
  const targetPhotoId = photoId.trim();
  if (!targetPhotoId) {
    return NextResponse.json({ error: "invalid_photo_id" }, { status: 400 });
  }

  const links = await getOciMediaLinksForEntity({
    familyGroupKey: resolved.tenant.tenantKey,
    entityType: "household",
    entityId: householdId,
    usageType: "gallery",
  });
  const targetLinks = links.filter((item) => item.linkId === targetPhotoId || item.fileId === targetPhotoId);
  const targetFileId = targetLinks[0]?.fileId.trim() || targetPhotoId;

  let deletedLinks = 0;
  for (const link of targetLinks) {
    deletedLinks += await deleteOciMediaLink(link.linkId);
  }

  const householdPhotoRows = await getTableRecords("HouseholdPhotos", resolved.tenant.tenantKey).catch(() => []);
  const legacyRowNumbers = householdPhotoRows
    .filter((row) => {
      const rowHouseholdId = (row.data.household_id ?? "").trim();
      const rowPhotoId = (row.data.photo_id ?? "").trim();
      const rowFileId = (row.data.file_id ?? "").trim();
      return rowHouseholdId === householdId && (rowPhotoId === targetPhotoId || rowFileId === targetFileId);
    })
    .map((row) => row.rowNumber);
  const deletedLegacyRows = await deleteTableRows("HouseholdPhotos", legacyRowNumbers, resolved.tenant.tenantKey);

  let clearedWeddingPhoto = false;
  const householdRows = await getTableRecords("Households", resolved.tenant.tenantKey).catch(() => []);
  const householdRow = householdRows.find((row) => (row.data.household_id ?? "").trim() === householdId);
  if ((householdRow?.data.wedding_photo_file_id ?? "").trim() === targetFileId) {
    const updated = await updateTableRecordById(
      "Households",
      householdId,
      { wedding_photo_file_id: "" },
      "household_id",
      resolved.tenant.tenantKey,
    );
    clearedWeddingPhoto = Boolean(updated);
  }

  if (deletedLinks === 0 && deletedLegacyRows === 0 && !clearedWeddingPhoto) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    deletedLinks,
    deletedLegacyRows,
    clearedWeddingPhoto,
  });
}
