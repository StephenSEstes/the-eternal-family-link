"use client";

import { useEffect, useMemo, useState } from "react";
import { getPhotoProxyPath } from "@/lib/google/photo-path";

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
};

type HouseholdOption = {
  householdId: string;
  label: string;
};

type ClientMediaMetadata = {
  mediaKind: "image" | "video" | "audio";
  mimeType: string;
  width?: number;
  height?: number;
  durationSec?: number;
  fileSizeBytes?: number;
};

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

function fileToMetadata(file: File): Promise<ClientMediaMetadata> {
  const mimeType = file.type || "application/octet-stream";
  const mediaKind = mimeType.startsWith("video/") ? "video" : mimeType.startsWith("audio/") ? "audio" : "image";
  const result: ClientMediaMetadata = {
    mediaKind,
    mimeType,
    fileSizeBytes: Number.isFinite(file.size) ? file.size : undefined,
  };
  if (mediaKind === "image") {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        result.width = img.naturalWidth;
        result.height = img.naturalHeight;
        URL.revokeObjectURL(url);
        resolve(result);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(result);
      };
      img.src = url;
    });
  }
  return new Promise((resolve) => {
    const media = document.createElement(mediaKind === "video" ? "video" : "audio");
    const url = URL.createObjectURL(file);
    media.preload = "metadata";
    media.onloadedmetadata = () => {
      if (Number.isFinite(media.duration)) {
        result.durationSec = Math.max(0, media.duration);
      }
      if (mediaKind === "video") {
        const video = media as HTMLVideoElement;
        result.width = video.videoWidth;
        result.height = video.videoHeight;
      }
      URL.revokeObjectURL(url);
      resolve(result);
    };
    media.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(result);
    };
    media.src = url;
  });
}

async function assertOk(res: Response, fallbackMessage: string) {
  if (res.ok) return;
  const body = await res.json().catch(() => null);
  const message = body?.message || body?.error || fallbackMessage;
  throw new Error(String(message));
}

export function MediaLibraryClient({ tenantKey, canManage }: MediaLibraryClientProps) {
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [peopleOptions, setPeopleOptions] = useState<PersonOption[]>([]);
  const [householdOptions, setHouseholdOptions] = useState<HouseholdOption[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [category, setCategory] = useState("");
  const [photoDate, setPhotoDate] = useState("");
  const [entitySearch, setEntitySearch] = useState("");
  const [selectedPersonIds, setSelectedPersonIds] = useState<string[]>([]);
  const [selectedHouseholdIds, setSelectedHouseholdIds] = useState<string[]>([]);

  const appendSelectedFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const incoming = Array.from(files);
    setSelectedFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}|${file.size}|${file.lastModified}`));
      const next = [...current];
      for (const file of incoming) {
        const key = `${file.name}|${file.size}|${file.lastModified}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(file);
      }
      return next;
    });
  };

  const removeSelectedFile = (fileToRemove: File) => {
    const targetKey = `${fileToRemove.name}|${fileToRemove.size}|${fileToRemove.lastModified}`;
    setSelectedFiles((current) =>
      current.filter((file) => `${file.name}|${file.size}|${file.lastModified}` !== targetKey),
    );
  };

  const loadLibrary = async (query = "") => {
    const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/photos/search?q=${encodeURIComponent(query)}`);
    await assertOk(res, "Failed to load media library");
    const body = (await res.json()) as { items?: MediaItem[] };
    setMediaItems(Array.isArray(body.items) ? body.items : []);
  };

  useEffect(() => {
    void loadLibrary();
  }, [tenantKey]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadLibrary(search.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    void (async () => {
      const peopleRes = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/people`);
      const peopleBody = await peopleRes.json().catch(() => null);
      if (peopleRes.ok) {
        const items: Array<{ personId?: string; displayName?: string }> = Array.isArray(peopleBody?.items)
          ? peopleBody.items
          : [];
        setPeopleOptions(
          items
            .map((item) => ({ personId: String(item.personId ?? ""), displayName: String(item.displayName ?? "") }))
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

  const filteredPeopleOptions = useMemo(() => {
    const q = entitySearch.trim().toLowerCase();
    if (!q) return peopleOptions;
    return peopleOptions.filter((item) => item.displayName.toLowerCase().includes(q));
  }, [entitySearch, peopleOptions]);

  const filteredHouseholdOptions = useMemo(() => {
    const q = entitySearch.trim().toLowerCase();
    if (!q) return householdOptions;
    return householdOptions.filter((item) => item.label.toLowerCase().includes(q));
  }, [entitySearch, householdOptions]);

  const toggleSelected = (list: string[], value: string, setList: (next: string[]) => void) => {
    if (list.includes(value)) {
      setList(list.filter((item) => item !== value));
      return;
    }
    setList([...list, value]);
  };

  const uploadOneFile = async (file: File) => {
    const mediaMeta = await fileToMetadata(file);
    const metaJson = JSON.stringify(mediaMeta);
    const hasPeople = selectedPersonIds.length > 0;
    const hasHouseholds = selectedHouseholdIds.length > 0;
    if (!hasPeople && !hasHouseholds) {
      throw new Error("Select at least one person or household to attach.");
    }

    let fileId = "";
    let uploadedViaHouseholdId = "";
    let uploadedViaPersonId = "";

    if (hasPeople) {
      uploadedViaPersonId = selectedPersonIds[0];
      const form = new FormData();
      form.append("file", file);
      form.append("label", category.trim());
      form.append("date", photoDate.trim());
      form.append("description", "");
      form.append("isHeadshot", "false");
      form.append("attributeType", "media");
      if (typeof mediaMeta.width === "number") form.append("mediaWidth", String(Math.round(mediaMeta.width)));
      if (typeof mediaMeta.height === "number") form.append("mediaHeight", String(Math.round(mediaMeta.height)));
      if (typeof mediaMeta.durationSec === "number") form.append("mediaDurationSec", String(mediaMeta.durationSec));
      const uploadRes = await fetch(
        `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(uploadedViaPersonId)}/photos/upload`,
        {
          method: "POST",
          body: form,
        },
      );
      await assertOk(uploadRes, "Person media upload failed");
      const uploadBody = await uploadRes.json().catch(() => null);
      fileId = String(uploadBody?.fileId ?? "").trim();
    } else {
      uploadedViaHouseholdId = selectedHouseholdIds[0];
      const form = new FormData();
      form.append("file", file);
      form.append("name", category.trim());
      form.append("date", photoDate.trim());
      form.append("description", "");
      form.append("isPrimary", "false");
      if (typeof mediaMeta.width === "number") form.append("mediaWidth", String(Math.round(mediaMeta.width)));
      if (typeof mediaMeta.height === "number") form.append("mediaHeight", String(Math.round(mediaMeta.height)));
      if (typeof mediaMeta.durationSec === "number") form.append("mediaDurationSec", String(mediaMeta.durationSec));
      const uploadRes = await fetch(
        `/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(uploadedViaHouseholdId)}/photos/upload`,
        {
          method: "POST",
          body: form,
        },
      );
      await assertOk(uploadRes, "Household media upload failed");
      const uploadBody = await uploadRes.json().catch(() => null);
      fileId = String(uploadBody?.fileId ?? "").trim();
    }

    if (!fileId) {
      throw new Error("Upload completed but no file ID was returned.");
    }

    for (const personId of selectedPersonIds) {
      if (personId === uploadedViaPersonId) continue;
      const addRes = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(personId)}/attributes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attributeType: "media",
          valueText: fileId,
          valueJson: metaJson,
          label: category.trim(),
          isPrimary: false,
          sortOrder: 0,
          startDate: photoDate.trim(),
          endDate: "",
          visibility: "family",
          shareScope: "both_families",
          notes: "",
        }),
      });
      await assertOk(addRes, `Failed to attach media to person ${personId}`);
    }

    if (selectedHouseholdIds.length > 0) {
      if (!canManage) {
        throw new Error("Household attachments require ADMIN access.");
      }
      for (const householdId of selectedHouseholdIds) {
        if (householdId === uploadedViaHouseholdId) continue;
        const linkRes = await fetch(
          `/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(householdId)}/photos/link`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileId,
              name: category.trim(),
              description: "",
              photoDate: photoDate.trim(),
              mediaMetadata: metaJson,
            }),
          },
        );
        await assertOk(linkRes, `Failed to attach media to household ${householdId}`);
      }
    }
  };

  const uploadAll = async () => {
    if (selectedFiles.length === 0) {
      setStatus("Select one or more files first.");
      return;
    }
    if (selectedPersonIds.length === 0 && selectedHouseholdIds.length === 0) {
      setStatus("Select at least one person or household.");
      return;
    }

    setBusy(true);
    setStatus(`Uploading ${selectedFiles.length} file(s)...`);
    try {
      for (const file of selectedFiles) {
        await uploadOneFile(file);
      }
      setStatus(`Uploaded and linked ${selectedFiles.length} file(s).`);
      setSelectedFiles([]);
      setCategory("");
      setPhotoDate("");
      await loadLibrary(search.trim());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="section">
      <div className="card" style={{ marginBottom: "1rem" }}>
        <h1 className="page-title" style={{ marginBottom: "0.25rem" }}>Media Library</h1>
        <p className="page-subtitle" style={{ marginBottom: "1rem" }}>
          Upload photos and videos, add category/date, and attach to people or households.
        </p>

        <div style={{ display: "grid", gap: "0.75rem" }}>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span style={{ fontWeight: 600 }}>Files</span>
            <input
              className="input"
              type="file"
              multiple
              accept="image/*,video/*,audio/*"
              onChange={(e) => {
                appendSelectedFiles(e.target.files);
                e.currentTarget.value = "";
              }}
              disabled={busy}
            />
          </label>
          {selectedFiles.length > 0 ? (
            <div className="card" style={{ padding: "0.6rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
                <strong>{selectedFiles.length} file(s) selected</strong>
                <button
                  type="button"
                  className="button button-ghost tap-button"
                  onClick={() => setSelectedFiles([])}
                  disabled={busy}
                >
                  Clear all
                </button>
              </div>
              <div style={{ marginTop: "0.5rem", maxHeight: "140px", overflow: "auto", display: "grid", gap: "0.35rem" }}>
                {selectedFiles.map((file) => (
                  <div
                    key={`${file.name}|${file.size}|${file.lastModified}`}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}
                  >
                    <span style={{ fontSize: "0.85rem", overflowWrap: "anywhere" }}>
                      {file.name} ({Math.max(1, Math.round(file.size / 1024))} KB)
                    </span>
                    <button
                      type="button"
                      className="button button-ghost tap-button"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => removeSelectedFile(file)}
                      disabled={busy}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span style={{ fontWeight: 600 }}>Category</span>
              <input
                className="input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g., Reunion 2026"
                disabled={busy}
              />
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span style={{ fontWeight: 600 }}>Date</span>
              <input className="input" type="date" value={photoDate} onChange={(e) => setPhotoDate(e.target.value)} disabled={busy} />
            </label>
          </div>

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span style={{ fontWeight: 600 }}>Attach Targets</span>
            <input
              className="input"
              value={entitySearch}
              onChange={(e) => setEntitySearch(e.target.value)}
              placeholder="Search people or households"
              disabled={busy}
            />
          </label>

          <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            <div className="card" style={{ padding: "0.75rem", maxHeight: "180px", overflow: "auto" }}>
              <strong style={{ display: "block", marginBottom: "0.5rem" }}>People</strong>
              {filteredPeopleOptions.map((item) => (
                <label key={item.personId} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
                  <input
                    type="checkbox"
                    checked={selectedPersonIds.includes(item.personId)}
                    onChange={() => toggleSelected(selectedPersonIds, item.personId, setSelectedPersonIds)}
                    disabled={busy}
                  />
                  <span>{item.displayName}</span>
                </label>
              ))}
            </div>

            <div className="card" style={{ padding: "0.75rem", maxHeight: "180px", overflow: "auto" }}>
              <strong style={{ display: "block", marginBottom: "0.5rem" }}>Households</strong>
              {!canManage ? <p className="page-subtitle">Admin only</p> : null}
              {filteredHouseholdOptions.map((item) => (
                <label key={item.householdId} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
                  <input
                    type="checkbox"
                    checked={selectedHouseholdIds.includes(item.householdId)}
                    onChange={() => toggleSelected(selectedHouseholdIds, item.householdId, setSelectedHouseholdIds)}
                    disabled={busy || !canManage}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </div>

          <button type="button" className="button tap-button" onClick={() => void uploadAll()} disabled={busy}>
            {busy ? "Uploading..." : "Upload and Attach"}
          </button>
        </div>

        {status ? <p style={{ marginTop: "0.75rem" }}>{status}</p> : null}
      </div>

      <div className="card">
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "0.75rem" }}>
          <strong>Library</strong>
          <input
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files, people, households"
            style={{ maxWidth: "360px" }}
          />
        </div>

        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {mediaItems.map((item) => {
            const kind = inferMediaKind(item.fileId, item.mediaMetadata);
            return (
              <article key={item.fileId} className="card" style={{ padding: "0.6rem" }}>
                <div style={{ marginBottom: "0.5rem", minHeight: "120px", display: "grid", placeItems: "center", background: "#f6f7f9", borderRadius: "10px" }}>
                  {kind === "video" ? (
                    <video src={getPhotoProxyPath(item.fileId, tenantKey)} controls muted playsInline style={{ width: "100%", maxHeight: "160px", borderRadius: "8px" }} />
                  ) : kind === "audio" ? (
                    <audio src={getPhotoProxyPath(item.fileId, tenantKey)} controls style={{ width: "100%" }} />
                  ) : (
                    <img src={getPhotoProxyPath(item.fileId, tenantKey)} alt={item.name || item.fileId} style={{ width: "100%", maxHeight: "160px", objectFit: "cover", borderRadius: "8px" }} />
                  )}
                </div>
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
    </main>
  );
}
