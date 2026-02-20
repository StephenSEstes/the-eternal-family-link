import { NextResponse } from "next/server";
import { canEditPerson } from "@/lib/auth/permissions";
import { uploadPhotoToFolder } from "@/lib/google/drive";
import {
  createTableRecord,
  getPersonAttributes,
  getPersonById,
  getTenantConfig,
  PERSON_ATTRIBUTES_TAB,
  updateTableRecordById,
} from "@/lib/google/sheets";
import { requireTenantAccess } from "@/lib/tenant/guard";

type UploadRouteProps = {
  params: Promise<{ tenantKey: string; personId: string }>;
};

function buildAttributeId(tenantKey: string, personId: string) {
  return `${tenantKey}-${personId}-photo-${Date.now()}`;
}

export async function POST(request: Request, { params }: UploadRouteProps) {
  const { tenantKey, personId } = await params;
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

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "invalid_payload", message: "file is required" }, { status: 400 });
  }

  const label = String(formData?.get("label") ?? "gallery").trim() || "gallery";
  const requestedHeadshot = String(formData?.get("isHeadshot") ?? "").trim().toLowerCase() === "true";
  const arrayBuffer = await file.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  if (bytes.length === 0) {
    return NextResponse.json({ error: "invalid_payload", message: "file is empty" }, { status: 400 });
  }

  const tenantConfig = await getTenantConfig(resolved.tenant.tenantKey);
  const uploaded = await uploadPhotoToFolder({
    folderId: tenantConfig.photosFolderId,
    filename: file.name || `${personId}-${Date.now()}.jpg`,
    mimeType: file.type || "application/octet-stream",
    data: bytes,
  });

  const existingPhotos = (await getPersonAttributes(resolved.tenant.tenantKey, personId)).filter(
    (item) => item.attributeType === "photo",
  );
  const shouldBePrimary = requestedHeadshot || existingPhotos.length === 0;

  if (shouldBePrimary) {
    await Promise.all(
      existingPhotos
        .filter((item) => item.isPrimary)
        .map((item) =>
          updateTableRecordById(
            PERSON_ATTRIBUTES_TAB,
            item.attributeId,
            { is_primary: "FALSE" },
            "attribute_id",
            resolved.tenant.tenantKey,
          ),
        ),
    );
  }

  const attributeId = buildAttributeId(resolved.tenant.tenantKey, personId);
  await createTableRecord(
    PERSON_ATTRIBUTES_TAB,
    {
      attribute_id: attributeId,
      tenant_key: resolved.tenant.tenantKey,
      person_id: personId,
      attribute_type: "photo",
      value_text: uploaded.fileId,
      value_json: "",
      label: shouldBePrimary ? "headshot" : label,
      is_primary: shouldBePrimary ? "TRUE" : "FALSE",
      sort_order: "0",
      start_date: "",
      end_date: "",
      visibility: "family",
      notes: "",
    },
    resolved.tenant.tenantKey,
  );

  return NextResponse.json({
    ok: true,
    tenantKey: resolved.tenant.tenantKey,
    personId,
    fileId: uploaded.fileId,
    isHeadshot: shouldBePrimary,
  });
}
