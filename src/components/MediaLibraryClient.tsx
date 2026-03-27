"use client";

import { useEffect, useMemo, useState } from "react";
import { getPhotoPreviewProxyPath, getPhotoProxyPath } from "@/lib/google/photo-path";
import { MediaAttachWizard, formatMediaAttachUserSummary } from "@/components/media/MediaAttachWizard";
import { matchesCanonicalMediaFileId, type AttributeWithMedia } from "@/lib/attributes/media-response";
import type { MediaAttachExecutionSummary } from "@/lib/media/attach-orchestrator";
import { inferStoredMediaKind } from "@/lib/media/upload";

type MediaLibraryClientProps = {
  tenantKey: string;
  canManage: boolean;
};

type MediaItem = {
  fileId: string;
  name: string;
  description: string;
  date: string;
  createdAt?: string;
  mediaKind?: string;
  mediaMetadata?: string;
  exifExtractedAt?: string;
  people: Array<{ personId: string; displayName: string }>;
  households: Array<{ householdId: string; label: string }>;
};

type MediaItemDetailPayload = {
  item?: MediaItem;
  editable?: boolean;
  canEditName?: boolean;
};

type PersonOption = {
  personId: string;
  displayName: string;
  gender?: "male" | "female" | "unspecified";
};

type HouseholdOption = {
  householdId: string;
  label: string;
};

type LinkedSearchResult =
  | {
      kind: "person";
      key: string;
      displayName: string;
      personId: string;
      gender: "male" | "female" | "unspecified";
    }
  | {
      kind: "household";
      key: string;
      displayName: string;
      householdId: string;
    };

function getGenderAvatarSrc(gender: "male" | "female" | "unspecified") {
  return gender === "female" ? "/placeholders/avatar-female.png" : "/placeholders/avatar-male.png";
}

function HouseholdIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M4 10.4L12 4l8 6.4v8.6a1 1 0 0 1-1 1h-4.8a.7.7 0 0 1-.7-.7V14a1.5 1.5 0 0 0-3 0v5.3a.7.7 0 0 1-.7.7H5a1 1 0 0 1-1-1v-8.6z"
        fill="currentColor"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="11" cy="11" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 16l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="9" cy="10" r="1.6" fill="currentColor" />
      <path d="M6.5 16l4-4 2.7 2.7L16 12l2 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="3.5" y="6" width="12.5" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M16 10l4.5-2.5v9L16 14z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function AudioIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M14 5v10.3a2.8 2.8 0 1 1-1.7-2.6V8.6l6-1.4v7.1a2.8 2.8 0 1 1-1.7-2.6V5.8z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
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

function DocumentFilterIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M7 3.8h7l3.2 3.2v13a1 1 0 0 1-1 1H7A1.8 1.8 0 0 1 5.2 19.2V5.6A1.8 1.8 0 0 1 7 3.8z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M14 4.6V8h3.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8.5 12.1h7M8.5 15h7M8.5 17.9h4.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function inferMediaKind(fileId: string, rawMetadata?: string) {
  return inferStoredMediaKind(fileId, rawMetadata);
}

function readMediaKind(item: Pick<MediaItem, "fileId" | "mediaKind" | "mediaMetadata">) {
  const explicit = String(item.mediaKind ?? "").trim().toLowerCase();
  if (explicit === "image" || explicit === "video" || explicit === "audio" || explicit === "document") {
    return explicit;
  }
  return inferMediaKind(item.fileId, item.mediaMetadata);
}

async function assertOk(res: Response, fallbackMessage: string) {
  if (res.ok) return;
  const body = await res.json().catch(() => null);
  const message = body?.message || body?.error || fallbackMessage;
  throw new Error(String(message));
}

type MediaTypeFilter = "all" | "image" | "video" | "audio" | "document";

const MEDIA_LIBRARY_FETCH_LIMIT = 5000;
const MEDIA_LIBRARY_PAGE_SIZE = 12;
const MEDIA_TYPE_FILTER_OPTIONS: Array<{ value: MediaTypeFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
  { value: "audio", label: "Audio" },
  { value: "document", label: "Documents" },
];

function MediaTypeFilterIcon({ type }: { type: MediaTypeFilter }) {
  if (type === "image") {
    return <ImageIcon />;
  }
  if (type === "video") {
    return <VideoIcon />;
  }
  if (type === "audio") {
    return <AudioIcon />;
  }
  if (type === "document") {
    return <DocumentFilterIcon />;
  }
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M5 5h5v5H5zm9 0h5v5h-5zM5 14h5v5H5zm9 0h5v5h-5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function parseSortableTimestamp(value: string | undefined) {
  const parsed = Date.parse(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

export function MediaLibraryClient({ tenantKey, canManage }: MediaLibraryClientProps) {
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [peopleOptions, setPeopleOptions] = useState<PersonOption[]>([]);
  const [householdOptions, setHouseholdOptions] = useState<HouseholdOption[]>([]);
  const [search, setSearch] = useState("");
  const [includeDrive, setIncludeDrive] = useState(false);
  const [status, setStatus] = useState("");
  const [showAttachWizard, setShowAttachWizard] = useState(false);
  const [showPhotoEditor, setShowPhotoEditor] = useState(false);
  const [selectedPhotoDetail, setSelectedPhotoDetail] = useState<MediaItem | null>(null);
  const [selectedPhotoEditable, setSelectedPhotoEditable] = useState(false);
  const [selectedPhotoCanEditName, setSelectedPhotoCanEditName] = useState(false);
  const [selectedPhotoName, setSelectedPhotoName] = useState("");
  const [selectedPhotoDescription, setSelectedPhotoDescription] = useState("");
  const [selectedPhotoDate, setSelectedPhotoDate] = useState("");
  const [selectedPhotoAssociations, setSelectedPhotoAssociations] = useState<{
    people: Array<{ personId: string; displayName: string }>;
    households: Array<{ householdId: string; label: string }>;
  }>({ people: [], households: [] });
  const [photoAssociationBusy, setPhotoAssociationBusy] = useState(false);
  const [photoAssociationStatus, setPhotoAssociationStatus] = useState("");
  const [photoTagQuery, setPhotoTagQuery] = useState("");
  const [pendingPhotoOps, setPendingPhotoOps] = useState<Set<string>>(new Set());
  const [linkedFilterQuery, setLinkedFilterQuery] = useState("");
  const [linkedFilterPersonIds, setLinkedFilterPersonIds] = useState<string[]>([]);
  const [linkedFilterHouseholdIds, setLinkedFilterHouseholdIds] = useState<string[]>([]);
  const [mediaTypeFilter, setMediaTypeFilter] = useState<MediaTypeFilter>("all");
  const [pageOffset, setPageOffset] = useState(0);
  const linkedFilterPeopleKey = linkedFilterPersonIds.join("|");
  const linkedFilterHouseholdsKey = linkedFilterHouseholdIds.join("|");

  const loadLibrary = async (query = "", options?: { noCache?: boolean }) => {
    const normalizedQuery = query.trim();
    const noCache = options?.noCache ? "&noCache=1" : "";
    const res = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/photos/search?q=${encodeURIComponent(normalizedQuery)}&limit=${MEDIA_LIBRARY_FETCH_LIMIT}&includeDrive=${includeDrive ? "1" : "0"}${noCache}`,
      { cache: options?.noCache ? "no-store" : "default" },
    );
    await assertOk(res, "Failed to load media library");
    const body = (await res.json()) as { items?: MediaItem[] };
    setMediaItems(Array.isArray(body.items) ? body.items : []);
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadLibrary(search.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [tenantKey, search, includeDrive]);

  useEffect(() => {
    void (async () => {
      const peopleRes = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/people`);
      const peopleBody = await peopleRes.json().catch(() => null);
      if (peopleRes.ok) {
        const items: Array<{ personId?: string; displayName?: string; gender?: "male" | "female" | "unspecified" }> = Array.isArray(peopleBody?.items)
          ? peopleBody.items
          : [];
        setPeopleOptions(
          items
            .map((item) => ({
              personId: String(item.personId ?? ""),
              displayName: String(item.displayName ?? ""),
              gender: item.gender ?? "unspecified",
            }))
            .filter((item) => item.personId && item.displayName)
            .sort((a, b) => a.displayName.localeCompare(b.displayName)),
        );
      }

      const householdsRes = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/households`);
      const householdsBody = await householdsRes.json().catch(() => null);
      if (householdsRes.ok) {
        const items: Array<{ householdId?: string; label?: string }> = Array.isArray(householdsBody?.households)
          ? householdsBody.households
          : [];
        setHouseholdOptions(
          items
            .map((item) => ({
              householdId: String(item.householdId ?? ""),
              label: String(item.label ?? "").trim() || String(item.householdId ?? ""),
            }))
            .filter((item) => item.householdId)
            .sort((a, b) => a.label.localeCompare(b.label)),
        );
      }
    })();
  }, [tenantKey]);

  useEffect(() => {
    setPageOffset(0);
  }, [
    tenantKey,
    search,
    includeDrive,
    mediaTypeFilter,
    linkedFilterPeopleKey,
    linkedFilterHouseholdsKey,
  ]);

  const peopleById = useMemo(() => new Map(peopleOptions.map((item) => [item.personId, item])), [peopleOptions]);
  const householdsById = useMemo(() => new Map(householdOptions.map((item) => [item.householdId, item])), [householdOptions]);

  const upsertMediaItem = (nextItem: MediaItem) => {
    setMediaItems((current) => {
      const index = current.findIndex((item) => item.fileId === nextItem.fileId);
      if (index < 0) {
        return [nextItem, ...current];
      }
      const next = current.slice();
      next[index] = nextItem;
      return next;
    });
  };

  const applySelectedPhotoDetail = (
    nextItem: MediaItem,
    options?: {
      editable?: boolean;
      canEditName?: boolean;
      preserveExistingText?: boolean;
    },
  ) => {
    const preserveExistingText = options?.preserveExistingText ?? false;
    setSelectedPhotoDetail(nextItem);
    setSelectedPhotoEditable(Boolean(options?.editable));
    setSelectedPhotoCanEditName(Boolean(options?.canEditName));
    setSelectedPhotoAssociations({
      people: Array.isArray(nextItem.people) ? nextItem.people : [],
      households: Array.isArray(nextItem.households) ? nextItem.households : [],
    });
    setSelectedPhotoName((current) => (preserveExistingText && current ? current : nextItem.name || ""));
    setSelectedPhotoDescription((current) =>
      preserveExistingText && current ? current : nextItem.description || "",
    );
    setSelectedPhotoDate((current) => (preserveExistingText && current ? current : nextItem.date || ""));
    upsertMediaItem(nextItem);
  };

  const photoTagSearchResults = useMemo(() => {
    const q = photoTagQuery.trim().toLowerCase();
    if (!q) return [] as LinkedSearchResult[];
    const linkedPersonIds = new Set(selectedPhotoAssociations.people.map((item) => item.personId));
    const linkedHouseholdIds = new Set(selectedPhotoAssociations.households.map((item) => item.householdId));
    const personResults: LinkedSearchResult[] = peopleOptions
      .filter((item) => item.displayName.toLowerCase().includes(q) && !linkedPersonIds.has(item.personId))
      .map((item) => ({
        kind: "person",
        key: `tag-person-${item.personId}`,
        displayName: item.displayName,
        personId: item.personId,
        gender: item.gender ?? "unspecified",
      }));
    const householdResults: LinkedSearchResult[] = canManage
      ? householdOptions
          .filter((item) => item.label.toLowerCase().includes(q) && !linkedHouseholdIds.has(item.householdId))
          .map((item) => ({
            kind: "household",
            key: `tag-household-${item.householdId}`,
            displayName: item.label,
            householdId: item.householdId,
          }))
      : [];
    return [...personResults, ...householdResults].slice(0, 15);
  }, [photoTagQuery, selectedPhotoAssociations.people, selectedPhotoAssociations.households, peopleOptions, canManage, householdOptions]);

  const linkedFilterSearchResults = useMemo(() => {
    const q = linkedFilterQuery.trim().toLowerCase();
    if (!q) return [] as LinkedSearchResult[];
    const selectedPeople = new Set(linkedFilterPersonIds);
    const selectedHouseholds = new Set(linkedFilterHouseholdIds);
    const peopleMatches: LinkedSearchResult[] = peopleOptions
      .filter((item) => item.displayName.toLowerCase().includes(q) && !selectedPeople.has(item.personId))
      .map((item) => ({
        kind: "person",
        key: `filter-person-${item.personId}`,
        displayName: item.displayName,
        personId: item.personId,
        gender: item.gender ?? "unspecified",
      }));
    const householdMatches: LinkedSearchResult[] = householdOptions
      .filter((item) => item.label.toLowerCase().includes(q) && !selectedHouseholds.has(item.householdId))
      .map((item) => ({
        kind: "household",
        key: `filter-household-${item.householdId}`,
        displayName: item.label,
        householdId: item.householdId,
      }));
    return [...peopleMatches, ...householdMatches].slice(0, 15);
  }, [linkedFilterQuery, linkedFilterPersonIds, linkedFilterHouseholdIds, peopleOptions, householdOptions]);

  const filteredMediaItems = useMemo(() => {
    const personSet = new Set(linkedFilterPersonIds);
    const householdSet = new Set(linkedFilterHouseholdIds);
    const filtered =
      linkedFilterPersonIds.length === 0 && linkedFilterHouseholdIds.length === 0
        ? mediaItems
        : mediaItems.filter((item) => {
            const hasPerson = item.people.some((entry) => personSet.has(entry.personId));
            const hasHousehold = item.households.some((entry) => householdSet.has(entry.householdId));
            return hasPerson || hasHousehold;
          });

    return filtered
      .filter((item) => mediaTypeFilter === "all" || readMediaKind(item) === mediaTypeFilter)
      .sort((a, b) => {
        const byCreatedAt = parseSortableTimestamp(b.createdAt) - parseSortableTimestamp(a.createdAt);
        if (byCreatedAt !== 0) return byCreatedAt;
        return a.name.localeCompare(b.name) || a.fileId.localeCompare(b.fileId);
      });
  }, [mediaItems, linkedFilterPersonIds, linkedFilterHouseholdIds, mediaTypeFilter]);

  useEffect(() => {
    setPageOffset((current) => {
      if (filteredMediaItems.length === 0) {
        return 0;
      }
      const maxOffset = Math.floor((filteredMediaItems.length - 1) / MEDIA_LIBRARY_PAGE_SIZE) * MEDIA_LIBRARY_PAGE_SIZE;
      return current > maxOffset ? maxOffset : current;
    });
  }, [filteredMediaItems.length]);

  const visibleMediaItems = useMemo(
    () => filteredMediaItems.slice(pageOffset, pageOffset + MEDIA_LIBRARY_PAGE_SIZE),
    [filteredMediaItems, pageOffset],
  );

  const visibleRangeStart = filteredMediaItems.length === 0 ? 0 : pageOffset + 1;
  const visibleRangeEnd = Math.min(pageOffset + MEDIA_LIBRARY_PAGE_SIZE, filteredMediaItems.length);
  const canShowPrevPage = pageOffset > 0;
  const canShowNextPage = pageOffset + MEDIA_LIBRARY_PAGE_SIZE < filteredMediaItems.length;

  const addLinkedFilterTarget = (candidate: LinkedSearchResult) => {
    if (candidate.kind === "person") {
      setLinkedFilterPersonIds((current) => (current.includes(candidate.personId) ? current : [...current, candidate.personId]));
      return;
    }
    setLinkedFilterHouseholdIds((current) =>
      current.includes(candidate.householdId) ? current : [...current, candidate.householdId],
    );
  };

  const loadSelectedPhotoDetail = async (
    fileId: string,
    options?: { noStore?: boolean; fallbackItem?: MediaItem | null },
  ) => {
    const noCache = options?.noStore ? "?noCache=1" : "";
    const res = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/photos/${encodeURIComponent(fileId)}${noCache}`,
      { cache: options?.noStore ? "no-store" : "default" },
    );
    const body = (await res.json().catch(() => null)) as MediaItemDetailPayload | null;
    if (!res.ok) {
      setPhotoAssociationStatus(`Failed to load media details: ${res.status}`);
      return null;
    }
    const serverItem = body?.item;
    if (!serverItem) {
      return null;
    }
    const fallbackItem = options?.fallbackItem ?? selectedPhotoDetail;
    const mergedItem: MediaItem = {
      fileId: serverItem.fileId,
      name: serverItem.name || fallbackItem?.name || "",
      description: serverItem.description || fallbackItem?.description || "",
      date: serverItem.date || fallbackItem?.date || "",
      createdAt: serverItem.createdAt || fallbackItem?.createdAt || "",
      mediaKind: serverItem.mediaKind || fallbackItem?.mediaKind || "",
      mediaMetadata: serverItem.mediaMetadata || fallbackItem?.mediaMetadata || "",
      exifExtractedAt: serverItem.exifExtractedAt || fallbackItem?.exifExtractedAt || "",
      people: Array.isArray(serverItem.people) ? serverItem.people : [],
      households: Array.isArray(serverItem.households) ? serverItem.households : [],
    };
    applySelectedPhotoDetail(mergedItem, {
      editable: body?.editable ?? false,
      canEditName: body?.canEditName ?? false,
    });
    return mergedItem;
  };

  const openPhotoEditor = async (fileId: string) => {
    setPhotoTagQuery("");
    const prefill = mediaItems.find((item) => item.fileId === fileId) ?? null;
    if (prefill) {
      applySelectedPhotoDetail(prefill, {
        editable: false,
        canEditName: false,
      });
    } else {
      setSelectedPhotoDetail(null);
      setSelectedPhotoEditable(false);
      setSelectedPhotoCanEditName(false);
      setSelectedPhotoName("");
      setSelectedPhotoDescription("");
      setSelectedPhotoDate("");
      setSelectedPhotoAssociations({ people: [], households: [] });
    }
    setPhotoAssociationStatus("Refreshing links...");
    setShowPhotoEditor(true);
    void (async () => {
      await loadSelectedPhotoDetail(fileId, { noStore: true, fallbackItem: prefill });
      setPhotoAssociationStatus("");
    })();
  };

  const saveSelectedPhotoMetadata = async () => {
    if (!selectedPhotoDetail) return;
    setPhotoAssociationBusy(true);
    setPhotoAssociationStatus("Saving media details...");
    try {
      const res = await fetch(
        `/api/t/${encodeURIComponent(tenantKey)}/photos/${encodeURIComponent(selectedPhotoDetail.fileId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: selectedPhotoName,
            description: selectedPhotoDescription,
            date: selectedPhotoDate,
          }),
        },
      );
      const body = (await res.json().catch(() => null)) as MediaItemDetailPayload | { message?: string; error?: string } | null;
      if (!res.ok) {
        const message =
          (body && "message" in body && typeof body.message === "string" && body.message) ||
          (body && "error" in body && typeof body.error === "string" && body.error) ||
          "Failed to save media details";
        throw new Error(message);
      }
      if (body && "item" in body && body.item) {
        applySelectedPhotoDetail(body.item, {
          editable: body.editable ?? false,
          canEditName: body.canEditName ?? false,
        });
      } else {
        await loadSelectedPhotoDetail(selectedPhotoDetail.fileId, { noStore: true });
      }
      setShowPhotoEditor(false);
      setPhotoAssociationStatus("");
      setStatus("Media details saved.");
    } catch (error) {
      setPhotoAssociationStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      setPhotoAssociationBusy(false);
    }
  };

  const linkPhotoToPerson = async (personId: string) => {
    if (!selectedPhotoDetail) return;
    setPhotoAssociationBusy(true);
    setPhotoAssociationStatus("Linking person...");
    try {
      const kind = inferMediaKind(selectedPhotoDetail.fileId, selectedPhotoDetail.mediaMetadata);
      const attributeType = kind === "image" ? "photo" : "media";
      const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(personId)}/attributes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attributeType,
          valueText: selectedPhotoDetail.fileId,
          valueJson: selectedPhotoDetail.mediaMetadata || "",
          label: selectedPhotoName || selectedPhotoDetail.name || "media",
          isPrimary: false,
          sortOrder: 0,
          startDate: selectedPhotoDate || selectedPhotoDetail.date || "",
          endDate: "",
          visibility: "family",
          shareScope: "one_family",
          shareFamilyGroupKey: tenantKey,
          notes: selectedPhotoDescription || selectedPhotoDetail.description || "",
        }),
      });
      await assertOk(res, "Failed to link person");
      await loadSelectedPhotoDetail(selectedPhotoDetail.fileId, { noStore: true });
      setPhotoAssociationStatus("Person linked.");
    } catch (error) {
      setPhotoAssociationStatus(error instanceof Error ? error.message : "Link failed");
    } finally {
      setPhotoAssociationBusy(false);
    }
  };

  const unlinkPhotoFromPerson = async (personId: string) => {
    if (!selectedPhotoDetail) return;
    setPhotoAssociationBusy(true);
    setPhotoAssociationStatus("Removing person link...");
    try {
      const attrsRes = await fetch(
        `/api/t/${encodeURIComponent(tenantKey)}/attributes?entity_type=person&entity_id=${encodeURIComponent(personId)}`,
        { cache: "no-store" },
      );
      const attrsBody = await attrsRes.json().catch(() => null);
      await assertOk(attrsRes, "Failed to load person attributes");
      const attrs = Array.isArray(attrsBody?.attributes) ? (attrsBody.attributes as AttributeWithMedia[]) : [];
      const matches = attrs.filter((item) => matchesCanonicalMediaFileId(item, selectedPhotoDetail.fileId));
      for (const match of matches) {
        const delRes = await fetch(
          `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(personId)}/attributes/${encodeURIComponent(match.attributeId)}`,
          { method: "DELETE" },
        );
        await assertOk(delRes, "Failed to remove person link");
      }
      const unlinkRes = await fetch(
        `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(personId)}/photos/${encodeURIComponent(selectedPhotoDetail.fileId)}`,
        { method: "DELETE" },
      );
      await assertOk(unlinkRes, "Failed to remove person photo link");
      await loadSelectedPhotoDetail(selectedPhotoDetail.fileId, { noStore: true });
      setPhotoAssociationStatus("Person link removed.");
    } catch (error) {
      setPhotoAssociationStatus(error instanceof Error ? error.message : "Remove failed");
    } finally {
      setPhotoAssociationBusy(false);
    }
  };

  const linkPhotoToHousehold = async (householdId: string) => {
    if (!selectedPhotoDetail) return;
    setPhotoAssociationBusy(true);
    setPhotoAssociationStatus("Linking household...");
    try {
      const res = await fetch(
        `/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(householdId)}/photos/link`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileId: selectedPhotoDetail.fileId,
            name: selectedPhotoName || selectedPhotoDetail.name || "photo",
            description: selectedPhotoDescription || selectedPhotoDetail.description || "",
            photoDate: selectedPhotoDate || selectedPhotoDetail.date || "",
            mediaMetadata: selectedPhotoDetail.mediaMetadata || "",
            isPrimary: false,
          }),
        },
      );
      await assertOk(res, "Failed to link household");
      await loadSelectedPhotoDetail(selectedPhotoDetail.fileId, { noStore: true });
      setPhotoAssociationStatus("Household linked.");
    } catch (error) {
      setPhotoAssociationStatus(error instanceof Error ? error.message : "Link failed");
    } finally {
      setPhotoAssociationBusy(false);
    }
  };

  const unlinkPhotoFromHousehold = async (householdId: string) => {
    if (!selectedPhotoDetail) return;
    setPhotoAssociationBusy(true);
    setPhotoAssociationStatus("Removing household link...");
    try {
      const res = await fetch(
        `/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(householdId)}/photos/${encodeURIComponent(selectedPhotoDetail.fileId)}`,
        { method: "DELETE" },
      );
      await assertOk(res, "Failed to remove household link");
      await loadSelectedPhotoDetail(selectedPhotoDetail.fileId, { noStore: true });
      setPhotoAssociationStatus("Household link removed.");
    } catch (error) {
      setPhotoAssociationStatus(error instanceof Error ? error.message : "Remove failed");
    } finally {
      setPhotoAssociationBusy(false);
    }
  };

  const deleteSelectedPhoto = async () => {
    if (!selectedPhotoDetail) return;
    const confirmed = window.confirm(
      "Delete this selected media from all current person/household links? This does not remove the Drive file itself.",
    );
    if (!confirmed) return;
    setPhotoAssociationBusy(true);
    setPhotoAssociationStatus("Deleting selected media links...");
    try {
      for (const person of selectedPhotoAssociations.people) {
        const attrsRes = await fetch(
          `/api/t/${encodeURIComponent(tenantKey)}/attributes?entity_type=person&entity_id=${encodeURIComponent(person.personId)}`,
          { cache: "no-store" },
        );
        const attrsBody = await attrsRes.json().catch(() => null);
        await assertOk(attrsRes, "Failed to load person attributes");
        const attrs = Array.isArray(attrsBody?.attributes) ? (attrsBody.attributes as AttributeWithMedia[]) : [];
        const matches = attrs.filter((item) => matchesCanonicalMediaFileId(item, selectedPhotoDetail.fileId));
        for (const match of matches) {
          const delRes = await fetch(
            `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}/attributes/${encodeURIComponent(match.attributeId)}`,
            { method: "DELETE" },
          );
          await assertOk(delRes, "Failed to remove person media link");
        }
        const unlinkRes = await fetch(
          `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}/photos/${encodeURIComponent(selectedPhotoDetail.fileId)}`,
          { method: "DELETE" },
        );
        await assertOk(unlinkRes, "Failed to remove person photo link");
      }

      for (const household of selectedPhotoAssociations.households) {
        const delRes = await fetch(
          `/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(household.householdId)}/photos/${encodeURIComponent(selectedPhotoDetail.fileId)}`,
          { method: "DELETE" },
        );
        await assertOk(delRes, "Failed to remove household media link");
      }

      await loadLibrary(search.trim(), { noCache: true });
      setSelectedPhotoAssociations({ people: [], households: [] });
      setShowPhotoEditor(false);
      setPhotoAssociationStatus("Selected media links deleted.");
      setStatus("Selected media links deleted.");
    } catch (error) {
      setPhotoAssociationStatus(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setPhotoAssociationBusy(false);
    }
  };

  const applyPhotoTagCandidate = async (candidate: LinkedSearchResult) => {
    setPhotoTagQuery("");
    if (candidate.kind === "person") {
      await linkPhotoToPerson(candidate.personId);
      return;
    }
    await linkPhotoToHousehold(candidate.householdId);
  };

  const handleAttachWizardComplete = async (summary: MediaAttachExecutionSummary) => {
    setStatus(formatMediaAttachUserSummary(summary));
    setPageOffset(0);
    await loadLibrary(search.trim(), { noCache: true });
  };

  return (
    <main className="section">
      <section className="people-hero">
        <div>
          <h1 className="page-title">Media Library</h1>
          <p className="page-subtitle">Attach and catalog media across people and households.</p>
          {status ? <p style={{ marginTop: "0.75rem", marginBottom: 0 }}>{status}</p> : null}
        </div>
        <button type="button" className="button button-primary add-person-trigger" onClick={() => setShowAttachWizard(true)}>
          <span className="button-icon" aria-hidden="true">
            <PlusIcon />
          </span>
          <span>Add Media</span>
        </button>
      </section>

      <MediaAttachWizard
        open={showAttachWizard}
        context={{
          tenantKey,
          source: "library",
          canManage,
          allowHouseholdLinks: canManage,
          defaultAttributeType: "media",
          preselectedPersonIds: linkedFilterPersonIds,
          preselectedHouseholdIds: linkedFilterHouseholdIds,
          peopleOptions,
          householdOptions,
        }}
        onClose={() => setShowAttachWizard(false)}
        onComplete={(summary) => void handleAttachWizardComplete(summary)}
      />

      <div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "0.25rem", alignItems: "stretch", marginBottom: "0.85rem" }}>
          {MEDIA_TYPE_FILTER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={mediaTypeFilter === option.value ? "button tap-button" : "button secondary tap-button"}
              onClick={() => setMediaTypeFilter(option.value)}
              style={{
                minWidth: 0,
                width: "100%",
                paddingInline: "0.35rem",
                paddingBlock: "0.45rem",
                whiteSpace: "normal",
                lineHeight: 1.1,
                fontSize: "0.8rem",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.3rem", width: "100%" }}>
                <span aria-hidden="true" style={{ display: "inline-flex", flex: "0 0 auto" }}>
                  <MediaTypeFilterIcon type={option.value} />
                </span>
                <span>{option.label}</span>
              </span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", flex: "1 1 460px", minWidth: "280px" }}>
            <label className="search-wrap" htmlFor="media-library-search" style={{ flex: "1 1 360px", minWidth: "260px", marginTop: 0 }}>
              <span className="search-icon" aria-hidden="true">
                <SearchIcon />
              </span>
              <input
                id="media-library-search"
                className="search-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by labels and text"
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.9rem" }}>
              <input
                type="checkbox"
                checked={includeDrive}
                onChange={(e) => setIncludeDrive(e.target.checked)}
              />
              Include unlinked Drive files
            </label>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", marginLeft: "auto" }}>
            <span className="page-subtitle" style={{ margin: 0, textAlign: "right" }}>
              Showing {visibleRangeStart}-{visibleRangeEnd} of {filteredMediaItems.length}
            </span>
            {(canShowPrevPage || canShowNextPage) ? (
              <div style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
                {canShowPrevPage ? (
                  <button
                    type="button"
                    className="button secondary tap-button"
                    onClick={() => setPageOffset((current) => Math.max(0, current - MEDIA_LIBRARY_PAGE_SIZE))}
                    style={{ padding: "0.35rem 0.55rem", minWidth: "76px", lineHeight: 1.1 }}
                  >
                    Prev 12
                  </button>
                ) : null}
                {canShowNextPage ? (
                  <button
                    type="button"
                    className="button secondary tap-button"
                    onClick={() => setPageOffset((current) => current + MEDIA_LIBRARY_PAGE_SIZE)}
                    style={{ padding: "0.35rem 0.55rem", minWidth: "76px", lineHeight: 1.1 }}
                  >
                    Next 12
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <label className="label">Selected Linked Filters</label>
        <div className="person-chip-row" style={{ marginTop: "0.3rem" }}>
          {linkedFilterPersonIds.map((personId) => (
            <span key={`filter-selected-person-${personId}`} className="person-linked-row">
              <span className="person-linked-main">
                <span className="person-linked-icon" aria-hidden="true">
                  <img src={getGenderAvatarSrc(peopleById.get(personId)?.gender ?? "unspecified")} alt="" className="person-linked-avatar" />
                </span>
                <span>{peopleById.get(personId)?.displayName || personId}</span>
              </span>
              <button
                type="button"
                className="person-chip-remove"
                onClick={() => setLinkedFilterPersonIds((current) => current.filter((id) => id !== personId))}
                aria-label={`Remove ${peopleById.get(personId)?.displayName || personId}`}
              >
                x
              </button>
            </span>
          ))}
          {linkedFilterHouseholdIds.map((householdId) => (
            <span key={`filter-selected-household-${householdId}`} className="person-linked-row">
              <span className="person-linked-main">
                <span className="person-linked-icon person-linked-icon--household" aria-hidden="true">
                  <HouseholdIcon />
                </span>
                <span>{householdsById.get(householdId)?.label || householdId}</span>
              </span>
              <button
                type="button"
                className="person-chip-remove"
                onClick={() => setLinkedFilterHouseholdIds((current) => current.filter((id) => id !== householdId))}
                aria-label={`Remove ${householdsById.get(householdId)?.label || householdId}`}
              >
                x
              </button>
            </span>
          ))}
          {linkedFilterPersonIds.length === 0 && linkedFilterHouseholdIds.length === 0 ? (
            <span className="status-chip status-chip--neutral">No filters selected</span>
          ) : null}
        </div>
        <label className="label" style={{ marginTop: "0.55rem", marginBottom: 0 }}>Search to Add Linked Filters</label>
        <input
          className="input"
          value={linkedFilterQuery}
          onChange={(e) => setLinkedFilterQuery(e.target.value)}
          placeholder="Type person or household name"
          style={{ maxWidth: "420px" }}
        />
        {linkedFilterQuery.trim() ? (
          <div className="person-typeahead-list" style={{ marginTop: "0.45rem", marginBottom: "0.7rem" }}>
            {linkedFilterSearchResults.length > 0 ? (
              linkedFilterSearchResults.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  className="person-typeahead-item"
                  onClick={() => addLinkedFilterTarget(entry)}
                >
                  <span className="person-linked-main">
                    <span className={`person-linked-icon${entry.kind === "household" ? " person-linked-icon--household" : ""}`} aria-hidden="true">
                      {entry.kind === "person" ? (
                        <img src={getGenderAvatarSrc(entry.gender)} alt="" className="person-linked-avatar" />
                      ) : (
                        <HouseholdIcon />
                      )}
                    </span>
                    <span>{entry.displayName}</span>
                  </span>
                </button>
              ))
            ) : (
              <p className="page-subtitle" style={{ margin: 0 }}>No matching results.</p>
            )}
          </div>
        ) : null}

        {visibleMediaItems.length === 0 ? (
          <p className="page-subtitle" style={{ margin: "0.35rem 0 0" }}>
            No media matches the current search and filters.
          </p>
        ) : null}

        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {visibleMediaItems.map((item) => {
            const kind = readMediaKind(item);
            return (
              <article key={item.fileId} className="card" style={{ padding: "0.6rem" }}>
                <button
                  type="button"
                  onClick={() => void openPhotoEditor(item.fileId)}
                  className="button-ghost tap-button"
                  style={{
                    width: "100%",
                    marginBottom: "0.5rem",
                    minHeight: "120px",
                    display: "grid",
                    placeItems: "center",
                    background: "#f6f7f9",
                    borderRadius: "10px",
                    border: "1px solid var(--border)",
                    padding: 0,
                  }}
                  aria-label={`Edit ${item.name || item.fileId}`}
                >
                  {kind === "video" ? (
                    <video src={getPhotoProxyPath(item.fileId, tenantKey)} controls muted playsInline style={{ width: "100%", maxHeight: "160px", borderRadius: "8px" }} />
                  ) : kind === "audio" ? (
                    <audio src={getPhotoProxyPath(item.fileId, tenantKey)} controls style={{ width: "100%" }} />
                  ) : kind === "document" ? (
                    <div style={{ display: "grid", gap: "0.4rem", placeItems: "center", padding: "1rem", textAlign: "center", color: "#0f4c81" }}>
                      <DocumentIcon />
                      <strong>Document</strong>
                    </div>
                  ) : (
                    <img
                      src={getPhotoPreviewProxyPath(item.fileId, item.mediaMetadata, tenantKey)}
                      alt={item.name || item.fileId}
                      style={{ width: "100%", maxHeight: "160px", objectFit: "cover", objectPosition: "top center", borderRadius: "8px" }}
                    />
                  )}
                </button>
                <div style={{ fontSize: "0.85rem", display: "grid", gap: "0.2rem" }}>
                  <strong style={{ overflowWrap: "anywhere" }}>{item.name || item.fileId}</strong>
                  {item.date ? <span>{item.date}</span> : null}
                  <span>People: {item.people.length} | Households: {item.households.length}</span>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      {showPhotoEditor && selectedPhotoDetail ? (
        <div className="person-modal-backdrop" onClick={(event) => event.stopPropagation()}>
          <div
            className="person-modal-panel"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: "840px", width: "min(840px, 96vw)" }}
          >
            <div className="person-photo-detail-shell">
              <div className="person-photo-detail-card">
                <div className="person-photo-detail-head">
                  <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Edit Media</h4>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      type="button"
                      className="button tap-button"
                      onClick={() => void saveSelectedPhotoMetadata()}
                      disabled={photoAssociationBusy || !selectedPhotoEditable}
                    >
                      Save
                    </button>
                    {canManage ? (
                      <button
                        type="button"
                        className="button secondary tap-button"
                        onClick={() => void deleteSelectedPhoto()}
                        disabled={photoAssociationBusy}
                        style={{ color: "#991b1b", borderColor: "#fecaca", background: "#fff1f2" }}
                      >
                        Delete
                      </button>
                    ) : null}
                    <button type="button" className="button secondary tap-button" onClick={() => setShowPhotoEditor(false)}>
                      Close
                    </button>
                  </div>
                </div>
                <div style={{ marginTop: "0.75rem" }}>
                  {readMediaKind(selectedPhotoDetail) === "video" ? (
                    <video
                      src={getPhotoProxyPath(selectedPhotoDetail.fileId, tenantKey)}
                      className="person-photo-detail-preview"
                      controls
                      playsInline
                    />
                  ) : readMediaKind(selectedPhotoDetail) === "audio" ? (
                    <audio src={getPhotoProxyPath(selectedPhotoDetail.fileId, tenantKey)} className="person-photo-detail-preview" controls />
                  ) : readMediaKind(selectedPhotoDetail) === "document" ? (
                    <div className="person-photo-detail-preview" style={{ display: "grid", placeItems: "center", gap: "0.65rem", alignContent: "center", padding: "1.5rem", textAlign: "center" }}>
                      <span style={{ color: "#0f4c81" }}><DocumentIcon /></span>
                      <strong>{selectedPhotoDetail.name || "Document"}</strong>
                      <a
                        href={getPhotoProxyPath(selectedPhotoDetail.fileId, tenantKey)}
                        target="_blank"
                        rel="noreferrer"
                        className="button secondary tap-button"
                        style={{ textDecoration: "none" }}
                      >
                        Open Document
                      </a>
                    </div>
                  ) : (
                    <img
                      src={getPhotoProxyPath(selectedPhotoDetail.fileId, tenantKey)}
                      alt={selectedPhotoDetail.name || "photo"}
                      className="person-photo-detail-preview"
                    />
                  )}
                </div>
                <div className="card" style={{ marginTop: "0.75rem" }}>
                  <h5 style={{ margin: "0 0 0.5rem" }}>Media Info</h5>
                  <label className="label">Name</label>
                  <input
                    className="input"
                    value={selectedPhotoName}
                    onChange={(event) => setSelectedPhotoName(event.target.value)}
                    disabled={photoAssociationBusy || !selectedPhotoCanEditName}
                  />
                  <label className="label">Description</label>
                  <input
                    className="input"
                    value={selectedPhotoDescription}
                    onChange={(event) => setSelectedPhotoDescription(event.target.value)}
                    disabled={photoAssociationBusy || !selectedPhotoEditable}
                  />
                  <label className="label">Date</label>
                  <input
                    className="input"
                    value={selectedPhotoDate}
                    onChange={(event) => setSelectedPhotoDate(event.target.value)}
                    disabled={photoAssociationBusy || !selectedPhotoEditable}
                  />
                  {/*
                    <div
                      style={{
                        marginTop: "0.65rem",
                        padding: "0.6rem",
                        border: "1px solid var(--border)",
                        borderRadius: "10px",
                        background: "#f8fafc",
                        display: "grid",
                        gap: "0.45rem",
                      }}
                    >
                      <strong style={{ fontSize: "0.9rem" }}>Photo Suggestions</strong>
                      {selectedPhotoIntelligenceSuggestion ? (
                        <>
                      <span className="page-subtitle" style={{ margin: 0 }}>
                        Date source: {selectedPhotoIntelligenceSuggestion.dateSource.replace(/_/g, " ")} ({selectedPhotoIntelligenceSuggestion.dateConfidence})
                      </span>
                      {selectedPhotoIntelligenceSuggestion.visionLabels && selectedPhotoIntelligenceSuggestion.visionLabels.length > 0 ? (
                        <span className="page-subtitle" style={{ margin: 0 }}>
                          Vision labels: {selectedPhotoIntelligenceSuggestion.visionLabels.slice(0, 4).join(", ")}
                        </span>
                      ) : null}
                      {typeof selectedPhotoIntelligenceSuggestion.detectedFaceCount === "number" ? (
                        <span className="page-subtitle" style={{ margin: 0 }}>
                          Faces detected: {selectedPhotoIntelligenceSuggestion.detectedFaceCount}
                        </span>
                      ) : null}
                      <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
                        {selectedPhotoIntelligenceSuggestion.labelSuggestion ? (
                          <button
                            type="button"
                            className="button secondary tap-button"
                            disabled={photoAssociationBusy || photoIntelligenceBusy || !selectedPhotoCanEditName}
                            onClick={() => setSelectedPhotoName(selectedPhotoIntelligenceSuggestion.labelSuggestion)}
                          >
                            Use Title
                          </button>
                        ) : null}
                        {selectedPhotoIntelligenceSuggestion.descriptionSuggestion ? (
                          <button
                            type="button"
                            className="button secondary tap-button"
                            disabled={photoAssociationBusy || photoIntelligenceBusy || !selectedPhotoEditable}
                            onClick={() => setSelectedPhotoDescription(selectedPhotoIntelligenceSuggestion.descriptionSuggestion)}
                          >
                            Use Description
                          </button>
                        ) : null}
                        {selectedPhotoIntelligenceSuggestion.dateSuggestion ? (
                          <button
                            type="button"
                            className="button secondary tap-button"
                            disabled={photoAssociationBusy || photoIntelligenceBusy || !selectedPhotoEditable}
                            onClick={() => setSelectedPhotoDate(selectedPhotoIntelligenceSuggestion.dateSuggestion)}
                          >
                            Use Date
                          </button>
                        ) : null}
                      </div>
                      {selectedPhotoIntelligenceSuggestion.faceSuggestions && selectedPhotoIntelligenceSuggestion.faceSuggestions.length > 0 ? (
                        <div style={{ display: "grid", gap: "0.45rem" }}>
                          <strong style={{ fontSize: "0.88rem" }}>Face Suggestions</strong>
                          {selectedPhotoIntelligenceSuggestion.faceSuggestions.map((face, index) => (
                            <div
                              key={face.faceId || `face-suggestion-${index}`}
                              style={{
                                border: "1px solid #dbe4ee",
                                borderRadius: "10px",
                                padding: "0.55rem 0.65rem",
                                display: "grid",
                                gap: "0.35rem",
                                background: "#fff",
                              }}
                            >
                              <span className="page-subtitle" style={{ margin: 0 }}>
                                Face {index + 1} · quality {formatConfidencePercent(face.qualityScore)} · detection {formatConfidencePercent(face.detectionConfidence)}
                              </span>
                              {face.matches.length > 0 ? (
                                <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
                                  {face.matches.map((match) => (
                                    <span
                                      key={`${face.faceId}-${match.personId}`}
                                      className="status-chip status-chip--neutral"
                                      style={{
                                        background: match.confidenceBand === "high" ? "#ecfdf3" : match.confidenceBand === "medium" ? "#f8fafc" : "#fff7ed",
                                        borderColor: match.confidenceBand === "high" ? "#bbf7d0" : match.confidenceBand === "medium" ? "#dbe4ee" : "#fed7aa",
                                        color: match.confidenceBand === "high" ? "#166534" : match.confidenceBand === "medium" ? "#334155" : "#9a3412",
                                      }}
                                    >
                                      {match.displayName} · {formatConfidencePercent(match.confidenceScore)}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="page-subtitle" style={{ margin: 0 }}>
                                  No candidate people yet.
                                </span>
                              )}
                              <div style={{ display: "grid", gap: "0.4rem", marginTop: "0.15rem" }}>
                                <strong style={{ fontSize: "0.82rem" }}>Associate Face</strong>
                                <div style={{ display: "flex", gap: "0.65rem", alignItems: "flex-start", flexWrap: "wrap" }}>
                                  <FaceCropPreview
                                    fileId={selectedPhotoDetail.fileId}
                                    tenantKey={tenantKey}
                                    bbox={face.bbox}
                                  />
                                  <div style={{ display: "grid", gap: "0.35rem", minWidth: "220px", flex: "1 1 220px" }}>
                                    <select
                                      className="input"
                                      value={faceAssociationSelections[face.faceId] ?? ""}
                                      disabled={photoAssociationBusy || photoIntelligenceBusy || pendingFaceAssociations.has(face.faceId)}
                                      onChange={(event) =>
                                        setFaceAssociationSelections((current) => ({
                                          ...current,
                                          [face.faceId]: event.target.value,
                                        }))}
                                    >
                                      <option value="">Select person...</option>
                                      {peopleOptions.map((person) => (
                                        <option key={`face-person-${face.faceId}-${person.personId}`} value={person.personId}>
                                          {person.displayName}
                                        </option>
                                      ))}
                                    </select>
                                    <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap", alignItems: "center" }}>
                                      <button
                                        type="button"
                                        className="button secondary tap-button"
                                        disabled={
                                          photoAssociationBusy
                                          || photoIntelligenceBusy
                                          || pendingFaceAssociations.has(face.faceId)
                                          || !String(faceAssociationSelections[face.faceId] ?? "").trim()
                                        }
                                        onClick={() => {
                                          void associateFaceToPerson(face.faceId);
                                        }}
                                      >
                                        {pendingFaceAssociations.has(face.faceId) ? "Associating..." : "Associate Face"}
                                      </button>
                                      {confirmedFaceAssociations[face.faceId] ? (
                                        <span className="page-subtitle" style={{ margin: 0 }}>
                                          Saved to {confirmedFaceAssociations[face.faceId]}.
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : typeof selectedPhotoIntelligenceSuggestion.detectedFaceCount === "number" &&
                        selectedPhotoIntelligenceSuggestion.detectedFaceCount > 0 ? (
                        <span className="page-subtitle" style={{ margin: 0 }}>
                          Faces were detected, but no person candidates are ready yet.
                        </span>
                      ) : null}
                        </>
                      ) : (
                        <span className="page-subtitle" style={{ margin: 0 }}>
                          {photoIntelligenceBusy
                            ? "Generating suggestions for this photo..."
                            : "No AI suggestions yet. Use Generate Suggestions to analyze this photo."}
                        </span>
                      )}
                      {selectedPhotoIntelligenceDebug ? (
                        <details style={{ marginTop: "0.25rem" }}>
                          <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>Vision Debug</summary>
                          <div style={{ marginTop: "0.45rem", display: "grid", gap: "0.3rem" }}>
                            <span className="page-subtitle" style={{ margin: 0 }}>
                              configured={String(selectedPhotoIntelligenceDebug.visionConfigured)} attempted={String(selectedPhotoIntelligenceDebug.visionAttempted)} succeeded={String(selectedPhotoIntelligenceDebug.visionSucceeded)}
                            </span>
                            <span className="page-subtitle" style={{ margin: 0 }}>
                              embeddingAttempted={String(selectedPhotoIntelligenceDebug.embeddingAttempted)} embeddingSucceeded={String(selectedPhotoIntelligenceDebug.embeddingSucceeded)} embeddingFacesReturned={String(selectedPhotoIntelligenceDebug.embeddingFacesReturned)} embeddingFacesWithVectors={String(selectedPhotoIntelligenceDebug.embeddingFacesWithVectors)}
                            </span>
                            <span className="page-subtitle" style={{ margin: 0 }}>
                              sourceLoadMs={String(selectedPhotoIntelligenceDebug.sourceLoadLatencyMs)} exifMs={String(selectedPhotoIntelligenceDebug.exifLatencyMs)} visionPrepareMs={String(selectedPhotoIntelligenceDebug.visionPrepareLatencyMs)} visionRequestMs={String(selectedPhotoIntelligenceDebug.visionRequestLatencyMs)} visionTotalMs={String(selectedPhotoIntelligenceDebug.visionTotalLatencyMs)}
                            </span>
                            <span className="page-subtitle" style={{ margin: 0 }}>
                              facePersistMs={String(selectedPhotoIntelligenceDebug.facePersistenceLatencyMs)} captionMs={String(selectedPhotoIntelligenceDebug.captionLatencyMs)} metadataUpdateMs={String(selectedPhotoIntelligenceDebug.metadataUpdateLatencyMs)} routeTotalMs={String(selectedPhotoIntelligenceDebug.routeTotalLatencyMs)}
                            </span>
                            {selectedPhotoIntelligenceDebug.visionErrorMessage ? (
                              <span className="page-subtitle" style={{ margin: 0, color: "#991b1b" }}>
                                {selectedPhotoIntelligenceDebug.visionErrorMessage}
                              </span>
                            ) : null}
                            {selectedPhotoIntelligenceDebug.embeddingErrorMessage ? (
                              <span className="page-subtitle" style={{ margin: 0, color: "#991b1b" }}>
                                {selectedPhotoIntelligenceDebug.embeddingErrorMessage}
                              </span>
                            ) : null}
                            {(selectedPhotoIntelligenceDebug.visionErrorCode || selectedPhotoIntelligenceDebug.visionStatusCode || selectedPhotoIntelligenceDebug.visionServiceCode || selectedPhotoIntelligenceDebug.visionOpcRequestId) ? (
                              <span className="page-subtitle" style={{ margin: 0 }}>
                                code={selectedPhotoIntelligenceDebug.visionErrorCode || "-"} status={selectedPhotoIntelligenceDebug.visionStatusCode || "-"} service={selectedPhotoIntelligenceDebug.visionServiceCode || "-"} requestId={selectedPhotoIntelligenceDebug.visionOpcRequestId || "-"}
                              </span>
                            ) : null}
                            {selectedPhotoIntelligenceDebug.visionRawResult ? (
                              <textarea className="textarea" readOnly value={selectedPhotoIntelligenceDebug.visionRawResult} style={{ minHeight: "120px" }} />
                            ) : (
                              <span className="page-subtitle" style={{ margin: 0 }}>
                                No raw Vision result captured.
                              </span>
                            )}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  */}
                  {!selectedPhotoEditable ? (
                    <p className="page-subtitle" style={{ marginTop: "0.5rem", marginBottom: 0 }}>
                      Link this file to a person or household before editing app metadata.
                    </p>
                  ) : null}
                </div>
                <div className="person-photo-tags-card card">
                  <h5 style={{ margin: "0 0 0.5rem" }}>Linked To</h5>
                  <label className="label">Selected Links</label>
                  <div className="person-association-list">
                    {selectedPhotoAssociations.people.map((item) => (
                      <span key={`editor-person-${item.personId}`} className="person-linked-row">
                        <span className="person-linked-main">
                          <span className="person-linked-icon" aria-hidden="true">
                            <img
                              src={getGenderAvatarSrc(peopleById.get(item.personId)?.gender ?? "unspecified")}
                              alt=""
                              className="person-linked-avatar"
                            />
                          </span>
                          <span>{item.displayName}</span>
                        </span>
                        <button
                          type="button"
                          className="person-chip-remove"
                          disabled={photoAssociationBusy || pendingPhotoOps.has(`p-${item.personId}`)}
                          onClick={() => {
                            const key = `p-${item.personId}`;
                            setPendingPhotoOps((current) => new Set(current).add(key));
                            void (async () => {
                              await unlinkPhotoFromPerson(item.personId);
                              setPendingPhotoOps((current) => {
                                const next = new Set(current);
                                next.delete(key);
                                return next;
                              });
                            })();
                          }}
                          aria-label={`Remove ${item.displayName} from photo`}
                        >
                          {pendingPhotoOps.has(`p-${item.personId}`) ? "..." : "x"}
                        </button>
                      </span>
                    ))}
                    {selectedPhotoAssociations.households.map((item) => (
                      <span key={`editor-household-${item.householdId}`} className="person-linked-row">
                        <span className="person-linked-main">
                          <span className="person-linked-icon person-linked-icon--household" aria-hidden="true">
                            <HouseholdIcon />
                          </span>
                          <span>{item.label || item.householdId}</span>
                        </span>
                        <button
                          type="button"
                          className="person-chip-remove"
                          disabled={photoAssociationBusy || pendingPhotoOps.has(`h-${item.householdId}`)}
                          onClick={() => {
                            const key = `h-${item.householdId}`;
                            setPendingPhotoOps((current) => new Set(current).add(key));
                            void (async () => {
                              await unlinkPhotoFromHousehold(item.householdId);
                              setPendingPhotoOps((current) => {
                                const next = new Set(current);
                                next.delete(key);
                                return next;
                              });
                            })();
                          }}
                          aria-label={`Remove ${item.label || item.householdId} from photo`}
                        >
                          {pendingPhotoOps.has(`h-${item.householdId}`) ? "..." : "x"}
                        </button>
                      </span>
                    ))}
                    {selectedPhotoAssociations.people.length === 0 && selectedPhotoAssociations.households.length === 0 ? (
                      <span className="status-chip status-chip--neutral">None</span>
                    ) : null}
                  </div>
                  <label className="label" style={{ marginTop: "0.75rem" }}>Search to Add Links</label>
                  <input
                    className="input"
                    value={photoTagQuery}
                    onChange={(e) => setPhotoTagQuery(e.target.value)}
                    placeholder="Search people, households"
                    disabled={photoAssociationBusy}
                  />
                  {photoTagQuery.trim() ? (
                    <div className="person-typeahead-list">
                      {photoTagSearchResults.length > 0 ? (
                        photoTagSearchResults.map((entry) => (
                          <button
                            key={entry.key}
                            type="button"
                            className="person-typeahead-item"
                            onClick={() => void applyPhotoTagCandidate(entry)}
                            disabled={photoAssociationBusy}
                          >
                            <span className="person-linked-main">
                              <span className={`person-linked-icon${entry.kind === "household" ? " person-linked-icon--household" : ""}`} aria-hidden="true">
                                {entry.kind === "person" ? (
                                  <img src={getGenderAvatarSrc(entry.gender)} alt="" className="person-linked-avatar" />
                                ) : (
                                  <HouseholdIcon />
                                )}
                              </span>
                              <span>{entry.displayName}</span>
                            </span>
                          </button>
                        ))
                      ) : (
                        <p className="page-subtitle" style={{ margin: 0 }}>No matching results.</p>
                      )}
                    </div>
                  ) : null}
                  {photoAssociationStatus ? <p className="page-subtitle" style={{ marginTop: "0.65rem" }}>{photoAssociationStatus}</p> : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
