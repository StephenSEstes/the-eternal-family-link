import { getPhotoProxyPath } from "@/lib/google/photo-path";
import {
  type HouseholdLinkInput,
  type HouseholdUploadContractInput,
  type PersonAttributeLinkInput,
  type PersonUploadContractInput,
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
  previewUrl?: string;
  existingMediaMetadata?: string;
  title: string;
  description: string;
  date: string;
  notes: string;
  personIds: string[];
  householdIds: string[];
  attributeType?: "photo" | "media";
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
};

function norm(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function inferImageByMetadataOrFileId(fileId: string, mediaMetadata?: string) {
  const raw = (mediaMetadata ?? "").trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { mediaKind?: string; mimeType?: string };
      const mediaKind = norm(parsed.mediaKind);
      if (mediaKind) return mediaKind === "image";
      const mimeType = norm(parsed.mimeType);
      if (mimeType) return mimeType.startsWith("image/");
    } catch {
      // Ignore malformed metadata.
    }
  }
  const lower = fileId.toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|bmp|heic|heif)$/.test(lower)) return true;
  if (/\.(mp4|mov|webm|mp3|m4a|wav|ogg)$/.test(lower)) return false;
  return true;
}

export async function readImageFileMetadata(file: File): Promise<{ width?: number; height?: number; mimeType: string }> {
  const result: { width?: number; height?: number; mimeType: string } = {
    mimeType: file.type || "application/octet-stream",
  };
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

function buildClientImageMetadata(file: File, meta: { width?: number; height?: number; mimeType: string }) {
  return JSON.stringify({
    mediaKind: "image",
    mimeType: meta.mimeType,
    width: meta.width,
    height: meta.height,
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
  attributeType: "photo" | "media";
}) {
  const contract = buildPersonUploadContractFields({
    label: input.title,
    description: input.description,
    photoDate: input.date,
    attributeType: input.attributeType,
    isHeadshot: false,
  });
  const mediaMeta = await readImageFileMetadata(input.file);
  const form = new FormData();
  form.append("file", input.file);
  form.append("label", contract.label);
  form.append("description", contract.description);
  form.append("photoDate", contract.photoDate);
  form.append("isHeadshot", contract.isHeadshot);
  form.append("attributeType", contract.attributeType);
  if (typeof mediaMeta.width === "number") form.append("mediaWidth", String(Math.round(mediaMeta.width)));
  if (typeof mediaMeta.height === "number") form.append("mediaHeight", String(Math.round(mediaMeta.height)));
  if (input.file.lastModified) form.append("fileCreatedAt", new Date(input.file.lastModified).toISOString());
  const res = await fetch(
    `/api/t/${encodeURIComponent(input.context.tenantKey)}/people/${encodeURIComponent(input.personId)}/photos/upload`,
    { method: "POST", body: form },
  );
  await assertOk(res, "Failed to upload image to person");
  const body = (await res.json().catch(() => null)) as { fileId?: string } | null;
  const fileId = String(body?.fileId ?? "").trim();
  if (!fileId) {
    throw new Error("Upload completed but no file ID was returned.");
  }
  return { fileId, mediaMetadata: buildClientImageMetadata(input.file, mediaMeta) };
}

async function uploadToHousehold(input: {
  context: MediaAttachContext;
  householdId: string;
  file: File;
  title: string;
  description: string;
  date: string;
}) {
  const contract = buildHouseholdUploadContractFields({
    name: input.title,
    description: input.description,
    photoDate: input.date,
    isPrimary: false,
  });
  const mediaMeta = await readImageFileMetadata(input.file);
  const form = new FormData();
  form.append("file", input.file);
  form.append("name", contract.name);
  form.append("description", contract.description);
  form.append("photoDate", contract.photoDate);
  form.append("isPrimary", contract.isPrimary);
  if (typeof mediaMeta.width === "number") form.append("mediaWidth", String(Math.round(mediaMeta.width)));
  if (typeof mediaMeta.height === "number") form.append("mediaHeight", String(Math.round(mediaMeta.height)));
  if (input.file.lastModified) form.append("fileCreatedAt", new Date(input.file.lastModified).toISOString());
  const res = await fetch(
    `/api/t/${encodeURIComponent(input.context.tenantKey)}/households/${encodeURIComponent(input.householdId)}/photos/upload`,
    { method: "POST", body: form },
  );
  await assertOk(res, "Failed to upload image to household");
  const body = (await res.json().catch(() => null)) as { fileId?: string } | null;
  const fileId = String(body?.fileId ?? "").trim();
  if (!fileId) {
    throw new Error("Upload completed but no file ID was returned.");
  }
  return { fileId, mediaMetadata: buildClientImageMetadata(input.file, mediaMeta) };
}

async function linkToPerson(input: {
  context: MediaAttachContext;
  personId: string;
  fileId: string;
  mediaMetadata: string;
  title: string;
  description: string;
  date: string;
  attributeType: "photo" | "media";
}) {
  const payload = buildPersonAttributeLinkPayload({
    attributeType: input.attributeType,
    valueText: input.fileId,
    valueJson: input.mediaMetadata,
    label: input.title,
    notes: input.description,
    startDate: input.date,
  });
  const res = await fetch(
    `/api/t/${encodeURIComponent(input.context.tenantKey)}/people/${encodeURIComponent(input.personId)}/attributes`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  await assertOk(res, `Failed to link image to person ${input.personId}`);
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
  await assertOk(res, `Failed to link image to household ${input.householdId}`);
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

function applySharedAndContextDefaults(
  context: MediaAttachContext,
  item: MediaAttachDraftItem,
  shared: MediaAttachSharedMetadata,
) {
  const shouldApplyShared = shared.sameMemorySet;
  const title = (shouldApplyShared ? shared.title : item.title).trim() || context.defaultLabel?.trim() || "photo";
  const description = (shouldApplyShared ? shared.description : item.description).trim() || context.defaultDescription?.trim() || "";
  const date = (shouldApplyShared ? shared.date : item.date).trim() || context.defaultDate?.trim() || "";
  return { title, description, date };
}

export async function searchImageLibrary(input: {
  tenantKey: string;
  query: string;
  limit?: number;
}): Promise<MediaAttachLibraryItem[]> {
  const query = input.query.trim();
  if (!query) return [];
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(5000, Math.trunc(input.limit ?? 100))) : 100;
  const res = await fetch(
    `/api/t/${encodeURIComponent(input.tenantKey)}/photos/search?q=${encodeURIComponent(query)}&limit=${limit}&includeDrive=1`,
    { cache: "no-store" },
  );
  await assertOk(res, "Failed to search image library");
  const body = (await res.json().catch(() => null)) as { items?: MediaAttachLibraryItem[] } | null;
  const items = Array.isArray(body?.items) ? body.items : [];
  return items.filter((item) => inferImageByMetadataOrFileId(item.fileId, item.mediaMetadata));
}

export function toImagePreviewSrc(tenantKey: string, fileId: string) {
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

  for (let idx = 0; idx < input.items.length; idx += 1) {
    const item = input.items[idx];
    const { title, description, date } = applySharedAndContextDefaults(input.context, item, input.shared);
    const personIds = Array.from(new Set(item.personIds.map((value) => value.trim()).filter(Boolean)));
    const householdIds = Array.from(new Set(item.householdIds.map((value) => value.trim()).filter(Boolean)));
    const attributeType = item.attributeType ?? input.context.defaultAttributeType ?? "media";

    input.onProgress?.(`Saving ${idx + 1} of ${total}`, idx, total);

    try {
      let fileId = item.fileId?.trim() ?? "";
      let mediaMetadata = item.existingMediaMetadata?.trim() ?? "";
      let uploadedViaPersonId = "";
      let uploadedViaHouseholdId = "";

      if (!fileId) {
        if (!item.file) {
          summary.failures.push({ clientId: item.clientId, message: "No file selected for upload.", targetType: "upload" });
          continue;
        }
        if (!item.file.type.startsWith("image/")) {
          summary.failures.push({ clientId: item.clientId, message: "Only image uploads are supported in MVP.", targetType: "upload" });
          continue;
        }
        if (personIds.length > 0) {
          uploadedViaPersonId = personIds[0];
          const uploaded = await uploadToPerson({
            context: input.context,
            personId: uploadedViaPersonId,
            file: item.file,
            title,
            description,
            date,
            attributeType,
          });
          fileId = uploaded.fileId;
          mediaMetadata = uploaded.mediaMetadata;
          summary.createdAttributes += 1;
        } else if (householdIds.length > 0 && input.context.allowHouseholdLinks) {
          uploadedViaHouseholdId = householdIds[0];
          const uploaded = await uploadToHousehold({
            context: input.context,
            householdId: uploadedViaHouseholdId,
            file: item.file,
            title,
            description,
            date,
          });
          fileId = uploaded.fileId;
          mediaMetadata = uploaded.mediaMetadata;
          summary.createdLinks += 1;
        } else {
          summary.failures.push({
            clientId: item.clientId,
            message: "No attachment target selected. Add at least one person or household.",
            targetType: "upload",
          });
          continue;
        }
      }

      if (!associationCache.has(fileId)) {
        associationCache.set(fileId, await loadAssociationsByFileId(input.context.tenantKey, fileId));
      }
      const associations = associationCache.get(fileId)!;

      for (const personId of personIds) {
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
        for (const householdId of householdIds) {
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
    } catch (error) {
      summary.failures.push({
        clientId: item.clientId,
        message: error instanceof Error ? error.message : "Unexpected media attach failure.",
        targetType: "upload",
      });
    }
  }

  input.onProgress?.("Save complete", total, total);
  return summary;
}
