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
};

type Props = {
  open: boolean;
  tenantKey: string;
  householdId: string;
  onClose: () => void;
  onSaved: () => void;
};

type TabKey = "info" | "children" | "pictures";

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
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [newPhotoName, setNewPhotoName] = useState("");
  const [newPhotoDescription, setNewPhotoDescription] = useState("");
  const [newPhotoDate, setNewPhotoDate] = useState("");
  const [newPhotoPrimary, setNewPhotoPrimary] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
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
    setSelectedPhotoIds([]);
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

  if (!open) {
    return null;
  }

  const imageSrc = weddingPhotoFileId ? getPhotoProxyPath(weddingPhotoFileId, tenantKey) : "/WeddingAvatar1.png";

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 95, display: "grid", placeItems: "center", padding: "1rem" }}
      onClick={onClose}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="card"
        style={{ width: "min(900px, 100%)", maxHeight: "90vh", overflowY: "auto" }}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div style={{ display: "grid", gridTemplateColumns: "140px minmax(0, 1fr) auto", gap: "0.8rem", alignItems: "center" }}>
          <img
            src={imageSrc}
            alt="Household cover"
            style={{ width: 140, height: 98, borderRadius: 12, objectFit: "cover", border: "1px solid var(--line)" }}
          />
          <div>
            <h3 style={{ margin: 0 }}>{household?.label || "Household"}</h3>
            <p className="page-subtitle" style={{ margin: 0 }}>
              Mother: {household?.wifeName || "-"} | Father: {household?.husbandName || "-"}
            </p>
          </div>
          <button type="button" className="button secondary tap-button" onClick={onClose}>Close</button>
        </div>

        <div className="settings-chip-list" style={{ marginTop: "0.8rem", flexWrap: "nowrap", overflowX: "auto" }}>
          <button type="button" className={`button secondary tap-button ${activeTab === "info" ? "game-option-selected" : ""}`} onClick={() => setActiveTab("info")}>Info</button>
          <button type="button" className={`button secondary tap-button ${activeTab === "children" ? "game-option-selected" : ""}`} onClick={() => setActiveTab("children")}>Children</button>
          <button type="button" className={`button secondary tap-button ${activeTab === "pictures" ? "game-option-selected" : ""}`} onClick={() => setActiveTab("pictures")}>Pictures</button>
        </div>

        {loading ? <p style={{ marginTop: "0.75rem" }}>{status}</p> : null}

        {!loading && household ? (
          <>
            {activeTab === "info" ? (
              <>
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
              </>
            ) : null}

            {activeTab === "children" ? (
              <>
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
                <div className="settings-table-wrap">
                  <table className="settings-table">
                    <thead>
                      <tr>
                        <th>Remove</th>
                        <th>Preview</th>
                        <th>Name</th>
                        <th>Description</th>
                        <th>Date</th>
                        <th>Primary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {photos.length > 0 ? photos.map((photo) => (
                        <tr key={photo.photoId}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedPhotoIds.includes(photo.photoId)}
                              onChange={(e) => {
                                setSelectedPhotoIds((current) =>
                                  e.target.checked
                                    ? [...current, photo.photoId]
                                    : current.filter((id) => id !== photo.photoId),
                                );
                              }}
                            />
                          </td>
                          <td>
                            <img
                              src={getPhotoProxyPath(photo.fileId, tenantKey)}
                              alt={photo.name || "photo"}
                              style={{ width: 64, height: 64, borderRadius: 10, objectFit: "cover", border: "1px solid var(--line)" }}
                            />
                          </td>
                          <td>{photo.name || "-"}</td>
                          <td>{photo.description || "-"}</td>
                          <td>{photo.photoDate || "-"}</td>
                          <td>{photo.isPrimary ? "Yes" : "No"}</td>
                        </tr>
                      )) : (
                        <tr><td colSpan={6}>No linked photos yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="card" style={{ marginTop: "0.75rem" }}>
                  <h4 style={{ marginTop: 0 }}>Add Photo</h4>
                  <label className="label">Name</label>
                  <input className="input" value={newPhotoName} onChange={(e) => setNewPhotoName(e.target.value)} placeholder="Photo name" />
                  <label className="label">Description</label>
                  <input className="input" value={newPhotoDescription} onChange={(e) => setNewPhotoDescription(e.target.value)} placeholder="Photo description" />
                  <label className="label">Date</label>
                  <input className="input" type="date" value={newPhotoDate} onChange={(e) => setNewPhotoDate(e.target.value)} />
                  <label className="label" style={{ marginTop: "0.5rem" }}>
                    <input type="checkbox" checked={newPhotoPrimary} onChange={(e) => setNewPhotoPrimary(e.target.checked)} /> Set as primary
                  </label>
                  <input
                    id={`household-photo-upload-${householdId}`}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) =>
                      void (async () => {
                        const file = e.target.files?.[0];
                        e.currentTarget.value = "";
                        if (!file) return;
                        setUploadingPhoto(true);
                        setStatus("Adding photo...");
                        const form = new FormData();
                        form.append("file", file);
                        form.append("name", newPhotoName.trim() || file.name || "photo");
                        form.append("description", newPhotoDescription.trim());
                        form.append("photoDate", newPhotoDate.trim());
                        form.append("isPrimary", String(newPhotoPrimary));
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
                        setNewPhotoName("");
                        setNewPhotoDescription("");
                        setNewPhotoDate("");
                        setNewPhotoPrimary(false);
                        setStatus("Photo linked.");
                        setUploadingPhoto(false);
                        await refresh();
                        onSaved();
                      })()
                    }
                  />
                  <button
                    type="button"
                    className="button tap-button"
                    disabled={uploadingPhoto}
                    onClick={() => document.getElementById(`household-photo-upload-${householdId}`)?.click()}
                  >
                    {uploadingPhoto ? "Adding..." : "Add Photo"}
                  </button>
                </div>
                <button
                  type="button"
                  className="button secondary tap-button"
                  disabled={selectedPhotoIds.length === 0}
                  onClick={() =>
                    void (async () => {
                      setStatus("Removing selected photo links...");
                      for (const photoId of selectedPhotoIds) {
                        await fetch(
                          `/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(householdId)}/photos/${encodeURIComponent(photoId)}`,
                          { method: "DELETE" },
                        );
                      }
                      setSelectedPhotoIds([]);
                      setStatus("Selected photo links removed.");
                      await refresh();
                      onSaved();
                    })()
                  }
                >
                  Remove Selected Links
                </button>
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
  );
}
