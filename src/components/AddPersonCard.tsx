"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type AddPersonCardProps = {
  tenantKey: string;
  canManage: boolean;
};

export function AddPersonCard({ tenantKey, canManage }: AddPersonCardProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [phones, setPhones] = useState("");
  const [address, setAddress] = useState("");
  const [hobbies, setHobbies] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  if (!canManage) {
    return null;
  }

  const submit = async () => {
    if (!displayName.trim() || !birthDate.trim()) {
      setStatus("Name and birthday are required.");
      return;
    }
    setIsSaving(true);
    setStatus("Creating person...");
    const response = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/people`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: displayName,
        birth_date: birthDate,
        phones,
        address,
        hobbies,
        notes,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(`Failed: ${response.status} ${JSON.stringify(body)}`);
      setIsSaving(false);
      return;
    }
    setStatus("Person created.");
    setDisplayName("");
    setBirthDate("");
    setPhones("");
    setAddress("");
    setHobbies("");
    setNotes("");
    setOpen(false);
    setIsSaving(false);
    router.refresh();
  };

  return (
    <section className="card">
      <button type="button" className="button tap-button" onClick={() => setOpen((value) => !value)}>
        {open ? "Close Add Person" : "Add Person"}
      </button>
      {open ? (
        <div style={{ marginTop: "0.75rem" }}>
          <label className="label">Full Name</label>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <label className="label">Birthday (YYYY-MM-DD)</label>
          <input className="input" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          <label className="label">Phones</label>
          <textarea className="textarea" value={phones} onChange={(e) => setPhones(e.target.value)} />
          <label className="label">Address</label>
          <textarea className="textarea" value={address} onChange={(e) => setAddress(e.target.value)} />
          <label className="label">Hobbies</label>
          <textarea className="textarea" value={hobbies} onChange={(e) => setHobbies(e.target.value)} />
          <label className="label">Notes</label>
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button type="button" className="button tap-button" onClick={submit} disabled={isSaving}>
            {isSaving ? "Saving..." : "Create Person"}
          </button>
        </div>
      ) : null}
      {status ? <p>{status}</p> : null}
    </section>
  );
}
