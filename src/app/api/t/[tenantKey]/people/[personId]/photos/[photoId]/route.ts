import { NextResponse } from "next/server";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { canEditPerson } from "@/lib/auth/permissions";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { getPersonById, PEOPLE_TABLE, updateTableRecordById } from "@/lib/data/runtime";
import { deleteOciMediaLink, getOciMediaLinksForEntity } from "@/lib/oci/tables";

type RouteProps = {
  params: Promise<{ tenantKey: string; personId: string; photoId: string }>;
};

export async function DELETE(_: Request, { params }: RouteProps) {
  const { tenantKey, personId, photoId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }
  if (!canEditPerson(resolved.session, personId, resolved.tenant)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const person = await getPersonById(personId, resolved.tenant.tenantKey);
  if (!person) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const targetFileId = photoId.trim();
  if (!targetFileId) {
    return NextResponse.json({ error: "invalid_photo_id" }, { status: 400 });
  }

  let deletedLinks = 0;
  const personLinks = await getOciMediaLinksForEntity({
    familyGroupKey: resolved.tenant.tenantKey,
    entityType: "person",
    entityId: personId,
  });
  const matchingLinks = personLinks.filter((item) => item.fileId.trim() === targetFileId);
  for (const link of matchingLinks) {
    deletedLinks += await deleteOciMediaLink(link.linkId);
  }

  const currentPhotoFileId = person.photoFileId.trim();
  if (currentPhotoFileId === targetFileId) {
    await updateTableRecordById(
      PEOPLE_TABLE,
      personId,
      { photo_file_id: "" },
      "person_id",
      resolved.tenant.tenantKey,
    );
  }

  if (deletedLinks > 0 || currentPhotoFileId === targetFileId) {
    await appendSessionAuditLog(resolved.session, {
      action: "DELETE",
      entityType: "PERSON_MEDIA",
      entityId: targetFileId,
      familyGroupKey: resolved.tenant.tenantKey,
      status: "SUCCESS",
      details: `Deleted person media links=${deletedLinks} for person=${personId}.`,
    });
  }

  return NextResponse.json({
    ok: true,
    tenantKey: resolved.tenant.tenantKey,
    personId,
    photoId: targetFileId,
    deletedLinks,
  });
}
