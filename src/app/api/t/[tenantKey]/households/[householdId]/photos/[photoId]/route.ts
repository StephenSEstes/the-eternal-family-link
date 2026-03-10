import { NextResponse } from "next/server";
import { requireTenantAdmin } from "@/lib/family-group/guard";
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
