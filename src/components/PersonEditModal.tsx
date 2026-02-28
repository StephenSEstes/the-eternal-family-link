"use client";

import { useEffect, useMemo, useState } from "react";
import { getPhotoProxyPath } from "@/lib/google/photo-path";

type PersonItem = {
  personId: string;
  displayName: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  nickName?: string;
  birthDate?: string;
  gender?: "male" | "female" | "unspecified";
  photoFileId?: string;
  phones?: string;
  address?: string;
  hobbies?: string;
  notes?: string;
};

type GraphEdge = {
  id: string;
  fromPersonId: string;
  toPersonId: string;
  label: string;
};

type HouseholdLink = {
  id: string;
  partner1PersonId: string;
  partner2PersonId: string;
};

type PersonAttribute = {
  attributeId: string;
  attributeType: string;
  valueText: string;
  label: string;
  isPrimary: boolean;
};

type Props = {
  open: boolean;
  tenantKey: string;
  canManage: boolean;
  person: PersonItem | null;
  people: PersonItem[];
  edges: GraphEdge[];
  households: HouseholdLink[];
  onClose: () => void;
  onSaved: () => void;
  onEditHousehold: (householdId: string) => void;
};

type TabKey = "contact" | "attributes" | "photos";

function toMonthDay(value: string) {
  const raw = value.trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return `${match[2]}/${match[3]}`;
  }
  return raw || "-";
}

export function PersonEditModal({
  open,
  tenantKey,
  canManage,
  person,
  people,
  edges,
  households,
  onClose,
  onSaved,
  onEditHousehold,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>("contact");
  const [displayName, setDisplayName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nickName, setNickName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "unspecified">("unspecified");
  const [phones, setPhones] = useState("");
  const [address, setAddress] = useState("");
  const [hobbies, setHobbies] = useState("");
  const [notes, setNotes] = useState("");
  const [parent1Id, setParent1Id] = useState("");
  const [parent2Id, setParent2Id] = useState("");
  const [spouseId, setSpouseId] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [attributes, setAttributes] = useState<PersonAttribute[]>([]);
  const [newAttrType, setNewAttrType] = useState("note");
  const [newAttrLabel, setNewAttrLabel] = useState("");
  const [newAttrValue, setNewAttrValue] = useState("");
  const [newPhotoFileId, setNewPhotoFileId] = useState("");
  const [newPhotoLabel, setNewPhotoLabel] = useState("portrait");

  const parentEdges = useMemo(
    () => edges.filter((edge) => edge.label.trim().toLowerCase() === "parent"),
    [edges],
  );
  const childIds = useMemo(() => {
    if (!person) return [] as string[];
    return parentEdges
      .filter((edge) => edge.fromPersonId === person.personId)
      .map((edge) => edge.toPersonId);
  }, [parentEdges, person]);

  const parentIds = useMemo(() => {
    if (!person) return [] as string[];
    return parentEdges
      .filter((edge) => edge.toPersonId === person.personId)
      .map((edge) => edge.fromPersonId)
      .slice(0, 2);
  }, [parentEdges, person]);

  const householdId = useMemo(() => {
    if (!person) return "";
    const match = households.find(
      (item) => item.partner1PersonId === person.personId || item.partner2PersonId === person.personId,
    );
    return match?.id ?? "";
  }, [households, person]);

  const fallbackAvatar = (person?.gender ?? "unspecified") === "female"
    ? "/placeholders/avatar-female.png"
    : "/placeholders/avatar-male.png";
  const headerAvatar = person?.photoFileId ? getPhotoProxyPath(person.photoFileId, tenantKey) : fallbackAvatar;
  const photoAttributes = attributes.filter((item) => item.attributeType.toLowerCase() === "photo");
  const regularAttributes = attributes.filter((item) => item.attributeType.toLowerCase() !== "photo");

  const loadAttributes = async (personId: string) => {
    const res = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(personId)}/attributes`,
      { cache: "no-store" },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setStatus(`Attribute load failed: ${res.status}`);
      return;
    }
    setAttributes(Array.isArray(body?.attributes) ? (body.attributes as PersonAttribute[]) : []);
  };

  useEffect(() => {
    if (!open || !person) {
      return;
    }
    setActiveTab("contact");
    setDisplayName(person.displayName || "");
    setFirstName(person.firstName || "");
    setMiddleName(person.middleName || "");
    setLastName(person.lastName || "");
    setNickName(person.nickName || "");
    setBirthDate(person.birthDate || "");
    setGender(person.gender || "unspecified");
    setPhones(person.phones || "");
    setAddress(person.address || "");
    setHobbies(person.hobbies || "");
    setNotes(person.notes || "");
    setParent1Id(parentIds[0] ?? "");
    setParent2Id(parentIds[1] ?? "");
    const partner = households.find((item) => item.partner1PersonId === person.personId || item.partner2PersonId === person.personId);
    if (partner) {
      setSpouseId(partner.partner1PersonId === person.personId ? partner.partner2PersonId : partner.partner1PersonId);
    } else {
      setSpouseId("");
    }
    setNewAttrType("note");
    setNewAttrLabel("");
    setNewAttrValue("");
    setNewPhotoFileId("");
    setNewPhotoLabel("portrait");
    setStatus("");
    void loadAttributes(person.personId);
  }, [open, person, households, parentIds, tenantKey]);

  if (!open || !person) {
    return null;
  }

  const personOptions = people.filter((item) => item.personId !== person.personId);
  const showReadOnly = !canManage;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 90, display: "grid", placeItems: "center", padding: "1rem" }}
      onClick={onClose}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="card"
        style={{ width: "min(920px, 100%)", maxHeight: "90vh", overflowY: "auto" }}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div style={{ display: "grid", gridTemplateColumns: "112px minmax(0, 1fr) auto", gap: "0.9rem", alignItems: "center" }}>
          <img
            src={headerAvatar}
            alt={person.displayName}
            style={{ width: 112, height: 112, borderRadius: 14, objectFit: "cover", border: "1px solid var(--line)" }}
          />
          <div>
            <h3 style={{ margin: 0 }}>{displayName || person.displayName}</h3>
            <p className="page-subtitle" style={{ marginTop: "0.3rem", marginBottom: "0.3rem" }}>
              {toMonthDay(birthDate || person.birthDate || "")} | {person.personId}
            </p>
            <p className="page-subtitle" style={{ margin: 0 }}>
              Email: Managed in User Administration | Phone: {phones || "-"}
            </p>
          </div>
          <button type="button" className="button secondary tap-button" onClick={onClose}>Close</button>
        </div>

        <div className="settings-chip-list" style={{ marginTop: "0.8rem" }}>
          <button type="button" className={`button secondary tap-button ${activeTab === "contact" ? "game-option-selected" : ""}`} onClick={() => setActiveTab("contact")}>Contact Info</button>
          <button type="button" className={`button secondary tap-button ${activeTab === "attributes" ? "game-option-selected" : ""}`} onClick={() => setActiveTab("attributes")}>Attributes</button>
          <button type="button" className={`button secondary tap-button ${activeTab === "photos" ? "game-option-selected" : ""}`} onClick={() => setActiveTab("photos")}>Pictures</button>
        </div>

        {activeTab === "contact" ? (
          <>
            <div className="settings-chip-list">
              <div style={{ flex: 1, minWidth: 180 }}>
                <label className="label">Display Name</label>
                <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={showReadOnly} />
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <label className="label">Birthdate</label>
                <input className="input" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} disabled={showReadOnly} />
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <label className="label">Gender</label>
                <select className="input" value={gender} onChange={(e) => setGender(e.target.value as "male" | "female" | "unspecified")} disabled={showReadOnly}>
                  <option value="unspecified">Unspecified</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
            </div>

            <div className="settings-chip-list">
              <div style={{ flex: 1, minWidth: 170 }}>
                <label className="label">First Name</label>
                <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={showReadOnly} />
              </div>
              <div style={{ flex: 1, minWidth: 170 }}>
                <label className="label">Middle Name</label>
                <input className="input" value={middleName} onChange={(e) => setMiddleName(e.target.value)} disabled={showReadOnly} />
              </div>
              <div style={{ flex: 1, minWidth: 170 }}>
                <label className="label">Last Name</label>
                <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={showReadOnly} />
              </div>
              <div style={{ flex: 1, minWidth: 170 }}>
                <label className="label">Nick Name</label>
                <input className="input" value={nickName} onChange={(e) => setNickName(e.target.value)} disabled={showReadOnly} />
              </div>
            </div>

            <label className="label">Phone</label>
            <input className="input" value={phones} onChange={(e) => setPhones(e.target.value)} disabled={showReadOnly} />
            <label className="label">Address</label>
            <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} disabled={showReadOnly} />
            <label className="label">Hobbies</label>
            <input className="input" value={hobbies} onChange={(e) => setHobbies(e.target.value)} disabled={showReadOnly} />
            <label className="label">Notes</label>
            <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={showReadOnly} />

            {canManage ? (
              <>
                <div className="settings-chip-list">
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <label className="label">Mother</label>
                    <select className="input" value={parent1Id} onChange={(e) => setParent1Id(e.target.value)}>
                      <option value="">None</option>
                      {personOptions.map((option) => (
                        <option key={`p1-${option.personId}`} value={option.personId}>{option.displayName}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <label className="label">Father</label>
                    <select className="input" value={parent2Id} onChange={(e) => setParent2Id(e.target.value)}>
                      <option value="">None</option>
                      {personOptions.map((option) => (
                        <option key={`p2-${option.personId}`} value={option.personId}>{option.displayName}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <label className="label">Spouse</label>
                    <select className="input" value={spouseId} onChange={(e) => setSpouseId(e.target.value)}>
                      <option value="">None</option>
                      {personOptions.map((option) => (
                        <option key={`sp-${option.personId}`} value={option.personId}>{option.displayName}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {householdId ? (
                  <button type="button" className="button secondary tap-button" onClick={() => onEditHousehold(householdId)}>
                    Edit Household
                  </button>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}

        {activeTab === "attributes" ? (
          <>
            <div className="settings-table-wrap">
              <table className="settings-table">
                <thead><tr><th>Type</th><th>Label</th><th>Value</th></tr></thead>
                <tbody>
                  {regularAttributes.length > 0 ? regularAttributes.map((item) => (
                    <tr key={item.attributeId}>
                      <td>{item.attributeType}</td>
                      <td>{item.label || "-"}</td>
                      <td>{item.valueText}</td>
                    </tr>
                  )) : <tr><td colSpan={3}>No attributes yet.</td></tr>}
                </tbody>
              </table>
            </div>

            {canManage ? (
              <div className="card" style={{ marginTop: "0.75rem" }}>
                <h4 style={{ marginTop: 0 }}>Add Attribute</h4>
                <div className="settings-chip-list">
                  <input className="input" value={newAttrType} onChange={(e) => setNewAttrType(e.target.value)} placeholder="Type (hobby, note, etc)" />
                  <input className="input" value={newAttrLabel} onChange={(e) => setNewAttrLabel(e.target.value)} placeholder="Label" />
                </div>
                <input className="input" value={newAttrValue} onChange={(e) => setNewAttrValue(e.target.value)} placeholder="Value" />
                <button
                  type="button"
                  className="button tap-button"
                  style={{ marginTop: "0.75rem" }}
                  onClick={() =>
                    void (async () => {
                      if (!newAttrValue.trim()) {
                        setStatus("Attribute value is required.");
                        return;
                      }
                      const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}/attributes`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          attributeType: newAttrType.trim() || "note",
                          valueText: newAttrValue,
                          label: newAttrLabel,
                          visibility: "family",
                          shareScope: "both_families",
                          shareFamilyGroupKey: "",
                          sortOrder: 0,
                          isPrimary: false,
                        }),
                      });
                      const body = await res.text();
                      if (!res.ok) {
                        setStatus(`Add attribute failed: ${res.status} ${body.slice(0, 120)}`);
                        return;
                      }
                      setNewAttrLabel("");
                      setNewAttrValue("");
                      setStatus("Attribute saved.");
                      await loadAttributes(person.personId);
                      onSaved();
                    })()
                  }
                >
                  Add Attribute
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        {activeTab === "photos" ? (
          <>
            <div className="settings-table-wrap">
              <table className="settings-table">
                <thead><tr><th>Label</th><th>File ID</th><th>Primary</th></tr></thead>
                <tbody>
                  {photoAttributes.length > 0 ? photoAttributes.map((item) => (
                    <tr key={item.attributeId}>
                      <td>{item.label || "-"}</td>
                      <td>{item.valueText}</td>
                      <td>{item.isPrimary ? "Yes" : "No"}</td>
                    </tr>
                  )) : <tr><td colSpan={3}>No photos recorded.</td></tr>}
                </tbody>
              </table>
            </div>
            {canManage ? (
              <div className="card" style={{ marginTop: "0.75rem" }}>
                <h4 style={{ marginTop: 0 }}>Add Photo By File ID</h4>
                <label className="label">Photo File ID</label>
                <input className="input" value={newPhotoFileId} onChange={(e) => setNewPhotoFileId(e.target.value)} placeholder="Google Drive file id" />
                <label className="label">Label</label>
                <input className="input" value={newPhotoLabel} onChange={(e) => setNewPhotoLabel(e.target.value)} placeholder="portrait" />
                <button
                  type="button"
                  className="button tap-button"
                  style={{ marginTop: "0.75rem" }}
                  onClick={() =>
                    void (async () => {
                      if (!newPhotoFileId.trim()) {
                        setStatus("Photo file ID is required.");
                        return;
                      }
                      const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}/attributes`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          attributeType: "photo",
                          valueText: newPhotoFileId.trim(),
                          label: newPhotoLabel.trim() || "portrait",
                          visibility: "family",
                          shareScope: "both_families",
                          shareFamilyGroupKey: "",
                          sortOrder: 0,
                          isPrimary: photoAttributes.length === 0,
                        }),
                      });
                      const body = await res.text();
                      if (!res.ok) {
                        setStatus(`Add photo failed: ${res.status} ${body.slice(0, 120)}`);
                        return;
                      }
                      setStatus("Photo saved.");
                      setNewPhotoFileId("");
                      await loadAttributes(person.personId);
                      onSaved();
                    })()
                  }
                >
                  Add Photo
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        <div className="settings-chip-list" style={{ marginTop: "1rem" }}>
          <button
            type="button"
            className="button tap-button"
            disabled={showReadOnly || saving}
            onClick={() =>
              void (async () => {
                if (!person.personId) return;
                setSaving(true);
                setStatus("Saving person...");
                const personRes = await fetch(
                  `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      display_name: displayName.trim() || person.displayName,
                      first_name: firstName,
                      middle_name: middleName,
                      last_name: lastName,
                      nick_name: nickName,
                      birth_date: birthDate,
                      gender,
                      phones,
                      address,
                      hobbies,
                      notes,
                    }),
                  },
                );
                if (!personRes.ok) {
                  const body = await personRes.text();
                  setStatus(`Save failed: ${personRes.status} ${body.slice(0, 150)}`);
                  setSaving(false);
                  return;
                }
                if (canManage) {
                  const relationshipRes = await fetch(
                    `/api/t/${encodeURIComponent(tenantKey)}/relationships/builder`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        personId: person.personId,
                        parentIds: [parent1Id, parent2Id].filter(Boolean),
                        childIds,
                        spouseId,
                      }),
                    },
                  );
                  if (!relationshipRes.ok) {
                    const body = await relationshipRes.text();
                    setStatus(`Saved person, relationship save failed: ${relationshipRes.status} ${body.slice(0, 150)}`);
                    setSaving(false);
                    return;
                  }
                }
                setStatus("Saved.");
                setSaving(false);
                onSaved();
                onClose();
              })()
            }
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button type="button" className="button secondary tap-button" onClick={onClose}>Close</button>
        </div>

        {status ? <p style={{ marginTop: "0.75rem" }}>{status}</p> : null}
      </div>
    </div>
  );
}

