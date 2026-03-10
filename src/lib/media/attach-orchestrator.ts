import { getPhotoProxyPath } from "@/lib/google/photo-path";
import { normalizeMediaKind, type MediaKind } from "@/lib/media/upload";
import { matchesCanonicalMediaFileId, type AttributeWithMedia } from "@/lib/attributes/media-response";
import {
  buildHouseholdLinkPayload,
  buildHouseholdUploadContractFields,
  buildPersonAttributeLinkPayload,
  buildPersonUploadContractFields,
} from "@/lib/media/attach-contracts";

export type MediaAttachLaunchSource = "person" | "attribute" | "household" | "library";

export type MediaAttachPersonOption = {
  personId: string;
  displayName: string;
  gender?: "male" | "female" | "unspecified";
};

export type MediaAttachHouseholdOption = {
  householdId: string;
  label: string;
};

export type MediaAttachContext = {
  tenantKey: string;
  source: MediaAttachLaunchSource;
  canManage: boolean;
  allowHouseholdLinks: boolean;
  personId?: string;
  householdId?: string;
  attributeId?: string;
  entityType?: "person" | "household" | "attribute";
  defaultDate?: string;
  defaultLabel?: string;
  defaultDescription?: string;
  defaultAttributeType?: "photo" | "media";
  defaultIsPrimary?: boolean;
  preselectedPersonIds?: string[];
  preselectedHouseholdIds?: string[];
  peopleOptions?: MediaAttachPersonOption[];
  householdOptions?: MediaAttachHouseholdOption[];
};

export type MediaAttachLibraryItem = {
  fileId: string;
  name: string;
  description: string;
  date: string;
  mediaMetadata?: string;
  people: Array<{ personId: string; displayName: string }>;
  households: Array<{ householdId: string; label: string }>;
};

export type MediaAttachDraftItem = {
  clientId: string;
  source: "device_upload" | "camera_capture" | "library_existing";
  file?: File;
  fileId?: string;
  mediaKind?: "image" | "video" | "audio";
  previewUrl?: string;
  existingMediaMetadata?: string;
  duplicateOfFileId?: string;
  duplicateExistingPreviewUrl?: string;
  duplicateDecision?: "undecided" | "duplicate" | "not_duplicate" | "replace_existing";
  skipImport?: boolean;
  title: string;
  description: string;
  date: string;
  notes: string;
  personIds: string[];
  householdIds: string[];
  attributeType?: "photo" | "video" | "audio" | "media";
};

export type MediaAttachSharedMetadata = {
  sameMemorySet: boolean;
  title: string;
  description: string;
  date: string;
  notes: string;
};

export type MediaAttachFailure = {
  clientId: string;
  message: string;
  targetType?: "person" | "household" | "upload";
  targetId?: string;
};

export type MediaAttachExecutionSummary = {
  createdLinks: number;
  createdAttributes: number;
  skipped: number;
  failures: MediaAttachFailure[];
};

type AssociationSnapshot = {
  personIds: Set<string>;
  householdIds: Set<string>;
};

type RunPlanInput = {
  context: MediaAttachContext;
  items: MediaAttachDraftItem[];
  shared: MediaAttachSharedMetadata;
  onProgress?: (message: string, completed: number, total: number) => void;
  onItemStatus?: (
    clientId: string,
    status: "pending" | "working" | "uploaded" | "linked" | "skipped" | "failed",
    message?: string,
  ) => void;
};

function norm(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

type SupportedMediaKind = Exclude<MediaKind, "unknown">;

function inferUploadMediaKind(file: Pick<File, "name" | "type">): SupportedMediaKind | "" {
  const byMime = normalizeMediaKind(file.type);
  if (byMime !== "unknown") {
    return byMime;
  }
  const lower = file.name.toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|bmp|heic|heif)$/.test(lower)) return "image";
  if (/\.(mp4|mov|webm|m4v)$/.test(lower)) return "video";
  if (/\.(mp3|m4a|wav|ogg|aac|flac)$/.test(lower)) return "audio";
  return "";
}

function mediaTabShareDefaults(context: MediaAttachContext) {
  if (context.source === "library") {
    return {
      shareScope: "one_family" as const,
      shareFamilyGroupKey: context.tenantKey,
    };
  }
  return {
    shareScope: "both_families" as const,
    shareFamilyGroupKey: "",
  };
}

export function inferMediaKindByMetadataOrFileId(fileId: string, mediaMetadata?: string): SupportedMediaKind {
  const raw = (mediaMetadata ?? "").trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { mediaKind?: string; mimeType?: string };
      const mediaKind = norm(parsed.mediaKind);
      if (mediaKind === "image" || mediaKind === "video" || mediaKind === "audio") {
        return mediaKind;
      }
      const mimeType = norm(parsed.mimeType);
      if (mimeType.startsWith("video/")) return "video";
      if (mimeType.startsWith("audio/")) return "audio";
      if (mimeType.startsWith("image/")) return "image";
    } catch {
      // Ignore malformed metadata.
    }
  }
  const lower = fileId.toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|bmp|heic|heif)$/.test(lower)) return "image";
  if (/\.(mp4|mov|webm|m4v)$/.test(lower)) return "video";
  if (/\.(mp3|m4a|wav|ogg|aac|flac)$/.test(lower)) return "audio";
  return "image";
}

async function readImageDimensions(file: File): Promise<{ width?: number; height?: number }> {
  const result: { width?: number; height?: number } = {};
  await new Promise<void>((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      result.width = img.naturalWidth || undefined;
      result.height = img.naturalHeight || undefined;
      URL.revokeObjectURL(url);
      resolve();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    img.src = url;
  });
  return result;
}

async function readTimedMediaMetadata(file: File, mediaKind: "video" | "audio"): Promise<{ width?: number; height?: number; durationSec?: number }> {
  const result: { width?: number; height?: number; durationSec?: number } = {};
  await new Promise<void>((resolve) => {
    const url = URL.createObjectURL(file);
    const element = document.createElement(mediaKind);
    element.preload = "metadata";
    const finish = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    element.onloadedmetadata = () => {
      result.durationSec = Number.isFinite(element.duration) ? element.duration : undefined;
      if (mediaKind === "video") {
        const video = element as HTMLVideoElement;
        result.width = video.videoWidth || undefined;
        result.height = video.videoHeight || undefined;
      }
      finish();
    };
    element.onerror = finish;
    element.src = url;
    element.load();
  });
  return result;
}

export async function readClientMediaFileMetadata(file: File): Promise<{
  mediaKind: SupportedMediaKind;
  mimeType: string;
  width?: number;
  height?: number;
  durationSec?: number;
}> {
  const mediaKind = inferUploadMediaKind(file) || "image";
  const mimeType = file.type || "application/octet-stream";
  if (mediaKind === "image") {
    const dimensions = await readImageDimensions(file);
    return { mediaKind, mimeType, ...dimensions };
  }
  const timed = await readTimedMediaMetadata(file, mediaKind);
  return { mediaKind, mimeType, ...timed };
}

function buildClientMediaMetadata(
  file: File,
  meta: { mediaKind: SupportedMediaKind; width?: number; height?: number; durationSec?: number; mimeType: string },
) {
  return JSON.stringify({
    mediaKind: meta.mediaKind,
    mimeType: meta.mimeType,
    width: meta.width,
    height: meta.height,
    durationSec: meta.durationSec,
    fileSizeBytes: Number.isFinite(file.size) ? file.size : undefined,
    originalFileName: file.name || undefined,
  });
}

async function assertOk(res: Response, fallbackMessage: string) {
  if (res.ok) return;
  const body = await res.json().catch(() => null);
  const message = body?.message || body?.error || fallbackMessage;
  throw new Error(String(message));
}

async function uploadToPerson(input: {
  context: MediaAttachContext;
  personId: string;
  file: File;
  title: string;
  description: string;
  date: string;
  attributeType: "photo" | "video" | "audio" | "media";
  captureSource?: string;
}) {
  const contract = buildPersonUploadContractFields({
    label: input.title,
    description: input.description,
    photoDate: input.date,
    attributeType: input.attributeType,
    isHeadshot: false,
  });
  const mediaMeta = await readClientMediaFileMetadata(input.file);
  const form = new FormData();
  form.append("file", input.file);
  form.append("label", contract.label);
  form.append("description", contract.description);
  form.append("photoDate", contract.photoDate);
  form.append("isHeadshot", contract.isHeadshot);
  form.append("attributeType", contract.attributeType);
  const shareDefaults = mediaTabShareDefaults(input.context);
  form.append("shareScope", shareDefaults.shareScope);
  form.append("shareFamilyGroupKey", shareDefaults.shareFamilyGroupKey);
  if (input.context.attributeId?.trim()) {
    form.append("attributeId", input.context.attributeId.trim());
  }
  if (typeof mediaMeta.width === "number") form.append("mediaWidth", String(Math.round(mediaMeta.width)));
  if (typeof mediaMeta.height === "number") form.append("mediaHeight", String(Math.round(mediaMeta.height)));
  if (typeof mediaMeta.durationSec === "number") form.append("mediaDurationSec", String(mediaMeta.durationSec));
  if (input.captureSource) form.append("captureSource", input.captureSource);
  if (input.file.lastModified) form.append("fileCreatedAt", new Date(input.file.lastModified).toISOString());
  const res = await fetch(
    `/api/t/${encodeURIComponent(input.context.tenantKey)}/people/${encodeURIComponent(input.personId)}/photos/upload`,
    { method: "POST", body: form },
  );
  await assertOk(res, "Failed to upload media to person");
  const body = (await res.json().catch(() => null)) as { fileId?: string } | null;
  const fileId = String(body?.fileId ?? "").trim();
  if (!fileId) {
    throw new Error("Upload completed but no file ID was returned.");
  }
  return { fileId, mediaMetadata: buildClientMediaMetadata(input.file, mediaMeta) };
}

async function uploadToHousehold(input: {
  context: MediaAttachContext;
  householdId: string;
  file: File;
  title: string;
  description: string;
  date: string;
  captureSource?: string;
}) {
  const contract = buildHouseholdUploadContractFields({
    name: input.title,
    description: input.description,
    photoDate: input.date,
    isPrimary: false,
  });
  const mediaMeta = await readClientMediaFileMetadata(input.file);
  const form = new FormData();
  form.append("file", input.file);
  form.append("name", contract.name);
  form.append("description", contract.description);
  form.append("photoDate", contract.photoDate);
  form.append("isPrimary", contract.isPrimary);
  if (input.context.attributeId?.trim()) {
    form.append("attributeId", input.context.attributeId.trim());
  }
  if (typeof mediaMeta.width === "number") form.append("mediaWidth", String(Math.round(mediaMeta.width)));
  if (typeof mediaMeta.height === "number") form.append("mediaHeight", String(Math.round(mediaMeta.height)));
  if (typeof mediaMeta.durationSec === "number") form.append("mediaDurationSec", String(mediaMeta.durationSec));
  if (input.captureSource) form.append("captureSource", input.captureSource);
  if (input.file.lastModified) form.append("fileCreatedAt", new Date(input.file.lastModified).toISOString());
  const res = await fetch(
    `/api/t/${encodeURIComponent(input.context.tenantKey)}/households/${encodeURIComponent(input.householdId)}/photos/upload`,
    { method: "POST", body: form },
  );
  await assertOk(res, "Failed to upload media to household");
  const body = (await res.json().catch(() => null)) as { fileId?: string } | null;
  const fileId = String(body?.fileId ?? "").trim();
  if (!fileId) {
    throw new Error("Upload completed but no file ID was returned.");
  }
  return { fileId, mediaMetadata: buildClientMediaMetadata(input.file, mediaMeta) };
}

async function linkToPerson(input: {
  context: MediaAttachContext;
  personId: string;
  fileId: string;
  mediaMetadata: string;
  title: string;
  description: string;
  date: string;
  attributeType: "photo" | "video" | "audio" | "media";
}) {
  const payload = buildPersonAttributeLinkPayload({
    attributeType: input.attributeType,
    valueText: input.fileId,
    valueJson: input.mediaMetadata,
    label: input.title,
    notes: input.description,
    startDate: input.date,
    ...mediaTabShareDefaults(input.context),
  });
  const res = await fetch(
    `/api/t/${encodeURIComponent(input.context.tenantKey)}/people/${encodeURIComponent(input.personId)}/attributes`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  await assertOk(res, `Failed to link media to person ${input.personId}`);
}

async function linkToHousehold(input: {
  context: MediaAttachContext;
  householdId: string;
  fileId: string;
  mediaMetadata: string;
  title: string;
  description: string;
  date: string;
}) {
  const payload = buildHouseholdLinkPayload({
    fileId: input.fileId,
    name: input.title,
    description: input.description,
    photoDate: input.date,
    mediaMetadata: input.mediaMetadata,
  });
  const res = await fetch(
    `/api/t/${encodeURIComponent(input.context.tenantKey)}/households/${encodeURIComponent(input.householdId)}/photos/link`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  await assertOk(res, `Failed to link media to household ${input.householdId}`);
  const body = (await res.json().catch(() => null)) as { existing?: boolean } | null;
  return { existing: Boolean(body?.existing) };
}

async function loadAssociationsByFileId(tenantKey: string, fileId: string): Promise<AssociationSnapshot> {
  const res = await fetch(
    `/api/t/${encodeURIComponent(tenantKey)}/photos/search?q=${encodeURIComponent(fileId)}&limit=200&includeDrive=1`,
    { cache: "no-store" },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    return { personIds: new Set<string>(), householdIds: new Set<string>() };
  }
  const items = Array.isArray(body?.items) ? (body.items as MediaAttachLibraryItem[]) : [];
  const item = items.find((entry) => entry.fileId === fileId);
  return {
    personIds: new Set((item?.people ?? []).map((person) => person.personId)),
    householdIds: new Set((item?.households ?? []).map((household) => household.householdId)),
  };
}

async function unlinkDuplicateFromPerson(tenantKey: string, personId: string, duplicateFileId: string) {
  const attrsRes = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/attributes?entity_type=person&entity_id=${encodeURIComponent(personId)}`, {
    cache: "no-store",
  });
  await assertOk(attrsRes, `Failed to load person attributes for duplicate replace (${personId})`);
  const attrsBody = await attrsRes.json().catch(() => null);
  const attrs = Array.isArray(attrsBody?.attributes) ? (attrsBody.attributes as AttributeWithMedia[]) : [];
  const matches = attrs.filter((item) => matchesCanonicalMediaFileId(item, duplicateFileId));
  for (const match of matches) {
    const delRes = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(personId)}/attributes/${encodeURIComponent(match.attributeId)}`,
      { method: "DELETE" },
    );
    await assertOk(delRes, `Failed to remove duplicate person link (${personId})`);
  }
}

async function unlinkDuplicateFromHousehold(tenantKey: string, householdId: string, duplicateFileId: string) {
  const res = await fetch(
    `/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(householdId)}/photos/${encodeURIComponent(duplicateFileId)}`,
    { method: "DELETE" },
  );
  await assertOk(res, `Failed to remove duplicate household link (${householdId})`);
}

function applySharedAndContextDefaults(
  context: MediaAttachContext,
  item: MediaAttachDraftItem,
  shared: MediaAttachSharedMetadata,
) {
  const shouldApplyShared = shared.sameMemorySet;
  const title = (shouldApplyShared ? shared.title : item.title).trim() || context.defaultLabel?.trim() || "media";
  const description = (shouldApplyShared ? shared.description : item.description).trim() || context.defaultDescription?.trim() || "";
  const date = (shouldApplyShared ? shared.date : item.date).trim() || context.defaultDate?.trim() || "";
  return { title, description, date };
}

export async function searchMediaLibrary(input: {
  tenantKey: string;
  query: string;
  limit?: number;
}): Promise<MediaAttachLibraryItem[]> {
  const query = input.query.trim();
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(5000, Math.trunc(input.limit ?? 100))) : 100;
  const res = await fetch(
    `/api/t/${encodeURIComponent(input.tenantKey)}/photos/search?q=${encodeURIComponent(query)}&limit=${limit}&includeDrive=1`,
    { cache: "no-store" },
  );
  await assertOk(res, "Failed to search media library");
  const body = (await res.json().catch(() => null)) as { items?: MediaAttachLibraryItem[] } | null;
  const items = Array.isArray(body?.items) ? body.items : [];
  return items;
}

export function toMediaPreviewSrc(tenantKey: string, fileId: string) {
  return getPhotoProxyPath(fileId, tenantKey);
}

export async function runMediaAttachPlan(input: RunPlanInput): Promise<MediaAttachExecutionSummary> {
  const summary: MediaAttachExecutionSummary = {
    createdLinks: 0,
    createdAttributes: 0,
    skipped: 0,
    failures: [],
  };
  const total = input.items.length;
  const associationCache = new Map<string, AssociationSnapshot>();
  input.items.forEach((item) => input.onItemStatus?.(item.clientId, "pending"));

  for (let idx = 0; idx < input.items.length; idx += 1) {
    const item = input.items[idx];
    if (item.skipImport) {
      summary.skipped += 1;
      input.onItemStatus?.(item.clientId, "skipped", "Skipped by user.");
      continue;
    }
    const { title, description, date } = applySharedAndContextDefaults(input.context, item, input.shared);
    const personIds = Array.from(new Set(item.personIds.map((value) => value.trim()).filter(Boolean)));
    const householdIds = Array.from(new Set(item.householdIds.map((value) => value.trim()).filter(Boolean)));
    const attributeType = item.attributeType ?? input.context.defaultAttributeType ?? "media";

    input.onProgress?.(`Saving ${idx + 1} of ${total}`, idx, total);
    input.onItemStatus?.(item.clientId, "working", `Saving item ${idx + 1} of ${total}`);

    try {
      let fileId = item.fileId?.trim() ?? "";
      let mediaMetadata = item.existingMediaMetadata?.trim() ?? "";
      let uploadedViaPersonId = "";
      let uploadedViaHouseholdId = "";
      let uploadedViaPerson = false;
      let uploadedViaHousehold = false;

      if (item.duplicateOfFileId && item.duplicateDecision === "duplicate") {
        fileId = item.duplicateOfFileId.trim();
      } else if (
        item.duplicateOfFileId &&
        (item.duplicateDecision === "not_duplicate" || item.duplicateDecision === "replace_existing")
      ) {
        fileId = "";
      }

      if (!fileId) {
        if (!item.file) {
          summary.failures.push({ clientId: item.clientId, message: "No file selected for upload.", targetType: "upload" });
          input.onItemStatus?.(item.clientId, "failed", "No file selected for upload.");
          continue;
        }
        const uploadMediaKind = inferUploadMediaKind(item.file);
        if (!uploadMediaKind) {
          summary.failures.push({ clientId: item.clientId, message: "Unsupported media type. Use image, video, or audio files.", targetType: "upload" });
          input.onItemStatus?.(item.clientId, "failed", "Unsupported media type.");
          continue;
        }
        const captureSource = item.source === "camera_capture" ? "camera" : item.source === "device_upload" ? "device_upload" : "";
        if (personIds.length > 0) {
          uploadedViaPersonId = personIds[0];
          uploadedViaPerson = true;
          const uploaded = await uploadToPerson({
            context: input.context,
            personId: uploadedViaPersonId,
            file: item.file,
            title,
            description,
            date,
            attributeType,
            captureSource,
          });
          fileId = uploaded.fileId;
          mediaMetadata = uploaded.mediaMetadata;
          summary.createdAttributes += 1;
          input.onItemStatus?.(item.clientId, "uploaded", "Uploaded via person target.");
        } else if (householdIds.length > 0 && input.context.allowHouseholdLinks) {
          uploadedViaHouseholdId = householdIds[0];
          uploadedViaHousehold = true;
          const uploaded = await uploadToHousehold({
            context: input.context,
            householdId: uploadedViaHouseholdId,
            file: item.file,
            title,
            description,
            date,
            captureSource,
          });
          fileId = uploaded.fileId;
          mediaMetadata = uploaded.mediaMetadata;
          summary.createdLinks += 1;
          input.onItemStatus?.(item.clientId, "uploaded", "Uploaded via household target.");
        } else {
          summary.failures.push({
            clientId: item.clientId,
            message: "No attachment target selected. Add at least one person or household.",
            targetType: "upload",
          });
          input.onItemStatus?.(item.clientId, "failed", "No attachment target selected.");
          continue;
        }
      }

      if (item.duplicateOfFileId && item.duplicateDecision === "replace_existing") {
        const duplicateFileId = item.duplicateOfFileId.trim();
        if (duplicateFileId && duplicateFileId !== fileId) {
          for (const personId of personIds) {
            try {
              await unlinkDuplicateFromPerson(input.context.tenantKey, personId, duplicateFileId);
            } catch (error) {
              summary.failures.push({
                clientId: item.clientId,
                message: error instanceof Error ? error.message : "Failed to replace duplicate person link.",
                targetType: "person",
                targetId: personId,
              });
            }
          }
          if (input.context.allowHouseholdLinks) {
            for (const householdId of householdIds) {
              try {
                await unlinkDuplicateFromHousehold(input.context.tenantKey, householdId, duplicateFileId);
              } catch (error) {
                summary.failures.push({
                  clientId: item.clientId,
                  message: error instanceof Error ? error.message : "Failed to replace duplicate household link.",
                  targetType: "household",
                  targetId: householdId,
                });
              }
            }
          }
        }
      }

      const pendingPersonLinks = personIds.filter((personId) => personId && (!uploadedViaPerson || personId !== uploadedViaPersonId));
      const pendingHouseholdLinks = input.context.allowHouseholdLinks
        ? householdIds.filter((householdId) => householdId && (!uploadedViaHousehold || householdId !== uploadedViaHouseholdId))
        : [];

      let associations: AssociationSnapshot = { personIds: new Set<string>(), householdIds: new Set<string>() };
      if (pendingPersonLinks.length > 0 || pendingHouseholdLinks.length > 0) {
        if (!associationCache.has(fileId)) {
          associationCache.set(fileId, await loadAssociationsByFileId(input.context.tenantKey, fileId));
        }
        associations = associationCache.get(fileId)!;
      }

      for (const personId of pendingPersonLinks) {
        if (personId === uploadedViaPersonId) continue;
        if (associations.personIds.has(personId)) {
          summary.skipped += 1;
          continue;
        }
        try {
          await linkToPerson({
            context: input.context,
            personId,
            fileId,
            mediaMetadata,
            title,
            description,
            date,
            attributeType,
          });
          associations.personIds.add(personId);
          summary.createdAttributes += 1;
        } catch (error) {
          summary.failures.push({
            clientId: item.clientId,
            message: error instanceof Error ? error.message : "Failed to link person.",
            targetType: "person",
            targetId: personId,
          });
        }
      }

      if (input.context.allowHouseholdLinks) {
        for (const householdId of pendingHouseholdLinks) {
          if (householdId === uploadedViaHouseholdId) continue;
          if (associations.householdIds.has(householdId)) {
            summary.skipped += 1;
            continue;
          }
          try {
            const linked = await linkToHousehold({
              context: input.context,
              householdId,
              fileId,
              mediaMetadata,
              title,
              description,
              date,
            });
            if (linked.existing) {
              summary.skipped += 1;
            } else {
              summary.createdLinks += 1;
              associations.householdIds.add(householdId);
            }
          } catch (error) {
            summary.failures.push({
              clientId: item.clientId,
              message: error instanceof Error ? error.message : "Failed to link household.",
              targetType: "household",
              targetId: householdId,
            });
          }
        }
      }
      input.onItemStatus?.(item.clientId, "linked", "Completed.");
    } catch (error) {
      summary.failures.push({
        clientId: item.clientId,
        message: error instanceof Error ? error.message : "Unexpected media attach failure.",
        targetType: "upload",
      });
      input.onItemStatus?.(
        item.clientId,
        "failed",
        error instanceof Error ? error.message : "Unexpected media attach failure.",
      );
    }
  }

  input.onProgress?.("Save complete", total, total);
  return summary;
}
