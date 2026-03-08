"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type MediaAttachContext,
  type MediaAttachDraftItem,
  type MediaAttachExecutionSummary,
  type MediaAttachHouseholdOption,
  type MediaAttachLibraryItem,
  type MediaAttachPersonOption,
  runMediaAttachPlan,
  searchImageLibrary,
  toImagePreviewSrc,
} from "@/lib/media/attach-orchestrator";

type WizardStep = "source" | "select" | "grouping" | "shared" | "per_item" | "review";
type SourceChoice = "device_upload" | "camera_capture" | "library_existing";
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
  const [perItemIndex, setPerItemIndex] = useState(0);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryResults, setLibraryResults] = useState<MediaAttachLibraryItem[]>([]);
  const [librarySelectedFileIds, setLibrarySelectedFileIds] = useState<string[]>([]);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [duplicateScanBusy, setDuplicateScanBusy] = useState(false);
  const [tagQuery, setTagQuery] = useState("");

  const selectedItem = items[perItemIndex] ?? null;
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
  }, [context.defaultDate, context.defaultDescription, context.defaultLabel, open]);

  useEffect(() => {
    return () => {
      for (const item of items) {
        if (item.previewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(item.previewUrl);
        }
      }
    };
  }, [items]);

  if (!open) return null;

  const readChecksumFromMetadata = (raw?: string) => {
    const text = (raw ?? "").trim();
    if (!text) return "";
    try {
      const parsed = JSON.parse(text) as { checksumSha256?: string };
      return String(parsed.checksumSha256 ?? "").trim().toLowerCase();
    } catch {
      return "";
    }
  };

  const computeFileSha256 = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const bytes = Array.from(new Uint8Array(hashBuffer));
    return bytes.map((value) => value.toString(16).padStart(2, "0")).join("");
  };

  const scanForDuplicates = async (files: File[]) => {
    if (files.length === 0) return new Map<string, MediaAttachLibraryItem>();
    setDuplicateScanBusy(true);
    try {
      const catalog = await searchImageLibrary({
        tenantKey: context.tenantKey,
        query: "",
        limit: 5000,
      });
      const byChecksum = new Map<string, MediaAttachLibraryItem>();
      for (const item of catalog) {
        const checksum = readChecksumFromMetadata(item.mediaMetadata);
        if (!checksum || byChecksum.has(checksum)) continue;
        byChecksum.set(checksum, item);
      }
      const matches = new Map<string, MediaAttachLibraryItem>();
      for (const file of files) {
        const checksum = await computeFileSha256(file);
        const existing = byChecksum.get(checksum);
        if (existing) {
          matches.set(fileKey(file), existing);
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
    const incoming = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (incoming.length === 0) {
      setStatus("Only image files are supported in this MVP.");
      return;
    }
    setStatus("Checking for duplicates...");
    const duplicateMatches = await scanForDuplicates(incoming);
    setItems((current) => {
      const seen = new Set(current.filter((item) => item.file).map((item) => fileKey(item.file!)));
      const next = [...current];
      for (const file of incoming) {
        const key = fileKey(file);
        if (seen.has(key)) continue;
        seen.add(key);
        const previewUrl = URL.createObjectURL(file);
        const duplicate = duplicateMatches.get(key);
        next.push({
          clientId: makeClientId(),
          source,
          file,
          fileId: duplicate?.fileId || "",
          previewUrl,
          existingMediaMetadata: duplicate?.mediaMetadata ?? "",
          duplicateOfFileId: duplicate?.fileId ?? "",
          duplicateExistingPreviewUrl: duplicate?.fileId ? toImagePreviewSrc(context.tenantKey, duplicate.fileId) : "",
          title: context.defaultLabel ?? "",
          description: context.defaultDescription ?? "",
          date: context.defaultDate ?? (file.lastModified ? new Date(file.lastModified).toISOString().slice(0, 10) : ""),
          notes: "",
          personIds: Array.from(new Set((context.preselectedPersonIds ?? []).map((value) => value.trim()).filter(Boolean))),
          householdIds: Array.from(new Set((context.preselectedHouseholdIds ?? []).map((value) => value.trim()).filter(Boolean))),
          attributeType: context.defaultAttributeType ?? "media",
        });
      }
      return next;
    });
    const duplicateCount = duplicateMatches.size;
    setStatus(duplicateCount > 0 ? `Duplicate check complete: ${duplicateCount} duplicate image(s) found and will be linked without re-upload.` : "");
  };

  const addLibrarySelection = () => {
    if (librarySelectedFileIds.length === 0) {
      setStatus("Select one or more library images first.");
      return;
    }
    setItems((current) => {
      const seen = new Set(current.map((item) => item.fileId).filter(Boolean));
      const next = [...current];
      for (const fileId of librarySelectedFileIds) {
        if (seen.has(fileId)) continue;
        const match = libraryResults.find((item) => item.fileId === fileId);
        if (!match) continue;
        next.push({
          clientId: makeClientId(),
          source: "library_existing",
          fileId: match.fileId,
          previewUrl: toImagePreviewSrc(context.tenantKey, match.fileId),
          existingMediaMetadata: match.mediaMetadata ?? "",
          title: match.name || context.defaultLabel || "photo",
          description: match.description || context.defaultDescription || "",
          date: match.date || context.defaultDate || "",
          notes: "",
          personIds: Array.from(new Set([...(context.preselectedPersonIds ?? []), ...match.people.map((person) => person.personId)])),
          householdIds: Array.from(new Set([...(context.preselectedHouseholdIds ?? []), ...match.households.map((household) => household.householdId)])),
          attributeType: "photo",
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
      const results = await searchImageLibrary({ tenantKey: context.tenantKey, query, limit: 200 });
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
      setStatus("Select at least one image.");
      return;
    }
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

  const saveAll = async () => {
    if (items.length === 0) {
      setStatus("Select at least one image.");
      return;
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

  const renderSource = (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Choose Source</h4>
      <div className="settings-chip-list">
        <button type="button" className={`tab-pill ${sourceChoice === "device_upload" ? "active" : ""}`} onClick={() => setSourceChoice("device_upload")}>Device Upload</button>
        <button type="button" className={`tab-pill ${sourceChoice === "camera_capture" ? "active" : ""}`} onClick={() => setSourceChoice("camera_capture")}>Camera Capture</button>
        <button type="button" className={`tab-pill ${sourceChoice === "library_existing" ? "active" : ""}`} onClick={() => setSourceChoice("library_existing")}>Media Library</button>
      </div>
      <button type="button" className="button tap-button" onClick={() => setStep("select")}>Continue</button>
    </div>
  );

  const renderSelect = (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Select Images</h4>
      {sourceChoice === "device_upload" ? (
        <input
          className="input"
          type="file"
          multiple
          accept="image/*"
          onChange={(event) => {
            void appendFiles(event.target.files, "device_upload");
            event.currentTarget.value = "";
          }}
        />
      ) : null}
      {sourceChoice === "camera_capture" ? (
        <input
          className="input"
          type="file"
          multiple
          accept="image/*"
          capture="environment"
          onChange={(event) => {
            void appendFiles(event.target.files, "camera_capture");
            event.currentTarget.value = "";
          }}
        />
      ) : null}
      {sourceChoice === "library_existing" ? (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              className="input"
              value={libraryQuery}
              onChange={(event) => setLibraryQuery(event.target.value)}
              placeholder="Search image library"
            />
            <button type="button" className="button secondary tap-button" onClick={() => void runLibrarySearch()} disabled={libraryBusy}>
              {libraryBusy ? "Searching..." : "Search"}
            </button>
          </div>
          {libraryResults.length > 0 ? (
            <div style={{ display: "grid", gap: "0.35rem", maxHeight: "220px", overflow: "auto" }}>
              {libraryResults.map((item) => {
                const checked = librarySelectedFileIds.includes(item.fileId);
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
                    <span>{item.name || item.fileId}</span>
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
            {items.map((item) => (
              <div key={item.clientId} style={{ display: "grid", gap: "0.25rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
                  {item.previewUrl ? <img src={item.previewUrl} alt="" style={{ width: "34px", height: "34px", objectFit: "cover", borderRadius: "6px" }} /> : null}
                  <span style={{ fontSize: "0.9rem" }}>{item.title || item.file?.name || item.fileId || "Image"}</span>
                </div>
                {item.duplicateOfFileId ? (
                  <span className="status-chip status-chip--neutral" style={{ width: "fit-content" }}>
                    Duplicate found: {item.duplicateOfFileId} (will link, not re-upload)
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
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
          onClick={() => setSameMemorySet(true)}
        >
          Yes
        </button>
        <button
          type="button"
          className={`button secondary tap-button ${sameMemorySet === false ? "active" : ""}`}
          onClick={() => setSameMemorySet(false)}
        >
          No
        </button>
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" className="button secondary tap-button" onClick={() => setStep("select")}>Back</button>
        <button
          type="button"
          className="button tap-button"
          onClick={() => {
            if (sameMemorySet == null) {
              setStatus("Select Yes or No.");
              return;
            }
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
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" className="button secondary tap-button" onClick={() => setStep("grouping")}>Back</button>
        <button type="button" className="button tap-button" onClick={() => { setPerItemIndex(0); setStep("per_item"); }}>Continue</button>
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
      {selectedItem.previewUrl ? (
        <img src={selectedItem.previewUrl} alt="Selected image" style={{ width: "100%", maxHeight: "220px", objectFit: "contain", background: "#f3f4f6", borderRadius: "10px" }} />
      ) : null}
      {selectedItem.duplicateOfFileId && selectedItem.duplicateExistingPreviewUrl ? (
        <div className="card" style={{ padding: "0.6rem", display: "grid", gap: "0.45rem" }}>
          <strong>Duplicate confirmed</strong>
          <span style={{ fontSize: "0.9rem" }}>
            This selected image matches existing library file <code>{selectedItem.duplicateOfFileId}</code>. It will not upload again.
          </span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
            <div style={{ display: "grid", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Selected Image</span>
              <img src={selectedItem.previewUrl || ""} alt="Selected image preview" style={{ width: "100%", maxHeight: "170px", objectFit: "contain", background: "#f3f4f6", borderRadius: "8px" }} />
            </div>
            <div style={{ display: "grid", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Existing Library Image</span>
              <img src={selectedItem.duplicateExistingPreviewUrl} alt="Existing library duplicate preview" style={{ width: "100%", maxHeight: "170px", objectFit: "contain", background: "#f3f4f6", borderRadius: "8px" }} />
            </div>
          </div>
          <span style={{ fontSize: "0.85rem" }}>You can still edit metadata/links below; save will only create links/details.</span>
        </div>
      ) : null}
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
      <label style={{ display: "grid", gap: "0.35rem" }}>
        <span style={{ fontWeight: 600 }}>Notes</span>
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
          <button type="button" className="button tap-button" onClick={() => setPerItemIndex((value) => Math.min(items.length - 1, value + 1))}>
            Next Item
          </button>
        ) : (
          <button type="button" className="button tap-button" onClick={() => setStep("review")}>
            Review
          </button>
        )}
      </div>
    </div>
  ) : null;

  const renderReview = (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Review</h4>
      <p className="page-subtitle" style={{ margin: 0 }}>Confirm items and links before save.</p>
      <div style={{ display: "grid", gap: "0.45rem", maxHeight: "280px", overflow: "auto" }}>
        {items.map((item, index) => (
          <div key={item.clientId} className="card" style={{ padding: "0.55rem" }}>
            <strong>Item {index + 1}: {item.title || item.file?.name || item.fileId || "Image"}</strong>
            <div style={{ fontSize: "0.85rem", marginTop: "0.2rem" }}>
              <span>Date: {item.date || "-"}</span>
              <span style={{ marginLeft: "0.65rem" }}>People: {item.personIds.length}</span>
              <span style={{ marginLeft: "0.65rem" }}>Households: {item.householdIds.length}</span>
              {item.duplicateOfFileId ? <span style={{ marginLeft: "0.65rem" }}>Duplicate: yes (link-only)</span> : null}
            </div>
          </div>
        ))}
      </div>
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
    <div className="person-modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="person-modal-panel" onClick={(event) => event.stopPropagation()} style={{ maxWidth: "900px", width: "min(900px, 96vw)" }}>
        <div className="person-modal-sticky-head">
          <div className="person-modal-header">
            <div>
              <h3 className="person-modal-title">Media Attach Wizard</h3>
              <p className="person-modal-meta">Image-only MVP. Existing backend contracts preserved.</p>
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
