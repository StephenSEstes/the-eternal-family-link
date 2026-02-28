"use client";

import { useEffect, useMemo, useState } from "react";

type PersonItem = {
  personId: string;
  displayName: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  nickName?: string;
  birthDate?: string;
  gender?: "male" | "female" | "unspecified";
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
  const [displayName, setDisplayName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nickName, setNickName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "unspecified">("unspecified");
  const [parent1Id, setParent1Id] = useState("");
  const [parent2Id, setParent2Id] = useState("");
  const [spouseId, setSpouseId] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    if (!open || !person) {
      return;
    }
    setDisplayName(person.displayName || "");
    setFirstName(person.firstName || "");
    setMiddleName(person.middleName || "");
    setLastName(person.lastName || "");
    setNickName(person.nickName || "");
    setBirthDate(person.birthDate || "");
    setGender(person.gender || "unspecified");
    setParent1Id(parentIds[0] ?? "");
    setParent2Id(parentIds[1] ?? "");
    const partner = households.find((item) => item.partner1PersonId === person.personId || item.partner2PersonId === person.personId);
    if (partner) {
      setSpouseId(partner.partner1PersonId === person.personId ? partner.partner2PersonId : partner.partner1PersonId);
    } else {
      setSpouseId("");
    }
    setStatus("");
  }, [open, person, households, parentIds]);

  if (!open || !person) {
    return null;
  }

  const personOptions = people.filter((item) => item.personId !== person.personId);
  const showReadOnly = !canManage;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 90, display: "grid", placeItems: "center", padding: "1rem" }}>
      <div className="card" style={{ width: "min(780px, 100%)", maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem" }}>
          <h3 style={{ margin: 0 }}>Edit Person</h3>
          <button type="button" className="button secondary tap-button" onClick={onClose}>Close</button>
        </div>

        <p className="page-subtitle" style={{ marginTop: "0.5rem" }}>{person.personId}</p>

        <label className="label">Display Name</label>
        <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={showReadOnly} />

        <div className="settings-chip-list">
          <div style={{ flex: 1, minWidth: 180 }}>
            <label className="label">First Name</label>
            <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={showReadOnly} />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label className="label">Middle Name</label>
            <input className="input" value={middleName} onChange={(e) => setMiddleName(e.target.value)} disabled={showReadOnly} />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label className="label">Last Name</label>
            <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={showReadOnly} />
          </div>
        </div>

        <div className="settings-chip-list">
          <div style={{ flex: 1, minWidth: 180 }}>
            <label className="label">Nickname</label>
            <input className="input" value={nickName} onChange={(e) => setNickName(e.target.value)} disabled={showReadOnly} />
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

        <div className="settings-chip-list" style={{ marginTop: "1rem" }}>
          <button
            type="button"
            className="button tap-button"
            disabled={showReadOnly || saving}
            onClick={() =>
              void (async () => {
                if (!person.personId) return;
                setSaving(true);
                setStatus("Saving...");
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
                      phones: person.phones ?? "",
                      address: person.address ?? "",
                      hobbies: person.hobbies ?? "",
                      notes: person.notes ?? "",
                    }),
                  },
                );
                if (!personRes.ok) {
                  const body = await personRes.text();
                  setStatus(`Save failed: ${personRes.status} ${body.slice(0, 120)}`);
                  setSaving(false);
                  return;
                }
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
                  setStatus(`Saved person, relationship save failed: ${relationshipRes.status} ${body.slice(0, 140)}`);
                  setSaving(false);
                  return;
                }
                setStatus("Saved.");
                setSaving(false);
                onSaved();
              })()
            }
          >
            {saving ? "Saving..." : "Save Person"}
          </button>
          <button type="button" className="button secondary tap-button" onClick={onClose}>Close</button>
        </div>

        {status ? <p style={{ marginTop: "0.75rem" }}>{status}</p> : null}
      </div>
    </div>
  );
}
