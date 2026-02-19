"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type AccessItem = {
  userEmail: string;
  role: "ADMIN" | "USER";
  personId: string;
  isEnabled: boolean;
};

type SettingsClientProps = {
  tenantKey: string;
  accessItems: AccessItem[];
  people: { personId: string; displayName: string }[];
};

const CSV_TEMPLATES: Record<string, string> = {
  people: "display_name,birth_date,phones,address,hobbies,notes,photo_file_id\nJordan Tenant,1950-05-20,555-0104,44 Family Rd,Chess,Imported profile,",
  relationships: "rel_id,from_person_id,to_person_id,rel_type\nrel-tenant-a-10,p-tenant-a-1,p-tenant-a-4,sibling",
  family_units: "family_unit_id,partner1_person_id,partner2_person_id\nfu-tenant-a-10,p-tenant-a-2,p-tenant-a-4",
  important_dates: "id,date,title,description,person_id\ntenant-a-date-10,2026-12-24,Holiday Dinner,Family gathering,p-tenant-a-1",
};

export function SettingsClient({ tenantKey, accessItems, people }: SettingsClientProps) {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "USER">("USER");
  const [personId, setPersonId] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);
  const [accessStatus, setAccessStatus] = useState("");

  const [target, setTarget] = useState<"people" | "relationships" | "family_units" | "important_dates">("people");
  const [csv, setCsv] = useState(CSV_TEMPLATES.people);
  const [importStatus, setImportStatus] = useState("");
  const [relationPersonId, setRelationPersonId] = useState("");
  const [parentIds, setParentIds] = useState<string[]>([]);
  const [childIds, setChildIds] = useState<string[]>([]);
  const [spouseId, setSpouseId] = useState("");
  const [relationStatus, setRelationStatus] = useState("");

  const template = useMemo(() => CSV_TEMPLATES[target], [target]);

  const upsertAccess = async () => {
    setAccessStatus("Saving...");
    const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/user-access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userEmail, role, personId, isEnabled }),
    });
    if (!res.ok) {
      const body = await res.text();
      setAccessStatus(`Failed: ${res.status} ${body.slice(0, 120)}`);
      return;
    }
    setAccessStatus("Saved.");
    router.refresh();
  };

  const importCsv = async () => {
    setImportStatus("Importing...");
    const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/import/csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, csv }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setImportStatus(`Failed: ${res.status} ${JSON.stringify(body)}`);
      return;
    }
    setImportStatus(`Imported. created=${body.created} updated=${body.updated} failed=${body.failed}`);
  };

  const toggleItem = (items: string[], id: string) => {
    if (items.includes(id)) {
      return items.filter((value) => value !== id);
    }
    return [...items, id];
  };

  const saveRelationships = async () => {
    if (!relationPersonId) {
      setRelationStatus("Choose a person first.");
      return;
    }
    setRelationStatus("Saving relationships...");
    const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/relationships/builder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId: relationPersonId, parentIds, childIds, spouseId }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setRelationStatus(`Failed: ${res.status} ${JSON.stringify(body)}`);
      return;
    }
    setRelationStatus("Relationships saved.");
  };

  return (
    <div className="settings-stack">
      <section className="card">
        <h2 style={{ marginTop: 0 }}>User Access & Rights</h2>
        <p className="page-subtitle">Tenant-scoped admin access list.</p>
        <div className="settings-table-wrap">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Person ID</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {accessItems.map((item) => (
                <tr key={`${item.userEmail}-${item.personId}-${item.role}`}>
                  <td>{item.userEmail}</td>
                  <td>{item.role}</td>
                  <td>{item.personId || "-"}</td>
                  <td>{item.isEnabled ? "TRUE" : "FALSE"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 style={{ marginBottom: "0.45rem" }}>Add/Update User</h3>
        <label className="label">User Email</label>
        <input className="input" value={userEmail} onChange={(e) => setUserEmail(e.target.value)} />
        <label className="label">Role</label>
        <select className="input" value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "USER")}>
          <option value="USER">USER</option>
          <option value="ADMIN">ADMIN</option>
        </select>
        <label className="label">Person ID (optional)</label>
        <input className="input" value={personId} onChange={(e) => setPersonId(e.target.value)} />
        <label className="label">
          <input type="checkbox" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} /> Enabled
        </label>
        <button type="button" className="button tap-button" onClick={upsertAccess}>
          Save Access
        </button>
        {accessStatus ? <p>{accessStatus}</p> : null}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Relationship Builder</h2>
        <p className="page-subtitle">Pick a person, then select parents, children, and spouse from existing people.</p>
        <label className="label">Person</label>
        <select
          className="input"
          value={relationPersonId}
          onChange={(e) => {
            setRelationPersonId(e.target.value);
            setParentIds([]);
            setChildIds([]);
            setSpouseId("");
          }}
        >
          <option value="">Select person</option>
          {people.map((person) => (
            <option key={person.personId} value={person.personId}>
              {person.displayName}
            </option>
          ))}
        </select>

        <label className="label">Spouse</label>
        <select className="input" value={spouseId} onChange={(e) => setSpouseId(e.target.value)}>
          <option value="">No spouse selected</option>
          {people
            .filter((person) => person.personId !== relationPersonId)
            .map((person) => (
              <option key={person.personId} value={person.personId}>
                {person.displayName}
              </option>
            ))}
        </select>

        <label className="label">Parents</label>
        <div className="settings-chip-list">
          {people
            .filter((person) => person.personId !== relationPersonId)
            .map((person) => (
              <button
                key={`parent-${person.personId}`}
                type="button"
                className={`button secondary tap-button settings-chip ${parentIds.includes(person.personId) ? "game-option-selected" : ""}`}
                onClick={() => setParentIds((items) => toggleItem(items, person.personId))}
              >
                {person.displayName}
              </button>
            ))}
        </div>

        <label className="label">Children</label>
        <div className="settings-chip-list">
          {people
            .filter((person) => person.personId !== relationPersonId)
            .map((person) => (
              <button
                key={`child-${person.personId}`}
                type="button"
                className={`button secondary tap-button settings-chip ${childIds.includes(person.personId) ? "game-option-selected" : ""}`}
                onClick={() => setChildIds((items) => toggleItem(items, person.personId))}
              >
                {person.displayName}
              </button>
            ))}
        </div>

        <button type="button" className="button tap-button" onClick={saveRelationships}>
          Save Relationships
        </button>
        {relationStatus ? <p>{relationStatus}</p> : null}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>CSV Import (Paste)</h2>
        <p className="page-subtitle">Initial data load by tenant. CSV header must match exactly.</p>
        <label className="label">Target Table</label>
        <select
          className="input"
          value={target}
          onChange={(e) => {
            const next = e.target.value as typeof target;
            setTarget(next);
            setCsv(CSV_TEMPLATES[next]);
          }}
        >
          <option value="people">People</option>
          <option value="relationships">Relationships</option>
          <option value="family_units">FamilyUnits</option>
          <option value="important_dates">ImportantDates</option>
        </select>
        <p className="settings-template-title">Required format for `{target}`:</p>
        <pre className="settings-template">{template}</pre>
        <label className="label">Paste CSV Content</label>
        <textarea className="textarea settings-csv-box" value={csv} onChange={(e) => setCsv(e.target.value)} />
        <button type="button" className="button tap-button" onClick={importCsv}>
          Import CSV
        </button>
        {importStatus ? <p>{importStatus}</p> : null}
      </section>
    </div>
  );
}
