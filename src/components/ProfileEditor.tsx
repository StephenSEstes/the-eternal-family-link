"use client";

import { useMemo, useState } from "react";
import type { PersonRecord } from "@/lib/google/types";

type ProfileEditorProps = {
  person: PersonRecord;
  canEdit: boolean;
};

type Status =
  | { type: "idle" }
  | { type: "error"; message: string }
  | { type: "success"; message: string };

export function ProfileEditor({ person, canEdit }: ProfileEditorProps) {
  const [display_name, setDisplayName] = useState(person.displayName);
  const [phones, setPhones] = useState(person.phones);
  const [address, setAddress] = useState(person.address);
  const [hobbies, setHobbies] = useState(person.hobbies);
  const [notes, setNotes] = useState(person.notes);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<Status>({ type: "idle" });

  const payload = useMemo(
    () => ({
      display_name,
      phones,
      address,
      hobbies,
      notes,
    }),
    [address, display_name, hobbies, notes, phones],
  );

  const handleSave = async () => {
    setIsSaving(true);
    setStatus({ type: "idle" });

    try {
      const response = await fetch(`/api/people/${person.personId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorBody?.error ?? "Could not save profile");
      }

      setStatus({ type: "success", message: "Saved successfully." });
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Save failed" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Profile</h2>

      <label className="label" htmlFor="display_name">
        Display Name
      </label>
      <input
        id="display_name"
        className="input"
        value={display_name}
        onChange={(event) => setDisplayName(event.target.value)}
        readOnly={!canEdit}
      />

      <label className="label" htmlFor="phones">
        Phones
      </label>
      <textarea
        id="phones"
        className="textarea"
        value={phones}
        onChange={(event) => setPhones(event.target.value)}
        readOnly={!canEdit}
      />

      <label className="label" htmlFor="address">
        Address
      </label>
      <textarea
        id="address"
        className="textarea"
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        readOnly={!canEdit}
      />

      <label className="label" htmlFor="hobbies">
        Hobbies
      </label>
      <textarea
        id="hobbies"
        className="textarea"
        value={hobbies}
        onChange={(event) => setHobbies(event.target.value)}
        readOnly={!canEdit}
      />

      <label className="label" htmlFor="notes">
        Notes
      </label>
      <textarea
        id="notes"
        className="textarea"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        readOnly={!canEdit}
      />

      {canEdit ? (
        <button type="button" className="button" disabled={isSaving} onClick={handleSave}>
          {isSaving ? "Saving..." : "Save Changes"}
        </button>
      ) : (
        <p className="status-warn">You have read-only access to this profile.</p>
      )}

      {status.type === "error" && <p className="status-warn">{status.message}</p>}
      {status.type === "success" && <p className="status-ok">{status.message}</p>}
    </div>
  );
}