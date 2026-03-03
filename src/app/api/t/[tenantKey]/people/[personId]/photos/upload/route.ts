import { NextResponse } from "next/server";
import { canEditPerson } from "@/lib/auth/permissions";
import { buildEntityId } from "@/lib/entity-id";
import { uploadPhotoToFolder } from "@/lib/google/drive";
import {
  createTableRecord,
  ensureResolvedTabColumns,
  getPersonAttributes,
  getPersonById,
  getTenantConfig,
  PEOPLE_TAB,
  PERSON_ATTRIBUTES_TAB,
  updateTableRecordById,
} from "@/lib/google/sheets";
import { requireTenantAccess } from "@/lib/family-group/guard";

type UploadRouteProps = {
  params: Promise<{ tenantKey: string; personId: string }>;
};

function buildAttributeId(tenantKey: string, personId: string) {
  return buildEntityId("attr", `${tenantKey}|${personId}|photo|${Date.now()}`);
}

function normalizeDateFromTimestamp(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

export async function POST(request: Request, { params }: UploadRouteProps) {
  try {
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
    const fileField = formData?.get("file");
    if (!fileField || typeof fileField === "string" || typeof (fileField as Blob).arrayBuffer !== "function") {
      return NextResponse.json({ error: "invalid_payload", message: "file is required" }, { status: 400 });
    }
    const file = fileField as Blob & { name?: string; type?: string };

    const label = String(formData?.get("label") ?? "gallery").trim() || "gallery";
    const requestedHeadshot = String(formData?.get("isHeadshot") ?? "").trim().toLowerCase() === "true";
    const description = String(formData?.get("description") ?? "").trim();
    const requestedPhotoDate = String(formData?.get("photoDate") ?? "").trim();
    const fileCreatedAt = String(formData?.get("fileCreatedAt") ?? "").trim();
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

    const createdAtIso = !Number.isNaN(new Date(fileCreatedAt).getTime())
      ? new Date(fileCreatedAt).toISOString()
      : new Date().toISOString();
    const effectivePhotoDate = requestedPhotoDate || normalizeDateFromTimestamp(createdAtIso);
    const mediaMetadata = JSON.stringify({
      fileName: file.name || "",
      mimeType: file.type || "application/octet-stream",
      sizeBytes: bytes.length,
      createdAt: createdAtIso,
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
    await ensureResolvedTabColumns(
      PERSON_ATTRIBUTES_TAB,
      ["media_metadata"],
      resolved.tenant.tenantKey,
    );
    await createTableRecord(
      PERSON_ATTRIBUTES_TAB,
      {
        attribute_id: attributeId,
        person_id: personId,
        attribute_type: "photo",
        value_text: uploaded.fileId,
        value_json: mediaMetadata,
        media_metadata: mediaMetadata,
        label: shouldBePrimary ? "headshot" : label,
        is_primary: shouldBePrimary ? "TRUE" : "FALSE",
        sort_order: "0",
        start_date: effectivePhotoDate,
        end_date: "",
        visibility: "family",
        share_scope: "both_families",
        share_family_group_key: "",
        notes: description,
      },
      resolved.tenant.tenantKey,
    );

    if (shouldBePrimary) {
      await updateTableRecordById(
        PEOPLE_TAB,
        personId,
        { photo_file_id: uploaded.fileId },
        "person_id",
        resolved.tenant.tenantKey,
      );
    }

    return NextResponse.json({
      ok: true,
      tenantKey: resolved.tenant.tenantKey,
      personId,
      fileId: uploaded.fileId,
      isHeadshot: shouldBePrimary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected upload failure";
    console.error("[photos/upload] failed", error);
    return NextResponse.json(
      {
        error: "upload_failed",
        message,
        hint: "Confirm service account Drive access to the target photos folder.",
      },
      { status: 500 },
    );
  }
}
