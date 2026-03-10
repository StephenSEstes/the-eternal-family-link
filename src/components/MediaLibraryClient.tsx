"use client";

import { useEffect, useMemo, useState } from "react";
import { getPhotoProxyPath } from "@/lib/google/photo-path";
import { MediaAttachWizard, formatMediaAttachUserSummary } from "@/components/media/MediaAttachWizard";
import type { MediaAttachExecutionSummary } from "@/lib/media/attach-orchestrator";

type MediaLibraryClientProps = {
  tenantKey: string;
  canManage: boolean;
};

type MediaItem = {
  fileId: string;
  name: string;
  description: string;
  date: string;
  mediaMetadata?: string;
  people: Array<{ personId: string; displayName: string }>;
  households: Array<{ householdId: string; label: string }>;
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

function inferMediaKind(fileId: string, rawMetadata?: string) {
  if (rawMetadata) {
    try {
      const parsed = JSON.parse(rawMetadata) as { mediaKind?: string; mimeType?: string };
      const kind = (parsed.mediaKind ?? "").toLowerCase();
      if (kind === "video" || kind === "audio" || kind === "image") return kind;
      const mime = (parsed.mimeType ?? "").toLowerCase();
      if (mime.startsWith("video/")) return "video";
      if (mime.startsWith("audio/")) return "audio";
      if (mime.startsWith("image/")) return "image";
    } catch {
      // Ignore malformed metadata and fall back to file extension.
    }
  }
  const lower = fileId.toLowerCase();
  if (lower.endsWith(".mp4") || lower.endsWith(".mov") || lower.endsWith(".webm")) return "video";
  if (lower.endsWith(".mp3") || lower.endsWith(".m4a") || lower.endsWith(".wav") || lower.endsWith(".ogg")) return "audio";
  return "image";
}

async function assertOk(res: Response, fallbackMessage: string) {
  if (res.ok) return;
  const body = await res.json().catch(() => null);
  const message = body?.message || body?.error || fallbackMessage;
  throw new Error(String(message));
}

const INITIAL_MEDIA_LIBRARY_LIMIT = 100;
const SEARCH_MEDIA_LIBRARY_LIMIT = 5000;

export function MediaLibraryClient({ tenantKey, canManage }: MediaLibraryClientProps) {
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [peopleOptions, setPeopleOptions] = useState<PersonOption[]>([]);
  const [householdOptions, setHouseholdOptions] = useState<HouseholdOption[]>([]);
  const [search, setSearch] = useState("");
  const [includeDrive, setIncludeDrive] = useState(false);
  const [status, setStatus] = useState("");
  const [showAttachWizard, setShowAttachWizard] = useState(false);
  const [showPhotoEditor, setShowPhotoEditor] = useState(false);
  const [selectedPhotoFileId, setSelectedPhotoFileId] = useState("");
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

  const loadLibrary = async (query = "", options?: { noCache?: boolean }) => {
    const normalizedQuery = query.trim();
    const limit = normalizedQuery ? SEARCH_MEDIA_LIBRARY_LIMIT : INITIAL_MEDIA_LIBRARY_LIMIT;
    const noCache = options?.noCache ? "&noCache=1" : "";
    const res = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/photos/search?q=${encodeURIComponent(normalizedQuery)}&limit=${limit}&includeDrive=${includeDrive ? "1" : "0"}${noCache}`,
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

  const peopleById = useMemo(() => new Map(peopleOptions.map((item) => [item.personId, item])), [peopleOptions]);
  const householdsById = useMemo(() => new Map(householdOptions.map((item) => [item.householdId, item])), [householdOptions]);
  const selectedPhotoItem = useMemo(
    () => mediaItems.find((item) => item.fileId === selectedPhotoFileId) ?? null,
    [mediaItems, selectedPhotoFileId],
  );

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

  const visibleMediaItems = useMemo(() => {
    if (linkedFilterPersonIds.length === 0 && linkedFilterHouseholdIds.length === 0) return mediaItems;
    const personSet = new Set(linkedFilterPersonIds);
    const householdSet = new Set(linkedFilterHouseholdIds);
    return mediaItems.filter((item) => {
      const hasPerson = item.people.some((entry) => personSet.has(entry.personId));
      const hasHousehold = item.households.some((entry) => householdSet.has(entry.householdId));
      return hasPerson || hasHousehold;
    });
  }, [mediaItems, linkedFilterPersonIds, linkedFilterHouseholdIds]);

  const addLinkedFilterTarget = (candidate: LinkedSearchResult) => {
    if (candidate.kind === "person") {
      setLinkedFilterPersonIds((current) => (current.includes(candidate.personId) ? current : [...current, candidate.personId]));
      return;
    }
    setLinkedFilterHouseholdIds((current) =>
      current.includes(candidate.householdId) ? current : [...current, candidate.householdId],
    );
  };

  const loadSelectedPhotoAssociations = async (
    fileId: string,
    options?: { noStore?: boolean; includeDrive?: boolean },
  ) => {
    const includeDrive = options?.includeDrive ?? false;
    const noCache = options?.noStore ? "&noCache=1" : "";
    const res = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/photos/search?q=${encodeURIComponent(fileId)}&limit=40&includeDrive=${includeDrive ? "1" : "0"}${noCache}`,
      { cache: options?.noStore ? "no-store" : "default" },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setPhotoAssociationStatus(`Failed to load links: ${res.status}`);
      return;
    }
    const items = Array.isArray(body?.items) ? (body.items as MediaItem[]) : [];
    const match = items.find((item) => item.fileId === fileId) ?? null;
    if (!match) {
      setSelectedPhotoAssociations({ people: [], households: [] });
      return;
    }
    setSelectedPhotoAssociations({
      people: Array.isArray(match.people) ? match.people : [],
      households: Array.isArray(match.households) ? match.households : [],
    });
  };

  const openPhotoEditor = async (fileId: string) => {
    setSelectedPhotoFileId(fileId);
    setPhotoTagQuery("");
    const prefill = mediaItems.find((item) => item.fileId === fileId) ?? null;
    if (prefill) {
      setSelectedPhotoAssociations({
        people: Array.isArray(prefill.people) ? prefill.people : [],
        households: Array.isArray(prefill.households) ? prefill.households : [],
      });
    } else {
      setSelectedPhotoAssociations({ people: [], households: [] });
    }
    setPhotoAssociationStatus("Refreshing links...");
    setShowPhotoEditor(true);
    void (async () => {
      await loadSelectedPhotoAssociations(fileId, { noStore: true, includeDrive: false });
      setPhotoAssociationStatus("");
    })();
  };

  const linkPhotoToPerson = async (personId: string) => {
    if (!selectedPhotoItem) return;
    setPhotoAssociationBusy(true);
    setPhotoAssociationStatus("Linking person...");
    try {
      const kind = inferMediaKind(selectedPhotoItem.fileId, selectedPhotoItem.mediaMetadata);
      const attributeType = kind === "image" ? "photo" : "media";
      const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(personId)}/attributes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attributeType,
          valueText: selectedPhotoItem.fileId,
          valueJson: selectedPhotoItem.mediaMetadata || "",
          label: selectedPhotoItem.name || "media",
          isPrimary: false,
          sortOrder: 0,
          startDate: selectedPhotoItem.date || "",
          endDate: "",
          visibility: "family",
          shareScope: "one_family",
          shareFamilyGroupKey: tenantKey,
          notes: selectedPhotoItem.description || "",
        }),
      });
      await assertOk(res, "Failed to link person");
      await loadSelectedPhotoAssociations(selectedPhotoItem.fileId, { noStore: true, includeDrive: false });
      await loadLibrary(search, { noCache: true });
      setPhotoAssociationStatus("Person linked.");
    } catch (error) {
      setPhotoAssociationStatus(error instanceof Error ? error.message : "Link failed");
    } finally {
      setPhotoAssociationBusy(false);
    }
  };

  const unlinkPhotoFromPerson = async (personId: string) => {
    if (!selectedPhotoItem) return;
    setPhotoAssociationBusy(true);
    setPhotoAssociationStatus("Removing person link...");
    try {
      const attrsRes = await fetch(
        `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(personId)}/attributes`,
        { cache: "no-store" },
      );
      const attrsBody = await attrsRes.json().catch(() => null);
      await assertOk(attrsRes, "Failed to load person attributes");
      const attrs = Array.isArray(attrsBody?.attributes)
        ? (attrsBody.attributes as Array<{ attributeId: string; attributeType: string; valueText: string }>)
        : [];
      const matches = attrs.filter((item) => {
        const type = item.attributeType.toLowerCase();
        return ["photo", "video", "audio", "media"].includes(type) && item.valueText.trim() === selectedPhotoItem.fileId;
      });
      for (const match of matches) {
        const delRes = await fetch(
          `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(personId)}/attributes/${encodeURIComponent(match.attributeId)}`,
          { method: "DELETE" },
        );
        await assertOk(delRes, "Failed to remove person link");
      }
      const unlinkRes = await fetch(
        `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(personId)}/photos/${encodeURIComponent(selectedPhotoItem.fileId)}`,
        { method: "DELETE" },
      );
      await assertOk(unlinkRes, "Failed to remove person photo link");
      await loadSelectedPhotoAssociations(selectedPhotoItem.fileId, { noStore: true, includeDrive: false });
      await loadLibrary(search, { noCache: true });
      setPhotoAssociationStatus("Person link removed.");
    } catch (error) {
      setPhotoAssociationStatus(error instanceof Error ? error.message : "Remove failed");
    } finally {
      setPhotoAssociationBusy(false);
    }
  };

  const linkPhotoToHousehold = async (householdId: string) => {
    if (!selectedPhotoItem) return;
    setPhotoAssociationBusy(true);
    setPhotoAssociationStatus("Linking household...");
    try {
      const res = await fetch(
        `/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(householdId)}/photos/link`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileId: selectedPhotoItem.fileId,
            name: selectedPhotoItem.name || "photo",
            description: selectedPhotoItem.description || "",
            photoDate: selectedPhotoItem.date || "",
            mediaMetadata: selectedPhotoItem.mediaMetadata || "",
            isPrimary: false,
          }),
        },
      );
      await assertOk(res, "Failed to link household");
      await loadSelectedPhotoAssociations(selectedPhotoItem.fileId, { noStore: true, includeDrive: false });
      await loadLibrary(search, { noCache: true });
      setPhotoAssociationStatus("Household linked.");
    } catch (error) {
      setPhotoAssociationStatus(error instanceof Error ? error.message : "Link failed");
    } finally {
      setPhotoAssociationBusy(false);
    }
  };

  const unlinkPhotoFromHousehold = async (householdId: string) => {
    if (!selectedPhotoItem) return;
    setPhotoAssociationBusy(true);
    setPhotoAssociationStatus("Removing household link...");
    try {
      const res = await fetch(
        `/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(householdId)}/photos/${encodeURIComponent(selectedPhotoItem.fileId)}`,
        { method: "DELETE" },
      );
      await assertOk(res, "Failed to remove household link");
      await loadSelectedPhotoAssociations(selectedPhotoItem.fileId, { noStore: true, includeDrive: false });
      await loadLibrary(search, { noCache: true });
      setPhotoAssociationStatus("Household link removed.");
    } catch (error) {
      setPhotoAssociationStatus(error instanceof Error ? error.message : "Remove failed");
    } finally {
      setPhotoAssociationBusy(false);
    }
  };

  const deleteSelectedPhoto = async () => {
    if (!selectedPhotoItem) return;
    const confirmed = window.confirm(
      "Delete this selected media from all current person/household links? This does not remove the Drive file itself.",
    );
    if (!confirmed) return;
    setPhotoAssociationBusy(true);
    setPhotoAssociationStatus("Deleting selected media links...");
    try {
      for (const person of selectedPhotoAssociations.people) {
        const attrsRes = await fetch(
          `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}/attributes`,
          { cache: "no-store" },
        );
        const attrsBody = await attrsRes.json().catch(() => null);
        await assertOk(attrsRes, "Failed to load person attributes");
        const attrs = Array.isArray(attrsBody?.attributes)
          ? (attrsBody.attributes as Array<{ attributeId: string; attributeType: string; valueText: string }>)
          : [];
        const matches = attrs.filter((item) => {
          const type = item.attributeType.toLowerCase();
          return ["photo", "video", "audio", "media"].includes(type) && item.valueText.trim() === selectedPhotoItem.fileId;
        });
        for (const match of matches) {
          const delRes = await fetch(
            `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}/attributes/${encodeURIComponent(match.attributeId)}`,
            { method: "DELETE" },
          );
          await assertOk(delRes, "Failed to remove person media link");
        }
        const unlinkRes = await fetch(
          `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}/photos/${encodeURIComponent(selectedPhotoItem.fileId)}`,
          { method: "DELETE" },
        );
        await assertOk(unlinkRes, "Failed to remove person photo link");
      }

      for (const household of selectedPhotoAssociations.households) {
        const delRes = await fetch(
          `/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(household.householdId)}/photos/${encodeURIComponent(selectedPhotoItem.fileId)}`,
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
    await loadLibrary(search.trim(), { noCache: true });
  };

  return (
    <main className="section">
      <div className="card" style={{ marginBottom: "1rem" }}>
        <h1 className="page-title" style={{ marginBottom: "0.25rem" }}>Media Library</h1>
        <p className="page-subtitle" style={{ marginBottom: "1rem" }}>
          Attach and catalog images across people and households.
        </p>
        <button type="button" className="button tap-button" onClick={() => setShowAttachWizard(true)}>
          Add Media
        </button>

        {status ? <p style={{ marginTop: "0.75rem" }}>{status}</p> : null}
      </div>

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

      <div className="card">
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap" }}>
          <strong>Library</strong>
          <input
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files, people, households"
            style={{ maxWidth: "360px" }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.9rem" }}>
            <input
              type="checkbox"
              checked={includeDrive}
              onChange={(e) => setIncludeDrive(e.target.checked)}
            />
            Include unlinked Drive files
          </label>
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
        <label className="label" style={{ marginTop: "0.55rem" }}>Search to Add Linked Filters</label>
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

        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {visibleMediaItems.map((item) => {
            const kind = inferMediaKind(item.fileId, item.mediaMetadata);
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
                  ) : (
                    <img
                      src={getPhotoProxyPath(item.fileId, tenantKey)}
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
      {showPhotoEditor && selectedPhotoItem ? (
        <div className="person-modal-backdrop" onClick={() => setShowPhotoEditor(false)}>
          <div
            className="person-modal-panel"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: "840px", width: "min(840px, 96vw)" }}
          >
            <div className="person-photo-detail-shell">
              <div className="person-photo-detail-card">
                <div className="person-photo-detail-head">
                  <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Edit Photo</h4>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
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
                  {inferMediaKind(selectedPhotoItem.fileId, selectedPhotoItem.mediaMetadata) === "video" ? (
                    <video
                      src={getPhotoProxyPath(selectedPhotoItem.fileId, tenantKey)}
                      className="person-photo-detail-preview"
                      controls
                      playsInline
                    />
                  ) : inferMediaKind(selectedPhotoItem.fileId, selectedPhotoItem.mediaMetadata) === "audio" ? (
                    <audio src={getPhotoProxyPath(selectedPhotoItem.fileId, tenantKey)} className="person-photo-detail-preview" controls />
                  ) : (
                    <img
                      src={getPhotoProxyPath(selectedPhotoItem.fileId, tenantKey)}
                      alt={selectedPhotoItem.name || "photo"}
                      className="person-photo-detail-preview"
                    />
                  )}
                </div>
                <div className="card" style={{ marginTop: "0.75rem" }}>
                  <h5 style={{ margin: "0 0 0.5rem" }}>Photo Info</h5>
                  <label className="label">Name</label>
                  <input className="input" value={selectedPhotoItem.name || ""} disabled />
                  <label className="label">Description</label>
                  <input className="input" value={selectedPhotoItem.description || ""} disabled />
                  <label className="label">Date</label>
                  <input className="input" value={selectedPhotoItem.date || ""} disabled />
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
