"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type AddPersonCardProps = {
  tenantKey: string;
  canManage: boolean;
  compact?: boolean;
};

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function AddPersonCard({ tenantKey, canManage, compact = false }: AddPersonCardProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nickName, setNickName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "unspecified">("unspecified");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  if (!canManage) {
    return null;
  }

  const submit = async () => {
    if (!firstName.trim() || !lastName.trim() || !birthDate.trim()) {
      setStatus("First name, last name, and birthday are required.");
      return;
    }
    setIsSaving(true);
    setStatus("Creating person...");
    const response = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/people`, {
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
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(`Failed: ${response.status} ${JSON.stringify(body)}`);
      setIsSaving(false);
      return;
    }
    setStatus("Person created.");
    setFirstName("");
    setMiddleName("");
    setLastName("");
    setNickName("");
    setDisplayName("");
    setBirthDate("");
    setGender("unspecified");
    setOpen(false);
    setIsSaving(false);
    router.refresh();
  };

  return (
    <section className={compact ? "add-person-inline" : "card"}>
      <button type="button" className={compact ? "button button-primary add-person-trigger" : "button tap-button"} onClick={() => setOpen((value) => !value)}>
        <span className="button-icon">
          <PlusIcon />
        </span>
        <span>{open ? "Close Add Person" : "Add Person"}</span>
      </button>
      {open ? (
        <div className={compact ? "add-person-popover" : ""} style={compact ? undefined : { marginTop: "0.75rem" }}>
          <label className="label">First Name</label>
          <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <label className="label">Middle Name</label>
          <input className="input" value={middleName} onChange={(e) => setMiddleName(e.target.value)} />
          <label className="label">Last Name</label>
          <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          <label className="label">Nickname</label>
          <input className="input" value={nickName} onChange={(e) => setNickName(e.target.value)} />
          <label className="label">Display Name</label>
          <input
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Optional: how this name should appear in the app"
          />
          <label className="label">Birthday (YYYY-MM-DD)</label>
          <input className="input" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          <label className="label">Gender</label>
          <select className="input" value={gender} onChange={(e) => setGender(e.target.value as "male" | "female" | "unspecified")}>
            <option value="unspecified">Unspecified</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
          <p className="page-subtitle" style={{ marginTop: "0.5rem" }}>
            Add details like phone, address, hobbies, and notes later as attributes.
          </p>
          <button type="button" className="button tap-button button-primary" onClick={submit} disabled={isSaving}>
            {isSaving ? "Saving..." : "Create Person"}
          </button>
        </div>
      ) : null}
      {status ? <p>{status}</p> : null}
    </section>
  );
}
