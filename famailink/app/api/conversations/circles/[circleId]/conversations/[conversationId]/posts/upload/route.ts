import { createHash } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth/guards";
import { createConversationPost, upsertConversationMediaAsset } from "@/lib/conversations/store";
import { actorFromSession, jsonError, normalize } from "@/lib/conversations/route-helpers";
import { buildMediaFileId, buildMediaId } from "@/lib/media/ids";
import { createImageThumbnailVariant } from "@/lib/media/thumbnail.server";
import { fallbackUploadExtension, sanitizeUploadFileName, validateUploadInput } from "@/lib/media/upload";
import { dispatchPendingPushNotifications, queueConversationActivityNotifications } from "@/lib/notifications/store";
import { getOciObjectStorageLocation, putOciObjectByKey } from "@/lib/oci/object-storage";

type RouteContext = {
  params: Promise<{ circleId: string; conversationId: string }>;
};

function sanitizeObjectNameSegment(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "file";
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session) return unauthorized;

  const { circleId, conversationId } = await context.params;
  const formData = await request.formData().catch(() => null);
  const fileField = formData?.get("file");
  if (!fileField || typeof fileField === "string" || typeof (fileField as Blob).arrayBuffer !== "function") {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }

  const file = fileField as Blob & { name?: string; type?: string };
  const bytes = Buffer.from(await file.arrayBuffer());
  const validated = validateUploadInput({ byteLength: bytes.length, mimeType: file.type, fileName: file.name });
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const objectStorage = getOciObjectStorageLocation();
  if (!objectStorage) {
    return NextResponse.json(
      { error: "storage_not_configured", message: "OCI object storage is not configured for uploads." },
      { status: 500 },
    );
  }

  try {
    const actor = actorFromSession(session);
    const createdAt = new Date().toISOString();
    const caption = normalize(formData?.get("caption") ?? "");
    const fileId = buildMediaFileId();
    const mediaId = buildMediaId(fileId);
    const safeFileName = sanitizeUploadFileName(
      file.name || "",
      `${actor.personId}-${Date.now()}.${fallbackUploadExtension(validated.mediaKind, validated.mimeType, file.name)}`,
    );
    const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
    const originalObjectKey = `${objectStorage.objectPrefix}/famailink/share/original/${sanitizeObjectNameSegment(circleId)}/${sanitizeObjectNameSegment(conversationId)}/${sanitizeObjectNameSegment(fileId)}/${safeFileName}`;
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
          thumbnailObjectKey = `${objectStorage.objectPrefix}/famailink/share/thumb/${sanitizeObjectNameSegment(circleId)}/${sanitizeObjectNameSegment(conversationId)}/${sanitizeObjectNameSegment(fileId)}/${thumbName}`;
          await putOciObjectByKey({
            objectKey: thumbnailObjectKey,
            data: thumbVariant.buffer,
            mimeType: thumbVariant.mimeType,
          });
        }
      } catch (error) {
        console.warn("[famailink-share-upload] thumbnail generation skipped", error);
      }
    }

    await upsertConversationMediaAsset({
      mediaId,
      fileId,
      mediaKind: validated.mediaKind,
      label: safeFileName,
      description: caption,
      photoDate: "",
      sourceProvider: "oci_object",
      sourceFileId: fileId,
      originalObjectKey,
      thumbnailObjectKey,
      checksumSha256,
      mimeType: validated.mimeType,
      fileName: safeFileName,
      fileSizeBytes: String(bytes.length),
      createdAt,
    });

    const post = await createConversationPost({
      actor,
      circleId,
      conversationId,
      caption,
      fileId,
    });

    after(async () => {
      try {
        await queueConversationActivityNotifications({
          actor,
          circleId,
          conversationId,
          eventType: "message_posted",
          entityType: "share_post",
          entityId: post.postId,
          previewText: caption || safeFileName,
        });
        await dispatchPendingPushNotifications(25);
      } catch {
        // Best-effort background delivery only.
      }
    });

    return NextResponse.json({
      post,
      media: {
        mediaId,
        fileId,
        mediaKind: validated.mediaKind,
        originalObjectKey,
        thumbnailObjectKey,
      },
    });
  } catch (error) {
    return jsonError(error, "upload_post_failed", 500);
  }
}
