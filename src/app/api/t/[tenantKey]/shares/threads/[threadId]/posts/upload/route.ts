import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { collectPersistedExifData } from "@/lib/media/exif";
import { buildMediaFileId, buildMediaId, buildMediaLinkId } from "@/lib/media/ids";
import { createImageThumbnailVariant } from "@/lib/media/thumbnail.server";
import {
  buildMediaKindMetadata,
  fallbackUploadExtension,
  sanitizeUploadFileName,
  validateUploadInput,
} from "@/lib/media/upload";
import { getOciObjectStorageLocation, putOciObjectByKey } from "@/lib/oci/object-storage";
import {
  createOciNotificationOutboxEntries,
  createOciSharePost,
  getOciShareThreadById,
  getOciShareThreadMember,
  listOciShareThreadMembers,
  upsertOciMediaAsset,
  upsertOciMediaLink,
} from "@/lib/oci/tables";

type RouteProps = {
  params: Promise<{ tenantKey: string; threadId: string }>;
};

function sanitizeObjectNameSegment(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "file";
}

function buildPostId() {
  return `spost-${randomUUID().replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
}

function buildNotificationId() {
  return `nout-${randomUUID().replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
}

function parseTaggedPeople(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  if (!text.startsWith("[") && !text.startsWith("{")) {
    return text
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry ?? "").trim()).filter(Boolean);
    }
  } catch {
    // ignore and return fallback
  }
  return [];
}

export async function POST(request: Request, { params }: RouteProps) {
  try {
    const { tenantKey, threadId } = await params;
    const resolved = await requireTenantAccess(tenantKey);
    if ("error" in resolved) {
      return resolved.error;
    }

    const actorPersonId = String(resolved.session.user?.person_id ?? resolved.tenant.personId ?? "").trim();
    const actorEmail = String(resolved.session.user?.email ?? "").trim().toLowerCase();
    const actorDisplayName = String(resolved.session.user?.name ?? actorEmail).trim();
    if (!actorPersonId) {
      return NextResponse.json({ error: "missing_actor_person_id" }, { status: 400 });
    }

    const thread = await getOciShareThreadById({
      familyGroupKey: resolved.tenant.tenantKey,
      threadId,
    });
    if (!thread) {
      return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
    }
    const member = await getOciShareThreadMember({
      familyGroupKey: resolved.tenant.tenantKey,
      threadId: thread.threadId,
      personId: actorPersonId,
    });
    if (!member || !member.isActive) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const formData = await request.formData().catch(() => null);
    const fileField = formData?.get("file");
    if (!fileField || typeof fileField === "string" || typeof (fileField as Blob).arrayBuffer !== "function") {
      return NextResponse.json({ error: "invalid_payload", message: "file is required" }, { status: 400 });
    }
    const file = fileField as Blob & { name?: string; type?: string; lastModified?: number };

    const caption = String(formData?.get("caption") ?? "").trim();
    const taggedPeople = Array.from(new Set(parseTaggedPeople(String(formData?.get("taggedPersonIds") ?? ""))));

    const bytes = Buffer.from(await file.arrayBuffer());
    const validated = validateUploadInput({ byteLength: bytes.length, mimeType: file.type, fileName: file.name });
    if (!validated.ok) {
      return NextResponse.json({ error: "invalid_payload", message: validated.error }, { status: 400 });
    }

    const objectStorage = getOciObjectStorageLocation();
    if (!objectStorage) {
      return NextResponse.json(
        { error: "storage_not_configured", message: "OCI object storage is not configured for uploads." },
        { status: 500 },
      );
    }

    const fileId = buildMediaFileId();
    const mediaId = buildMediaId(fileId);
    const safeFileName = sanitizeUploadFileName(
      file.name || "",
      `${actorPersonId}-${Date.now()}.${fallbackUploadExtension(validated.mediaKind, validated.mimeType, file.name)}`,
    );
    const originalObjectKey = `${objectStorage.objectPrefix}/share/original/${sanitizeObjectNameSegment(resolved.tenant.tenantKey)}/${sanitizeObjectNameSegment(thread.threadId)}/${sanitizeObjectNameSegment(fileId)}/${safeFileName}`;
    await putOciObjectByKey({
      objectKey: originalObjectKey,
      data: bytes,
      mimeType: validated.mimeType,
    });

    let thumbnailObjectKey = "";
    if (validated.mediaKind === "image") {
      try {
        const thumbVariant = await createImageThumbnailVariant({ source: bytes, mimeType: validated.mimeType });
        if (thumbVariant) {
          const thumbName = sanitizeObjectNameSegment(
            safeFileName.replace(/\.[^.]+$/, "") + `-thumb.${thumbVariant.extension}`,
          );
          thumbnailObjectKey = `${objectStorage.objectPrefix}/share/thumb/${sanitizeObjectNameSegment(resolved.tenant.tenantKey)}/${sanitizeObjectNameSegment(thread.threadId)}/${sanitizeObjectNameSegment(fileId)}/${thumbName}`;
          await putOciObjectByKey({
            objectKey: thumbnailObjectKey,
            mimeType: thumbVariant.mimeType,
            data: thumbVariant.buffer,
          });
        }
      } catch {
        thumbnailObjectKey = "";
      }
    }

    const persistedExif = validated.mediaKind === "image" ? await collectPersistedExifData(bytes) : null;
    const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
    const nowIso = new Date().toISOString();

    await upsertOciMediaAsset({
      mediaId,
      fileId,
      mediaKind: validated.mediaKind,
      label: safeFileName,
      description: caption,
      photoDate: nowIso.slice(0, 10),
      sourceProvider: "oci_object",
      sourceFileId: fileId,
      originalObjectKey,
      thumbnailObjectKey,
      checksumSha256,
      mimeType: validated.mimeType,
      fileName: safeFileName,
      fileSizeBytes: String(bytes.length),
      createdAt: nowIso,
      exifExtractedAt: persistedExif?.extractedAt,
      exifSourceTag: persistedExif?.sourceTag,
      exifCaptureDate: persistedExif?.captureDate,
      exifCaptureTimestampRaw: persistedExif?.captureTimestampRaw,
      exifMake: persistedExif?.make,
      exifModel: persistedExif?.model,
      exifSoftware: persistedExif?.software,
      exifWidth: persistedExif?.width,
      exifHeight: persistedExif?.height,
      exifOrientation: persistedExif?.orientation,
      exifFingerprint: persistedExif?.fingerprint,
    });

    for (const personId of taggedPeople) {
      await upsertOciMediaLink({
        familyGroupKey: resolved.tenant.tenantKey,
        linkId: buildMediaLinkId(resolved.tenant.tenantKey, "person", personId, fileId, "share"),
        mediaId,
        entityType: "person",
        entityId: personId,
        usageType: "share",
        label: safeFileName,
        description: caption,
        photoDate: nowIso.slice(0, 10),
        isPrimary: false,
        sortOrder: 0,
        mediaMetadata: buildMediaKindMetadata(validated.mediaKind),
        createdAt: nowIso,
      });
    }

    const post = await createOciSharePost({
      postId: buildPostId(),
      threadId: thread.threadId,
      familyGroupKey: resolved.tenant.tenantKey,
      fileId,
      captionText: caption,
      authorPersonId: actorPersonId,
      authorDisplayName: actorDisplayName,
      authorEmail: actorEmail,
      createdAt: nowIso,
      updatedAt: nowIso,
      postStatus: "active",
    });

    const members = await listOciShareThreadMembers({
      familyGroupKey: resolved.tenant.tenantKey,
      threadId: thread.threadId,
    });
    const outboxRows = members
      .filter((entry) => entry.personId && entry.personId !== actorPersonId)
      .map((entry) => ({
        notificationId: buildNotificationId(),
        familyGroupKey: resolved.tenant.tenantKey,
        personId: entry.personId,
        channel: "webpush",
        eventType: "share_post_created",
        entityType: "share_post",
        entityId: post.postId,
        payloadJson: JSON.stringify({
          threadId: thread.threadId,
          postId: post.postId,
          caption: post.captionText,
          fileId: post.fileId,
        }),
        status: "pending",
        attemptCount: 0,
        createdAt: nowIso,
      }));
    if (outboxRows.length > 0) {
      await createOciNotificationOutboxEntries(outboxRows);
    }

    await appendSessionAuditLog(resolved.session, {
      action: "UPLOAD",
      entityType: "SHARE_POST",
      entityId: post.postId,
      familyGroupKey: resolved.tenant.tenantKey,
      status: "SUCCESS",
      details: `Uploaded share post for thread=${thread.threadId}, file=${fileId}.`,
    });

    return NextResponse.json({
      tenantKey: resolved.tenant.tenantKey,
      threadId: thread.threadId,
      postId: post.postId,
      fileId,
      mediaId,
      taggedPersonIds: taggedPeople,
      notificationOutboxCount: outboxRows.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected upload failure";
    return NextResponse.json({ error: "upload_failed", message }, { status: 500 });
  }
}
