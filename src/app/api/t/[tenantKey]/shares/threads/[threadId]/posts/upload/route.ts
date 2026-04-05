import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { appendSessionAuditLog } from "@/lib/audit/log";
import {
  removePersonMediaAssociations,
  syncPersonMediaAssociations,
  type PersonMediaAttributeType,
} from "@/lib/attributes/person-media";
import { createAttribute, deleteAttribute } from "@/lib/attributes/store";
import { getPersonById } from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { collectPersistedExifData } from "@/lib/media/exif";
import { buildMediaFileId, buildMediaId } from "@/lib/media/ids";
import { createImageThumbnailVariant } from "@/lib/media/thumbnail.server";
import {
  buildMediaKindMetadata,
  fallbackUploadExtension,
  sanitizeUploadFileName,
  type SupportedMediaKind,
  validateUploadInput,
} from "@/lib/media/upload";
import { getOciObjectStorageLocation, putOciObjectByKey } from "@/lib/oci/object-storage";
import {
  createOciNotificationOutboxEntries,
  createOciSharePost,
  getOciShareConversationById,
  getOciShareConversationMember,
  getOciShareThreadMember,
  listOciShareThreadMembers,
  upsertOciShareConversationMember,
  upsertOciMediaAsset,
} from "@/lib/oci/tables";
import { resolveAccessibleShareThread } from "@/lib/shares/thread-access";

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

function buildConversationMemberId(conversationId: string, personId: string) {
  const c = conversationId.trim().replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "conv";
  const p = personId.trim().replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "person";
  return `scm-${c}-${p}-${randomUUID().replace(/[^a-zA-Z0-9]/g, "").slice(0, 6)}`;
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

function mapMediaKindToPersonAttributeType(mediaKind: SupportedMediaKind): PersonMediaAttributeType {
  if (mediaKind === "video") return "video";
  if (mediaKind === "audio") return "audio";
  if (mediaKind === "image") return "photo";
  return "media";
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

    const thread = await resolveAccessibleShareThread({
      threadId,
      tenant: resolved.tenant,
    });
    if (!thread) {
      return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
    }
    const member = await getOciShareThreadMember({
      familyGroupKey: thread.familyGroupKey,
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
    const conversationId = String(formData?.get("conversationId") ?? "").trim();
    if (!conversationId) {
      return NextResponse.json({ error: "conversation_id_required" }, { status: 400 });
    }
    const conversation = await getOciShareConversationById({
      familyGroupKey: thread.familyGroupKey,
      threadId: thread.threadId,
      conversationId,
    });
    if (!conversation) {
      return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });
    }
    const conversationMember = await getOciShareConversationMember({
      familyGroupKey: thread.familyGroupKey,
      conversationId: conversation.conversationId,
      personId: actorPersonId,
    });
    if (!conversationMember || !conversationMember.isActive) {
      await upsertOciShareConversationMember({
        conversationMemberId: buildConversationMemberId(conversation.conversationId, actorPersonId),
        conversationId: conversation.conversationId,
        threadId: thread.threadId,
        familyGroupKey: thread.familyGroupKey,
        personId: actorPersonId,
        memberRole: "member",
        joinedAt: new Date().toISOString(),
        isActive: true,
      });
    }
    const requestedTaggedPeople = Array.from(
      new Set(
        parseTaggedPeople(String(formData?.get("taggedPersonIds") ?? ""))
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    );
    const taggedPeople = requestedTaggedPeople.length > 0 ? requestedTaggedPeople : [actorPersonId];

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
    const originalObjectKey = `${objectStorage.objectPrefix}/share/original/${sanitizeObjectNameSegment(thread.familyGroupKey)}/${sanitizeObjectNameSegment(thread.threadId)}/${sanitizeObjectNameSegment(fileId)}/${safeFileName}`;
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
          thumbnailObjectKey = `${objectStorage.objectPrefix}/share/thumb/${sanitizeObjectNameSegment(thread.familyGroupKey)}/${sanitizeObjectNameSegment(thread.threadId)}/${sanitizeObjectNameSegment(fileId)}/${thumbName}`;
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
    const photoDate = nowIso.slice(0, 10);
    const mediaMetadata = buildMediaKindMetadata(validated.mediaKind);

    await upsertOciMediaAsset({
      mediaId,
      fileId,
      mediaKind: validated.mediaKind,
      label: safeFileName,
      description: caption,
      photoDate,
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

    const attributeType = mapMediaKindToPersonAttributeType(validated.mediaKind);
    const persistedTaggedPeople: string[] = [];
    for (const personId of taggedPeople) {
      const person = await getPersonById(personId, thread.familyGroupKey);
      if (!person) {
        continue;
      }
      const created = await createAttribute(thread.familyGroupKey, {
        entityType: "person",
        entityId: personId,
        category: "descriptor",
        attributeKind: "descriptor",
        attributeType,
        attributeTypeCategory: "",
        attributeDate: photoDate,
        dateIsEstimated: false,
        estimatedTo: "",
        attributeDetail: fileId,
        attributeNotes: caption,
        endDate: "",
        typeKey: attributeType,
        label: caption || safeFileName,
        valueText: fileId,
        dateStart: photoDate,
        dateEnd: "",
        location: "",
        notes: caption,
      });
      try {
        await syncPersonMediaAssociations({
          tenantKey: thread.familyGroupKey,
          personId,
          attributeId: created.attributeId,
          attributeType,
          fileId,
          mediaKind: validated.mediaKind,
          label: caption || safeFileName,
          description: caption,
          photoDate,
          isPrimary: false,
          sortOrder: 0,
          mediaMetadata,
          sourceProvider: "oci_object",
          sourceFileId: fileId,
          originalObjectKey,
          thumbnailObjectKey,
          checksumSha256,
          mimeType: validated.mimeType,
          fileName: safeFileName,
          fileSizeBytes: String(bytes.length),
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
          createdAt: nowIso,
        });
      } catch (error) {
        await removePersonMediaAssociations({
          tenantKey: thread.familyGroupKey,
          personId,
          attributeId: created.attributeId,
          fileIds: [fileId],
        }).catch(() => undefined);
        await deleteAttribute(thread.familyGroupKey, created.attributeId).catch(() => undefined);
        throw error;
      }
      persistedTaggedPeople.push(personId);
    }

    const post = await createOciSharePost({
      postId: buildPostId(),
      threadId: thread.threadId,
      conversationId,
      familyGroupKey: thread.familyGroupKey,
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
      familyGroupKey: thread.familyGroupKey,
      threadId: thread.threadId,
    });
    const outboxRows = members
      .filter((entry) => entry.personId && entry.personId !== actorPersonId)
      .map((entry) => ({
        notificationId: buildNotificationId(),
        familyGroupKey: thread.familyGroupKey,
        personId: entry.personId,
        channel: "webpush",
        eventType: "share_post_created",
        entityType: "share_post",
        entityId: post.postId,
        payloadJson: JSON.stringify({
          threadId: thread.threadId,
          conversationId,
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
      familyGroupKey: thread.familyGroupKey,
      status: "SUCCESS",
      details: `Uploaded share post for thread=${thread.threadId}, file=${fileId}.`,
    });

    return NextResponse.json({
      tenantKey: resolved.tenant.tenantKey,
      threadFamilyGroupKey: thread.familyGroupKey,
      threadId: thread.threadId,
      conversationId,
      postId: post.postId,
      fileId,
      mediaId,
      taggedPersonIds: persistedTaggedPeople,
      notificationOutboxCount: outboxRows.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected upload failure";
    return NextResponse.json({ error: "upload_failed", message }, { status: 500 });
  }
}
