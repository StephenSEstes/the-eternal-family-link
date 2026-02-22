"use client";

import { useMemo, useState } from "react";
import { getPhotoProxyPath } from "@/lib/google/photo-path";
import type { PersonAttributeRecord, PersonRecord } from "@/lib/google/types";

type TenantOption = {
  tenantKey: string;
  tenantName: string;
};

type ProfileEditorProps = {
  person: PersonRecord;
  tenantKey: string;
  people: { personId: string; displayName: string }[];
  marriedToByPersonId: Record<string, string>;
  initialParentIds: string[];
  initialSpouseId: string;
  initialAttributes: PersonAttributeRecord[];
  tenantOptions: TenantOption[];
  canManagePermissions: boolean;
  canEdit: boolean;
};

type Status = { type: "idle" } | { type: "error"; message: string } | { type: "success"; message: string };

type TabKey = "overview" | "photos" | "attributes" | "permissions";

type AttributeDraft = {
  valueText: string;
  label: string;
};

export function ProfileEditor({
  person,
  tenantKey,
  people,
  marriedToByPersonId,
  initialParentIds,
  initialSpouseId,
  initialAttributes,
  tenantOptions,
  canManagePermissions,
  canEdit,
}: ProfileEditorProps) {
  const initialInLaw = useMemo(() => {
    const marker = initialAttributes.find((item) => item.attributeType.toLowerCase() === "in_law");
    if (!marker) {
      return false;
    }
    const normalized = marker.valueText.trim().toLowerCase();
    return normalized === "true" || normalized === "yes" || normalized === "1";
  }, [initialAttributes]);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [displayName, setDisplayName] = useState(person.displayName);
  const [birthDate, setBirthDate] = useState(person.birthDate);
  const [parent1Id, setParent1Id] = useState(initialParentIds[0] ?? "");
  const [parent2Id, setParent2Id] = useState(initialParentIds[1] ?? "");
  const [spouseId, setSpouseId] = useState(initialSpouseId);
  const [isInLaw, setIsInLaw] = useState(initialInLaw);
  const [relationStatus, setRelationStatus] = useState("");
  const [attributeType, setAttributeType] = useState("hobby");
  const [attributeValue, setAttributeValue] = useState("");
  const [attributeLabel, setAttributeLabel] = useState("");
  const [attributeVisibility, setAttributeVisibility] = useState("family");
  const [attributeSortOrder, setAttributeSortOrder] = useState(0);
  const [attributePrimary, setAttributePrimary] = useState(false);
  const [attributeStatus, setAttributeStatus] = useState("");
  const [newPhotoFileId, setNewPhotoFileId] = useState("");
  const [newPhotoLabel, setNewPhotoLabel] = useState("gallery");
  const [newPhotoUpload, setNewPhotoUpload] = useState<File | null>(null);
  const [newPhotoHeadshot, setNewPhotoHeadshot] = useState(false);
  const [photoStatus, setPhotoStatus] = useState("");
  const [permissionTenantKey, setPermissionTenantKey] = useState(tenantKey);
  const [permissionEmail, setPermissionEmail] = useState("");
  const [permissionRole, setPermissionRole] = useState<"ADMIN" | "USER">("USER");
  const [permissionEnabled, setPermissionEnabled] = useState(true);
  const [permissionStatus, setPermissionStatus] = useState("");
  const [attributes, setAttributes] = useState<PersonAttributeRecord[]>(initialAttributes);
  const [attributeDrafts, setAttributeDrafts] = useState<Record<string, AttributeDraft>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<Status>({ type: "idle" });

  const payload = useMemo(
    () => ({
      display_name: displayName,
      birth_date: birthDate,
      phones: person.phones,
      address: person.address,
      hobbies: person.hobbies,
      notes: person.notes,
    }),
    [birthDate, displayName, person.address, person.hobbies, person.notes, person.phones],
  );

  const parentOptions = useMemo(
    () => people.filter((option) => option.personId !== person.personId),
    [people, person.personId],
  );

  const spouseOptions = useMemo(
    () =>
      people.filter((option) => {
        if (option.personId === person.personId) {
          return false;
        }
        const marriedTo = marriedToByPersonId[option.personId];
        return !marriedTo || marriedTo === person.personId;
      }),
    [marriedToByPersonId, people, person.personId],
  );

  const photoAttributes = useMemo(
    () => attributes.filter((item) => item.attributeType === "photo"),
    [attributes],
  );
  const nonPhotoAttributes = useMemo(
    () => attributes.filter((item) => item.attributeType !== "photo"),
    [attributes],
  );

  const updateDraft = (attributeId: string, key: keyof AttributeDraft, value: string) => {
    setAttributeDrafts((current) => {
      const base = current[attributeId] ?? { valueText: "", label: "" };
      return { ...current, [attributeId]: { ...base, [key]: value } };
    });
  };

  const getDraft = (attribute: PersonAttributeRecord): AttributeDraft => {
    return attributeDrafts[attribute.attributeId] ?? {
      valueText: attribute.valueText,
      label: attribute.label,
    };
  };

  const refreshAttributes = async () => {
    const response = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}/attributes`,
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setAttributeStatus(`Failed to load attributes: ${response.status}`);
      setPhotoStatus(`Failed to load attributes: ${response.status}`);
      return;
    }
    setAttributes(Array.isArray(body?.attributes) ? body.attributes : []);
  };

  const saveAttributePatch = async (attributeId: string, patch: Record<string, unknown>) => {
    const response = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}/attributes/${encodeURIComponent(attributeId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, message: `Failed: ${response.status} ${JSON.stringify(body)}` };
    }
    return { ok: true, message: "Updated." };
  };

  const createAttribute = async () => {
    if (!attributeValue.trim()) {
      setAttributeStatus("Attribute value is required.");
      return;
    }
    setAttributeStatus("Saving attribute...");
    const response = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}/attributes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attributeType,
          valueText: attributeValue,
          label: attributeLabel,
          visibility: attributeVisibility,
          sortOrder: attributeSortOrder,
          isPrimary: attributePrimary,
        }),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setAttributeStatus(`Failed: ${response.status} ${JSON.stringify(body)}`);
      return;
    }
    setAttributeStatus("Attribute saved.");
    setAttributeValue("");
    setAttributeLabel("");
    setAttributePrimary(false);
    await refreshAttributes();
  };

  const deleteAttribute = async (attributeId: string) => {
    setAttributeStatus("Deleting attribute...");
    const response = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}/attributes/${encodeURIComponent(attributeId)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      const body = await response.text();
      setAttributeStatus(`Delete failed: ${response.status} ${body.slice(0, 120)}`);
      return;
    }
    setAttributeStatus("Attribute deleted.");
    await refreshAttributes();
  };

  const createPhoto = async () => {
    if (!newPhotoFileId.trim()) {
      setPhotoStatus("Google Drive file ID is required.");
      return;
    }
    setPhotoStatus("Saving photo...");
    const response = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}/attributes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attributeType: "photo",
          valueText: newPhotoFileId.trim(),
          label: newPhotoLabel.trim(),
          visibility: "family",
          sortOrder: 0,
          isPrimary: photoAttributes.length === 0,
        }),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setPhotoStatus(`Failed: ${response.status} ${JSON.stringify(body)}`);
      return;
    }
    setPhotoStatus("Photo saved.");
    setNewPhotoFileId("");
    setNewPhotoLabel("gallery");
    await refreshAttributes();
  };

  const uploadPhoto = async () => {
    if (!newPhotoUpload) {
      setPhotoStatus("Choose a file first.");
      return;
    }
    setPhotoStatus("Uploading photo...");
    const formData = new FormData();
    formData.set("file", newPhotoUpload);
    formData.set("label", newPhotoLabel);
    formData.set("isHeadshot", newPhotoHeadshot ? "true" : "false");
    const response = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}/photos/upload`,
      {
        method: "POST",
        body: formData,
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setPhotoStatus(`Upload failed: ${response.status} ${JSON.stringify(body)}`);
      return;
    }
    setPhotoStatus("Photo uploaded.");
    setNewPhotoUpload(null);
    setNewPhotoFileId("");
    setNewPhotoLabel("gallery");
    setNewPhotoHeadshot(false);
    await refreshAttributes();
  };

  const setHeadshot = async (attributeId: string) => {
    setPhotoStatus("Setting headshot...");
    const result = await saveAttributePatch(attributeId, { isPrimary: true, label: "headshot" });
    if (!result.ok) {
      setPhotoStatus(result.message);
      return;
    }
    setPhotoStatus("Headshot updated.");
    await refreshAttributes();
  };

  const savePhotoRow = async (attribute: PersonAttributeRecord) => {
    const draft = getDraft(attribute);
    setPhotoStatus("Saving photo changes...");
    const result = await saveAttributePatch(attribute.attributeId, {
      valueText: draft.valueText.trim(),
      label: draft.label.trim(),
    });
    if (!result.ok) {
      setPhotoStatus(result.message);
      return;
    }
    setPhotoStatus("Photo updated.");
    await refreshAttributes();
  };

  const deletePhoto = async (attributeId: string) => {
    setPhotoStatus("Deleting photo...");
    const response = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}/attributes/${encodeURIComponent(attributeId)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      const body = await response.text();
      setPhotoStatus(`Delete failed: ${response.status} ${body.slice(0, 120)}`);
      return;
    }
    setPhotoStatus("Photo deleted.");
    await refreshAttributes();
  };

  const saveRelationships = async (parentIds: string[]) => {
    const response = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/relationships/builder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId: person.personId, parentIds, spouseId }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 409 && body?.error === "spouse_unavailable") {
        return { ok: false, message: "Selected spouse is already married. Dissociate them first." };
      } else {
        return { ok: false, message: `Failed: ${response.status} ${JSON.stringify(body)}` };
      }
    }
    return { ok: true, message: "Relationships saved." };
  };

  const syncInLawAttribute = async (enabled: boolean) => {
    const current = attributes.find((item) => item.attributeType.toLowerCase() === "in_law");
    if (enabled) {
      if (current) {
        const result = await saveAttributePatch(current.attributeId, {
          valueText: "TRUE",
          label: "in-law",
          visibility: "family",
        });
        return result.ok ? { ok: true, message: "" } : { ok: false, message: result.message };
      }
      const response = await fetch(
        `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}/attributes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attributeType: "in_law",
            valueText: "TRUE",
            label: "in-law",
            visibility: "family",
            sortOrder: 0,
            isPrimary: false,
          }),
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        return { ok: false, message: `Failed: ${response.status} ${JSON.stringify(body)}` };
      }
      return { ok: true, message: "" };
    }

    if (!current) {
      return { ok: true, message: "" };
    }

    const response = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}/attributes/${encodeURIComponent(current.attributeId)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      const body = await response.text();
      return { ok: false, message: `Delete failed: ${response.status} ${body.slice(0, 120)}` };
    }
    return { ok: true, message: "" };
  };

  const onParentChange = (slot: 1 | 2, value: string) => {
    if (slot === 1) {
      setParent1Id(value);
      if (!parent2Id && value) {
        const spouse = marriedToByPersonId[value];
        if (spouse && spouse !== person.personId) {
          setParent2Id(spouse);
        }
      }
      return;
    }
    setParent2Id(value);
    if (!parent1Id && value) {
      const spouse = marriedToByPersonId[value];
      if (spouse && spouse !== person.personId) {
        setParent1Id(spouse);
      }
    }
  };

  const handleSaveProfile = async () => {
    setIsSaving(true);
    setStatus({ type: "idle" });
    setRelationStatus("Saving profile...");

    try {
      const response = await fetch(
        `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorBody?.error ?? "Could not save profile");
      }

      const parentIds = isInLaw ? [] : Array.from(new Set([parent1Id, parent2Id].filter(Boolean)));
      const relationResult = await saveRelationships(parentIds);
      if (!relationResult.ok) {
        throw new Error(relationResult.message);
      }

      const inLawResult = await syncInLawAttribute(isInLaw);
      if (!inLawResult.ok) {
        throw new Error(inLawResult.message);
      }

      await refreshAttributes();
      setStatus({ type: "success", message: "Profile and relationships saved." });
      setRelationStatus("Saved.");
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Save failed" });
      setRelationStatus("");
    } finally {
      setIsSaving(false);
    }
  };

  const grantPermission = async () => {
    if (!permissionEmail.trim()) {
      setPermissionStatus("Email is required.");
      return;
    }
    setPermissionStatus("Saving permission...");
    const response = await fetch(`/api/t/${encodeURIComponent(permissionTenantKey)}/user-access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userEmail: permissionEmail.trim().toLowerCase(),
        role: permissionRole,
        personId: person.personId,
        isEnabled: permissionEnabled,
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      setPermissionStatus(`Failed: ${response.status} ${body.slice(0, 160)}`);
      return;
    }
    setPermissionStatus("Access granted. User can sign in with this Google email.");
  };

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Edit Person</h2>
      <div className="settings-chip-list" style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          className={`button secondary tap-button ${activeTab === "overview" ? "game-option-selected" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>
        <button
          type="button"
          className={`button secondary tap-button ${activeTab === "photos" ? "game-option-selected" : ""}`}
          onClick={() => setActiveTab("photos")}
        >
          Photos
        </button>
        <button
          type="button"
          className={`button secondary tap-button ${activeTab === "attributes" ? "game-option-selected" : ""}`}
          onClick={() => setActiveTab("attributes")}
        >
          Attributes
        </button>
        {canManagePermissions ? (
          <button
            type="button"
            className={`button secondary tap-button ${activeTab === "permissions" ? "game-option-selected" : ""}`}
            onClick={() => setActiveTab("permissions")}
          >
            Permissions
          </button>
        ) : null}
      </div>

      {activeTab === "overview" ? (
        <>
          <label className="label" htmlFor="display_name">
            Full Name
          </label>
          <input
            id="display_name"
            className="input"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            readOnly={!canEdit}
          />

          <label className="label" htmlFor="birth_date">
            Birthday
          </label>
          <input
            id="birth_date"
            className="input"
            value={birthDate}
            onChange={(event) => setBirthDate(event.target.value)}
            readOnly={!canEdit}
            placeholder="YYYY-MM-DD"
          />

          <label className="label">
            <input
              type="checkbox"
              checked={isInLaw}
              onChange={(event) => setIsInLaw(event.target.checked)}
              disabled={!canEdit}
            />{" "}
            In-law (do not link parents in this family group)
          </label>
          {!isInLaw ? (
            <>
              <label className="label">Parent 1</label>
              <select
                className="input"
                value={parent1Id}
                onChange={(event) => onParentChange(1, event.target.value)}
                disabled={!canEdit}
              >
                <option value="">Not set</option>
                {parentOptions
                  .filter((option) => option.personId !== parent2Id)
                  .map((option) => (
                    <option key={option.personId} value={option.personId}>
                      {option.displayName}
                    </option>
                  ))}
              </select>

              <label className="label">Parent 2</label>
              <select
                className="input"
                value={parent2Id}
                onChange={(event) => onParentChange(2, event.target.value)}
                disabled={!canEdit}
              >
                <option value="">Not set</option>
                {parentOptions
                  .filter((option) => option.personId !== parent1Id)
                  .map((option) => (
                    <option key={option.personId} value={option.personId}>
                      {option.displayName}
                    </option>
                  ))}
              </select>
            </>
          ) : (
            <p className="page-subtitle">Parent links are hidden while in-law is selected.</p>
          )}

          <label className="label">Spouse</label>
          <select
            className="input"
            value={spouseId}
            onChange={(event) => setSpouseId(event.target.value)}
            disabled={!canEdit}
          >
            <option value="">Not married / not set</option>
            {spouseOptions.map((option) => (
              <option key={option.personId} value={option.personId}>
                {option.displayName}
              </option>
            ))}
          </select>
          <p className="page-subtitle">
            Contact and personal details are managed in the Attributes tab.
          </p>

          {canEdit ? (
            <>
              <button type="button" className="button tap-button" disabled={isSaving} onClick={handleSaveProfile}>
                {isSaving ? "Saving..." : "Save Profile"}
              </button>
            </>
          ) : (
            <p className="status-warn">You have read-only access to this profile.</p>
          )}
          {status.type === "error" && <p className="status-warn">{status.message}</p>}
          {status.type === "success" && <p className="status-ok">{status.message}</p>}
          {relationStatus ? <p>{relationStatus}</p> : null}
        </>
      ) : null}

      {activeTab === "photos" ? (
        <>
          <p className="page-subtitle">Manage photo IDs for this person. Mark one as headshot.</p>
          {canEdit ? (
            <>
              <label className="label">Upload Photo File</label>
              <input
                className="input"
                type="file"
                accept="image/*"
                onChange={(event) => setNewPhotoUpload(event.target.files?.[0] ?? null)}
              />
              <label className="label">
                <input
                  type="checkbox"
                  checked={newPhotoHeadshot}
                  onChange={(event) => setNewPhotoHeadshot(event.target.checked)}
                />{" "}
                Mark uploaded photo as headshot
              </label>
              <button type="button" className="button tap-button" onClick={uploadPhoto}>
                Upload Photo
              </button>
              <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "0.8rem 0" }} />
              <label className="label">New Photo File ID</label>
              <input
                className="input"
                value={newPhotoFileId}
                onChange={(event) => setNewPhotoFileId(event.target.value)}
                placeholder="Google Drive file ID"
              />
              <label className="label">Label</label>
              <input className="input" value={newPhotoLabel} onChange={(event) => setNewPhotoLabel(event.target.value)} />
              <button type="button" className="button tap-button" onClick={createPhoto}>
                Add Photo
              </button>
            </>
          ) : null}

          <div className="settings-attr-list">
            {photoAttributes.map((photo) => {
              const draft = getDraft(photo);
              return (
                <div key={photo.attributeId} className="settings-attr-row">
                  <div>
                    <img
                      src={getPhotoProxyPath(draft.valueText || photo.valueText, tenantKey)}
                      alt={`${person.displayName} photo`}
                      style={{ width: "100%", borderRadius: "10px", border: "1px solid var(--line)", marginBottom: "0.5rem" }}
                    />
                    <div className="settings-attr-meta">
                      {photo.isPrimary || photo.label.toLowerCase() === "headshot" ? "HEADSHOT" : "gallery photo"}
                    </div>
                    {canEdit ? (
                      <>
                        <label className="label">File ID</label>
                        <input
                          className="input"
                          value={draft.valueText}
                          onChange={(event) => updateDraft(photo.attributeId, "valueText", event.target.value)}
                        />
                        <label className="label">Label</label>
                        <input
                          className="input"
                          value={draft.label}
                          onChange={(event) => updateDraft(photo.attributeId, "label", event.target.value)}
                        />
                      </>
                    ) : null}
                  </div>
                  {canEdit ? (
                    <div className="settings-chip-list">
                      <button type="button" className="button secondary tap-button" onClick={() => savePhotoRow(photo)}>
                        Save Photo
                      </button>
                      <button type="button" className="button secondary tap-button" onClick={() => setHeadshot(photo.attributeId)}>
                        Set Headshot
                      </button>
                      <button type="button" className="button secondary tap-button" onClick={() => deletePhoto(photo.attributeId)}>
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {photoStatus ? <p>{photoStatus}</p> : null}
        </>
      ) : null}

      {activeTab === "attributes" ? (
        <>
          <p className="page-subtitle">Edit non-photo attributes (phones, hobbies, history, addresses, notes).</p>
          {canEdit ? (
            <>
              <label className="label">Attribute Type</label>
              <select className="input" value={attributeType} onChange={(event) => setAttributeType(event.target.value)}>
                <option value="hobby">hobby</option>
                <option value="phone">phone</option>
                <option value="address">address</option>
                <option value="history">history</option>
                <option value="note">note</option>
                <option value="custom">custom</option>
              </select>
              <label className="label">Value</label>
              <input className="input" value={attributeValue} onChange={(event) => setAttributeValue(event.target.value)} />
              <label className="label">Label</label>
              <input className="input" value={attributeLabel} onChange={(event) => setAttributeLabel(event.target.value)} />
              <label className="label">Visibility</label>
              <select
                className="input"
                value={attributeVisibility}
                onChange={(event) => setAttributeVisibility(event.target.value)}
              >
                <option value="family">family</option>
                <option value="private">private</option>
                <option value="public">public</option>
              </select>
              <label className="label">Sort Order</label>
              <input
                className="input"
                type="number"
                min={0}
                max={9999}
                value={attributeSortOrder}
                onChange={(event) => setAttributeSortOrder(Number.parseInt(event.target.value || "0", 10) || 0)}
              />
              <label className="label">
                <input
                  type="checkbox"
                  checked={attributePrimary}
                  onChange={(event) => setAttributePrimary(event.target.checked)}
                />{" "}
                Mark as primary
              </label>
              <button type="button" className="button tap-button" onClick={createAttribute}>
                Save Attribute
              </button>
            </>
          ) : null}

          {attributeStatus ? <p>{attributeStatus}</p> : null}
          <div className="settings-attr-list">
            {nonPhotoAttributes.map((item) => (
              <div key={item.attributeId} className="settings-attr-row">
                <div>
                  <strong>{item.attributeType}</strong>: {item.valueText}
                  <div className="settings-attr-meta">
                    label: {item.label || "-"} | primary: {item.isPrimary ? "TRUE" : "FALSE"} | visibility:{" "}
                    {item.visibility} | order: {item.sortOrder}
                  </div>
                </div>
                {canEdit ? (
                  <button type="button" className="button secondary tap-button" onClick={() => deleteAttribute(item.attributeId)}>
                    Delete
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}

      {activeTab === "permissions" && canManagePermissions ? (
        <>
          <p className="page-subtitle">
            Grant login to this family member using their Google account email. Default family group is the current one.
          </p>
          <label className="label">Family Group</label>
          <select
            className="input"
            value={permissionTenantKey}
            onChange={(event) => setPermissionTenantKey(event.target.value)}
          >
            {tenantOptions.map((option) => (
              <option key={option.tenantKey} value={option.tenantKey}>
                {option.tenantName}
              </option>
            ))}
          </select>
          <label className="label">Google Email</label>
          <input
            className="input"
            value={permissionEmail}
            onChange={(event) => setPermissionEmail(event.target.value)}
            placeholder="family.member@gmail.com"
          />
          <label className="label">Role</label>
          <select
            className="input"
            value={permissionRole}
            onChange={(event) => setPermissionRole(event.target.value as "ADMIN" | "USER")}
          >
            <option value="USER">USER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
          <label className="label">
            <input
              type="checkbox"
              checked={permissionEnabled}
              onChange={(event) => setPermissionEnabled(event.target.checked)}
            />{" "}
            Enabled
          </label>
          <button type="button" className="button tap-button" onClick={grantPermission}>
            Save Permission
          </button>
          {permissionStatus ? <p>{permissionStatus}</p> : null}
        </>
      ) : null}
    </div>
  );
}
