import { NextResponse } from "next/server";
import { requireTenantAdmin } from "@/lib/family-group/guard";
import { deleteTableRows, getTableRecords } from "@/lib/google/sheets";

type RouteProps = {
  params: Promise<{ tenantKey: string; householdId: string; photoId: string }>;
};

const HOUSEHOLD_PHOTOS_TAB = "HouseholdPhotos";

export async function DELETE(_: Request, { params }: RouteProps) {
  const { tenantKey, householdId, photoId } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
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
