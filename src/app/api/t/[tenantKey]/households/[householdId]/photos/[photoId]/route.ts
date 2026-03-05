import { NextResponse } from "next/server";
import { requireTenantAdmin } from "@/lib/family-group/guard";
import { deleteTableRows, getTableRecords } from "@/lib/google/sheets";
import { deleteOciMediaLink, getOciMediaLinksForEntity } from "@/lib/oci/tables";

type RouteProps = {
  params: Promise<{ tenantKey: string; householdId: string; photoId: string }>;
};

const HOUSEHOLD_PHOTOS_TAB = "HouseholdPhotos";

function isOciDataSource() {
  return (process.env.EFL_DATA_SOURCE ?? "").trim().toLowerCase() === "oci";
}

export async function DELETE(_: Request, { params }: RouteProps) {
  const { tenantKey, householdId, photoId } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  if (isOciDataSource()) {
    const links = await getOciMediaLinksForEntity({
      familyGroupKey: resolved.tenant.tenantKey,
      entityType: "household",
      entityId: householdId,
      usageType: "gallery",
    });
    const direct = links.find((item) => item.linkId === photoId);
    const byFileId = links.find((item) => item.fileId === photoId);
    const target = direct ?? byFileId;
    if (!target) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const deleted = await deleteOciMediaLink(target.linkId);
    if (!deleted) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deleted });
  }

  const rows = await getTableRecords(HOUSEHOLD_PHOTOS_TAB, resolved.tenant.tenantKey).catch(() => []);
  const match = rows.find(
    (row) =>
      (row.data.photo_id ?? "").trim() === photoId &&
      (row.data.household_id ?? "").trim() === householdId,
  );
  if (!match) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const deleted = await deleteTableRows(HOUSEHOLD_PHOTOS_TAB, [match.rowNumber], resolved.tenant.tenantKey);
  return NextResponse.json({ ok: true, deleted });
}
