import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { buildEntityId } from "@/lib/entity-id";
import { requireTenantAdmin } from "@/lib/family-group/guard";
import { uploadPhotoToFolder } from "@/lib/google/drive";
import { buildMediaId, buildMediaLinkId } from "@/lib/media/ids";
import { buildMediaMetadata, sanitizeUploadFileName, validateUploadInput } from "@/lib/media/upload";
import { setOciPrimaryMediaLink, upsertOciMediaAsset, upsertOciMediaLink } from "@/lib/oci/tables";
import { getAttributeById } from "@/lib/attributes/store";
import {
  getTableRecords,
  getTenantConfig,
} from "@/lib/data/runtime";

type UploadRouteProps = {
  params: Promise<{ tenantKey: string; householdId: string }>;
};

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
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
    const { tenantKey, householdId } = await params;
    const resolved = await requireTenantAdmin(tenantKey);
    if ("error" in resolved) {
      return resolved.error;
    }

    const households = await getTableRecords("Households", resolved.tenant.tenantKey);
    const exists = households.some((row) => (row.data.household_id ?? "").trim() === householdId);
    if (!exists) {
      return NextResponse.json({ error: "household_not_found" }, { status: 404 });
    }

    const formData = await request.formData().catch(() => null);
    const fileField = formData?.get("file");
    if (!fileField || typeof fileField === "string" || typeof (fileField as Blob).arrayBuffer !== "function") {
      return NextResponse.json({ error: "invalid_payload", message: "file is required" }, { status: 400 });
    }
    const file = fileField as Blob & { name?: string; type?: string };

    const name = String(formData?.get("name") ?? "").trim();
    const description = String(formData?.get("description") ?? "").trim();
    const requestedPhotoDate = String(formData?.get("photoDate") ?? "").trim();
    const fileCreatedAt = String(formData?.get("fileCreatedAt") ?? "").trim();
    const mediaWidth = String(formData?.get("mediaWidth") ?? "").trim();
    const mediaHeight = String(formData?.get("mediaHeight") ?? "").trim();
    const mediaDurationSec = String(formData?.get("mediaDurationSec") ?? "").trim();
    const captureSource = String(formData?.get("captureSource") ?? "").trim();
    const requestedPrimary = String(formData?.get("isPrimary") ?? "").trim().toLowerCase() === "true";
    const targetAttributeId = String(formData?.get("attributeId") ?? "").trim();

    const bytes = Buffer.from(await file.arrayBuffer());
    const validated = validateUploadInput({ byteLength: bytes.length, mimeType: file.type });
    if (!validated.ok) {
      return NextResponse.json({ error: "invalid_payload", message: validated.error }, { status: 400 });
    }

    const createdAtIso = !Number.isNaN(new Date(fileCreatedAt).getTime())
      ? new Date(fileCreatedAt).toISOString()
      : new Date().toISOString();
    const effectivePhotoDate = requestedPhotoDate || normalizeDateFromTimestamp(createdAtIso);
    const safeFileName = sanitizeUploadFileName(
      file.name || "",
      `${householdId}-${Date.now()}.${validated.mediaKind === "image" ? "jpg" : validated.mediaKind === "video" ? "mp4" : "bin"}`,
    );
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

    const config = await getTenantConfig(resolved.tenant.tenantKey);
    const uploaded = await uploadPhotoToFolder({
      folderId: config.photosFolderId,
      filename: safeFileName,
      mimeType: validated.mimeType,
      data: bytes,
    });

    let photoId = buildEntityId("attr", `${resolved.tenant.tenantKey}|${householdId}|${Date.now()}|${uploaded.fileId}`);
    let shouldBePrimary = !targetAttributeId && requestedPrimary;
    const existing = await getTableRecords("MediaLinks", resolved.tenant.tenantKey).catch(() => []);
    const existingForHousehold = existing.filter(
      (row) =>
        normalize(row.data.family_group_key) === normalize(resolved.tenant.tenantKey) &&
        normalize(row.data.entity_type) === "household" &&
        (row.data.entity_id ?? "").trim() === householdId &&
        normalize(row.data.usage_type) === "gallery",
    );
    shouldBePrimary = !targetAttributeId && (requestedPrimary || existingForHousehold.length === 0);
    const mediaId = buildMediaId(uploaded.fileId);
    const linkId = buildMediaLinkId(resolved.tenant.tenantKey, "household", householdId, uploaded.fileId, "gallery");
    photoId = linkId;
    await upsertOciMediaAsset({
      mediaId,
      fileId: uploaded.fileId,
      storageProvider: "gdrive",
      mimeType: validated.mimeType,
      fileName: safeFileName,
      fileSizeBytes: String(bytes.length),
      mediaMetadata,
      createdAt: createdAtIso,
    });
    if (!targetAttributeId) {
      await upsertOciMediaLink({
        familyGroupKey: resolved.tenant.tenantKey,
        linkId,
        mediaId,
        entityType: "household",
        entityId: householdId,
        usageType: "gallery",
        label: name || file.name || "photo",
        description,
        photoDate: effectivePhotoDate,
        isPrimary: shouldBePrimary,
        sortOrder: 0,
        mediaMetadata,
        createdAt: createdAtIso,
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
    }
    if (targetAttributeId) {
      const targetAttribute = await getAttributeById(resolved.tenant.tenantKey, targetAttributeId);
      if (!targetAttribute || targetAttribute.entityType !== "household" || targetAttribute.entityId !== householdId) {
        return NextResponse.json({ error: "invalid_payload", message: "attributeId is not valid for this household" }, { status: 400 });
      }
      const attributeLinkId = buildMediaLinkId(
        resolved.tenant.tenantKey,
        "attribute",
        targetAttributeId,
        uploaded.fileId,
        "media",
      );
      await upsertOciMediaLink({
        familyGroupKey: resolved.tenant.tenantKey,
        linkId: attributeLinkId,
        mediaId,
        entityType: "attribute",
        entityId: targetAttributeId,
        usageType: "media",
        label: name || file.name || "photo",
        description,
        photoDate: effectivePhotoDate,
        isPrimary: false,
        sortOrder: 0,
        mediaMetadata,
        createdAt: createdAtIso,
      });
    }

    return NextResponse.json({
      ok: true,
      tenantKey: resolved.tenant.tenantKey,
      householdId,
      photoId,
      fileId: uploaded.fileId,
      isPrimary: shouldBePrimary,
      attributeId: targetAttributeId || "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected upload failure";
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
