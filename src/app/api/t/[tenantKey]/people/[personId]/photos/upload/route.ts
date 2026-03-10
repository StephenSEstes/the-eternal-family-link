import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { canEditPerson } from "@/lib/auth/permissions";
import { toPersonMediaAttributes } from "@/lib/attributes/media-response";
import { syncPersonMediaAssociations, type PersonMediaAttributeType } from "@/lib/attributes/person-media";
import {
  createAttribute,
  getAttributeById,
  getAttributesForEntityWithMedia,
  getPrimaryPhotoFileIdForPerson,
} from "@/lib/attributes/store";
import { uploadPhotoToFolder } from "@/lib/google/drive";
import { buildMediaMetadata, sanitizeUploadFileName, validateUploadInput } from "@/lib/media/upload";
import {
  getPersonById,
  getTenantConfig,
  PEOPLE_TABLE,
  updateTableRecordById,
} from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";

type UploadRouteProps = {
  params: Promise<{ tenantKey: string; personId: string }>;
};

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
    const requestedAttributeType = String(formData?.get("attributeType") ?? "photo")
      .trim()
      .toLowerCase();
    const attributeType: PersonMediaAttributeType = ["photo", "video", "audio", "media"].includes(requestedAttributeType)
      ? (requestedAttributeType as PersonMediaAttributeType)
      : "photo";
    const requestedHeadshot = String(formData?.get("isHeadshot") ?? "").trim().toLowerCase() === "true";
    const description = String(formData?.get("description") ?? "").trim();
    const requestedPhotoDate = String(formData?.get("photoDate") ?? "").trim();
    const fileCreatedAt = String(formData?.get("fileCreatedAt") ?? "").trim();
    const mediaWidth = String(formData?.get("mediaWidth") ?? "").trim();
    const mediaHeight = String(formData?.get("mediaHeight") ?? "").trim();
    const mediaDurationSec = String(formData?.get("mediaDurationSec") ?? "").trim();
    const captureSource = String(formData?.get("captureSource") ?? "").trim();
    const targetAttributeId = String(formData?.get("attributeId") ?? "").trim();
    const arrayBuffer = await file.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    const validated = validateUploadInput({ byteLength: bytes.length, mimeType: file.type });
    if (!validated.ok) {
      return NextResponse.json({ error: "invalid_payload", message: validated.error }, { status: 400 });
    }

    const tenantConfig = await getTenantConfig(resolved.tenant.tenantKey);
    const safeFileName = sanitizeUploadFileName(
      file.name || "",
      `${personId}-${Date.now()}.${validated.mediaKind === "image" ? "jpg" : validated.mediaKind === "video" ? "mp4" : "bin"}`,
    );
    const uploaded = await uploadPhotoToFolder({
      folderId: tenantConfig.photosFolderId,
      filename: safeFileName,
      mimeType: validated.mimeType,
      data: bytes,
    });

    const createdAtIso = !Number.isNaN(new Date(fileCreatedAt).getTime())
      ? new Date(fileCreatedAt).toISOString()
      : new Date().toISOString();
    const effectivePhotoDate = requestedPhotoDate || normalizeDateFromTimestamp(createdAtIso);
    const mediaMetadata = buildMediaMetadata({
      fileName: safeFileName,
      mimeType: validated.mimeType,
      sizeBytes: bytes.length,
      createdAt: createdAtIso,
      mediaKind: validated.mediaKind,
      width: mediaWidth,
      height: mediaHeight,
      durationSec: mediaDurationSec,
      captureSource,
      extra: {
        checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      },
    });

    const existingPhotos = attributeType === "photo"
      ? toPersonMediaAttributes(
        await getAttributesForEntityWithMedia(resolved.tenant.tenantKey, "person", personId),
      ).filter((item) => item.attributeType === "photo")
      : [];
    const shouldBePrimary =
      !targetAttributeId &&
      attributeType === "photo" &&
      validated.mediaKind === "image" &&
      (requestedHeadshot || existingPhotos.length === 0);

    let attributeId = targetAttributeId;
    if (!targetAttributeId) {
      const created = await createAttribute(resolved.tenant.tenantKey, {
        entityType: "person",
        entityId: personId,
        category: "descriptor",
        attributeType,
        attributeTypeCategory: "",
        attributeDate: effectivePhotoDate,
        dateIsEstimated: false,
        estimatedTo: "",
        attributeDetail: uploaded.fileId,
        attributeNotes: description,
        endDate: "",
        typeKey: attributeType,
        label: shouldBePrimary ? "headshot" : label,
        valueText: uploaded.fileId,
        dateStart: effectivePhotoDate,
        dateEnd: "",
        location: "",
        notes: description,
      });
      attributeId = created.attributeId;
    } else {
      const targetAttribute = await getAttributeById(resolved.tenant.tenantKey, targetAttributeId);
      if (!targetAttribute || targetAttribute.entityType !== "person" || targetAttribute.entityId !== personId) {
        return NextResponse.json({ error: "invalid_payload", message: "attributeId is not valid for this person" }, { status: 400 });
      }
    }

    await syncPersonMediaAssociations({
      tenantKey: resolved.tenant.tenantKey,
      personId,
      attributeId,
      attributeType,
      fileId: uploaded.fileId,
      label: shouldBePrimary ? "headshot" : label,
      description,
      photoDate: effectivePhotoDate,
      isPrimary: shouldBePrimary,
      sortOrder: 0,
      mediaMetadata,
      createdAt: createdAtIso,
      replaceAttributeLinks: !targetAttributeId,
    });

    if (attributeType === "photo") {
      const primaryPhotoFileId = shouldBePrimary
        ? uploaded.fileId
        : ((await getPrimaryPhotoFileIdForPerson(resolved.tenant.tenantKey, personId)) ?? "");
      await updateTableRecordById(
        PEOPLE_TABLE,
        personId,
        { photo_file_id: primaryPhotoFileId },
        "person_id",
        resolved.tenant.tenantKey,
      );
    }

    await appendSessionAuditLog(resolved.session, {
      action: "UPLOAD",
      entityType: "PERSON_MEDIA",
      entityId: uploaded.fileId,
      familyGroupKey: resolved.tenant.tenantKey,
      status: "SUCCESS",
      details: `Uploaded ${attributeType} for person=${personId}, attribute=${attributeId}, primary=${String(shouldBePrimary)}.`,
    });

    return NextResponse.json({
      ok: true,
      tenantKey: resolved.tenant.tenantKey,
      personId,
      fileId: uploaded.fileId,
      isHeadshot: shouldBePrimary,
      attributeType,
      attributeId,
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
