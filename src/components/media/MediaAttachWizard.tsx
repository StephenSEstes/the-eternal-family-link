"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type MediaAttachContext,
  type MediaAttachDraftItem,
  type MediaAttachExecutionSummary,
  type MediaAttachHouseholdOption,
  type MediaAttachLibraryItem,
  type MediaAttachPersonOption,
  inferMediaKindByMetadataOrFileId,
  runMediaAttachPlan,
  searchMediaLibrary,
  toMediaPreviewSrc,
} from "@/lib/media/attach-orchestrator";
import { inferMediaKindFromMimeTypeOrFileName, type SupportedMediaKind } from "@/lib/media/upload";

type WizardStep = "source" | "select" | "grouping" | "shared" | "per_item" | "review";
type SourceChoice = "device_upload" | "camera_capture" | "library_existing";
type DisplayMediaKind = SupportedMediaKind;
type LinkedSearchResult =
  | { kind: "person"; key: string; displayName: string; personId: string; gender: "male" | "female" | "unspecified" }
  | { kind: "household"; key: string; displayName: string; householdId: string };

function makeClientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `media-item-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function fileKey(file: File) {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function formatSummary(summary: MediaAttachExecutionSummary) {
  const failureCount = summary.failures.length;
  return [
    `createdLinks=${summary.createdLinks}`,
    `createdAttributes=${summary.createdAttributes}`,
    `skipped=${summary.skipped}`,
    `failures=${failureCount}`,
  ].join(" | ");
}

function PhotoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <path d="M5 7h3l1.3-2h5.4L16 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.18" />
      <path d="M5 7h3l1.3-2h5.4L16 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm7 9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.2-1.8h5.6L16 6h1.5A2.5 2.5 0 0 1 20 8.5v7A2.5 2.5 0 0 1 17.5 18h-11A2.5 2.5 0 0 1 4 15.5z" fill="currentColor" opacity="0.18" />
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.2-1.8h5.6L16 6h1.5A2.5 2.5 0 0 1 20 8.5v7A2.5 2.5 0 0 1 17.5 18h-11A2.5 2.5 0 0 1 4 15.5zm8 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v11A2.5 2.5 0 0 1 16.5 20h-9A2.5 2.5 0 0 1 5 17.5z" fill="currentColor" opacity="0.18" />
      <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v11A2.5 2.5 0 0 1 16.5 20h-9A2.5 2.5 0 0 1 5 17.5zm3.5 3.5h7m-7 3h7m-7 3h4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UploadArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M12 4v11m0-11 4 4m-4-4-4 4M5 18.5h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.18" />
      <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2zm7 1.2V8h3.3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8.5 12.2h7M8.5 15h7M8.5 17.8h4.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function inferDraftMediaKind(item: Pick<MediaAttachDraftItem, "mediaKind" | "file" | "fileId" | "existingMediaMetadata">): DisplayMediaKind {
  if (item.mediaKind) {
    return item.mediaKind;
  }
  if (item.file?.type?.startsWith("video/")) return "video";
  if (item.file?.type?.startsWith("audio/")) return "audio";
  if (item.file?.type?.startsWith("image/")) return "image";
  return inferMediaKindByMetadataOrFileId(item.fileId ?? "", item.existingMediaMetadata);
}

function mediaLabel(kind: DisplayMediaKind) {
  if (kind === "video") return "video";
  if (kind === "audio") return "audio";
  if (kind === "document") return "document";
  return "photo";
}

function validateDraftItem(context: MediaAttachContext, item: MediaAttachDraftItem) {
  const errors: string[] = [];
  if (item.skipImport) return errors;
  if (
    context.source !== "attribute" &&
    item.duplicateOfFileId &&
    item.duplicateDecision !== "duplicate" &&
    item.duplicateDecision !== "not_duplicate" &&
    item.duplicateDecision !== "replace_existing"
  ) {
    errors.push("Choose Duplicate or Not Duplicate.");
  }
  if (!item.fileId && !item.file) {
    errors.push("Missing file source for this item.");
  }
  if (item.personIds.length === 0 && item.householdIds.length === 0) {
    errors.push("Add at least one person or household.");
  }
  return errors;
}

export function MediaAttachWizard({
  open,
  context,
  onClose,
  onComplete,
}: {
  open: boolean;
  context: MediaAttachContext;
  onClose: () => void;
  onComplete: (summary: MediaAttachExecutionSummary) => void;
}) {
  const peopleOptions = useMemo(() => context.peopleOptions ?? [], [context.peopleOptions]);
  const householdOptions = useMemo(() => context.householdOptions ?? [], [context.householdOptions]);
  const [step, setStep] = useState<WizardStep>("source");
  const [sourceChoice, setSourceChoice] = useState<SourceChoice>("device_upload");
  const [items, setItems] = useState<MediaAttachDraftItem[]>([]);
  const [sameMemorySet, setSameMemorySet] = useState<boolean | null>(null);
  const [sharedTitle, setSharedTitle] = useState(context.defaultLabel ?? "");
  const [sharedDescription, setSharedDescription] = useState(context.defaultDescription ?? "");
  const [sharedDate, setSharedDate] = useState(context.defaultDate ?? "");
  const [sharedNotes, setSharedNotes] = useState("");
  const [sharedPersonIds, setSharedPersonIds] = useState<string[]>(context.preselectedPersonIds ?? []);
  const [sharedHouseholdIds, setSharedHouseholdIds] = useState<string[]>(context.preselectedHouseholdIds ?? []);
  const [sharedTagQuery, setSharedTagQuery] = useState("");
  const [perItemIndex, setPerItemIndex] = useState(0);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [itemProgress, setItemProgress] = useState<
    Record<string, { status: "pending" | "working" | "uploaded" | "linked" | "skipped" | "failed"; message: string }>
  >({});
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryResults, setLibraryResults] = useState<MediaAttachLibraryItem[]>([]);
  const [librarySelectedFileIds, setLibrarySelectedFileIds] = useState<string[]>([]);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [duplicateScanBusy, setDuplicateScanBusy] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const previewUrlsRef = useRef<Set<string>>(new Set());
  const duplicateCatalogRef = useRef<Map<string, MediaAttachLibraryItem> | null>(null);
  const fileHashCacheRef = useRef<Map<string, string>>(new Map());
  const devicePickerRef = useRef<HTMLInputElement | null>(null);
  const cameraPickerRef = useRef<HTMLInputElement | null>(null);

  const selectedItem = items[perItemIndex] ?? null;
  const availableSources: SourceChoice[] =
    context.source === "attribute"
      ? ["device_upload", "camera_capture"]
      : ["device_upload", "camera_capture", "library_existing"];
  const tagSearchResults = useMemo(() => {
    const query = tagQuery.trim().toLowerCase();
    if (!query || !selectedItem) return [] as LinkedSearchResult[];
    const selectedPeopleSet = new Set(selectedItem.personIds);
    const selectedHouseholdsSet = new Set(selectedItem.householdIds);
    const personResults: LinkedSearchResult[] = peopleOptions
      .filter((item) => item.displayName.toLowerCase().includes(query) && !selectedPeopleSet.has(item.personId))
      .map((item) => ({
        kind: "person",
        key: `person-${item.personId}`,
        displayName: item.displayName,
        personId: item.personId,
        gender: item.gender ?? "unspecified",
      }));
    const householdResults: LinkedSearchResult[] = context.allowHouseholdLinks
      ? householdOptions
          .filter((item) => item.label.toLowerCase().includes(query) && !selectedHouseholdsSet.has(item.householdId))
          .map((item) => ({
            kind: "household",
            key: `household-${item.householdId}`,
            displayName: item.label,
            householdId: item.householdId,
          }))
      : [];
    return [...personResults, ...householdResults].slice(0, 15);
  }, [context.allowHouseholdLinks, householdOptions, peopleOptions, selectedItem, tagQuery]);
  const sharedTagSearchResults = useMemo(() => {
    const query = sharedTagQuery.trim().toLowerCase();
    if (!query) return [] as LinkedSearchResult[];
    const selectedPeopleSet = new Set(sharedPersonIds);
    const selectedHouseholdsSet = new Set(sharedHouseholdIds);
    const personResults: LinkedSearchResult[] = peopleOptions
      .filter((item) => item.displayName.toLowerCase().includes(query) && !selectedPeopleSet.has(item.personId))
      .map((item) => ({
        kind: "person",
        key: `shared-person-${item.personId}`,
        displayName: item.displayName,
        personId: item.personId,
        gender: item.gender ?? "unspecified",
      }));
    const householdResults: LinkedSearchResult[] = context.allowHouseholdLinks
      ? householdOptions
          .filter((item) => item.label.toLowerCase().includes(query) && !selectedHouseholdsSet.has(item.householdId))
          .map((item) => ({
            kind: "household",
            key: `shared-household-${item.householdId}`,
            displayName: item.label,
            householdId: item.householdId,
          }))
      : [];
    return [...personResults, ...householdResults].slice(0, 15);
  }, [context.allowHouseholdLinks, householdOptions, peopleOptions, sharedHouseholdIds, sharedPersonIds, sharedTagQuery]);

  useEffect(() => {
    if (!open) return;
    setStep("source");
    setSourceChoice("device_upload");
    setItems([]);
    setSameMemorySet(null);
    setSharedTitle(context.defaultLabel ?? "");
    setSharedDescription(context.defaultDescription ?? "");
    setSharedDate(context.defaultDate ?? "");
    setSharedNotes("");
    setSharedPersonIds(context.preselectedPersonIds ?? []);
    setSharedHouseholdIds(context.preselectedHouseholdIds ?? []);
    setSharedTagQuery("");
    setPerItemIndex(0);
    setStatus("");
    setBusy(false);
    setProgressMessage("");
    setLibraryQuery("");
    setLibraryResults([]);
    setLibrarySelectedFileIds([]);
    setLibraryBusy(false);
    setDuplicateScanBusy(false);
    setTagQuery("");
    setItemProgress({});
    duplicateCatalogRef.current = null;
    fileHashCacheRef.current.clear();
  }, [context.defaultDate, context.defaultDescription, context.defaultLabel, open]);

  useEffect(() => {
    for (const item of items) {
      if (item.previewUrl?.startsWith("blob:")) {
        previewUrlsRef.current.add(item.previewUrl);
      }
    }
  }, [items]);

  useEffect(() => {
    return () => {
      const urls = previewUrlsRef.current;
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
      urls.clear();
    };
  }, []);

  if (!open) return null;

  const openSourcePicker = (choice: SourceChoice) => {
    setSourceChoice(choice);
    setStatus("");
    setStep("select");
  };

  const triggerDevicePicker = () => devicePickerRef.current?.click();
  const triggerCameraPicker = () => cameraPickerRef.current?.click();

  const renderMediaPreview = (
    kind: DisplayMediaKind,
    src: string,
    alt: string,
    options?: { maxHeight?: string; cover?: boolean; compact?: boolean },
  ) => {
    const maxHeight = options?.maxHeight ?? "220px";
    const cover = options?.cover ?? false;
    if (options?.compact && kind !== "image") {
      return (
        <div style={{ display: "grid", placeItems: "center", minHeight: "72px", borderRadius: "10px", background: "#f3f4f6", color: "#334155", fontSize: "0.8rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {kind === "document" ? <DocumentIcon /> : kind}
        </div>
      );
    }
    if (kind === "video") {
      return <video src={src} controls playsInline muted={options?.compact} style={{ width: "100%", maxHeight, borderRadius: "10px", objectFit: cover ? "cover" : "contain", background: "#f3f4f6" }} />;
    }
    if (kind === "audio") {
      return (
        <div style={{ display: "grid", gap: "0.5rem", padding: "0.9rem", borderRadius: "10px", background: "#f3f4f6", minHeight: options?.compact ? "72px" : "120px", alignContent: "center" }}>
          <strong style={{ fontSize: options?.compact ? "0.85rem" : "0.95rem" }}>Audio Preview</strong>
          <audio src={src} controls style={{ width: "100%" }} />
        </div>
      );
    }
    if (kind === "document") {
      return (
        <div style={{ display: "grid", gap: "0.45rem", padding: options?.compact ? "0.9rem" : "1rem", borderRadius: "10px", background: "#f3f4f6", minHeight: options?.compact ? "72px" : "120px", alignContent: "center", justifyItems: "center", textAlign: "center" }}>
          <span style={{ color: "#0f4c81" }}><DocumentIcon /></span>
          <strong style={{ fontSize: options?.compact ? "0.85rem" : "0.95rem" }}>Document</strong>
          {src ? (
            <a href={src} target="_blank" rel="noreferrer" className="button secondary tap-button" style={{ textDecoration: "none" }}>
              Open Document
            </a>
          ) : null}
        </div>
      );
    }
    return <img src={src} alt={alt} style={{ width: "100%", maxHeight, objectFit: cover ? "cover" : "contain", background: "#f3f4f6", borderRadius: "10px" }} />;
  };

  const parseMediaMetadata = (raw?: string) => {
    const text = (raw ?? "").trim();
    if (!text) return null;
    try {
      return JSON.parse(text) as {
        checksumSha256?: string;
        sizeBytes?: number;
        width?: number;
        height?: number;
        mimeType?: string;
      };
    } catch {
      return null;
    }
  };

  const toLegacyFingerprint = (meta: { sizeBytes?: number; width?: number; height?: number; mimeType?: string } | null) => {
    if (!meta) return "";
    const sizeBytes = Number.isFinite(meta.sizeBytes) ? Number(meta.sizeBytes) : 0;
    const width = Number.isFinite(meta.width) ? Number(meta.width) : 0;
    const height = Number.isFinite(meta.height) ? Number(meta.height) : 0;
    const mimeType = String(meta.mimeType ?? "").trim().toLowerCase();
    if (!sizeBytes || !mimeType) return "";
    return `${sizeBytes}|${width}|${height}|${mimeType}`;
  };

  const computeFileSha256 = async (file: File) => {
    if (!crypto?.subtle) return "";
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const bytes = Array.from(new Uint8Array(hashBuffer));
    return bytes.map((value) => value.toString(16).padStart(2, "0")).join("");
  };

  const computeFileFingerprint = async (file: File) => {
    const mimeType = (file.type || "application/octet-stream").trim().toLowerCase();
    if (!mimeType.startsWith("image/")) return "";
    const dims = await new Promise<{ width: number; height: number }>((resolve) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        const width = Number.isFinite(image.naturalWidth) ? image.naturalWidth : 0;
        const height = Number.isFinite(image.naturalHeight) ? image.naturalHeight : 0;
        URL.revokeObjectURL(url);
        resolve({ width, height });
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ width: 0, height: 0 });
      };
      image.src = url;
    });
    return `${file.size}|${dims.width}|${dims.height}|${mimeType}`;
  };

  const loadDuplicateCatalog = async () => {
    if (duplicateCatalogRef.current) return duplicateCatalogRef.current;
    const catalog = await searchMediaLibrary({
      tenantKey: context.tenantKey,
      query: "",
      limit: 5000,
    });
    const byChecksum = new Map<string, MediaAttachLibraryItem>();
    const byLegacyFingerprint = new Map<string, MediaAttachLibraryItem>();
    for (const item of catalog) {
      const parsed = parseMediaMetadata(item.mediaMetadata);
      const checksum = String(parsed?.checksumSha256 ?? "").trim().toLowerCase();
      if (checksum && !byChecksum.has(checksum)) {
        byChecksum.set(checksum, item);
      }
      const fingerprint = toLegacyFingerprint(parsed);
      if (fingerprint && !byLegacyFingerprint.has(fingerprint)) {
        byLegacyFingerprint.set(fingerprint, item);
      }
    }
    // Keep legacy fingerprints in the same cache map under prefixed keys for lightweight lookup.
    for (const [fingerprint, item] of byLegacyFingerprint) {
      byChecksum.set(`legacy:${fingerprint}`, item);
    }
    duplicateCatalogRef.current = byChecksum;
    return byChecksum;
  };

  const scanForDuplicates = async (files: File[]) => {
    if (files.length === 0) return new Map<string, MediaAttachLibraryItem>();
    if (!crypto?.subtle) return new Map<string, MediaAttachLibraryItem>();
    setDuplicateScanBusy(true);
    try {
      const byChecksum = await loadDuplicateCatalog();
      const matches = new Map<string, MediaAttachLibraryItem>();
      const checksums = await Promise.all(
        files.map(async (file) => {
          const key = fileKey(file);
          const cached = fileHashCacheRef.current.get(key);
          if (cached) return { key, checksum: cached, fingerprint: "" };
          const checksum = await computeFileSha256(file);
          if (checksum) fileHashCacheRef.current.set(key, checksum);
          const fingerprint = await computeFileFingerprint(file);
          return { key, checksum, fingerprint };
        }),
      );
      for (const { key, checksum, fingerprint } of checksums) {
        const existing =
          (checksum ? byChecksum.get(checksum) : undefined) ??
          (fingerprint ? byChecksum.get(`legacy:${fingerprint}`) : undefined);
        if (existing) {
          matches.set(key, existing);
        }
      }
      return matches;
    } catch {
      return new Map<string, MediaAttachLibraryItem>();
    } finally {
      setDuplicateScanBusy(false);
    }
  };

  const appendFiles = async (files: FileList | null, source: SourceChoice) => {
    if (!files || files.length === 0) return;
    const incoming = Array.from(files).filter((file) => {
      return inferMediaKindFromMimeTypeOrFileName(file.type, file.name) !== "unknown";
    });
    if (incoming.length === 0) {
      setStatus("Select image, video, audio, or document files to continue.");
      return;
    }
    const shouldScanDuplicates = context.source !== "attribute";
    if (shouldScanDuplicates) {
      setStatus("Checking for duplicates...");
    }
    const duplicateMatches = shouldScanDuplicates ? await scanForDuplicates(incoming) : new Map<string, MediaAttachLibraryItem>();
    setItems((current) => {
      const seen = new Set(current.filter((item) => item.file).map((item) => fileKey(item.file!)));
      const next = [...current];
      for (const file of incoming) {
        const key = fileKey(file);
        if (seen.has(key)) continue;
        seen.add(key);
        const previewUrl = URL.createObjectURL(file);
        const duplicate = duplicateMatches.get(key);
        const mediaKind = inferDraftMediaKind({ file, existingMediaMetadata: duplicate?.mediaMetadata ?? "", fileId: duplicate?.fileId ?? "" });
        next.push({
          clientId: makeClientId(),
          source,
          file,
          mediaKind,
          fileId: duplicate?.fileId || "",
          previewUrl,
          existingMediaMetadata: duplicate?.mediaMetadata ?? "",
          duplicateOfFileId: duplicate?.fileId ?? "",
          duplicateExistingPreviewUrl: duplicate?.fileId
            ? toMediaPreviewSrc(context.tenantKey, duplicate.fileId, duplicate.mediaMetadata)
            : "",
          duplicateDecision: duplicate?.fileId ? "undecided" : undefined,
          title: context.defaultLabel ?? "",
          description: context.defaultDescription ?? "",
          date: context.defaultDate ?? (file.lastModified ? new Date(file.lastModified).toISOString().slice(0, 10) : ""),
          notes: "",
          personIds: Array.from(new Set((context.preselectedPersonIds ?? []).map((value) => value.trim()).filter(Boolean))),
          householdIds: Array.from(new Set((context.preselectedHouseholdIds ?? []).map((value) => value.trim()).filter(Boolean))),
          attributeType: mediaKind === "video" || mediaKind === "audio" ? mediaKind : (context.defaultAttributeType ?? "media"),
        });
      }
      return next;
    });
    const duplicateCount = duplicateMatches.size;
    setStatus(duplicateCount > 0 ? `Duplicate check complete: ${duplicateCount} matching item(s) found and will be linked without re-upload.` : "");
  };

  const addLibrarySelection = () => {
    if (librarySelectedFileIds.length === 0) {
      setStatus("Select one or more library items first.");
      return;
    }
    setItems((current) => {
      const seen = new Set(current.map((item) => item.fileId).filter(Boolean));
      const next = [...current];
      for (const fileId of librarySelectedFileIds) {
        if (seen.has(fileId)) continue;
        const match = libraryResults.find((item) => item.fileId === fileId);
        if (!match) continue;
        const mediaKind = inferMediaKindByMetadataOrFileId(match.fileId, match.mediaMetadata);
        next.push({
          clientId: makeClientId(),
          source: "library_existing",
          fileId: match.fileId,
          mediaKind,
          previewUrl: toMediaPreviewSrc(context.tenantKey, match.fileId, match.mediaMetadata),
          existingMediaMetadata: match.mediaMetadata ?? "",
          title: match.name || context.defaultLabel || mediaLabel(mediaKind),
          description: match.description || context.defaultDescription || "",
          date: match.date || context.defaultDate || "",
          notes: "",
          personIds: Array.from(new Set([...(context.preselectedPersonIds ?? []), ...match.people.map((person) => person.personId)])),
          householdIds: Array.from(new Set([...(context.preselectedHouseholdIds ?? []), ...match.households.map((household) => household.householdId)])),
          attributeType: mediaKind === "video" || mediaKind === "audio" ? mediaKind : (context.defaultAttributeType ?? "media"),
          duplicateDecision: undefined,
        });
      }
      return next;
    });
    setLibrarySelectedFileIds([]);
    setStatus("");
  };

  const runLibrarySearch = async () => {
    const query = libraryQuery.trim();
    if (!query) {
      setLibraryResults([]);
      return;
    }
    setLibraryBusy(true);
    setStatus("");
    try {
      const results = await searchMediaLibrary({ tenantKey: context.tenantKey, query, limit: 200 });
      setLibraryResults(results);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Media search failed.");
      setLibraryResults([]);
    } finally {
      setLibraryBusy(false);
    }
  };

  const proceedFromSelect = () => {
    if (items.length === 0) {
      setStatus("Select at least one media item.");
      return;
    }
    setStatus("");
    if (items.length === 1) {
      setSameMemorySet(false);
      setPerItemIndex(0);
      setStep("per_item");
      return;
    }
    setStep("grouping");
  };

  const applyTagCandidate = (candidate: LinkedSearchResult) => {
    if (!selectedItem) return;
    setTagQuery("");
    setItems((current) =>
      current.map((item) => {
        if (item.clientId !== selectedItem.clientId) return item;
        if (candidate.kind === "person") {
          return { ...item, personIds: item.personIds.includes(candidate.personId) ? item.personIds : [...item.personIds, candidate.personId] };
        }
        return { ...item, householdIds: item.householdIds.includes(candidate.householdId) ? item.householdIds : [...item.householdIds, candidate.householdId] };
      }),
    );
  };

  const removePerson = (personId: string) => {
    if (!selectedItem) return;
    setItems((current) =>
      current.map((item) => (item.clientId === selectedItem.clientId ? { ...item, personIds: item.personIds.filter((id) => id !== personId) } : item)),
    );
  };

  const removeHousehold = (householdId: string) => {
    if (!selectedItem) return;
    setItems((current) =>
      current.map((item) => (item.clientId === selectedItem.clientId ? { ...item, householdIds: item.householdIds.filter((id) => id !== householdId) } : item)),
    );
  };

  const applySharedTagCandidate = (candidate: LinkedSearchResult) => {
    setSharedTagQuery("");
    if (candidate.kind === "person") {
      setSharedPersonIds((current) => (current.includes(candidate.personId) ? current : [...current, candidate.personId]));
      return;
    }
    setSharedHouseholdIds((current) =>
      current.includes(candidate.householdId) ? current : [...current, candidate.householdId],
    );
  };

  const saveAll = async () => {
    if (items.length === 0) {
      setStatus("Select at least one media item.");
      return;
    }
    const firstInvalidIndex = items.findIndex((item) => validateDraftItem(context, item).length > 0);
    if (firstInvalidIndex >= 0) {
      const errors = validateDraftItem(context, items[firstInvalidIndex]);
      setPerItemIndex(firstInvalidIndex);
      setStep("per_item");
      setStatus(errors[0] || "Fix item details before save.");
      return;
    }
    const hasHouseholdTargets = items.some((item) => !item.skipImport && item.householdIds.length > 0);
    if (hasHouseholdTargets) {
      const permissionProbe = await fetch(`/api/t/${encodeURIComponent(context.tenantKey)}/households`, { cache: "no-store" });
      if (!permissionProbe.ok) {
        setStatus("Household links require Admin permission. Remove household targets or use a person target.");
        return;
      }
    }
    setBusy(true);
    setStatus("");
    setProgressMessage("Saving...");
    try {
      const summary = await runMediaAttachPlan({
        context,
        items,
        shared: {
          sameMemorySet: Boolean(sameMemorySet),
          title: sharedTitle,
          description: sharedDescription,
          date: sharedDate,
          notes: sharedNotes,
        },
        onProgress: (message) => setProgressMessage(message),
        onItemStatus: (clientId, statusValue, message) =>
          setItemProgress((current) => ({
            ...current,
            [clientId]: { status: statusValue, message: message ?? "" },
          })),
      });
      onComplete(summary);
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setBusy(false);
      setProgressMessage("");
    }
  };

  const canGoToReview = items.length > 0 && perItemIndex >= items.length - 1;
  const selectedItemErrors = selectedItem ? validateDraftItem(context, selectedItem) : [];
  const selectedItemKind = selectedItem ? inferDraftMediaKind(selectedItem) : null;

  const renderSource = (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Choose How You Want To Add Media</h4>
      <p className="page-subtitle" style={{ margin: 0 }}>
        Pick a source to jump straight into the next step. You can come back and switch sources any time.
      </p>
      <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        {availableSources.includes("device_upload") ? (
          <button
            type="button"
            className="button-ghost tap-button"
            onClick={() => openSourcePicker("device_upload")}
            style={{ textAlign: "left", border: "1px solid var(--border)", borderRadius: "14px", padding: "1rem", display: "grid", gap: "0.45rem", background: sourceChoice === "device_upload" ? "#eef6ff" : "#fff" }}
          >
            <span style={{ color: "#0f4c81" }}><PhotoIcon /></span>
            <strong>Device Files</strong>
            <span style={{ fontSize: "0.92rem", color: "#4b5563" }}>Pick photos, videos, audio, or documents already on this device.</span>
          </button>
        ) : null}
        {availableSources.includes("camera_capture") ? (
          <button
            type="button"
            className="button-ghost tap-button"
            onClick={() => openSourcePicker("camera_capture")}
            style={{ textAlign: "left", border: "1px solid var(--border)", borderRadius: "14px", padding: "1rem", display: "grid", gap: "0.45rem", background: sourceChoice === "camera_capture" ? "#eef6ff" : "#fff" }}
          >
            <span style={{ color: "#0f4c81" }}><CameraIcon /></span>
            <strong>Camera</strong>
            <span style={{ fontSize: "0.92rem", color: "#4b5563" }}>Take a photo or record a video on this device.</span>
          </button>
        ) : null}
        {availableSources.includes("library_existing") ? (
          <button
            type="button"
            className="button-ghost tap-button"
            onClick={() => openSourcePicker("library_existing")}
            style={{ textAlign: "left", border: "1px solid var(--border)", borderRadius: "14px", padding: "1rem", display: "grid", gap: "0.45rem", background: sourceChoice === "library_existing" ? "#eef6ff" : "#fff" }}
          >
            <span style={{ color: "#0f4c81" }}><LibraryIcon /></span>
            <strong>Media Library</strong>
            <span style={{ fontSize: "0.92rem", color: "#4b5563" }}>Reuse items already stored in the family media library.</span>
          </button>
        ) : null}
      </div>
    </div>
  );

  const renderSelect = (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <h4 className="ui-section-title" style={{ marginBottom: 0 }}>
        {sourceChoice === "library_existing" ? "Select Library Media" : sourceChoice === "camera_capture" ? "Capture Or Pick Media" : "Choose Media Files"}
      </h4>
      <p className="page-subtitle" style={{ margin: 0 }}>
        {sourceChoice === "library_existing"
          ? "Search the library, then add the items you want to work with."
          : sourceChoice === "camera_capture"
            ? "Tap the button below to open your camera or media picker. Photos and videos are supported here."
            : "Tap the button below to choose photos, videos, audio, or document files from this device."}
      </p>
      {sourceChoice === "device_upload" ? (
        <>
          <input
            ref={devicePickerRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,application/pdf,text/*,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.rtf,.odt,.ods"
            style={{ display: "none" }}
            onChange={(event) => {
              void appendFiles(event.target.files, "device_upload");
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            className="button-ghost tap-button"
            onClick={triggerDevicePicker}
            style={{ border: "1px dashed #94a3b8", borderRadius: "14px", padding: "1rem", display: "grid", gap: "0.35rem", justifyItems: "center", background: "#f8fafc" }}
          >
            <UploadArrowIcon />
            <strong>Choose Media Or Documents</strong>
            <span style={{ fontSize: "0.9rem", color: "#4b5563" }}>Opens the device file picker.</span>
          </button>
        </>
      ) : null}
      {sourceChoice === "camera_capture" ? (
        <>
          <input
            ref={cameraPickerRef}
            type="file"
            multiple
            accept="image/*,video/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={(event) => {
              void appendFiles(event.target.files, "camera_capture");
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            className="button-ghost tap-button"
            onClick={triggerCameraPicker}
            style={{ border: "1px dashed #94a3b8", borderRadius: "14px", padding: "1rem", display: "grid", gap: "0.35rem", justifyItems: "center", background: "#f8fafc" }}
          >
            <CameraIcon />
            <strong>Open Camera Or Media Picker</strong>
            <span style={{ fontSize: "0.9rem", color: "#4b5563" }}>Capture new photos or video, or choose existing ones.</span>
          </button>
        </>
      ) : null}
      {sourceChoice === "library_existing" ? (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              className="input"
              value={libraryQuery}
              onChange={(event) => setLibraryQuery(event.target.value)}
              placeholder="Search media library"
            />
            <button type="button" className="button secondary tap-button" onClick={() => void runLibrarySearch()} disabled={libraryBusy}>
              {libraryBusy ? "Searching..." : "Search"}
            </button>
          </div>
          {libraryResults.length > 0 ? (
            <div style={{ display: "grid", gap: "0.35rem", maxHeight: "220px", overflow: "auto" }}>
              {libraryResults.map((item) => {
                const checked = librarySelectedFileIds.includes(item.fileId);
                const kind = inferMediaKindByMetadataOrFileId(item.fileId, item.mediaMetadata);
                return (
                  <label key={`library-${item.fileId}`} className="person-linked-row">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setLibrarySelectedFileIds((current) => (current.includes(item.fileId) ? current : [...current, item.fileId]));
                        } else {
                          setLibrarySelectedFileIds((current) => current.filter((value) => value !== item.fileId));
                        }
                      }}
                    />
                    <span>{item.name || item.fileId} <span style={{ color: "#6b7280" }}>({mediaLabel(kind)})</span></span>
                  </label>
                );
              })}
            </div>
          ) : null}
          <button type="button" className="button secondary tap-button" onClick={addLibrarySelection}>
            Add Selected Library Items
          </button>
        </div>
      ) : null}
      <div className="card" style={{ padding: "0.6rem", display: "grid", gap: "0.35rem" }}>
        <strong>{items.length} item(s) selected</strong>
        {duplicateScanBusy ? <span style={{ fontSize: "0.85rem" }}>Checking selected files for duplicates...</span> : null}
        {items.length > 0 ? (
          <div style={{ display: "grid", gap: "0.25rem", maxHeight: "180px", overflow: "auto" }}>
            {items.map((item) => {
              const kind = inferDraftMediaKind(item);
              return (
              <div key={item.clientId} style={{ display: "grid", gap: "0.25rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
                  {item.previewUrl ? (
                    <div style={{ width: "72px", minWidth: "72px" }}>
                      {renderMediaPreview(kind, item.previewUrl, "", { maxHeight: "72px", compact: true, cover: kind === "image" })}
                    </div>
                  ) : null}
                  <span style={{ fontSize: "0.9rem" }}>{item.title || item.file?.name || item.fileId || "Media"} <span style={{ color: "#6b7280" }}>({mediaLabel(kind)})</span></span>
                </div>
                {item.duplicateOfFileId ? (
                  <span className="status-chip status-chip--neutral" style={{ width: "fit-content" }}>
                    Matching library item found: {item.duplicateOfFileId} (will link, not re-upload)
                  </span>
                ) : null}
              </div>
            )})}
          </div>
        ) : <span style={{ fontSize: "0.9rem", color: "#6b7280" }}>Nothing selected yet.</span>}
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" className="button secondary tap-button" onClick={() => setStep("source")}>Back</button>
        <button type="button" className="button tap-button" onClick={proceedFromSelect}>Continue</button>
      </div>
    </div>
  );

  const renderGrouping = (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Same Memory/Event/Set?</h4>
      <p className="page-subtitle" style={{ margin: 0 }}>These {items.length} items were selected. Are they part of one memory/event/set?</p>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          type="button"
          className={`button tap-button ${sameMemorySet === true ? "active" : ""}`}
          aria-pressed={sameMemorySet === true}
          onClick={() => {
            setSameMemorySet(true);
            setStatus("");
          }}
        >
          Yes
        </button>
        <button
          type="button"
          className={`button secondary tap-button ${sameMemorySet === false ? "active" : ""}`}
          aria-pressed={sameMemorySet === false}
          onClick={() => {
            setSameMemorySet(false);
            setStatus("");
          }}
        >
          No
        </button>
      </div>
      {sameMemorySet != null ? (
        <span className="status-chip status-chip--neutral" style={{ width: "fit-content" }}>
          Selected: {sameMemorySet ? "Yes" : "No"}
        </span>
      ) : null}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" className="button secondary tap-button" onClick={() => { setStatus(""); setStep("select"); }}>Back</button>
        <button
          type="button"
          className="button tap-button"
          disabled={sameMemorySet == null}
          onClick={() => {
            if (sameMemorySet == null) {
              setStatus("Select Yes or No.");
              return;
            }
            setStatus("");
            if (sameMemorySet) {
              setStep("shared");
            } else {
              setPerItemIndex(0);
              setStep("per_item");
            }
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );

  const renderShared = (
    <div style={{ display: "grid", gap: "0.65rem" }}>
      <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Shared Metadata</h4>
      <label style={{ display: "grid", gap: "0.35rem" }}>
        <span style={{ fontWeight: 600 }}>Title</span>
        <input className="input" value={sharedTitle} onChange={(event) => setSharedTitle(event.target.value)} placeholder="Memory/Event title" />
      </label>
      <label style={{ display: "grid", gap: "0.35rem" }}>
        <span style={{ fontWeight: 600 }}>Description</span>
        <input className="input" value={sharedDescription} onChange={(event) => setSharedDescription(event.target.value)} placeholder="Description" />
      </label>
      <label style={{ display: "grid", gap: "0.35rem" }}>
        <span style={{ fontWeight: 600 }}>Date</span>
        <input className="input" type="date" value={sharedDate} onChange={(event) => setSharedDate(event.target.value)} />
      </label>
      <label style={{ display: "grid", gap: "0.35rem" }}>
        <span style={{ fontWeight: 600 }}>Notes</span>
        <textarea className="input" rows={3} value={sharedNotes} onChange={(event) => setSharedNotes(event.target.value)} />
      </label>
      <div className="card" style={{ padding: "0.6rem", display: "grid", gap: "0.45rem" }}>
        <strong>Apply Link Targets To All Items</strong>
        <label style={{ display: "grid", gap: "0.35rem" }}>
          <span style={{ fontWeight: 600 }}>Search People/Households</span>
          <input className="input" value={sharedTagQuery} onChange={(event) => setSharedTagQuery(event.target.value)} placeholder="Search links for all items" />
        </label>
        {sharedTagQuery.trim() ? (
          <div className="person-typeahead-list">
            {sharedTagSearchResults.length > 0 ? (
              sharedTagSearchResults.map((entry) => (
                <button key={entry.key} type="button" className="person-typeahead-item" onClick={() => applySharedTagCandidate(entry)}>
                  {entry.displayName}
                </button>
              ))
            ) : (
              <p className="page-subtitle" style={{ margin: 0 }}>No matching results.</p>
            )}
          </div>
        ) : null}
        <div className="person-chip-row">
          {sharedPersonIds.map((personId) => {
            const person = peopleOptions.find((option) => option.personId === personId);
            return (
              <span key={`shared-person-${personId}`} className="person-linked-row">
                <span className="person-linked-main">{person?.displayName || personId}</span>
                <button type="button" className="person-chip-remove" onClick={() => setSharedPersonIds((current) => current.filter((id) => id !== personId))}>x</button>
              </span>
            );
          })}
          {sharedHouseholdIds.map((householdId) => {
            const household = householdOptions.find((option) => option.householdId === householdId);
            return (
              <span key={`shared-household-${householdId}`} className="person-linked-row">
                <span className="person-linked-main">{household?.label || householdId}</span>
                <button type="button" className="person-chip-remove" onClick={() => setSharedHouseholdIds((current) => current.filter((id) => id !== householdId))}>x</button>
              </span>
            );
          })}
        </div>
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" className="button secondary tap-button" onClick={() => { setStatus(""); setStep("grouping"); }}>Back</button>
        <button
          type="button"
          className="button tap-button"
          onClick={() => {
            setStatus("");
            setItems((current) =>
              current.map((item) => ({
                ...item,
                personIds: Array.from(new Set([...item.personIds, ...sharedPersonIds])),
                householdIds: Array.from(new Set([...item.householdIds, ...sharedHouseholdIds])),
              })),
            );
            setPerItemIndex(0);
            setStep("per_item");
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );

  const renderPerItem = selectedItem ? (
    <div style={{ display: "grid", gap: "0.7rem" }}>
      <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Item {perItemIndex + 1} of {items.length}</h4>
      {items.length > 1 ? (
        <div style={{ display: "flex", gap: "0.4rem", overflowX: "auto", paddingBottom: "0.25rem" }}>
          {items.map((item, index) => (
            <button
              key={`jump-item-${item.clientId}`}
              type="button"
              className={`button ${index === perItemIndex ? "tap-button" : "secondary tap-button"}`}
              onClick={() => setPerItemIndex(index)}
            >
              {index + 1}
            </button>
          ))}
        </div>
      ) : null}
      {selectedItem.previewUrl && !selectedItem.duplicateOfFileId && selectedItemKind ? (
        renderMediaPreview(selectedItemKind, selectedItem.previewUrl, `Selected ${mediaLabel(selectedItemKind)}`)
      ) : null}
      {!selectedItem.duplicateOfFileId ? (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className={`button ${selectedItem.skipImport ? "secondary" : "tap-button"}`}
            onClick={() =>
              setItems((current) =>
                current.map((item) => (item.clientId === selectedItem.clientId ? { ...item, skipImport: !item.skipImport } : item)),
              )
            }
          >
            {selectedItem.skipImport ? "Unskip Item" : "Skip Item (Do Not Import)"}
          </button>
        </div>
      ) : null}
      {selectedItem.duplicateOfFileId && selectedItem.duplicateExistingPreviewUrl && selectedItemKind ? (
        <div className="card" style={{ padding: "0.6rem", display: "grid", gap: "0.45rem" }}>
          <strong>Matching Library Item Found</strong>
          <span style={{ fontSize: "0.9rem" }}>
            This selected {mediaLabel(selectedItemKind)} may match existing library file <code>{selectedItem.duplicateOfFileId}</code>.
          </span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
            <div style={{ display: "grid", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Selected {mediaLabel(selectedItemKind)}</span>
              {renderMediaPreview(selectedItemKind, selectedItem.previewUrl || "", `Selected ${mediaLabel(selectedItemKind)}`, { maxHeight: "170px" })}
            </div>
            <div style={{ display: "grid", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Existing library {mediaLabel(selectedItemKind)}</span>
              {renderMediaPreview(selectedItemKind, selectedItem.duplicateExistingPreviewUrl, `Existing ${mediaLabel(selectedItemKind)}`, { maxHeight: "170px" })}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className={`button tap-button ${selectedItem.duplicateDecision === "duplicate" ? "active" : ""}`}
              onClick={() =>
                setItems((current) =>
                  current.map((item) =>
                    item.clientId === selectedItem.clientId ? { ...item, duplicateDecision: "duplicate", skipImport: false } : item,
                  ),
                )
              }
            >
              Duplicate (Skip Import)
            </button>
            <button
              type="button"
              className={`button secondary tap-button ${selectedItem.duplicateDecision === "not_duplicate" ? "active" : ""}`}
              onClick={() =>
                setItems((current) =>
                  current.map((item) =>
                    item.clientId === selectedItem.clientId ? { ...item, duplicateDecision: "not_duplicate" } : item,
                  ),
                )
              }
            >
              Not A Duplicate (Import)
            </button>
            <button
              type="button"
              className={`button secondary tap-button ${selectedItem.duplicateDecision === "replace_existing" ? "active" : ""}`}
              onClick={() =>
                setItems((current) =>
                  current.map((item) =>
                    item.clientId === selectedItem.clientId ? { ...item, duplicateDecision: "replace_existing" } : item,
                  ),
                )
              }
            >
              Import New And Replace Existing Links
            </button>
          </div>
          {selectedItem.duplicateDecision ? (
            <span className="status-chip status-chip--neutral" style={{ width: "fit-content" }}>
              Decision: {selectedItem.duplicateDecision === "duplicate"
                ? "Skip Import (Use Existing)"
                : selectedItem.duplicateDecision === "replace_existing"
                  ? "Overwrite Existing"
                  : "Import As New"}
            </span>
          ) : null}
          <span style={{ fontSize: "0.85rem" }}>You can still edit metadata/links below.</span>
        </div>
      ) : null}
      <div style={{ display: "grid", gap: "0.65rem", gridTemplateColumns: "minmax(0, 1.8fr) minmax(0, 1fr)" }}>
        <label style={{ display: "grid", gap: "0.35rem" }}>
          <span style={{ fontWeight: 600 }}>Caption/Title</span>
          <input
            className="input"
            value={selectedItem.title}
            onChange={(event) =>
              setItems((current) => current.map((item) => (item.clientId === selectedItem.clientId ? { ...item, title: event.target.value } : item)))
            }
          />
        </label>
        <label style={{ display: "grid", gap: "0.35rem" }}>
          <span style={{ fontWeight: 600 }}>Date</span>
          <input
            className="input"
            type="date"
            value={selectedItem.date}
            onChange={(event) =>
              setItems((current) => current.map((item) => (item.clientId === selectedItem.clientId ? { ...item, date: event.target.value } : item)))
            }
          />
        </label>
      </div>
      <label style={{ display: "grid", gap: "0.35rem" }}>
        <span style={{ fontWeight: 600 }}>Description</span>
        <input
          className="input"
          value={selectedItem.description}
          onChange={(event) =>
            setItems((current) => current.map((item) => (item.clientId === selectedItem.clientId ? { ...item, description: event.target.value } : item)))
          }
        />
      </label>
      <label style={{ display: "grid", gap: "0.35rem" }}>
        <span style={{ fontWeight: 600 }}>Story/Notes</span>
        <textarea
          className="input"
          rows={2}
          value={selectedItem.notes}
          onChange={(event) =>
            setItems((current) => current.map((item) => (item.clientId === selectedItem.clientId ? { ...item, notes: event.target.value } : item)))
          }
        />
      </label>
      <label style={{ display: "grid", gap: "0.35rem" }}>
        <span style={{ fontWeight: 600 }}>Search to Add People/Households</span>
        <input className="input" value={tagQuery} onChange={(event) => setTagQuery(event.target.value)} placeholder="Search links" />
      </label>
      {tagQuery.trim() ? (
        <div className="person-typeahead-list">
          {tagSearchResults.length > 0 ? (
            tagSearchResults.map((entry) => (
              <button key={entry.key} type="button" className="person-typeahead-item" onClick={() => applyTagCandidate(entry)}>
                {entry.displayName}
              </button>
            ))
          ) : (
            <p className="page-subtitle" style={{ margin: 0 }}>No matching results.</p>
          )}
        </div>
      ) : null}
      <div className="person-chip-row">
        {selectedItem.personIds.map((personId) => {
          const person = peopleOptions.find((option) => option.personId === personId);
          return (
            <span key={`item-person-${selectedItem.clientId}-${personId}`} className="person-linked-row">
              <span className="person-linked-main">{person?.displayName || personId}</span>
              <button type="button" className="person-chip-remove" onClick={() => removePerson(personId)}>x</button>
            </span>
          );
        })}
        {selectedItem.householdIds.map((householdId) => {
          const household = householdOptions.find((option) => option.householdId === householdId);
          return (
            <span key={`item-household-${selectedItem.clientId}-${householdId}`} className="person-linked-row">
              <span className="person-linked-main">{household?.label || householdId}</span>
              <button type="button" className="person-chip-remove" onClick={() => removeHousehold(householdId)}>x</button>
            </span>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          type="button"
          className="button secondary tap-button"
          onClick={() => {
            if (perItemIndex > 0) setPerItemIndex(perItemIndex - 1);
            else setStep(sameMemorySet ? "shared" : items.length > 1 ? "grouping" : "select");
          }}
        >
          Back
        </button>
        {!canGoToReview ? (
          <button
            type="button"
            className="button tap-button"
            onClick={() => {
              if (selectedItemErrors.length > 0) {
                setStatus(selectedItemErrors[0] || "Fix item details before continuing.");
                return;
              }
              setStatus("");
              setPerItemIndex((value) => Math.min(items.length - 1, value + 1));
            }}
          >
            Next Item
          </button>
        ) : (
          <>
            <button
              type="button"
              className="button secondary tap-button"
              onClick={() => {
                if (selectedItemErrors.length > 0) {
                  setStatus(selectedItemErrors[0] || "Fix item details before review.");
                  return;
                }
                setStatus("");
                setStep("review");
              }}
            >
              Review
            </button>
            <button
              type="button"
              className="button tap-button"
              disabled={busy}
              onClick={() => void saveAll()}
            >
              {busy ? "Saving..." : "Save"}
            </button>
          </>
        )}
      </div>
      {selectedItemErrors.length > 0 ? (
        <div className="card" style={{ padding: "0.5rem", border: "1px solid #fecaca", background: "#fff1f2" }}>
          <strong style={{ display: "block", marginBottom: "0.25rem" }}>Needs attention</strong>
          <ul style={{ margin: 0, paddingLeft: "1rem" }}>
            {selectedItemErrors.map((message) => (
              <li key={`${selectedItem.clientId}-${message}`} style={{ fontSize: "0.9rem" }}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  ) : null;

  const renderReview = (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Review</h4>
      <p className="page-subtitle" style={{ margin: 0 }}>Confirm items and links before save.</p>
      <div style={{ display: "grid", gap: "0.45rem", maxHeight: "280px", overflow: "auto" }}>
        {items.map((item, index) => (
          (() => {
            const errors = validateDraftItem(context, item);
            return (
          <div key={item.clientId} className="card" style={{ padding: "0.55rem" }}>
            <strong>Item {index + 1}: {item.title || item.file?.name || item.fileId || "Media"}</strong>
            <div style={{ fontSize: "0.85rem", marginTop: "0.2rem" }}>
              <span>Date: {item.date || "-"}</span>
              <span style={{ marginLeft: "0.65rem" }}>People: {item.personIds.length}</span>
              <span style={{ marginLeft: "0.65rem" }}>Households: {item.householdIds.length}</span>
              {item.duplicateDecision === "duplicate" ? <span style={{ marginLeft: "0.65rem" }}>Duplicate: yes (link-only)</span> : null}
              {item.duplicateDecision === "replace_existing" ? <span style={{ marginLeft: "0.65rem" }}>Duplicate: overwrite existing</span> : null}
              {item.skipImport ? <span style={{ marginLeft: "0.65rem" }}>Skipped: yes</span> : null}
            </div>
            {errors.length > 0 ? (
              <div style={{ marginTop: "0.35rem", color: "#991b1b", fontSize: "0.85rem" }}>
                {errors[0]}
              </div>
            ) : null}
          </div>
            );
          })()
        ))}
      </div>
      {items.length > 0 ? (
        <div className="card" style={{ padding: "0.55rem", display: "grid", gap: "0.35rem" }}>
          <strong>Upload Progress</strong>
          {items.map((item, index) => {
            const progress = itemProgress[item.clientId] ?? { status: "pending" as const, message: "" };
            const width =
              progress.status === "failed" ? 100 :
              progress.status === "linked" || progress.status === "skipped" ? 100 :
              progress.status === "uploaded" ? 70 :
              progress.status === "working" ? 40 : 10;
            const color =
              progress.status === "failed" ? "#dc2626" :
              progress.status === "linked" ? "#16a34a" :
              progress.status === "skipped" ? "#6b7280" :
              progress.status === "uploaded" ? "#0284c7" :
              progress.status === "working" ? "#2563eb" : "#cbd5e1";
            return (
              <div key={`progress-${item.clientId}`} style={{ display: "grid", gap: "0.2rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem" }}>
                  <span>{index + 1}. {item.title || item.file?.name || item.fileId || "Media"}</span>
                  <span>{progress.status}</span>
                </div>
                <div style={{ height: "7px", background: "#e5e7eb", borderRadius: "6px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${width}%`, background: color, transition: "width 180ms ease" }} />
                </div>
                {progress.message ? <span style={{ fontSize: "0.78rem", color: "#4b5563" }}>{progress.message}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" className="button secondary tap-button" onClick={() => setStep("per_item")} disabled={busy}>Back</button>
        <button type="button" className="button tap-button" onClick={() => void saveAll()} disabled={busy}>
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
      {progressMessage ? <p className="page-subtitle" style={{ margin: 0 }}>{progressMessage}</p> : null}
    </div>
  );

  return (
    <div className="person-modal-backdrop" onClick={(event) => event.stopPropagation()}>
      <div className="person-modal-panel" onClick={(event) => event.stopPropagation()} style={{ maxWidth: "900px", width: "min(900px, 96vw)" }}>
        <div className="person-modal-sticky-head">
          <div className="person-modal-header">
            <div>
              <h3 className="person-modal-title">Media Attach Wizard</h3>
              <p className="person-modal-meta">Add photos, videos, audio, or documents, then link them to people or households.</p>
            </div>
            <button type="button" className="button secondary tap-button" onClick={onClose} disabled={busy}>Close</button>
          </div>
        </div>
        <div className="person-modal-body" style={{ maxHeight: "75vh", overflow: "auto" }}>
          {step === "source" ? renderSource : null}
          {step === "select" ? renderSelect : null}
          {step === "grouping" ? renderGrouping : null}
          {step === "shared" ? renderShared : null}
          {step === "per_item" ? renderPerItem : null}
          {step === "review" ? renderReview : null}
          {status ? <p style={{ marginTop: "0.75rem" }}>{status}</p> : null}
        </div>
      </div>
    </div>
  );
}

export function formatMediaAttachUserSummary(summary: MediaAttachExecutionSummary) {
  const lines = [
    "Media save completed.",
    formatSummary(summary),
  ];
  if (summary.failures.length > 0) {
    lines.push(`Failure details: ${summary.failures.slice(0, 3).map((item) => item.message).join(" | ")}`);
  }
  return lines.join(" ");
}

export function getPeopleMap(options: MediaAttachPersonOption[]) {
  return new Map(options.map((item) => [item.personId, item]));
}

export function getHouseholdsMap(options: MediaAttachHouseholdOption[]) {
  return new Map(options.map((item) => [item.householdId, item]));
}
