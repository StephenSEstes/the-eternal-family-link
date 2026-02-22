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

type LocalUserItem = {
  username: string;
  role: "ADMIN" | "USER";
  personId: string;
  isEnabled: boolean;
  failedAttempts: number;
  lockedUntil: string;
  mustChangePassword: boolean;
};

type SecurityPolicy = {
  minLength: number;
  requireNumber: boolean;
  requireUppercase: boolean;
  requireLowercase: boolean;
  lockoutAttempts: number;
};

type SettingsClientProps = {
  tenantKey: string;
  tenantName: string;
  tenantOptions: TenantOption[];
  accessItems: AccessItem[];
  people: { personId: string; displayName: string }[];
};

type SettingsTab = "family_groups" | "users" | "local_security" | "import";

const CSV_TEMPLATES: Record<string, string> = {
  people: "display_name,birth_date,phones,address,hobbies,notes,photo_file_id\nJordan Tenant,1950-05-20,555-0104,44 Family Rd,Chess,Imported profile,",
  relationships: "rel_id,from_person_id,to_person_id,rel_type\nrel-tenant-a-10,p-tenant-a-1,p-tenant-a-4,sibling",
  family_units: "family_unit_id,partner1_person_id,partner2_person_id\nfu-tenant-a-10,p-tenant-a-2,p-tenant-a-4",
  important_dates: "id,date,title,description,person_id\ntenant-a-date-10,2026-12-24,Holiday Dinner,Family gathering,p-tenant-a-1",
  person_attributes:
    "person_id,attribute_type,value_text,label,is_primary,sort_order,visibility,notes\np-tenant-a-1,photo,1A2B3C-photo-file-id,portrait,TRUE,0,family,Main portrait",
};

const DEFAULT_POLICY: SecurityPolicy = {
  minLength: 8,
  requireNumber: true,
  requireUppercase: false,
  requireLowercase: true,
  lockoutAttempts: 5,
};

export function SettingsClient({
  tenantKey,
  tenantName,
  tenantOptions,
  accessItems,
  people,
}: SettingsClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SettingsTab>("users");
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
  const [policy, setPolicy] = useState<SecurityPolicy>(DEFAULT_POLICY);
  const [policyStatus, setPolicyStatus] = useState("");
  const [localUsers, setLocalUsers] = useState<LocalUserItem[]>([]);
  const [localUserStatus, setLocalUserStatus] = useState("");
  const [localUsername, setLocalUsername] = useState("");
  const [localPassword, setLocalPassword] = useState("");
  const [localRole, setLocalRole] = useState<"ADMIN" | "USER">("USER");
  const [localPersonId, setLocalPersonId] = useState("");
  const [localEnabled, setLocalEnabled] = useState(true);
  const [selectedLocalUsername, setSelectedLocalUsername] = useState("");
  const [manageRole, setManageRole] = useState<"ADMIN" | "USER">("USER");
  const [manageNextUsername, setManageNextUsername] = useState("");
  const [managePassword, setManagePassword] = useState("");
  const [showDoneButton, setShowDoneButton] = useState(false);

  const template = useMemo(() => CSV_TEMPLATES[target], [target]);

  const loadTenantAdminData = async (tenantKeyToLoad: string) => {
    const [accessRes, policyRes, usersRes] = await Promise.all([
      fetch(`/api/t/${encodeURIComponent(tenantKeyToLoad)}/user-access`),
      fetch(`/api/t/${encodeURIComponent(tenantKeyToLoad)}/security-policy`),
      fetch(`/api/t/${encodeURIComponent(tenantKeyToLoad)}/local-users`),
    ]);
    const accessBody = await accessRes.json().catch(() => null);
    const policyBody = await policyRes.json().catch(() => null);
    const usersBody = await usersRes.json().catch(() => null);

    if (accessRes.ok && Array.isArray(accessBody?.items)) {
      setVisibleAccessItems(accessBody.items);
    } else {
      setVisibleAccessItems([]);
    }

    if (policyRes.ok && policyBody?.policy) {
      setPolicy({
        minLength: Number(policyBody.policy.minLength ?? DEFAULT_POLICY.minLength),
        requireNumber: Boolean(policyBody.policy.requireNumber),
        requireUppercase: Boolean(policyBody.policy.requireUppercase),
        requireLowercase: Boolean(policyBody.policy.requireLowercase),
        lockoutAttempts: Number(policyBody.policy.lockoutAttempts ?? DEFAULT_POLICY.lockoutAttempts),
      });
    } else {
      setPolicy(DEFAULT_POLICY);
    }

    if (usersRes.ok && Array.isArray(usersBody?.users)) {
      setLocalUsers(usersBody.users);
    } else {
      setLocalUsers([]);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await loadTenantAdminData(selectedTenantKey);
      if (cancelled) {
        return;
      }
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
    await loadTenantAdminData(selectedTenantKey);
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
    setNewTenantStatus("Family group created. Switch family group from header after session refresh.");
    router.refresh();
  };

  const savePolicy = async () => {
    setPolicyStatus("Saving policy...");
    const res = await fetch(`/api/t/${encodeURIComponent(selectedTenantKey)}/security-policy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(policy),
    });
    const body = await res.text();
    if (!res.ok) {
      setPolicyStatus(`Failed: ${res.status} ${body.slice(0, 180)}`);
      return;
    }
    setPolicyStatus("Policy saved.");
  };

  const createLocalUser = async () => {
    setLocalUserStatus("Creating local user...");
    const res = await fetch(`/api/t/${encodeURIComponent(selectedTenantKey)}/local-users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: localUsername,
        password: localPassword,
        role: localRole,
        personId: localPersonId,
        isEnabled: localEnabled,
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      setLocalUserStatus(`Failed: ${res.status} ${body.slice(0, 200)}`);
      return;
    }
    setLocalUserStatus("Local user saved.");
    setLocalUsername("");
    setLocalPassword("");
    setLocalRole("USER");
    setLocalPersonId("");
    setLocalEnabled(true);
    await loadTenantAdminData(selectedTenantKey);
  };

  const patchLocalUser = async (username: string, payload: Record<string, unknown>) => {
    setLocalUserStatus(`Updating ${username}...`);
    const res = await fetch(
      `/api/t/${encodeURIComponent(selectedTenantKey)}/local-users/${encodeURIComponent(username)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const body = await res.text();
    if (!res.ok) {
      setLocalUserStatus(`Failed: ${res.status} ${body.slice(0, 200)}`);
      return false;
    }
    await loadTenantAdminData(selectedTenantKey);
    setLocalUserStatus("Local user updated.");
    setShowDoneButton(true);
    if (typeof payload.action === "string" && payload.action === "rename_username") {
      const next = typeof payload.nextUsername === "string" ? payload.nextUsername.trim().toLowerCase() : "";
      if (next) {
        setSelectedLocalUsername(next);
        setManageNextUsername("");
      }
    }
    return true;
  };

  const deleteSelectedLocalUser = async () => {
    if (!selectedLocalUsername) {
      return;
    }
    const confirmed = window.confirm(
      `Mark "${selectedLocalUsername}" as inactive? They will not be able to sign in until re-enabled.`,
    );
    if (!confirmed) {
      return;
    }
    await patchLocalUser(selectedLocalUsername, { action: "set_enabled", isEnabled: false });
  };

  const closeLocalUserEditor = () => {
    setSelectedLocalUsername("");
    setManageNextUsername("");
    setManagePassword("");
    setShowDoneButton(false);
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

  useEffect(() => {
    if (localUsers.length === 0) {
      if (selectedLocalUsername) {
        setSelectedLocalUsername("");
      }
      if (showDoneButton) {
        setShowDoneButton(false);
      }
      return;
    }
    if (!selectedLocalUsername) {
      return;
    }
    const selected = localUsers.find((user) => user.username === selectedLocalUsername);
    if (!selected) {
      setSelectedLocalUsername("");
      setShowDoneButton(false);
      return;
    }
    setManageRole(selected.role);
  }, [localUsers, selectedLocalUsername, showDoneButton]);

  const selectedLocalUser = localUsers.find((user) => user.username === selectedLocalUsername) ?? null;

  return (
    <div className="settings-stack">
      <div className="settings-chip-list">
        <button
          type="button"
          className={`button secondary tap-button ${activeTab === "users" ? "game-option-selected" : ""}`}
          onClick={() => setActiveTab("users")}
        >
          Users & Rights
        </button>
        <button
          type="button"
          className={`button secondary tap-button ${activeTab === "local_security" ? "game-option-selected" : ""}`}
          onClick={() => setActiveTab("local_security")}
        >
          Local Login Security
        </button>
        <button
          type="button"
          className={`button secondary tap-button ${activeTab === "family_groups" ? "game-option-selected" : ""}`}
          onClick={() => setActiveTab("family_groups")}
        >
          Family Groups
        </button>
        <button
          type="button"
          className={`button secondary tap-button ${activeTab === "import" ? "game-option-selected" : ""}`}
          onClick={() => setActiveTab("import")}
        >
          CSV Import
        </button>
      </div>

      {activeTab === "family_groups" ? (
        <section className="card">
        <h2 style={{ marginTop: 0 }}>Family Groups</h2>
        <p className="page-subtitle">Current family group: {tenantName}. Create a new family group and seed first admin.</p>
        <label className="label">New Family Group Key</label>
        <input className="input" value={newTenantKey} onChange={(e) => setNewTenantKey(e.target.value)} placeholder="smith-family" />
        <label className="label">New Family Group Name</label>
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
      ) : null}

      {activeTab === "users" ? (
        <section className="card">
        <h2 style={{ marginTop: 0 }}>Family Group Users & Rights</h2>
        <label className="label">Target Family Group</label>
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
              <tr><th>Email</th><th>Role</th><th>Person ID</th><th>Enabled</th></tr>
            </thead>
            <tbody>
              {visibleAccessItems.map((item) => (
                <tr key={`${item.userEmail}-${item.personId}-${item.role}`}>
                  <td>{item.userEmail}</td><td>{item.role}</td><td>{item.personId || "-"}</td><td>{item.isEnabled ? "TRUE" : "FALSE"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 style={{ marginBottom: "0.45rem" }}>Add/Update Google User</h3>
        <label className="label">Google Email</label>
        <input className="input" value={userEmail} onChange={(e) => setUserEmail(e.target.value)} />
        <label className="label">Role</label>
        <select className="input" value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "USER")}>
          <option value="USER">USER</option><option value="ADMIN">ADMIN</option>
        </select>
        <label className="label">Linked Person</label>
        <select className="input" value={personId} onChange={(e) => setPersonId(e.target.value)}>
          <option value="">Select person</option>
          {people.map((person) => (
            <option key={person.personId} value={person.personId}>{person.displayName}</option>
          ))}
        </select>
        <label className="label"><input type="checkbox" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} /> Enabled</label>
        <button type="button" className="button tap-button" onClick={upsertAccess}>Save Google User Access</button>
        {accessStatus ? <p>{accessStatus}</p> : null}
        </section>
      ) : null}

      {activeTab === "local_security" ? (
        <section className="card">
        <h2 style={{ marginTop: 0 }}>Local Login Security</h2>
        <p className="page-subtitle">Configure password complexity, lockout rules, and local username/password users.</p>
        <label className="label">Minimum Password Length</label>
        <input
          className="input"
          type="number"
          min={4}
          max={128}
          value={policy.minLength}
          onChange={(e) => setPolicy((p) => ({ ...p, minLength: Number.parseInt(e.target.value || "8", 10) || 8 }))}
        />
        <label className="label"><input type="checkbox" checked={policy.requireNumber} onChange={(e) => setPolicy((p) => ({ ...p, requireNumber: e.target.checked }))} /> Require number</label>
        <label className="label"><input type="checkbox" checked={policy.requireUppercase} onChange={(e) => setPolicy((p) => ({ ...p, requireUppercase: e.target.checked }))} /> Require uppercase</label>
        <label className="label"><input type="checkbox" checked={policy.requireLowercase} onChange={(e) => setPolicy((p) => ({ ...p, requireLowercase: e.target.checked }))} /> Require lowercase</label>
        <label className="label">Lockout After Failed Attempts</label>
        <input
          className="input"
          type="number"
          min={1}
          max={50}
          value={policy.lockoutAttempts}
          onChange={(e) => setPolicy((p) => ({ ...p, lockoutAttempts: Number.parseInt(e.target.value || "5", 10) || 5 }))}
        />
        <button type="button" className="button tap-button" onClick={savePolicy}>Save Security Policy</button>
        {policyStatus ? <p>{policyStatus}</p> : null}

        <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "1rem 0" }} />
        <h3 style={{ marginTop: 0 }}>Create User</h3>
        <label className="label">Username</label>
        <input className="input" value={localUsername} onChange={(e) => setLocalUsername(e.target.value)} />
        <label className="label">Temporary Password</label>
        <input className="input" type="password" value={localPassword} onChange={(e) => setLocalPassword(e.target.value)} />
        <label className="label">Role</label>
        <select className="input" value={localRole} onChange={(e) => setLocalRole(e.target.value as "ADMIN" | "USER")}>
          <option value="USER">USER</option><option value="ADMIN">ADMIN</option>
        </select>
        <label className="label">Linked Person</label>
        <select className="input" value={localPersonId} onChange={(e) => setLocalPersonId(e.target.value)}>
          <option value="">Select person</option>
          {people.map((person) => (
            <option key={person.personId} value={person.personId}>{person.displayName}</option>
          ))}
        </select>
        <label className="label"><input type="checkbox" checked={localEnabled} onChange={(e) => setLocalEnabled(e.target.checked)} /> Active</label>
        <button type="button" className="button tap-button" onClick={createLocalUser}>Create User</button>

        <div className="settings-table-wrap" style={{ marginTop: "1rem" }}>
          <table className="settings-table">
            <thead>
              <tr><th>Username</th><th>Role</th><th>Person</th><th>Active</th><th>Failed</th><th>Locked Until</th><th>Select</th></tr>
            </thead>
            <tbody>
              {localUsers.map((user) => (
                <tr key={user.username}>
                  <td>{user.username}</td>
                  <td>{user.role}</td>
                  <td>{user.personId}</td>
                  <td>{user.isEnabled ? "TRUE" : "FALSE"}</td>
                  <td>{user.failedAttempts}</td>
                  <td>{user.lockedUntil || "-"}</td>
                  <td>
                    <button
                      type="button"
                      className="button secondary tap-button"
                      onClick={() => {
                        setSelectedLocalUsername(user.username);
                        setShowDoneButton(false);
                      }}
                    >
                      {selectedLocalUsername === user.username ? "Selected" : "Manage"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selectedLocalUser ? (
          <div className="card" style={{ marginTop: "0.75rem" }}>
            <h3 style={{ marginTop: 0, marginBottom: "0.5rem" }}>Manage User: {selectedLocalUser.username}</h3>
            <p className="page-subtitle" style={{ marginTop: 0 }}>
              Active: {selectedLocalUser.isEnabled ? "TRUE" : "FALSE"} | Failed attempts: {selectedLocalUser.failedAttempts}
            </p>
            <div className="settings-chip-list">
              <button
                type="button"
                className="button tap-button"
                onClick={() => void patchLocalUser(selectedLocalUser.username, { action: "set_enabled", isEnabled: !selectedLocalUser.isEnabled })}
              >
                {selectedLocalUser.isEnabled ? "Disable" : "Enable"}
              </button>
              <button type="button" className="button tap-button" onClick={() => void patchLocalUser(selectedLocalUser.username, { action: "unlock" })}>
                Unlock
              </button>
              {showDoneButton ? (
                <button type="button" className="button tap-button" onClick={closeLocalUserEditor}>
                  Done
                </button>
              ) : (
                <button
                  type="button"
                  className="button tap-button"
                  style={{ background: "var(--warn)", borderColor: "var(--warn)" }}
                  onClick={deleteSelectedLocalUser}
                >
                  Delete User
                </button>
              )}
            </div>

            <label className="label">Role</label>
            <div className="settings-inline-action">
              <select className="input" value={manageRole} onChange={(e) => setManageRole(e.target.value as "ADMIN" | "USER")}>
                <option value="USER">USER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
              <button
                type="button"
                className="button tap-button"
                onClick={() => void patchLocalUser(selectedLocalUser.username, { action: "update_role", role: manageRole })}
              >
                Change Role
              </button>
            </div>

            <label className="label">New Username</label>
            <div className="settings-inline-action">
              <input className="input" value={manageNextUsername} onChange={(e) => setManageNextUsername(e.target.value)} />
              <button
                type="button"
                className="button tap-button"
                onClick={() => void patchLocalUser(selectedLocalUser.username, { action: "rename_username", nextUsername: manageNextUsername })}
              >
                Change Username
              </button>
            </div>

            <label className="label">New Password</label>
            <div className="settings-inline-action">
              <input className="input" type="password" value={managePassword} onChange={(e) => setManagePassword(e.target.value)} />
              <button
                type="button"
                className="button tap-button"
                onClick={() => void patchLocalUser(selectedLocalUser.username, { action: "reset_password", password: managePassword })}
              >
                Reset Password
              </button>
            </div>
          </div>
        ) : (
          <p className="page-subtitle">Select a local user above to manage role, username, password, lock state, or deletion.</p>
        )}
        {localUserStatus ? <p>{localUserStatus}</p> : null}
        </section>
      ) : null}

      {activeTab === "import" ? (
        <section className="card">
        <h2 style={{ marginTop: 0 }}>CSV Import (Paste)</h2>
        <p className="page-subtitle">Initial data load into selected family group. CSV header must match exactly.</p>
        <label className="label">Target Family Group</label>
        <select className="input" value={selectedTenantKey} onChange={(e) => setSelectedTenantKey(e.target.value)}>
          {tenantOptions.map((option) => (
            <option key={option.tenantKey} value={option.tenantKey}>{option.tenantName}</option>
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
        <button type="button" className="button tap-button" onClick={importCsv}>Import CSV</button>
        {importStatus ? <p>{importStatus}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
