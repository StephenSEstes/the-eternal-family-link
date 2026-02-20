"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type AccessItem = {
  userEmail: string;
  role: "ADMIN" | "USER";
  personId: string;
  isEnabled: boolean;
};

type TenantOption = {
  tenantKey: string;
  tenantName: string;
  role: "ADMIN" | "USER";
};

type SettingsClientProps = {
  tenantKey: string;
  tenantName: string;
  tenantOptions: TenantOption[];
  accessItems: AccessItem[];
  people: { personId: string; displayName: string }[];
};

const CSV_TEMPLATES: Record<string, string> = {
  people: "display_name,birth_date,phones,address,hobbies,notes,photo_file_id\nJordan Tenant,1950-05-20,555-0104,44 Family Rd,Chess,Imported profile,",
  relationships: "rel_id,from_person_id,to_person_id,rel_type\nrel-tenant-a-10,p-tenant-a-1,p-tenant-a-4,sibling",
  family_units: "family_unit_id,partner1_person_id,partner2_person_id\nfu-tenant-a-10,p-tenant-a-2,p-tenant-a-4",
  important_dates: "id,date,title,description,person_id\ntenant-a-date-10,2026-12-24,Holiday Dinner,Family gathering,p-tenant-a-1",
  person_attributes:
    "person_id,attribute_type,value_text,label,is_primary,sort_order,visibility,notes\np-tenant-a-1,photo,1A2B3C-photo-file-id,portrait,TRUE,0,family,Main portrait",
};

export function SettingsClient({
  tenantKey,
  tenantName,
  tenantOptions,
  accessItems,
  people,
}: SettingsClientProps) {
  const router = useRouter();
  const [selectedTenantKey, setSelectedTenantKey] = useState(tenantKey);
  const [visibleAccessItems, setVisibleAccessItems] = useState<AccessItem[]>(accessItems);
  const [userEmail, setUserEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "USER">("USER");
  const [personId, setPersonId] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);
  const [accessStatus, setAccessStatus] = useState("");
  const [target, setTarget] = useState<
    "people" | "relationships" | "family_units" | "important_dates" | "person_attributes"
  >("people");
  const [csv, setCsv] = useState(CSV_TEMPLATES.people);
  const [importStatus, setImportStatus] = useState("");
  const [newTenantKey, setNewTenantKey] = useState("");
  const [newTenantName, setNewTenantName] = useState("");
  const [newTenantAdminEmail, setNewTenantAdminEmail] = useState("");
  const [newTenantPersonId, setNewTenantPersonId] = useState("");
  const [newTenantStatus, setNewTenantStatus] = useState("");

  const template = useMemo(() => CSV_TEMPLATES[target], [target]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const res = await fetch(`/api/t/${encodeURIComponent(selectedTenantKey)}/user-access`);
      const body = await res.json().catch(() => null);
      if (cancelled) {
        return;
      }
      if (!res.ok || !Array.isArray(body?.items)) {
        setVisibleAccessItems([]);
        return;
      }
      setVisibleAccessItems(body.items);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedTenantKey]);

  const upsertAccess = async () => {
    setAccessStatus("Saving...");
    const res = await fetch(`/api/t/${encodeURIComponent(selectedTenantKey)}/user-access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userEmail, role, personId, isEnabled }),
    });
    if (!res.ok) {
      const body = await res.text();
      setAccessStatus(`Failed: ${res.status} ${body.slice(0, 160)}`);
      return;
    }
    setAccessStatus("Saved.");
    const refresh = await fetch(`/api/t/${encodeURIComponent(selectedTenantKey)}/user-access`);
    const body = await refresh.json().catch(() => null);
    if (refresh.ok && Array.isArray(body?.items)) {
      setVisibleAccessItems(body.items);
    }
    router.refresh();
  };

  const createTenant = async () => {
    setNewTenantStatus("Creating family group...");
    const res = await fetch("/api/tenants/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userEmail: newTenantAdminEmail,
        tenantKey: newTenantKey,
        tenantName: newTenantName,
        role: "ADMIN",
        personId: newTenantPersonId,
        isEnabled: true,
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      setNewTenantStatus(`Failed: ${res.status} ${body.slice(0, 160)}`);
      return;
    }
    setNewTenantStatus("Family group created. Switch tenant from header after session refresh.");
    router.refresh();
  };

  const importCsv = async () => {
    setImportStatus("Importing...");
    const res = await fetch(`/api/t/${encodeURIComponent(selectedTenantKey)}/import/csv`, {
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

  return (
    <div className="settings-stack">
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Family Groups (Tenants)</h2>
        <p className="page-subtitle">Current tenant: {tenantName}. Create a new family group and seed first admin.</p>
        <label className="label">New Tenant Key</label>
        <input className="input" value={newTenantKey} onChange={(e) => setNewTenantKey(e.target.value)} placeholder="smith-family" />
        <label className="label">New Tenant Name</label>
        <input className="input" value={newTenantName} onChange={(e) => setNewTenantName(e.target.value)} placeholder="Smith Family" />
        <label className="label">First Admin Email</label>
        <input className="input" value={newTenantAdminEmail} onChange={(e) => setNewTenantAdminEmail(e.target.value)} />
        <label className="label">Link Admin To Person</label>
        <select className="input" value={newTenantPersonId} onChange={(e) => setNewTenantPersonId(e.target.value)}>
          <option value="">Select person</option>
          {people.map((person) => (
            <option key={person.personId} value={person.personId}>
              {person.displayName}
            </option>
          ))}
        </select>
        <button type="button" className="button tap-button" onClick={createTenant}>
          Create Family Group
        </button>
        {newTenantStatus ? <p>{newTenantStatus}</p> : null}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Tenant Users & Rights</h2>
        <p className="page-subtitle">Add family member login access under selected tenant.</p>
        <label className="label">Target Tenant</label>
        <select className="input" value={selectedTenantKey} onChange={(e) => setSelectedTenantKey(e.target.value)}>
          {tenantOptions.map((option) => (
            <option key={option.tenantKey} value={option.tenantKey}>
              {option.tenantName} ({option.role})
            </option>
          ))}
        </select>

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
              {visibleAccessItems.map((item) => (
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
        <label className="label">Google Email</label>
        <input className="input" value={userEmail} onChange={(e) => setUserEmail(e.target.value)} />
        <label className="label">Role</label>
        <select className="input" value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "USER")}>
          <option value="USER">USER</option>
          <option value="ADMIN">ADMIN</option>
        </select>
        <label className="label">Linked Person</label>
        <select className="input" value={personId} onChange={(e) => setPersonId(e.target.value)}>
          <option value="">Select person</option>
          {people.map((person) => (
            <option key={person.personId} value={person.personId}>
              {person.displayName}
            </option>
          ))}
        </select>
        <label className="label">
          <input type="checkbox" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} /> Enabled
        </label>
        <button type="button" className="button tap-button" onClick={upsertAccess}>
          Save User Access
        </button>
        {accessStatus ? <p>{accessStatus}</p> : null}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>CSV Import (Paste)</h2>
        <p className="page-subtitle">Initial data load into selected tenant. CSV header must match exactly.</p>
        <label className="label">Target Tenant</label>
        <select className="input" value={selectedTenantKey} onChange={(e) => setSelectedTenantKey(e.target.value)}>
          {tenantOptions.map((option) => (
            <option key={option.tenantKey} value={option.tenantKey}>
              {option.tenantName}
            </option>
          ))}
        </select>
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
          <option value="person_attributes">PersonAttributes</option>
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
