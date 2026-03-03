"use client";

import { useEffect, useMemo, useState } from "react";
import { getPhotoProxyPath } from "@/lib/google/photo-path";
import { PrimaryButton, SecondaryButton } from "@/components/ui/primitives";

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
  email?: string;
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
  startDate?: string;
  notes?: string;
};

type PhotoLibraryItem = {
  fileId: string;
  name: string;
  description: string;
  date: string;
  people: Array<{ personId: string; displayName: string }>;
  households: Array<{ householdId: string; label: string }>;
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
type AddSpouseMode = "existing" | "new";

function toMonthDay(value: string) {
  const raw = value.trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return `${match[2]}/${match[3]}`;
  }
  return raw || "-";
}

function parseDate(value?: string) {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function isEligibleParentAge(parentBirthDate: string | undefined, childBirthDate: string | undefined, minYears = 15) {
  const parent = parseDate(parentBirthDate);
  const child = parseDate(childBirthDate);
  if (!child) {
    return true;
  }
  if (!parent) {
    return false;
  }
  const cutoff = new Date(child);
  cutoff.setFullYear(cutoff.getFullYear() - minYears);
  return parent <= cutoff;
}

function assignParentSlots(parentIds: string[], peopleById: Map<string, PersonItem>) {
  let motherId = "";
  let fatherId = "";
  const remaining: string[] = [];

  parentIds.forEach((parentId) => {
    const gender = peopleById.get(parentId)?.gender ?? "unspecified";
    if (gender === "female" && !motherId) {
      motherId = parentId;
      return;
    }
    if (gender === "male" && !fatherId) {
      fatherId = parentId;
      return;
    }
    remaining.push(parentId);
  });

  remaining.forEach((parentId) => {
    if (!motherId) {
      motherId = parentId;
      return;
    }
    if (!fatherId) {
      fatherId = parentId;
    }
  });

  return { motherId, fatherId };
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
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [hobbies, setHobbies] = useState("");
  const [notes, setNotes] = useState("");
  const [parent1Id, setParent1Id] = useState("");
  const [parent2Id, setParent2Id] = useState("");
  const [spouseId, setSpouseId] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [localPeople, setLocalPeople] = useState<PersonItem[]>(people);
  const [attributes, setAttributes] = useState<PersonAttribute[]>([]);
  const [newAttrType, setNewAttrType] = useState("note");
  const [newAttrLabel, setNewAttrLabel] = useState("");
  const [newAttrValue, setNewAttrValue] = useState("");
  const [newPhotoLabel, setNewPhotoLabel] = useState("portrait");
  const [newPhotoDescription, setNewPhotoDescription] = useState("");
  const [newPhotoDate, setNewPhotoDate] = useState("");
  const [newPhotoHeadshot, setNewPhotoHeadshot] = useState(false);
  const [selectedPhotoAttributeIds, setSelectedPhotoAttributeIds] = useState<string[]>([]);
  const [selectedPhotoAttributeId, setSelectedPhotoAttributeId] = useState("");
  const [editPhotoName, setEditPhotoName] = useState("");
  const [editPhotoDescription, setEditPhotoDescription] = useState("");
  const [editPhotoDate, setEditPhotoDate] = useState("");
  const [editPhotoPrimary, setEditPhotoPrimary] = useState(false);
  const [linkTargetPersonId, setLinkTargetPersonId] = useState("");
  const [largePhotoFileId, setLargePhotoFileId] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoSearchQuery, setPhotoSearchQuery] = useState("");
  const [photoSearchResults, setPhotoSearchResults] = useState<PhotoLibraryItem[]>([]);
  const [photoSearchBusy, setPhotoSearchBusy] = useState(false);
  const [showAddSpouse, setShowAddSpouse] = useState(false);
  const [addSpouseMode, setAddSpouseMode] = useState<AddSpouseMode>("existing");
  const [existingSpouseQuery, setExistingSpouseQuery] = useState("");
  const [existingSpouseId, setExistingSpouseId] = useState("");
  const [newSpouseFirstName, setNewSpouseFirstName] = useState("");
  const [newSpouseMiddleName, setNewSpouseMiddleName] = useState("");
  const [newSpouseLastName, setNewSpouseLastName] = useState("");
  const [newSpouseNickName, setNewSpouseNickName] = useState("");
  const [newSpouseDisplayName, setNewSpouseDisplayName] = useState("");
  const [newSpouseBirthDate, setNewSpouseBirthDate] = useState("");
  const [newSpouseGender, setNewSpouseGender] = useState<"male" | "female" | "unspecified">("unspecified");
  const [newSpouseInLaw, setNewSpouseInLaw] = useState(true);
  const [creatingSpouse, setCreatingSpouse] = useState(false);
  const peopleById = useMemo(() => new Map(localPeople.map((item) => [item.personId, item])), [localPeople]);

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
    return Array.from(
      new Set(
        parentEdges
      .filter((edge) => edge.toPersonId === person.personId)
      .map((edge) => edge.fromPersonId)
      ),
    ).slice(0, 2);
  }, [parentEdges, person]);
  const parentSelection = useMemo(() => assignParentSlots(parentIds, peopleById), [parentIds, peopleById]);

  const householdId = useMemo(() => {
    if (!person) return "";
    const match = households.find(
      (item) => item.partner1PersonId === person.personId || item.partner2PersonId === person.personId,
    );
    return match?.id ?? "";
  }, [households, person]);
  const spouseByPersonId = useMemo(() => {
    const map = new Map<string, string>();
    households.forEach((unit) => {
      map.set(unit.partner1PersonId, unit.partner2PersonId);
      map.set(unit.partner2PersonId, unit.partner1PersonId);
    });
    return map;
  }, [households]);

  useEffect(() => {
    setLocalPeople(people);
  }, [people]);

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
    setEmail(person.email || "");
    setAddress(person.address || "");
    setHobbies(person.hobbies || "");
    setNotes(person.notes || "");
    setParent1Id(parentSelection.motherId);
    setParent2Id(parentSelection.fatherId);
    const partner = households.find((item) => item.partner1PersonId === person.personId || item.partner2PersonId === person.personId);
    if (partner) {
      setSpouseId(partner.partner1PersonId === person.personId ? partner.partner2PersonId : partner.partner1PersonId);
    } else {
      setSpouseId("");
    }
    setNewAttrType("note");
    setNewAttrLabel("");
    setNewAttrValue("");
    setNewPhotoLabel("portrait");
    setNewPhotoDescription("");
    setNewPhotoDate("");
    setNewPhotoHeadshot(false);
    setSelectedPhotoAttributeIds([]);
    setSelectedPhotoAttributeId("");
    setEditPhotoName("");
    setEditPhotoDescription("");
    setEditPhotoDate("");
    setEditPhotoPrimary(false);
    setLinkTargetPersonId("");
    setLargePhotoFileId("");
    setPhotoBusy(false);
    setPhotoSearchQuery("");
    setPhotoSearchResults([]);
    setPhotoSearchBusy(false);
    setShowAddSpouse(false);
    setAddSpouseMode("existing");
    setExistingSpouseQuery("");
    setExistingSpouseId("");
    setNewSpouseFirstName("");
    setNewSpouseMiddleName("");
    setNewSpouseLastName("");
    setNewSpouseNickName("");
    setNewSpouseDisplayName("");
    setNewSpouseBirthDate("");
    setNewSpouseGender((person.gender ?? "unspecified") === "male" ? "female" : (person.gender ?? "unspecified") === "female" ? "male" : "unspecified");
    setNewSpouseInLaw(true);
    setStatus("");
    void loadAttributes(person.personId);
  }, [open, person, households, parentSelection, tenantKey]);

  const personOptions = localPeople.filter((item) => item.personId !== person?.personId);
  const childBirthDate = birthDate || person?.birthDate;
  const motherOptions = useMemo(() => {
    const base = personOptions.filter(
      (item) =>
        (item.gender ?? "unspecified") === "female" &&
        isEligibleParentAge(item.birthDate, childBirthDate) &&
        item.personId !== parent2Id,
    );
    if (parent1Id && !base.some((option) => option.personId === parent1Id)) {
      const selected = personOptions.find((option) => option.personId === parent1Id);
      if (selected) {
        return [selected, ...base];
      }
    }
    return base;
  }, [childBirthDate, parent1Id, parent2Id, personOptions]);
  const fatherOptions = useMemo(() => {
    const base = personOptions.filter(
      (item) =>
        (item.gender ?? "unspecified") === "male" &&
        isEligibleParentAge(item.birthDate, childBirthDate) &&
        item.personId !== parent1Id,
    );
    if (parent2Id && !base.some((option) => option.personId === parent2Id)) {
      const selected = personOptions.find((option) => option.personId === parent2Id);
      if (selected) {
        return [selected, ...base];
      }
    }
    return base;
  }, [childBirthDate, parent1Id, parent2Id, personOptions]);

  const spouseOptions = useMemo(
    () =>
      personOptions.filter((option) => {
        const marriedTo = spouseByPersonId.get(option.personId);
        return !marriedTo || marriedTo === person?.personId;
      }),
    [person?.personId, personOptions, spouseByPersonId],
  );
  const existingSpouseOptions = useMemo(() => {
    const query = existingSpouseQuery.trim().toLowerCase();
    if (!query) return spouseOptions;
    return spouseOptions.filter((option) => option.displayName.toLowerCase().includes(query));
  }, [existingSpouseQuery, spouseOptions]);
  const selectedPhoto = useMemo(
    () => photoAttributes.find((item) => item.attributeId === selectedPhotoAttributeId) ?? null,
    [photoAttributes, selectedPhotoAttributeId],
  );
  const linkedPhotoFileIds = useMemo(() => new Set(photoAttributes.map((item) => item.valueText.trim()).filter(Boolean)), [photoAttributes]);
  const linkablePeople = useMemo(
    () => personOptions.sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [personOptions],
  );

  useEffect(() => {
    if (!selectedPhoto) {
      return;
    }
    setEditPhotoName(selectedPhoto.label || "");
    setEditPhotoDescription(selectedPhoto.notes || "");
    setEditPhotoDate(selectedPhoto.startDate || "");
    setEditPhotoPrimary(selectedPhoto.isPrimary);
  }, [selectedPhoto]);

  const searchPhotoLibrary = async () => {
    setPhotoSearchBusy(true);
    const res = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/photos/search?q=${encodeURIComponent(photoSearchQuery.trim())}`,
      { cache: "no-store" },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message = body?.message || body?.error || "";
      setStatus(`Photo search failed: ${res.status} ${String(message).slice(0, 160)}`);
      setPhotoSearchBusy(false);
      return;
    }
    setPhotoSearchResults(Array.isArray(body?.items) ? (body.items as PhotoLibraryItem[]) : []);
    setPhotoSearchBusy(false);
  };

  if (!open || !person) {
    return null;
  }
  const showReadOnly = !canManage;

  const createSpouseInline = async () => {
    if (!newSpouseFirstName.trim() || !newSpouseLastName.trim() || !newSpouseBirthDate.trim()) {
      setStatus("Spouse first name, last name, and birthdate are required.");
      return;
    }
    setCreatingSpouse(true);
    setStatus("Creating spouse...");
    const payload = {
      first_name: newSpouseFirstName.trim(),
      middle_name: newSpouseMiddleName.trim(),
      last_name: newSpouseLastName.trim(),
      nick_name: newSpouseNickName.trim(),
      display_name: newSpouseDisplayName.trim(),
      birth_date: newSpouseBirthDate.trim(),
      gender: newSpouseGender,
    };

    try {
      let response = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/people`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, allow_duplicate_similar: false }),
      });
      let body = await response.json().catch(() => null);

      if (!response.ok && response.status === 409 && body?.error === "duplicate_similar_birthdate_name") {
        const confirmAdd = window.confirm(
          "Possible duplicate found (same birthdate, similar name). Press OK to add anyway, or Cancel to review existing people.",
        );
        if (confirmAdd) {
          response = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/people`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, allow_duplicate_similar: true }),
          });
          body = await response.json().catch(() => null);
        }
      }

      if (!response.ok) {
        const message = body?.message || body?.error || `Spouse create failed: ${response.status}`;
        setStatus(String(message));
        setCreatingSpouse(false);
        return;
      }

      const createdPersonId = String(body?.person?.person_id ?? "").trim();
      const createdDisplayName = String(
        body?.person?.display_name ||
        `${newSpouseFirstName.trim()} ${newSpouseLastName.trim()}`.trim(),
      );
      if (!createdPersonId) {
        setStatus("Spouse created but returned person ID was empty.");
        setCreatingSpouse(false);
        return;
      }

      if (newSpouseInLaw) {
        await fetch(
          `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(createdPersonId)}/attributes`,
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
        ).catch(() => undefined);
      }

      setLocalPeople((current) => {
        if (current.some((entry) => entry.personId === createdPersonId)) {
          return current;
        }
        return [...current, { personId: createdPersonId, displayName: createdDisplayName, gender: newSpouseGender }];
      });
      setSpouseId(createdPersonId);
      setShowAddSpouse(false);
      setStatus("Spouse created and selected. Click Save to persist relationship.");
    } finally {
      setCreatingSpouse(false);
    }
  };

  return (
    <div
      className="person-modal-backdrop"
      onClick={onClose}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="person-modal-panel"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="person-modal-sticky-head">
          <div className="person-modal-header">
          <img
            src={headerAvatar}
            alt={person.displayName}
            className="person-modal-avatar"
          />
          <div>
            <h3 className="person-modal-title">{displayName || person.displayName}</h3>
            <p className="person-modal-meta">
              Birthdate: {toMonthDay(birthDate || person.birthDate || "")} | ID: {person.personId}
            </p>
            <p className="person-modal-meta">
              Email: {email || "-"} | Phone: {phones || "-"}
            </p>
          </div>
          <SecondaryButton type="button" className="tap-button" onClick={onClose}>Close</SecondaryButton>
          </div>
        </div>

        <div className="person-modal-tabs">
          <button type="button" className={`tab-pill ${activeTab === "contact" ? "active" : ""}`} onClick={() => setActiveTab("contact")}>Contact Info</button>
          <button type="button" className={`tab-pill ${activeTab === "attributes" ? "active" : ""}`} onClick={() => setActiveTab("attributes")}>Attributes</button>
          <button type="button" className={`tab-pill ${activeTab === "photos" ? "active" : ""}`} onClick={() => setActiveTab("photos")}>Pictures</button>
        </div>
        <div className="person-modal-content">

        {activeTab === "contact" ? (
          <>
            <div className="person-section-grid">
              <div className="card">
                <h4 className="ui-section-title">Identity</h4>
                <div className="field-grid">
                  <div>
                    <label className="label">Display Name</label>
                    <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={showReadOnly} />
                  </div>
                  <div>
                    <label className="label">Birthdate</label>
                    <input className="input" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} disabled={showReadOnly} />
                  </div>
                  <div className="field-span-2">
                    <label className="label">Gender</label>
                    <select className="input" value={gender} onChange={(e) => setGender(e.target.value as "male" | "female" | "unspecified")} disabled={showReadOnly}>
                      <option value="unspecified">Unspecified</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="card">
                <h4 className="ui-section-title">Basics</h4>
                <div className="field-grid">
                  <div>
                    <label className="label">First Name</label>
                    <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={showReadOnly} />
                  </div>
                  <div>
                    <label className="label">Middle Name</label>
                    <input className="input" value={middleName} onChange={(e) => setMiddleName(e.target.value)} disabled={showReadOnly} />
                  </div>
                  <div>
                    <label className="label">Last Name</label>
                    <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={showReadOnly} />
                  </div>
                  <div>
                    <label className="label">Nick Name</label>
                    <input className="input" value={nickName} onChange={(e) => setNickName(e.target.value)} disabled={showReadOnly} />
                  </div>
                </div>
              </div>

              <div className="card">
                <h4 className="ui-section-title">Contact</h4>
                <label className="label">Phone</label>
                <input className="input" value={phones} onChange={(e) => setPhones(e.target.value)} disabled={showReadOnly} />
                <label className="label">Email</label>
                <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} disabled={showReadOnly} />
                <label className="label">Address</label>
                <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} disabled={showReadOnly} />
              </div>

              <div className="card">
                <h4 className="ui-section-title">Family</h4>
                {canManage ? (
                  <>
                    <div className="settings-chip-list">
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <label className="label">Mother</label>
                        <select
                          className="input"
                          value={parent1Id}
                          onChange={(e) => {
                            const next = e.target.value;
                            setParent1Id(next);
                            const spouse = next ? spouseByPersonId.get(next) ?? "" : "";
                            setSpouseId(spouse);
                            if (spouse && spouse !== person.personId && spouse !== next) {
                              setParent2Id(spouse);
                            }
                          }}
                        >
                          <option value="">None</option>
                          {motherOptions.map((option) => (
                            <option key={`p1-${option.personId}`} value={option.personId}>{option.displayName}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <label className="label">Father</label>
                        <select
                          className="input"
                          value={parent2Id}
                          onChange={(e) => {
                            const next = e.target.value;
                            setParent2Id(next);
                            const spouse = next ? spouseByPersonId.get(next) ?? "" : "";
                            setSpouseId(spouse);
                            if (spouse && spouse !== person.personId && spouse !== next) {
                              setParent1Id(spouse);
                            }
                          }}
                        >
                          <option value="">None</option>
                          {fatherOptions.map((option) => (
                            <option key={`p2-${option.personId}`} value={option.personId}>{option.displayName}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <label className="label">Spouse</label>
                        <select className="input" value={spouseId} onChange={(e) => setSpouseId(e.target.value)}>
                          <option value="">None</option>
                          {spouseOptions.map((option) => (
                            <option key={`sp-${option.personId}`} value={option.personId}>{option.displayName}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {!spouseId ? (
                      <div style={{ marginTop: "0.75rem" }}>
                        <button
                          type="button"
                          className="button secondary tap-button"
                          onClick={() => {
                            setShowAddSpouse((value) => !value);
                            setStatus("");
                          }}
                        >
                          {showAddSpouse ? "Close Add Spouse" : "Add Spouse"}
                        </button>
                      </div>
                    ) : null}
                    {showAddSpouse ? (
                      <div className="card" style={{ marginTop: "0.75rem" }}>
                        <h4 style={{ marginTop: 0 }}>Add Spouse</h4>
                        <label className="label">Mode</label>
                        <select
                          className="input"
                          value={addSpouseMode}
                          onChange={(e) => setAddSpouseMode(e.target.value as AddSpouseMode)}
                        >
                          <option value="existing">Use Existing Person</option>
                          <option value="new">Create New Person</option>
                        </select>

                        {addSpouseMode === "existing" ? (
                          <>
                            <label className="label">Lookup</label>
                            <input
                              className="input"
                              value={existingSpouseQuery}
                              onChange={(e) => setExistingSpouseQuery(e.target.value)}
                              placeholder="Search by name"
                            />
                            <label className="label">Select Person</label>
                            <select
                              className="input"
                              value={existingSpouseId}
                              onChange={(e) => setExistingSpouseId(e.target.value)}
                            >
                              <option value="">Choose person</option>
                              {existingSpouseOptions.map((option) => (
                                <option key={`existing-spouse-${option.personId}`} value={option.personId}>
                                  {option.displayName}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="button tap-button"
                              style={{ marginTop: "0.75rem" }}
                              disabled={!existingSpouseId}
                              onClick={() => {
                                setSpouseId(existingSpouseId);
                                setShowAddSpouse(false);
                                setStatus("Spouse selected. Click Save to persist relationship.");
                              }}
                            >
                              Use Selected Person
                            </button>
                          </>
                        ) : (
                          <>
                            <label className="label">First Name</label>
                            <input className="input" value={newSpouseFirstName} onChange={(e) => setNewSpouseFirstName(e.target.value)} />
                            <label className="label">Middle Name</label>
                            <input className="input" value={newSpouseMiddleName} onChange={(e) => setNewSpouseMiddleName(e.target.value)} />
                            <label className="label">Last Name</label>
                            <input className="input" value={newSpouseLastName} onChange={(e) => setNewSpouseLastName(e.target.value)} />
                            <label className="label">Nick Name</label>
                            <input className="input" value={newSpouseNickName} onChange={(e) => setNewSpouseNickName(e.target.value)} />
                            <label className="label">Display Name (optional)</label>
                            <input className="input" value={newSpouseDisplayName} onChange={(e) => setNewSpouseDisplayName(e.target.value)} />
                            <label className="label">Birthdate</label>
                            <input className="input" type="date" value={newSpouseBirthDate} onChange={(e) => setNewSpouseBirthDate(e.target.value)} />
                            <label className="label">Gender</label>
                            <select
                              className="input"
                              value={newSpouseGender}
                              onChange={(e) => setNewSpouseGender(e.target.value as "male" | "female" | "unspecified")}
                            >
                              <option value="unspecified">Unspecified</option>
                              <option value="male">Male</option>
                              <option value="female">Female</option>
                            </select>
                            <label className="label" style={{ marginTop: "0.5rem" }}>
                              <input type="checkbox" checked={newSpouseInLaw} onChange={(e) => setNewSpouseInLaw(e.target.checked)} /> In-law mode
                            </label>
                            <button
                              type="button"
                              className="button tap-button"
                              style={{ marginTop: "0.75rem" }}
                              disabled={creatingSpouse}
                              onClick={() => void createSpouseInline()}
                            >
                              {creatingSpouse ? "Creating..." : "Create Spouse"}
                            </button>
                          </>
                        )}
                      </div>
                    ) : null}
                    {householdId ? (
                      <button type="button" className="button secondary tap-button" onClick={() => onEditHousehold(householdId)}>
                        Edit Household
                      </button>
                    ) : null}
                  </>
                ) : (
                  <p className="page-subtitle" style={{ marginBottom: "0.5rem" }}>
                    Relationship editing is available to administrators.
                  </p>
                )}
                <label className="label">Notes</label>
                <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={showReadOnly} />
              </div>
            </div>
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
                <thead><tr><th>Remove</th><th>Select</th><th>Preview</th><th>Name</th><th>Description</th><th>Date</th><th>Primary</th></tr></thead>
                <tbody>
                  {photoAttributes.length > 0 ? photoAttributes.map((item) => (
                    <tr key={item.attributeId}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedPhotoAttributeIds.includes(item.attributeId)}
                          onChange={(e) => {
                            setSelectedPhotoAttributeIds((current) =>
                              e.target.checked
                                ? [...current, item.attributeId]
                                : current.filter((id) => id !== item.attributeId),
                            );
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="radio"
                          name="selected-photo"
                          checked={selectedPhotoAttributeId === item.attributeId}
                          onChange={() => setSelectedPhotoAttributeId(item.attributeId)}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button secondary tap-button"
                          style={{ padding: 0, border: "none", background: "transparent" }}
                          onClick={() => setLargePhotoFileId(item.valueText)}
                        >
                          <img
                            src={getPhotoProxyPath(item.valueText, tenantKey)}
                            alt={item.label || "photo"}
                            style={{ width: 64, height: 64, borderRadius: 10, objectFit: "cover", border: "1px solid var(--line)" }}
                          />
                        </button>
                      </td>
                      <td>{item.label || "-"}</td>
                      <td>{item.notes || "-"}</td>
                      <td>{item.startDate || "-"}</td>
                      <td>{item.isPrimary ? "Yes" : "No"}</td>
                    </tr>
                  )) : <tr><td colSpan={7}>No photos recorded.</td></tr>}
                </tbody>
              </table>
            </div>
            {selectedPhoto && canManage ? (
              <div className="card" style={{ marginTop: "0.75rem" }}>
                <h4 style={{ marginTop: 0 }}>Edit Selected Photo Link</h4>
                <label className="label">Name</label>
                <input className="input" value={editPhotoName} onChange={(e) => setEditPhotoName(e.target.value)} />
                <label className="label">Description</label>
                <input className="input" value={editPhotoDescription} onChange={(e) => setEditPhotoDescription(e.target.value)} />
                <label className="label">Date</label>
                <input className="input" type="date" value={editPhotoDate} onChange={(e) => setEditPhotoDate(e.target.value)} />
                <label className="label" style={{ marginTop: "0.5rem" }}>
                  <input type="checkbox" checked={editPhotoPrimary} onChange={(e) => setEditPhotoPrimary(e.target.checked)} /> Set as primary
                </label>
                <div className="settings-chip-list" style={{ marginTop: "0.75rem" }}>
                  <button
                    type="button"
                    className="button tap-button"
                    disabled={photoBusy}
                    onClick={() =>
                      void (async () => {
                        setPhotoBusy(true);
                        setStatus("Saving photo metadata...");
                        const res = await fetch(
                          `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}/attributes/${encodeURIComponent(selectedPhoto.attributeId)}`,
                          {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              label: editPhotoName,
                              notes: editPhotoDescription,
                              startDate: editPhotoDate,
                              isPrimary: editPhotoPrimary,
                            }),
                          },
                        );
                        const body = await res.json().catch(() => null);
                        if (!res.ok) {
                          const message = body?.message || body?.error || "";
                          setStatus(`Save photo metadata failed: ${res.status} ${String(message).slice(0, 160)}`);
                          setPhotoBusy(false);
                          return;
                        }
                        setStatus("Photo metadata saved.");
                        setPhotoBusy(false);
                        await loadAttributes(person.personId);
                        onSaved();
                      })()
                    }
                  >
                    Save Photo Metadata
                  </button>
                </div>
              </div>
            ) : null}
            {selectedPhoto && canManage ? (
              <div className="card" style={{ marginTop: "0.75rem" }}>
                <h4 style={{ marginTop: 0 }}>Add To Another Person</h4>
                <label className="label">Select Person</label>
                <select className="input" value={linkTargetPersonId} onChange={(e) => setLinkTargetPersonId(e.target.value)}>
                  <option value="">Choose person</option>
                  {linkablePeople.map((item) => (
                    <option key={`link-photo-${item.personId}`} value={item.personId}>{item.displayName}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button tap-button"
                  style={{ marginTop: "0.75rem" }}
                  disabled={!linkTargetPersonId || photoBusy}
                  onClick={() =>
                    void (async () => {
                      setPhotoBusy(true);
                      setStatus("Linking photo to selected person...");
                      const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(linkTargetPersonId)}/attributes`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          attributeType: "photo",
                          valueText: selectedPhoto.valueText,
                          label: editPhotoName || selectedPhoto.label || "photo",
                          notes: editPhotoDescription || selectedPhoto.notes || "",
                          startDate: editPhotoDate || selectedPhoto.startDate || "",
                          visibility: "family",
                          shareScope: "both_families",
                          shareFamilyGroupKey: "",
                          sortOrder: 0,
                          isPrimary: false,
                        }),
                      });
                      const body = await res.json().catch(() => null);
                      if (!res.ok) {
                        const message = body?.message || body?.error || "";
                        setStatus(`Link photo failed: ${res.status} ${String(message).slice(0, 160)}`);
                        setPhotoBusy(false);
                        return;
                      }
                      setStatus("Photo linked to selected person.");
                      setPhotoBusy(false);
                    })()
                  }
                >
                  Add To Selected Person
                </button>
              </div>
            ) : null}
            <div className="card" style={{ marginTop: "0.75rem" }}>
              <h4 style={{ marginTop: 0 }}>Search Photo Library</h4>
              <label className="label">Search by name, description, date, person, household, or file ID</label>
              <input
                className="input"
                value={photoSearchQuery}
                onChange={(e) => setPhotoSearchQuery(e.target.value)}
                placeholder="e.g. wedding 1998 Ruth Clark"
              />
              <div className="settings-chip-list" style={{ marginTop: "0.75rem" }}>
                <button
                  type="button"
                  className="button secondary tap-button"
                  disabled={photoSearchBusy}
                  onClick={() => void searchPhotoLibrary()}
                >
                  {photoSearchBusy ? "Searching..." : "Search Photos"}
                </button>
              </div>
              {photoSearchResults.length > 0 ? (
                <div className="settings-table-wrap" style={{ marginTop: "0.75rem" }}>
                  <table className="settings-table">
                    <thead>
                      <tr>
                        <th>Preview</th>
                        <th>Name</th>
                        <th>Description</th>
                        <th>Date</th>
                        <th>Associations</th>
                        {canManage ? <th>Action</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {photoSearchResults.map((item) => {
                        const alreadyLinked = linkedPhotoFileIds.has(item.fileId);
                        const peopleText = item.people.map((person) => person.displayName).join(", ");
                        const householdsText = item.households.map((household) => household.label).join(", ");
                        return (
                          <tr key={`search-${item.fileId}`}>
                            <td>
                              <button
                                type="button"
                                className="button secondary tap-button"
                                style={{ padding: 0, border: "none", background: "transparent" }}
                                onClick={() => setLargePhotoFileId(item.fileId)}
                              >
                                <img
                                  src={getPhotoProxyPath(item.fileId, tenantKey)}
                                  alt={item.name || "photo"}
                                  style={{ width: 64, height: 64, borderRadius: 10, objectFit: "cover", border: "1px solid var(--line)" }}
                                />
                              </button>
                            </td>
                            <td>{item.name || "-"}</td>
                            <td>{item.description || "-"}</td>
                            <td>{item.date || "-"}</td>
                            <td>{[peopleText, householdsText].filter(Boolean).join(" | ") || "-"}</td>
                            {canManage ? (
                              <td>
                                <button
                                  type="button"
                                  className="button secondary tap-button"
                                  disabled={alreadyLinked || photoBusy}
                                  onClick={() =>
                                    void (async () => {
                                      setPhotoBusy(true);
                                      setStatus("Linking selected search photo...");
                                      const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}/attributes`, {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({
                                          attributeType: "photo",
                                          valueText: item.fileId,
                                          label: item.name || "photo",
                                          notes: item.description || "",
                                          startDate: item.date || "",
                                          visibility: "family",
                                          shareScope: "both_families",
                                          shareFamilyGroupKey: "",
                                          sortOrder: 0,
                                          isPrimary: photoAttributes.length === 0,
                                        }),
                                      });
                                      const body = await res.json().catch(() => null);
                                      if (!res.ok) {
                                        const message = body?.message || body?.error || "";
                                        setStatus(`Link photo failed: ${res.status} ${String(message).slice(0, 160)}`);
                                        setPhotoBusy(false);
                                        return;
                                      }
                                      setStatus("Photo linked.");
                                      setPhotoBusy(false);
                                      await loadAttributes(person.personId);
                                      onSaved();
                                    })()
                                  }
                                >
                                  {alreadyLinked ? "Already Linked" : "Link To This Person"}
                                </button>
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="page-subtitle" style={{ marginTop: "0.75rem" }}>
                  No search results yet.
                </p>
              )}
            </div>
            {canManage ? (
              <div className="card" style={{ marginTop: "0.75rem" }}>
                <h4 style={{ marginTop: 0 }}>Upload Photo</h4>
                <label className="label">Label</label>
                <input className="input" value={newPhotoLabel} onChange={(e) => setNewPhotoLabel(e.target.value)} placeholder="portrait" />
                <label className="label">Description</label>
                <input className="input" value={newPhotoDescription} onChange={(e) => setNewPhotoDescription(e.target.value)} placeholder="Photo description" />
                <label className="label">Date</label>
                <input className="input" type="date" value={newPhotoDate} onChange={(e) => setNewPhotoDate(e.target.value)} />
                <label className="label" style={{ marginTop: "0.5rem" }}>
                  <input type="checkbox" checked={newPhotoHeadshot} onChange={(e) => setNewPhotoHeadshot(e.target.checked)} /> Set as primary headshot
                </label>
                <input
                  id={`person-photo-upload-${person.personId}`}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) =>
                    void (async () => {
                      const file = e.target.files?.[0] ?? null;
                      e.currentTarget.value = "";
                      if (!file) {
                        return;
                      }
                      const form = new FormData();
                      form.append("file", file);
                      form.append("label", newPhotoLabel.trim() || "gallery");
                      form.append("isHeadshot", String(newPhotoHeadshot));
                      form.append("description", newPhotoDescription.trim());
                      form.append("photoDate", newPhotoDate.trim());
                      const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}/photos/upload`, {
                        method: "POST",
                        body: form,
                      });
                      const body = await res.json().catch(() => null);
                      if (!res.ok) {
                        const message = body?.message || body?.error || "";
                        setStatus(`Upload photo failed: ${res.status} ${String(message).slice(0, 160)}`);
                        return;
                      }
                      setStatus("Photo uploaded.");
                      setNewPhotoHeadshot(false);
                      setNewPhotoDescription("");
                      setNewPhotoDate("");
                      await loadAttributes(person.personId);
                      onSaved();
                    })()
                  }
                />
                <button
                  type="button"
                  className="button tap-button"
                  style={{ marginTop: "0.75rem" }}
                  onClick={() => document.getElementById(`person-photo-upload-${person.personId}`)?.click()}
                >
                  Add Photo
                </button>
              </div>
            ) : null}
            {canManage ? (
              <button
                type="button"
                className="button secondary tap-button"
                disabled={selectedPhotoAttributeIds.length === 0}
                onClick={() =>
                  void (async () => {
                    setStatus("Removing selected photo links...");
                    for (const attributeId of selectedPhotoAttributeIds) {
                      await fetch(
                        `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}/attributes/${encodeURIComponent(attributeId)}`,
                        { method: "DELETE" },
                      );
                    }
                    setSelectedPhotoAttributeIds([]);
                    setStatus("Selected photo links removed.");
                    await loadAttributes(person.personId);
                    onSaved();
                  })()
                }
              >
                Remove Selected Links
              </button>
            ) : null}
            {largePhotoFileId ? (
              <div
                style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 140, display: "grid", placeItems: "center", padding: "1rem" }}
                onClick={() => setLargePhotoFileId("")}
              >
                <img
                  src={getPhotoProxyPath(largePhotoFileId, tenantKey)}
                  alt="Large preview"
                  style={{ maxWidth: "min(1200px, 95vw)", maxHeight: "90vh", borderRadius: 14, border: "1px solid var(--line)", background: "#fff" }}
                />
              </div>
            ) : null}
          </>
        ) : null}

        <div className="settings-chip-list" style={{ marginTop: "1rem" }}>
          <PrimaryButton
            type="button"
            className="tap-button"
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
                      email,
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
                    const body = await relationshipRes.json().catch(() => null);
                    const message = body?.message || body?.error || "";
                    const hint = body?.hint ? ` | ${body.hint}` : "";
                    setStatus(`Saved person, relationship save failed: ${relationshipRes.status} ${String(message).slice(0, 150)}${hint}`);
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
          </PrimaryButton>
          <SecondaryButton type="button" className="tap-button" onClick={onClose}>Close</SecondaryButton>
        </div>

        {status ? <p style={{ marginTop: "0.75rem" }}>{status}</p> : null}
        </div>
      </div>
    </div>
  );
}
