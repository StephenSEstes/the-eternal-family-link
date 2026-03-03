"use client";

import { useEffect, useState } from "react";
import { getPhotoProxyPath } from "@/lib/google/photo-path";

type HouseholdSummary = {
  householdId: string;
  husbandPersonId: string;
  wifePersonId: string;
  husbandName: string;
  wifeName: string;
  label: string;
  notes: string;
  weddingPhotoFileId: string;
  address: string;
  city: string;
  state: string;
  zip: string;
};

type ChildSummary = {
  personId: string;
  displayName: string;
  birthDate: string;
};

type HouseholdPhoto = {
  photoId: string;
  fileId: string;
  name: string;
  description: string;
  photoDate: string;
  isPrimary: boolean;
  mediaMetadata?: string;
};

type Props = {
  open: boolean;
  tenantKey: string;
  householdId: string;
  onClose: () => void;
  onSaved: () => void;
};

type TabKey = "info" | "children" | "pictures";

function parseMediaMetadata(raw?: string) {
  const text = (raw ?? "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as { mimeType?: string; fileName?: string };
  } catch {
    return null;
  }
}

function isVideoMediaByMetadata(raw?: string) {
  const parsed = parseMediaMetadata(raw);
  const mime = (parsed?.mimeType ?? "").toLowerCase();
  const fileName = (parsed?.fileName ?? "").toLowerCase();
  return mime.startsWith("video/") || fileName.endsWith(".mp4") || fileName.endsWith(".mov") || fileName.endsWith(".webm");
}

export function HouseholdEditModal({ open, tenantKey, householdId, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("info");
  const [household, setHousehold] = useState<HouseholdSummary | null>(null);
  const [children, setChildren] = useState<ChildSummary[]>([]);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [weddingPhotoFileId, setWeddingPhotoFileId] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateValue, setStateValue] = useState("");
  const [zip, setZip] = useState("");
  const [photos, setPhotos] = useState<HouseholdPhoto[]>([]);
  const [selectedPhotoId, setSelectedPhotoId] = useState("");
  const [showPhotoDetail, setShowPhotoDetail] = useState(false);
  const [newPhotoName, setNewPhotoName] = useState("");
  const [newPhotoDescription, setNewPhotoDescription] = useState("");
  const [newPhotoDate, setNewPhotoDate] = useState("");
  const [newPhotoPrimary, setNewPhotoPrimary] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [pendingUploadPhotoFile, setPendingUploadPhotoFile] = useState<File | null>(null);
  const [pendingUploadPhotoPreviewUrl, setPendingUploadPhotoPreviewUrl] = useState("");
  const [showPhotoUploadPicker, setShowPhotoUploadPicker] = useState(false);
  const [largePhotoFileId, setLargePhotoFileId] = useState("");
  const [largePhotoIsVideo, setLargePhotoIsVideo] = useState(false);
  const [addChildOpen, setAddChildOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nickName, setNickName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState<"" | "male" | "female">("");
  const [childAddress, setChildAddress] = useState("");

  const refresh = async () => {
    setLoading(true);
    const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(householdId)}`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.household) {
      const hint = typeof body?.hint === "string" ? body.hint : "";
      const message = typeof body?.message === "string" ? body.message : "";
      setStatus(`Load failed: ${res.status}${message ? ` ${message}` : ""}${hint ? ` | ${hint}` : ""}`);
      setLoading(false);
      return;
    }
    const next = body.household as HouseholdSummary;
    setHousehold(next);
    setChildren(Array.isArray(body.children) ? (body.children as ChildSummary[]) : []);
    setPhotos(Array.isArray(body.photos) ? (body.photos as HouseholdPhoto[]) : []);
    setSelectedPhotoId("");
    setShowPhotoDetail(false);
    setLargePhotoFileId("");
    setLargePhotoIsVideo(false);
    setWeddingPhotoFileId(String(next.weddingPhotoFileId ?? ""));
    setLabel(String(next.label ?? ""));
    setNotes(String(next.notes ?? ""));
    setAddress(String(next.address ?? ""));
    setCity(String(next.city ?? ""));
    setStateValue(String(next.state ?? ""));
    setZip(String(next.zip ?? ""));
    setLoading(false);
    setStatus("");
  };

  const clearPendingUploadPhoto = () => {
    if (pendingUploadPhotoPreviewUrl) {
      URL.revokeObjectURL(pendingUploadPhotoPreviewUrl);
    }
    setPendingUploadPhotoFile(null);
    setPendingUploadPhotoPreviewUrl("");
  };

  const setPendingUploadFromInput = (file: File | null) => {
    if (!file) return;
    if (pendingUploadPhotoPreviewUrl) {
      URL.revokeObjectURL(pendingUploadPhotoPreviewUrl);
    }
    const previewUrl = URL.createObjectURL(file);
    setPendingUploadPhotoFile(file);
    setPendingUploadPhotoPreviewUrl(previewUrl);
    if (!newPhotoDate && file.lastModified) {
      setNewPhotoDate(new Date(file.lastModified).toISOString().slice(0, 10));
    }
  };

  const submitPendingUploadPhoto = async () => {
    if (!pendingUploadPhotoFile) {
      setStatus("Choose a photo first.");
      return;
    }
    setUploadingPhoto(true);
    setStatus("Adding photo...");
    const form = new FormData();
    form.append("file", pendingUploadPhotoFile);
    form.append("name", newPhotoName.trim() || pendingUploadPhotoFile.name || "photo");
    form.append("description", newPhotoDescription.trim());
    form.append("photoDate", newPhotoDate.trim());
    form.append("isPrimary", String(newPhotoPrimary));
    if (pendingUploadPhotoFile.lastModified) {
      form.append("fileCreatedAt", new Date(pendingUploadPhotoFile.lastModified).toISOString());
    }
    const res = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(householdId)}/photos/upload`,
      { method: "POST", body: form },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message = body?.message || body?.error || "";
      setStatus(`Add photo failed: ${res.status} ${String(message).slice(0, 160)}`);
      setUploadingPhoto(false);
      return;
    }
    clearPendingUploadPhoto();
    setShowPhotoUploadPicker(false);
    setNewPhotoName("");
    setNewPhotoDescription("");
    setNewPhotoDate("");
    setNewPhotoPrimary(false);
    setStatus("Photo linked.");
    setUploadingPhoto(false);
    await refresh();
    onSaved();
  };

  const selectedPhoto = photos.find((photo) => photo.photoId === selectedPhotoId) ?? null;

  useEffect(() => {
    if (!open || !householdId) {
      return;
    }
    setActiveTab("info");
    setAddChildOpen(false);
    setGender("");
    setChildAddress("");
    setStatus("Loading household...");
    void refresh();
  }, [open, householdId, tenantKey]);

  useEffect(() => {
    return () => {
      if (pendingUploadPhotoPreviewUrl) {
        URL.revokeObjectURL(pendingUploadPhotoPreviewUrl);
      }
    };
  }, [pendingUploadPhotoPreviewUrl]);

  if (!open) {
    return null;
  }

  const imageSrc = weddingPhotoFileId ? getPhotoProxyPath(weddingPhotoFileId, tenantKey) : "/WeddingAvatar1.png";

  return (
    <div
      className="person-modal-backdrop"
      onClick={onClose}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="person-modal-panel"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="person-modal-sticky-head">
          <div className="person-modal-header">
            <img
              src={imageSrc}
              alt="Household cover"
              className="person-modal-avatar"
              style={{ width: 84, height: 64 }}
            />
            <div>
              <h3 className="person-modal-title">{household?.label || "Household"}</h3>
              <p className="person-modal-meta">
                Mother: {household?.wifeName || "-"} | Father: {household?.husbandName || "-"}
              </p>
              <p className="person-modal-meta">Household ID: {householdId}</p>
            </div>
            <button type="button" className="button secondary tap-button" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="person-modal-tabs">
          <button type="button" className={`tab-pill ${activeTab === "info" ? "active" : ""}`} onClick={() => setActiveTab("info")}>Info</button>
          <button type="button" className={`tab-pill ${activeTab === "children" ? "active" : ""}`} onClick={() => setActiveTab("children")}>Children</button>
          <button type="button" className={`tab-pill ${activeTab === "pictures" ? "active" : ""}`} onClick={() => setActiveTab("pictures")}>Pictures</button>
        </div>
        <div className="person-modal-content">

        {loading ? <p style={{ marginTop: "0.75rem" }}>{status}</p> : null}

        {!loading && household ? (
          <>
            {activeTab === "info" ? (
              <>
                <div className="card">
                  <h4 className="ui-section-title">Household Info</h4>
                  <label className="label">Household Label</label>
                  <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Household name" />
                  <label className="label">Address</label>
                  <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address" />
                  <div className="settings-chip-list">
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <label className="label">City</label>
                      <input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
                    </div>
                    <div style={{ flex: 1, minWidth: 110 }}>
                      <label className="label">State</label>
                      <input className="input" value={stateValue} onChange={(e) => setStateValue(e.target.value)} />
                    </div>
                    <div style={{ flex: 1, minWidth: 110 }}>
                      <label className="label">ZIP</label>
                      <input className="input" value={zip} onChange={(e) => setZip(e.target.value)} />
                    </div>
                  </div>
                  <label className="label">Notes</label>
                  <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Household notes" />
                </div>
              </>
            ) : null}

            {activeTab === "children" ? (
              <>
                <div className="card">
                  <h4 className="ui-section-title">Children</h4>
                  <div className="settings-table-wrap">
                    <table className="settings-table">
                      <thead>
                        <tr><th>Name</th><th>Birthdate</th></tr>
                      </thead>
                      <tbody>
                        {children.length > 0 ? children.map((child) => (
                          <tr key={child.personId}>
                            <td>{child.displayName}</td>
                            <td>{child.birthDate || "-"}</td>
                          </tr>
                        )) : (
                          <tr><td colSpan={2}>No children linked yet.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <button
                  type="button"
                  className="button secondary tap-button"
                  onClick={() => {
                    if (addChildOpen) {
                      setFirstName("");
                      setMiddleName("");
                      setLastName("");
                      setNickName("");
                      setDisplayName("");
                      setBirthDate("");
                      setGender("");
                      setChildAddress("");
                    }
                    setAddChildOpen((value) => !value);
                  }}
                >
                  {addChildOpen ? "Cancel Add Child" : "Add Child"}
                </button>

                {addChildOpen ? (
                  <div className="card" style={{ marginTop: "0.75rem" }}>
                    <h4 style={{ marginTop: 0 }}>Add Child</h4>
                    <div className="settings-chip-list">
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <label className="label">First Name</label>
                        <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                      </div>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <label className="label">Middle Name</label>
                        <input className="input" value={middleName} onChange={(e) => setMiddleName(e.target.value)} />
                      </div>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <label className="label">Last Name</label>
                        <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                      </div>
                    </div>
                    <div className="settings-chip-list">
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <label className="label">Nick Name</label>
                        <input className="input" value={nickName} onChange={(e) => setNickName(e.target.value)} />
                      </div>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <label className="label">Display Name</label>
                        <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                      </div>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <label className="label">Birthdate</label>
                        <input className="input" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
                      </div>
                    </div>
                    <label className="label">Child Address (optional)</label>
                    <input
                      className="input"
                      value={childAddress}
                      onChange={(e) => setChildAddress(e.target.value)}
                      placeholder="Physical address if different from household"
                    />
                    <label className="label">Gender</label>
                    <select className="input" value={gender} onChange={(e) => setGender(e.target.value as "" | "male" | "female")}>
                      <option value="">Select gender</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>

                    <button
                      type="button"
                      className="button tap-button"
                      style={{ marginTop: "0.75rem" }}
                      onClick={() =>
                        void (async () => {
                          if (!birthDate.trim()) {
                            setStatus("Birthdate is required before saving child.");
                            return;
                          }
                          if (!gender) {
                            setStatus("Gender is required before saving child.");
                            return;
                          }
                          setStatus("Adding child...");
                          const res = await fetch(
                            `/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(householdId)}/children`,
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                first_name: firstName,
                                middle_name: middleName,
                                last_name: lastName,
                                nick_name: nickName,
                                display_name: displayName,
                                birth_date: birthDate,
                                gender,
                                address: childAddress,
                              }),
                            },
                          );
                          const body = await res.json().catch(() => null);
                          if (!res.ok) {
                            setStatus(`Add child failed: ${res.status} ${JSON.stringify(body)}`);
                            return;
                          }
                          setStatus("Child added.");
                          setAddChildOpen(false);
                          setFirstName("");
                          setMiddleName("");
                          setLastName("");
                          setNickName("");
                          setDisplayName("");
                          setBirthDate("");
                          setGender("");
                          setChildAddress("");
                          await refresh();
                          onSaved();
                        })()
                      }
                    >
                      Save Child
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}

            {activeTab === "pictures" ? (
              <>
                <div className="card person-photo-gallery-card">
                  <div className="person-photo-gallery-toolbar">
                    <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Gallery</h4>
                    <div className="person-photo-gallery-actions">
                      <button type="button" className="button tap-button" onClick={() => setShowPhotoUploadPicker(true)}>
                        + Add Photo
                      </button>
                    </div>
                  </div>
                  {photos.length > 0 ? (
                    <div className="person-photo-grid">
                      {photos.map((photo) => (
                        <button
                          key={photo.photoId}
                          type="button"
                          className="person-photo-tile"
                          onClick={() => {
                            setSelectedPhotoId(photo.photoId);
                            setShowPhotoDetail(true);
                          }}
                        >
                          {isVideoMediaByMetadata(photo.mediaMetadata) ? (
                            <video
                              src={getPhotoProxyPath(photo.fileId, tenantKey)}
                              className="person-photo-tile-image"
                              muted
                              playsInline
                            />
                          ) : (
                            <img
                              src={getPhotoProxyPath(photo.fileId, tenantKey)}
                              alt={photo.name || "photo"}
                              className="person-photo-tile-image"
                            />
                          )}
                          <div className="person-photo-tile-meta">
                            <span className="person-photo-tile-label">{photo.name || "photo"}</span>
                            {photo.isPrimary ? <span className="person-photo-primary-badge">Primary</span> : null}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="page-subtitle">No linked photos yet.</p>
                  )}
                </div>
                {selectedPhoto && showPhotoDetail ? (
                  <div className="person-photo-detail-shell">
                    <div className="person-photo-detail-card">
                      <div className="person-photo-detail-head">
                        <button type="button" className="button secondary tap-button" onClick={() => setShowPhotoDetail(false)}>
                          Back
                        </button>
                        <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Photo Detail</h4>
                        <button
                          type="button"
                          className="button secondary tap-button"
                          onClick={() => {
                            setLargePhotoFileId(selectedPhoto.fileId);
                            setLargePhotoIsVideo(isVideoMediaByMetadata(selectedPhoto.mediaMetadata));
                          }}
                        >
                          View Large
                        </button>
                      </div>
                      <div className="card">
                        {isVideoMediaByMetadata(selectedPhoto.mediaMetadata) ? (
                          <video
                            src={getPhotoProxyPath(selectedPhoto.fileId, tenantKey)}
                            className="person-photo-detail-preview"
                            controls
                            playsInline
                          />
                        ) : (
                          <img
                            src={getPhotoProxyPath(selectedPhoto.fileId, tenantKey)}
                            alt={selectedPhoto.name || "photo"}
                            className="person-photo-detail-preview"
                          />
                        )}
                      </div>
                      <div className="card">
                        <h5 style={{ margin: "0 0 0.5rem" }}>Photo Info</h5>
                        <label className="label">Name</label>
                        <input className="input" value={selectedPhoto.name || ""} disabled />
                        <label className="label">Description</label>
                        <input className="input" value={selectedPhoto.description || ""} disabled />
                        <label className="label">Date</label>
                        <input className="input" value={selectedPhoto.photoDate || ""} disabled />
                        <label className="label">Primary</label>
                        <input className="input" value={selectedPhoto.isPrimary ? "Yes" : "No"} disabled />
                      </div>
                      <div className="card" style={{ borderColor: "#fecaca" }}>
                        <h5 style={{ margin: "0 0 0.5rem" }}>Danger Zone</h5>
                        <button
                          type="button"
                          className="button secondary tap-button"
                          disabled={uploadingPhoto}
                          onClick={() =>
                            void (async () => {
                              const ok = window.confirm("Remove this photo from this household? This won't delete the photo from the library.");
                              if (!ok) return;
                              setUploadingPhoto(true);
                              setStatus("Removing photo link...");
                              await fetch(
                                `/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(householdId)}/photos/${encodeURIComponent(selectedPhoto.photoId)}`,
                                { method: "DELETE" },
                              );
                              setStatus("Photo link removed.");
                              setUploadingPhoto(false);
                              setShowPhotoDetail(false);
                              setSelectedPhotoId("");
                              await refresh();
                              onSaved();
                            })()
                          }
                        >
                          {uploadingPhoto ? "Saving..." : "Remove from Household"}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {showPhotoUploadPicker ? (
                  <div className="person-photo-picker-shell">
                    <div className="person-photo-picker-card">
                      <div className="person-photo-picker-head">
                        <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Upload Photo</h4>
                        <button
                          type="button"
                          className="button secondary tap-button"
                          onClick={() => {
                            clearPendingUploadPhoto();
                            setShowPhotoUploadPicker(false);
                          }}
                        >
                          Close
                        </button>
                      </div>
                      <label className="label">Name</label>
                      <input className="input" value={newPhotoName} onChange={(e) => setNewPhotoName(e.target.value)} placeholder="Photo name" />
                      <label className="label">Description</label>
                      <input className="input" value={newPhotoDescription} onChange={(e) => setNewPhotoDescription(e.target.value)} placeholder="Photo description" />
                      <label className="label">Date</label>
                      <input className="input" type="date" value={newPhotoDate} onChange={(e) => setNewPhotoDate(e.target.value)} />
                      <label className="label" style={{ marginTop: "0.5rem" }}>
                        <input type="checkbox" checked={newPhotoPrimary} onChange={(e) => setNewPhotoPrimary(e.target.checked)} /> Set as primary
                      </label>
                      {pendingUploadPhotoPreviewUrl ? (
                        <div className="person-upload-preview-card">
                          {pendingUploadPhotoFile?.type?.startsWith("video/") ? (
                            <video src={pendingUploadPhotoPreviewUrl} className="person-upload-preview-image" controls playsInline />
                          ) : (
                            <img src={pendingUploadPhotoPreviewUrl} alt="Selected upload preview" className="person-upload-preview-image" />
                          )}
                          <div className="person-upload-preview-meta">
                            <strong>{pendingUploadPhotoFile?.name || "Selected photo"}</strong>
                            <span>This photo will be uploaded with the metadata above.</span>
                          </div>
                        </div>
                      ) : (
                        <p className="page-subtitle" style={{ marginTop: "0.75rem" }}>No photo selected yet.</p>
                      )}
                      <input
                        id={`household-photo-upload-${householdId}`}
                        type="file"
                        accept="image/*,video/*"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          e.currentTarget.value = "";
                          setPendingUploadFromInput(file);
                        }}
                      />
                      <div className="settings-chip-list" style={{ marginTop: "0.75rem" }}>
                        <button
                          type="button"
                          className="button secondary tap-button"
                          disabled={uploadingPhoto}
                          onClick={() => document.getElementById(`household-photo-upload-${householdId}`)?.click()}
                        >
                          {pendingUploadPhotoFile ? "Choose Another Photo" : "Choose Photo"}
                        </button>
                        <button
                          type="button"
                          className="button tap-button"
                          disabled={!pendingUploadPhotoFile || uploadingPhoto}
                          onClick={() => void submitPendingUploadPhoto()}
                        >
                          {uploadingPhoto ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          className="button secondary tap-button"
                          disabled={uploadingPhoto}
                          onClick={() => {
                            clearPendingUploadPhoto();
                            setShowPhotoUploadPicker(false);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
                {largePhotoFileId ? (
                  <div
                    style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 140, display: "grid", placeItems: "center", padding: "1rem" }}
                    onClick={() => {
                      setLargePhotoFileId("");
                      setLargePhotoIsVideo(false);
                    }}
                  >
                    {largePhotoIsVideo ? (
                      <video
                        src={getPhotoProxyPath(largePhotoFileId, tenantKey)}
                        controls
                        playsInline
                        style={{ maxWidth: "min(1200px, 95vw)", maxHeight: "90vh", borderRadius: 14, border: "1px solid var(--line)", background: "#fff" }}
                      />
                    ) : (
                      <img
                        src={getPhotoProxyPath(largePhotoFileId, tenantKey)}
                        alt="Large preview"
                        style={{ maxWidth: "min(1200px, 95vw)", maxHeight: "90vh", borderRadius: 14, border: "1px solid var(--line)", background: "#fff" }}
                      />
                    )}
                  </div>
                ) : null}
              </>
            ) : null}

            <div className="settings-chip-list" style={{ marginTop: "0.8rem" }}>
              <button
                type="button"
                className="button tap-button"
                disabled={addChildOpen}
                onClick={() =>
                  void (async () => {
                    if (addChildOpen) {
                      setStatus("Finish saving the child or cancel Add Child before saving household.");
                      return;
                    }
                    setStatus("Saving household...");
                    const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(householdId)}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ label, notes, weddingPhotoFileId, address, city, state: stateValue, zip }),
                    });
                    if (!res.ok) {
                      const body = await res.text();
                      setStatus(`Save failed: ${res.status} ${body.slice(0, 140)}`);
                      return;
                    }
                    setStatus("Household saved.");
                    await refresh();
                    onSaved();
                  })()
                }
              >
                Save Household
              </button>
              <button type="button" className="button secondary tap-button" onClick={onClose}>Close</button>
            </div>
          </>
        ) : null}

        {status ? <p style={{ marginTop: "0.75rem" }}>{status}</p> : null}
      </div>
      </div>
    </div>
  );
}
