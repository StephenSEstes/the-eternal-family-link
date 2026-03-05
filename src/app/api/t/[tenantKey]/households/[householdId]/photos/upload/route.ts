import { NextResponse } from "next/server";
import { buildEntityId } from "@/lib/entity-id";
import { requireTenantAdmin } from "@/lib/family-group/guard";
import { uploadPhotoToFolder } from "@/lib/google/drive";
import { buildMediaId, buildMediaLinkId } from "@/lib/media/ids";
import { setOciPrimaryMediaLink, upsertOciMediaAsset, upsertOciMediaLink } from "@/lib/oci/tables";
import {
  createTableRecord,
  ensureResolvedTabColumns,
  getTableRecords,
  getTenantConfig,
  updateTableRecordById,
} from "@/lib/google/sheets";

type UploadRouteProps = {
  params: Promise<{ tenantKey: string; householdId: string }>;
};

const HOUSEHOLD_PHOTOS_TAB = "HouseholdPhotos";

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function isOciDataSource() {
  return (process.env.EFL_DATA_SOURCE ?? "").trim().toLowerCase() === "oci";
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
    const requestedPrimary = String(formData?.get("isPrimary") ?? "").trim().toLowerCase() === "true";

    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length === 0) {
      return NextResponse.json({ error: "invalid_payload", message: "file is empty" }, { status: 400 });
    }

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

    const config = await getTenantConfig(resolved.tenant.tenantKey);
    const uploaded = await uploadPhotoToFolder({
      folderId: config.photosFolderId,
      filename: file.name || `${householdId}-${Date.now()}.jpg`,
      mimeType: file.type || "application/octet-stream",
      data: bytes,
    });

    let photoId = buildEntityId("attr", `${resolved.tenant.tenantKey}|${householdId}|${Date.now()}|${uploaded.fileId}`);
    let shouldBePrimary = requestedPrimary;
    if (isOciDataSource()) {
      const existing = await getTableRecords("MediaLinks", resolved.tenant.tenantKey).catch(() => []);
      const existingForHousehold = existing.filter(
        (row) =>
          normalize(row.data.family_group_key) === normalize(resolved.tenant.tenantKey) &&
          normalize(row.data.entity_type) === "household" &&
          (row.data.entity_id ?? "").trim() === householdId &&
          normalize(row.data.usage_type) === "gallery",
      );
      shouldBePrimary = requestedPrimary || existingForHousehold.length === 0;
      const mediaId = buildMediaId(uploaded.fileId);
      const linkId = buildMediaLinkId(resolved.tenant.tenantKey, "household", householdId, uploaded.fileId, "gallery");
      photoId = linkId;
      await upsertOciMediaAsset({
        mediaId,
        fileId: uploaded.fileId,
        storageProvider: "gdrive",
        mimeType: file.type || "application/octet-stream",
        fileName: file.name || `${householdId}-${Date.now()}.jpg`,
        fileSizeBytes: String(bytes.length),
        mediaMetadata,
        createdAt: createdAtIso,
      });
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
    } else {
      await ensureResolvedTabColumns(
        HOUSEHOLD_PHOTOS_TAB,
        ["family_group_key", "photo_id", "household_id", "file_id", "name", "description", "photo_date", "is_primary", "media_metadata"],
        resolved.tenant.tenantKey,
      );
      const existing = (await getTableRecords(HOUSEHOLD_PHOTOS_TAB, resolved.tenant.tenantKey)).filter(
        (row) => (row.data.household_id ?? "").trim() === householdId,
      );
      shouldBePrimary = requestedPrimary || existing.length === 0;
      if (shouldBePrimary) {
        await Promise.all(
          existing
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
      await createTableRecord(
        HOUSEHOLD_PHOTOS_TAB,
        {
          family_group_key: resolved.tenant.tenantKey,
          photo_id: photoId,
          household_id: householdId,
          file_id: uploaded.fileId,
          name: name || file.name || "photo",
          description,
          photo_date: effectivePhotoDate,
          is_primary: shouldBePrimary ? "TRUE" : "FALSE",
          media_metadata: mediaMetadata,
        },
        resolved.tenant.tenantKey,
      );
    }

    return NextResponse.json({
      ok: true,
      tenantKey: resolved.tenant.tenantKey,
      householdId,
      photoId,
      fileId: uploaded.fileId,
      isPrimary: shouldBePrimary,
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
