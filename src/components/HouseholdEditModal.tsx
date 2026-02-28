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
};

type ChildSummary = {
  personId: string;
  displayName: string;
  birthDate: string;
};

type Props = {
  open: boolean;
  tenantKey: string;
  householdId: string;
  onClose: () => void;
  onSaved: () => void;
};

export function HouseholdEditModal({ open, tenantKey, householdId, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [household, setHousehold] = useState<HouseholdSummary | null>(null);
  const [children, setChildren] = useState<ChildSummary[]>([]);
  const [weddingPhotoFileId, setWeddingPhotoFileId] = useState("");
  const [addChildOpen, setAddChildOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nickName, setNickName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "unspecified">("unspecified");

  useEffect(() => {
    if (!open || !householdId) {
      return;
    }
    setLoading(true);
    setStatus("Loading household...");
    void (async () => {
      const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(householdId)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.household) {
        setStatus(`Load failed: ${res.status}`);
        setLoading(false);
        return;
      }
      setHousehold(body.household as HouseholdSummary);
      setChildren(Array.isArray(body.children) ? (body.children as ChildSummary[]) : []);
      setWeddingPhotoFileId(String(body.household.weddingPhotoFileId ?? ""));
      setStatus("");
      setLoading(false);
    })();
  }, [open, householdId, tenantKey]);

  if (!open) {
    return null;
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 95, display: "grid", placeItems: "center", padding: "1rem" }}>
      <div className="card" style={{ width: "min(760px, 100%)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Edit Household</h3>
          <button type="button" className="button secondary tap-button" onClick={onClose}>Close</button>
        </div>

        {loading ? <p style={{ marginTop: "0.75rem" }}>{status}</p> : null}

        {household ? (
          <>
            <div className="settings-table-wrap" style={{ marginTop: "0.75rem" }}>
              <table className="settings-table">
                <thead>
                  <tr><th>Mother</th><th>Father</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{household.wifeName}</td>
                    <td>{household.husbandName}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <label className="label">Wedding Photo File ID</label>
            <input className="input" value={weddingPhotoFileId} onChange={(e) => setWeddingPhotoFileId(e.target.value)} placeholder="Google Drive file id" />
            <div style={{ marginTop: "0.75rem" }}>
              <img
                src={weddingPhotoFileId ? getPhotoProxyPath(weddingPhotoFileId, tenantKey) : "/WeddingAvatar1.png"}
                alt="Wedding placeholder"
                style={{ width: "100%", maxHeight: 280, objectFit: "cover", borderRadius: 12, border: "1px solid var(--line)" }}
              />
            </div>

            <div className="settings-chip-list" style={{ marginTop: "0.75rem" }}>
              <button
                type="button"
                className="button tap-button"
                onClick={() =>
                  void (async () => {
                    setStatus("Saving household...");
                    const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(householdId)}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ weddingPhotoFileId }),
                    });
                    if (!res.ok) {
                      const body = await res.text();
                      setStatus(`Save failed: ${res.status} ${body.slice(0, 120)}`);
                      return;
                    }
                    setStatus("Household saved.");
                    onSaved();
                  })()
                }
              >
                Save Household
              </button>
              <button type="button" className="button secondary tap-button" onClick={() => setAddChildOpen((value) => !value)}>
                {addChildOpen ? "Cancel Add Child" : "Add Child"}
              </button>
            </div>

            <h4 style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>Children</h4>
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
                <label className="label">Gender</label>
                <select className="input" value={gender} onChange={(e) => setGender(e.target.value as "male" | "female" | "unspecified")}>
                  <option value="unspecified">Unspecified</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>

                <button
                  type="button"
                  className="button tap-button"
                  style={{ marginTop: "0.75rem" }}
                  onClick={() =>
                    void (async () => {
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
                      setGender("unspecified");
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

        {status ? <p style={{ marginTop: "0.75rem" }}>{status}</p> : null}
      </div>
    </div>
  );
}
