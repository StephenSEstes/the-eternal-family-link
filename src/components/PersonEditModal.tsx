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
  valueJson?: string;
  mediaMetadata?: string;
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
type DraftMeta = {
  label: string;
  description: string;
  date: string;
  isPrimary: boolean;
};

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

function parseMediaMetadata(raw?: string) {
  const text = (raw ?? "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { mimeType?: string; fileName?: string };
    return parsed;
  } catch {
    return null;
  }
}

function isVideoMediaByMetadata(raw?: string) {
  const parsed = parseMediaMetadata(raw);
  const mime = (parsed?.mimeType ?? "").toLowerCase();
  const fileName = (parsed?.fileName ?? "").toLowerCase();
  return mime.startsWith("video/") || fileName.endsWith(".mp4") || fileName.endsWith(".mov") || fileName.endsWith(".webm");
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

function oppositeGender(value: "male" | "female" | "unspecified") {
  if (value === "male") return "female";
  if (value === "female") return "male";
  return "unspecified";
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

function PhotoDetailHeader({
  onBack,
  onViewLarge,
}: {
  onBack: () => void;
  onViewLarge: () => void;
}) {
  return (
    <div className="person-photo-detail-head">
      <button type="button" className="button secondary tap-button" onClick={onBack}>
        Back
      </button>
      <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Photo Detail</h4>
      <button type="button" className="button secondary tap-button" onClick={onViewLarge}>
        View Large
      </button>
    </div>
  );
}

function PhotoInfoForm({
  draftMeta,
  onChange,
  disabled,
}: {
  draftMeta: DraftMeta;
  onChange: (next: DraftMeta) => void;
  disabled: boolean;
}) {
  return (
    <div className="person-photo-detail-fields card">
      <h5 style={{ margin: "0 0 0.5rem" }}>Photo Info</h5>
      <label className="label">Label</label>
      <input
        className="input"
        value={draftMeta.label}
        onChange={(e) => onChange({ ...draftMeta, label: e.target.value })}
        disabled={disabled}
      />
      <label className="label">Description</label>
      <input
        className="input"
        value={draftMeta.description}
        onChange={(e) => onChange({ ...draftMeta, description: e.target.value })}
        disabled={disabled}
      />
      <label className="label">Date</label>
      <input
        className="input"
        type="date"
        value={draftMeta.date}
        onChange={(e) => onChange({ ...draftMeta, date: e.target.value })}
        disabled={disabled}
      />
      <label className="label" style={{ marginTop: "0.5rem" }}>
        <input
          type="checkbox"
          checked={draftMeta.isPrimary}
          onChange={(e) => onChange({ ...draftMeta, isPrimary: e.target.checked })}
          disabled={disabled}
        /> Set as primary
      </label>
    </div>
  );
}

function StickySaveBar({
  dirty,
  saving,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const label = saving ? "Saving..." : dirty ? "Save Changes" : "Saved";
  return (
    <div className="photo-save-sticky-bar">
      <button
        type="button"
        className="button tap-button"
        disabled={!dirty || saving}
        onClick={onSave}
      >
        {label}
      </button>
    </div>
  );
}

function PeopleTagger({
  currentPerson,
  taggedPeople,
  taggedHouseholds,
  tagQuery,
  onTagQueryChange,
  results,
  pendingOps,
  canManage,
  onAddTag,
  onRemoveTag,
  onRemoveHousehold,
  busy,
  statusText,
}: {
  currentPerson: PersonItem;
  taggedPeople: Array<{ personId: string; displayName: string }>;
  taggedHouseholds: Array<{ householdId: string; label: string }>;
  tagQuery: string;
  onTagQueryChange: (value: string) => void;
  results: PersonItem[];
  pendingOps: Set<string>;
  canManage: boolean;
  onAddTag: (person: PersonItem) => void;
  onRemoveTag: (personId: string) => void;
  onRemoveHousehold: (householdId: string) => void;
  busy: boolean;
  statusText: string;
}) {
  return (
    <div className="person-photo-tags-card card">
      <h5 style={{ margin: "0 0 0.5rem" }}>People Tagged In This Photo</h5>
      <div className="person-chip-row">
        <span className="person-tag-chip">
          <span>{currentPerson.displayName}</span>
        </span>
        {taggedPeople
          .filter((item) => item.personId !== currentPerson.personId)
          .map((item) => (
            <span key={`chip-${item.personId}`} className="person-tag-chip">
              <span>{item.displayName}</span>
              {canManage ? (
                <button
                  type="button"
                  className="person-chip-remove"
                  disabled={busy || pendingOps.has(item.personId)}
                  onClick={() => onRemoveTag(item.personId)}
                  aria-label={`Remove ${item.displayName}`}
                >
                  {pendingOps.has(item.personId) ? "..." : "x"}
                </button>
              ) : null}
            </span>
          ))}
      </div>
      {canManage ? (
        <>
          <label className="label" style={{ marginTop: "0.75rem" }}>Search people to tag in this photo</label>
          <input
            className="input"
            value={tagQuery}
            onChange={(e) => onTagQueryChange(e.target.value)}
            placeholder="Start typing a name..."
          />
          {tagQuery.trim() ? (
            <div className="person-typeahead-list">
              {results.length > 0 ? (
                results.map((entry) => (
                  <button
                    key={`tag-result-${entry.personId}`}
                    type="button"
                    className="person-typeahead-item"
                    onClick={() => onAddTag(entry)}
                    disabled={busy || pendingOps.has(entry.personId)}
                  >
                    <span>{entry.displayName}</span>
                  </button>
                ))
              ) : (
                <p className="page-subtitle" style={{ margin: 0 }}>No matching people.</p>
              )}
            </div>
          ) : null}
        </>
      ) : null}
      <h5 style={{ margin: "0.75rem 0 0.5rem" }}>Linked Households</h5>
      <div className="person-chip-row">
        {taggedHouseholds.length > 0 ? (
          taggedHouseholds.map((household) => (
            <span key={`h-chip-${household.householdId}`} className="person-tag-chip">
              <span>{household.label || household.householdId}</span>
              {canManage ? (
                <button
                  type="button"
                  className="person-chip-remove"
                  disabled={busy || pendingOps.has(`h-${household.householdId}`)}
                  onClick={() => onRemoveHousehold(household.householdId)}
                  aria-label={`Remove ${household.label || household.householdId}`}
                >
                  {pendingOps.has(`h-${household.householdId}`) ? "..." : "x"}
                </button>
              ) : null}
            </span>
          ))
        ) : (
          <span className="status-chip status-chip--neutral">None</span>
        )}
      </div>
      {statusText ? <p className="page-subtitle" style={{ marginTop: "0.65rem" }}>{statusText}</p> : null}
    </div>
  );
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
  const [pendingUploadPhotoFile, setPendingUploadPhotoFile] = useState<File | null>(null);
  const [pendingUploadPhotoPreviewUrl, setPendingUploadPhotoPreviewUrl] = useState("");
  const [selectedPhotoAttributeId, setSelectedPhotoAttributeId] = useState("");
  const [draftMeta, setDraftMeta] = useState<DraftMeta>({ label: "", description: "", date: "", isPrimary: false });
  const [tagQuery, setTagQuery] = useState("");
  const [taggedPeople, setTaggedPeople] = useState<Array<{ personId: string; displayName: string }>>([]);
  const [pendingOps, setPendingOps] = useState<Set<string>>(new Set());
  const [largePhotoFileId, setLargePhotoFileId] = useState("");
  const [largePhotoIsVideo, setLargePhotoIsVideo] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [personPhotoQuery, setPersonPhotoQuery] = useState("");
  const [photoSearchQuery, setPhotoSearchQuery] = useState("");
  const [photoSearchResults, setPhotoSearchResults] = useState<PhotoLibraryItem[]>([]);
  const [selectedLibraryFileIds, setSelectedLibraryFileIds] = useState<string[]>([]);
  const [photoSearchBusy, setPhotoSearchBusy] = useState(false);
  const [selectedPhotoAssociationsBusy, setSelectedPhotoAssociationsBusy] = useState(false);
  const [selectedPhotoAssociations, setSelectedPhotoAssociations] = useState<{
    people: Array<{ personId: string; displayName: string }>;
    households: Array<{ householdId: string; label: string }>;
  }>({ people: [], households: [] });
  const [photoAssociationStatus, setPhotoAssociationStatus] = useState("");
  const [showPhotoDetail, setShowPhotoDetail] = useState(false);
  const [showPhotoLibraryPicker, setShowPhotoLibraryPicker] = useState(false);
  const [showPhotoUploadPicker, setShowPhotoUploadPicker] = useState(false);
  const [showAddSpouse, setShowAddSpouse] = useState(false);
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
    setPendingUploadPhotoFile(null);
    setPendingUploadPhotoPreviewUrl("");
    setSelectedPhotoAttributeId("");
    setDraftMeta({ label: "", description: "", date: "", isPrimary: false });
    setTagQuery("");
    setTaggedPeople([]);
    setPendingOps(new Set());
    setLargePhotoFileId("");
    setLargePhotoIsVideo(false);
    setPhotoBusy(false);
    setPersonPhotoQuery("");
    setPhotoSearchQuery("");
    setPhotoSearchResults([]);
    setSelectedLibraryFileIds([]);
    setPhotoSearchBusy(false);
    setPhotoAssociationStatus("");
    setShowPhotoDetail(false);
    setShowPhotoLibraryPicker(false);
    setShowPhotoUploadPicker(false);
    setShowAddSpouse(false);
    setNewSpouseFirstName("");
    setNewSpouseMiddleName("");
    setNewSpouseLastName("");
    setNewSpouseNickName("");
    setNewSpouseDisplayName("");
    setNewSpouseBirthDate("");
    setNewSpouseGender(oppositeGender(person.gender || "unspecified"));
    setNewSpouseInLaw(true);
    setStatus("");
    void loadAttributes(person.personId);
  }, [open, person, households, parentSelection, tenantKey]);

  useEffect(() => {
    return () => {
      if (pendingUploadPhotoPreviewUrl) {
        URL.revokeObjectURL(pendingUploadPhotoPreviewUrl);
      }
    };
  }, [pendingUploadPhotoPreviewUrl]);

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
  const hasVisibleSpouseSelection = useMemo(
    () => Boolean(spouseId && spouseOptions.some((option) => option.personId === spouseId)),
    [spouseId, spouseOptions],
  );
  useEffect(() => {
    if (!spouseId) {
      return;
    }
    if (!spouseOptions.some((option) => option.personId === spouseId)) {
      setSpouseId("");
    }
  }, [spouseId, spouseOptions]);
  const selectedPhoto = useMemo(
    () => photoAttributes.find((item) => item.attributeId === selectedPhotoAttributeId) ?? null,
    [photoAttributes, selectedPhotoAttributeId],
  );
  const linkedPhotoFileIds = useMemo(() => new Set(photoAttributes.map((item) => item.valueText.trim()).filter(Boolean)), [photoAttributes]);
  const filteredPhotoAttributes = useMemo(() => {
    const query = personPhotoQuery.trim().toLowerCase();
    if (!query) return photoAttributes;
    return photoAttributes.filter((item) =>
      [item.label, item.notes, item.startDate, item.valueText].some((value) => (value || "").toLowerCase().includes(query)),
    );
  }, [personPhotoQuery, photoAttributes]);
  const linkablePeople = useMemo(
    () => personOptions.slice().sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [personOptions],
  );
  const linkedPersonIdsForSelectedPhoto = useMemo(
    () => new Set(taggedPeople.map((entry) => entry.personId)),
    [taggedPeople],
  );
  const tagSearchResults = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    if (!q) return [] as PersonItem[];
    return linkablePeople
      .filter((item) => item.displayName.toLowerCase().includes(q) && !linkedPersonIdsForSelectedPhoto.has(item.personId))
      .slice(0, 8);
  }, [linkablePeople, linkedPersonIdsForSelectedPhoto, tagQuery]);
  useEffect(() => {
    if (!selectedPhoto) {
      return;
    }
    setDraftMeta({
      label: selectedPhoto.label || "",
      description: selectedPhoto.notes || "",
      date: selectedPhoto.startDate || "",
      isPrimary: selectedPhoto.isPrimary,
    });
    setTagQuery("");
    setPhotoAssociationStatus("");
  }, [selectedPhoto]);

  useEffect(() => {
    setTaggedPeople(selectedPhotoAssociations.people);
  }, [selectedPhotoAssociations.people]);

  const refreshSelectedPhotoAssociations = async (fileId: string) => {
    setSelectedPhotoAssociationsBusy(true);
    const res = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/photos/search?q=${encodeURIComponent(fileId)}`,
      { cache: "no-store" },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setSelectedPhotoAssociations({ people: [], households: [] });
      setSelectedPhotoAssociationsBusy(false);
      return;
    }
    const item = (Array.isArray(body?.items) ? (body.items as PhotoLibraryItem[]) : []).find(
      (entry) => entry.fileId === fileId,
    );
    setSelectedPhotoAssociations({
      people: item?.people ?? [],
      households: item?.households ?? [],
    });
    setSelectedPhotoAssociationsBusy(false);
  };

  useEffect(() => {
    if (!selectedPhoto || !showPhotoDetail) {
      setSelectedPhotoAssociations({ people: [], households: [] });
      return;
    }
    void refreshSelectedPhotoAssociations(selectedPhoto.valueText);
  }, [selectedPhoto, showPhotoDetail, tenantKey]);

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

  const openPhotoDetail = (attributeId: string) => {
    setSelectedPhotoAttributeId(attributeId);
    setShowPhotoDetail(true);
  };

  const saveSelectedPhotoMetadata = async () => {
    if (!selectedPhoto || !person) return;
    setPhotoBusy(true);
    setStatus("Saving photo metadata...");
    const res = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(person.personId)}/attributes/${encodeURIComponent(selectedPhoto.attributeId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: draftMeta.label,
          notes: draftMeta.description,
          startDate: draftMeta.date,
          isPrimary: draftMeta.isPrimary,
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
    await refreshSelectedPhotoAssociations(selectedPhoto.valueText);
    onSaved();
  };

  const linkSelectedPhotoToPerson = async (targetPersonId: string) => {
    if (!selectedPhoto || !targetPersonId || !person) return false;
    setPhotoAssociationStatus("Saving association...");
    setStatus("Linking photo to selected person...");
    const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(targetPersonId)}/attributes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attributeType: "photo",
        valueText: selectedPhoto.valueText,
        label: draftMeta.label || selectedPhoto.label || "photo",
        notes: draftMeta.description || selectedPhoto.notes || "",
        startDate: draftMeta.date || selectedPhoto.startDate || "",
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
      setPhotoAssociationStatus("Association save failed.");
      return false;
    }
    setStatus("Photo linked to selected person.");
    await refreshSelectedPhotoAssociations(selectedPhoto.valueText);
    setPhotoAssociationStatus("Association saved.");
    return true;
  };

  const removePhotoAssociationFromPerson = async (targetPersonId: string, fileId: string) => {
    if (!person) return false;
    setPhotoBusy(true);
    setPhotoAssociationStatus("Removing association...");
    const attrsRes = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(targetPersonId)}/attributes`,
      { cache: "no-store" },
    );
    const attrsBody = await attrsRes.json().catch(() => null);
    if (!attrsRes.ok) {
      setPhotoAssociationStatus("Association remove failed.");
      setPhotoBusy(false);
      return false;
    }
    const attrs = Array.isArray(attrsBody?.attributes) ? (attrsBody.attributes as PersonAttribute[]) : [];
    const matches = attrs.filter(
      (item) => item.attributeType.toLowerCase() === "photo" && item.valueText.trim() === fileId,
    );
    for (const match of matches) {
      await fetch(
        `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(targetPersonId)}/attributes/${encodeURIComponent(match.attributeId)}`,
        { method: "DELETE" },
      );
    }
    await refreshSelectedPhotoAssociations(fileId);
    if (targetPersonId === person.personId) {
      setSelectedPhotoAttributeId("");
      setShowPhotoDetail(false);
      await loadAttributes(person.personId);
      onSaved();
    }
    setPhotoAssociationStatus("Association removed.");
    setPhotoBusy(false);
    return true;
  };

  const removePhotoAssociationFromHousehold = async (householdIdToUnlink: string, fileId: string) => {
    setPhotoBusy(true);
    setPhotoAssociationStatus("Removing association...");
    const res = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(householdIdToUnlink)}/photos/${encodeURIComponent(fileId)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      setPhotoAssociationStatus("Association remove failed.");
      setPhotoBusy(false);
      return false;
    }
    await refreshSelectedPhotoAssociations(fileId);
    setPhotoAssociationStatus("Association removed.");
    setPhotoBusy(false);
    return true;
  };

  const addTagByTypeahead = async (candidate: PersonItem) => {
    if (!selectedPhoto || linkedPersonIdsForSelectedPhoto.has(candidate.personId)) {
      setPhotoAssociationStatus("Already tagged.");
      return;
    }
    setTagQuery("");
    setTaggedPeople((current) => [...current, { personId: candidate.personId, displayName: candidate.displayName }]);
    setPendingOps((current) => new Set(current).add(candidate.personId));
    try {
      const ok = await linkSelectedPhotoToPerson(candidate.personId);
      if (!ok) {
        setTaggedPeople((current) => current.filter((item) => item.personId !== candidate.personId));
      }
    } finally {
      setPendingOps((current) => {
        const next = new Set(current);
        next.delete(candidate.personId);
        return next;
      });
    }
  };

  const removeTagByChip = async (personIdToRemove: string) => {
    if (!selectedPhoto || !personIdToRemove) return;
    const previous = taggedPeople;
    setTaggedPeople((current) => current.filter((item) => item.personId !== personIdToRemove));
    setPendingOps((current) => new Set(current).add(personIdToRemove));
    try {
      const ok = await removePhotoAssociationFromPerson(personIdToRemove, selectedPhoto.valueText);
      if (!ok) {
        setTaggedPeople(previous);
      }
    } finally {
      setPendingOps((current) => {
        const next = new Set(current);
        next.delete(personIdToRemove);
        return next;
      });
    }
  };

  const removeHouseholdByChip = async (householdIdToRemove: string) => {
    if (!selectedPhoto || !householdIdToRemove) return;
    const key = `h-${householdIdToRemove}`;
    setPendingOps((current) => new Set(current).add(key));
    try {
      await removePhotoAssociationFromHousehold(householdIdToRemove, selectedPhoto.valueText);
    } finally {
      setPendingOps((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const linkSelectedLibraryPhotos = async () => {
    if (selectedLibraryFileIds.length === 0 || !person) return;
    setPhotoBusy(true);
    setStatus("Linking selected search photo...");
    for (const fileId of selectedLibraryFileIds) {
      const item = photoSearchResults.find((result) => result.fileId === fileId);
      if (!item) continue;
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
    }
    setSelectedLibraryFileIds([]);
    setStatus("Photo linked.");
    setPhotoBusy(false);
    await loadAttributes(person.personId);
    onSaved();
  };

  const clearPendingUploadPhoto = () => {
    if (pendingUploadPhotoPreviewUrl) {
      URL.revokeObjectURL(pendingUploadPhotoPreviewUrl);
    }
    setPendingUploadPhotoFile(null);
    setPendingUploadPhotoPreviewUrl("");
  };

  const setPendingUploadFromInput = (file: File | null) => {
    if (!file) return;
    if (pendingUploadPhotoPreviewUrl) {
      URL.revokeObjectURL(pendingUploadPhotoPreviewUrl);
    }
    const previewUrl = URL.createObjectURL(file);
    setPendingUploadPhotoFile(file);
    setPendingUploadPhotoPreviewUrl(previewUrl);
    if (!newPhotoDate && file.lastModified) {
      setNewPhotoDate(new Date(file.lastModified).toISOString().slice(0, 10));
    }
  };

  const submitPendingUploadPhoto = async () => {
    if (!pendingUploadPhotoFile || !person) {
      setStatus("Choose a photo first.");
      return;
    }
    setPhotoBusy(true);
    setStatus("Saving photo...");
    try {
      const form = new FormData();
      form.append("file", pendingUploadPhotoFile);
      form.append("label", newPhotoLabel.trim() || "gallery");
      form.append("isHeadshot", String(newPhotoHeadshot));
      form.append("description", newPhotoDescription.trim());
      form.append("photoDate", newPhotoDate.trim());
      if (pendingUploadPhotoFile.lastModified) {
        form.append("fileCreatedAt", new Date(pendingUploadPhotoFile.lastModified).toISOString());
      }
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
      clearPendingUploadPhoto();
      setShowPhotoUploadPicker(false);
      setNewPhotoHeadshot(false);
      setNewPhotoDescription("");
      setNewPhotoDate("");
      await loadAttributes(person.personId);
      onSaved();
    } finally {
      setPhotoBusy(false);
    }
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

      let relationSaved = false;
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
              spouseId: createdPersonId,
            }),
          },
        );
        relationSaved = relationshipRes.ok;
        if (!relationshipRes.ok) {
          const relationshipBody = await relationshipRes.json().catch(() => null);
          const message = relationshipBody?.message || relationshipBody?.error || "";
          setStatus(
            `Spouse created, but auto-link failed: ${relationshipRes.status} ${String(message).slice(0, 150)}. Click Save to retry link.`,
          );
        }
      }

      setLocalPeople((current) => {
        if (current.some((entry) => entry.personId === createdPersonId)) {
          return current;
        }
        return [...current, { personId: createdPersonId, displayName: createdDisplayName, gender: newSpouseGender }];
      });
      setSpouseId(createdPersonId);
      setShowAddSpouse(false);
      if (relationSaved) {
        setStatus("Spouse created, linked, and household created.");
        onSaved();
      } else if (!status) {
        setStatus("Spouse created and selected. Click Save to persist relationship.");
      }
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
                    {!hasVisibleSpouseSelection ? (
                      <div style={{ marginTop: "0.75rem" }}>
                        <button
                          type="button"
                          className="button secondary tap-button"
                          onClick={() => {
                            setShowAddSpouse(true);
                            setNewSpouseInLaw(true);
                            setNewSpouseGender(oppositeGender(gender));
                            setStatus("");
                          }}
                        >
                          Add Spouse
                        </button>
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
            <div className="card person-photo-gallery-card">
              <div className="person-photo-gallery-toolbar">
                <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Gallery</h4>
                <div className="person-photo-gallery-actions">
                  {canManage ? (
                    <button type="button" className="button tap-button" onClick={() => setShowPhotoUploadPicker(true)}>
                      + Add Photo
                    </button>
                  ) : null}
                  <button type="button" className="button secondary tap-button" onClick={() => setShowPhotoLibraryPicker(true)}>
                    Browse Library
                  </button>
                </div>
              </div>
              <label className="label">Search this person&apos;s photos</label>
              <input
                className="input"
                value={personPhotoQuery}
                onChange={(e) => setPersonPhotoQuery(e.target.value)}
                placeholder="Search by label, description, date, or file ID"
              />
              {filteredPhotoAttributes.length > 0 ? (
                <div className="person-photo-grid">
                  {filteredPhotoAttributes.map((item) => (
                    <button
                      key={item.attributeId}
                      type="button"
                      className="person-photo-tile"
                      onClick={() => openPhotoDetail(item.attributeId)}
                    >
                      {isVideoMediaByMetadata(item.mediaMetadata || item.valueJson) ? (
                        <video
                          src={getPhotoProxyPath(item.valueText, tenantKey)}
                          className="person-photo-tile-image"
                          muted
                          playsInline
                        />
                      ) : (
                        <img
                          src={getPhotoProxyPath(item.valueText, tenantKey)}
                          alt={item.label || "photo"}
                          className="person-photo-tile-image"
                        />
                      )}
                      <div className="person-photo-tile-meta">
                        <span className="person-photo-tile-label">{item.label || "photo"}</span>
                        {item.isPrimary ? <span className="person-photo-primary-badge">Primary</span> : null}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="page-subtitle" style={{ marginTop: "0.75rem" }}>
                  No photos recorded.
                </p>
              )}
            </div>

            {selectedPhoto && showPhotoDetail ? (
              <div className="person-photo-detail-shell">
                <div className="person-photo-detail-card">
                  <PhotoDetailHeader
                    onBack={() => setShowPhotoDetail(false)}
                    onViewLarge={() => {
                      setLargePhotoFileId(selectedPhoto.valueText);
                      setLargePhotoIsVideo(isVideoMediaByMetadata(selectedPhoto.mediaMetadata || selectedPhoto.valueJson));
                    }}
                  />
                  <div className="card">
                    {isVideoMediaByMetadata(selectedPhoto.mediaMetadata || selectedPhoto.valueJson) ? (
                      <video
                        src={getPhotoProxyPath(selectedPhoto.valueText, tenantKey)}
                        className="person-photo-detail-preview"
                        controls
                        playsInline
                      />
                    ) : (
                      <img
                        src={getPhotoProxyPath(selectedPhoto.valueText, tenantKey)}
                        alt={selectedPhoto.label || "photo"}
                        className="person-photo-detail-preview"
                      />
                    )}
                  </div>
                  <PhotoInfoForm draftMeta={draftMeta} onChange={setDraftMeta} disabled={!canManage || photoBusy} />
                  <PeopleTagger
                    currentPerson={person}
                    taggedPeople={taggedPeople}
                    taggedHouseholds={selectedPhotoAssociations.households}
                    tagQuery={tagQuery}
                    onTagQueryChange={setTagQuery}
                    results={tagSearchResults}
                    pendingOps={pendingOps}
                    canManage={canManage}
                    onAddTag={(candidate) => {
                      void addTagByTypeahead(candidate);
                    }}
                    onRemoveTag={(personIdToRemove) => {
                      if (personIdToRemove === person.personId) {
                        return;
                      }
                      void removeTagByChip(personIdToRemove);
                    }}
                    onRemoveHousehold={(householdIdToRemove) => {
                      void removeHouseholdByChip(householdIdToRemove);
                    }}
                    busy={photoBusy || selectedPhotoAssociationsBusy}
                    statusText={photoAssociationStatus}
                  />
                  {canManage ? (
                    <div className="card" style={{ borderColor: "#fecaca" }}>
                      <h5 style={{ margin: "0 0 0.5rem" }}>Danger Zone</h5>
                      <button
                        type="button"
                        className="button secondary tap-button"
                        disabled={photoBusy}
                        onClick={() => {
                          const ok = window.confirm(`Remove this photo from ${person.displayName}? This won't delete the photo from the library.`);
                          if (!ok) return;
                          void removePhotoAssociationFromPerson(person.personId, selectedPhoto.valueText);
                        }}
                      >
                        Remove from {person.displayName}
                      </button>
                    </div>
                  ) : null}
                  <StickySaveBar
                    dirty={
                      draftMeta.label !== (selectedPhoto.label || "") ||
                      draftMeta.description !== (selectedPhoto.notes || "") ||
                      draftMeta.date !== (selectedPhoto.startDate || "") ||
                      draftMeta.isPrimary !== selectedPhoto.isPrimary
                    }
                    saving={photoBusy}
                    onSave={() => {
                      void saveSelectedPhotoMetadata();
                    }}
                  />
                </div>
              </div>
            ) : null}

            {showPhotoLibraryPicker ? (
              <div className="person-photo-picker-shell">
                <div className="person-photo-picker-card">
                  <div className="person-photo-picker-head">
                    <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Browse/Search Library</h4>
                    <button type="button" className="button secondary tap-button" onClick={() => setShowPhotoLibraryPicker(false)}>
                      Close
                    </button>
                  </div>
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
                    {canManage ? (
                    <button
                      type="button"
                      className="button tap-button"
                      disabled={selectedLibraryFileIds.length === 0 || photoBusy}
                      onClick={() => void linkSelectedLibraryPhotos()}
                    >
                      {photoBusy ? "Saving..." : `Link To ${person.displayName}`}
                    </button>
                  ) : null}
                </div>
                  {photoSearchResults.length > 0 ? (
                    <div className="person-library-grid">
                      {photoSearchResults.map((item) => {
                        const alreadyLinked = linkedPhotoFileIds.has(item.fileId);
                        const checked = selectedLibraryFileIds.includes(item.fileId);
                        return (
                          <label key={`search-${item.fileId}`} className="person-library-tile">
                            <img
                              src={getPhotoProxyPath(item.fileId, tenantKey)}
                              alt={item.name || "photo"}
                              className="person-library-image"
                            />
                            <div className="person-library-meta">
                              <strong>{item.name || "-"}</strong>
                              <span>{item.date || "-"}</span>
                            </div>
                            <div className="settings-chip-list">
                              {alreadyLinked ? <span className="status-chip status-chip--neutral">Already linked</span> : null}
                              {canManage ? (
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={alreadyLinked}
                                  onChange={(e) => {
                                    setSelectedLibraryFileIds((current) =>
                                      e.target.checked
                                        ? [...current, item.fileId]
                                        : current.filter((id) => id !== item.fileId),
                                    );
                                  }}
                                />
                              ) : null}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="page-subtitle" style={{ marginTop: "0.75rem" }}>
                      No search results yet.
                    </p>
                  )}
                </div>
              </div>
            ) : null}

            {showPhotoUploadPicker && canManage ? (
              <div className="person-photo-picker-shell">
                <div className="person-photo-picker-card">
                  <div className="person-photo-picker-head">
                    <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Upload Photo</h4>
                    <button
                      type="button"
                      className="button secondary tap-button"
                      onClick={() => {
                        clearPendingUploadPhoto();
                        setShowPhotoUploadPicker(false);
                      }}
                    >
                      Close
                    </button>
                  </div>
                  <label className="label">Label</label>
                  <input className="input" value={newPhotoLabel} onChange={(e) => setNewPhotoLabel(e.target.value)} placeholder="portrait" />
                  <label className="label">Description</label>
                  <input className="input" value={newPhotoDescription} onChange={(e) => setNewPhotoDescription(e.target.value)} placeholder="Photo description" />
                  <label className="label">Date</label>
                  <input className="input" type="date" value={newPhotoDate} onChange={(e) => setNewPhotoDate(e.target.value)} />
                  <label className="label" style={{ marginTop: "0.5rem" }}>
                    <input type="checkbox" checked={newPhotoHeadshot} onChange={(e) => setNewPhotoHeadshot(e.target.checked)} /> Set as primary headshot
                  </label>
                  {pendingUploadPhotoPreviewUrl ? (
                    <div className="person-upload-preview-card">
                      {pendingUploadPhotoFile?.type?.startsWith("video/") ? (
                        <video
                          src={pendingUploadPhotoPreviewUrl}
                          className="person-upload-preview-image"
                          controls
                          playsInline
                        />
                      ) : (
                        <img
                          src={pendingUploadPhotoPreviewUrl}
                          alt="Selected upload preview"
                          className="person-upload-preview-image"
                        />
                      )}
                      <div className="person-upload-preview-meta">
                        <strong>{pendingUploadPhotoFile?.name || "Selected photo"}</strong>
                        <span>This photo will be uploaded with the metadata above.</span>
                      </div>
                    </div>
                  ) : (
                    <p className="page-subtitle" style={{ marginTop: "0.75rem" }}>
                      No photo selected yet.
                    </p>
                  )}
                  <input
                    id={`person-photo-upload-${person.personId}`}
                    type="file"
                    accept="image/*,video/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      e.currentTarget.value = "";
                      setPendingUploadFromInput(file);
                    }}
                  />
                  <div className="settings-chip-list" style={{ marginTop: "0.75rem" }}>
                    <button
                      type="button"
                      className="button secondary tap-button"
                      disabled={photoBusy}
                      onClick={() => document.getElementById(`person-photo-upload-${person.personId}`)?.click()}
                    >
                      {pendingUploadPhotoFile ? "Choose Another Photo" : "Choose Photo"}
                    </button>
                    <button
                      type="button"
                      className="button tap-button"
                      disabled={!pendingUploadPhotoFile || photoBusy}
                      onClick={() => void submitPendingUploadPhoto()}
                    >
                      {photoBusy ? "Saving..." : "Save"}
                    </button>
                    <button
                      type="button"
                      className="button secondary tap-button"
                      disabled={photoBusy}
                      onClick={() => {
                        clearPendingUploadPhoto();
                        setShowPhotoUploadPicker(false);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            {largePhotoFileId ? (
              <div
                style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 140, display: "grid", placeItems: "center", padding: "1rem" }}
                onClick={() => {
                  setLargePhotoFileId("");
                  setLargePhotoIsVideo(false);
                }}
              >
                {largePhotoIsVideo ? (
                  <video
                    src={getPhotoProxyPath(largePhotoFileId, tenantKey)}
                    controls
                    playsInline
                    style={{ maxWidth: "min(1200px, 95vw)", maxHeight: "90vh", borderRadius: 14, border: "1px solid var(--line)", background: "#fff" }}
                  />
                ) : (
                  <img
                    src={getPhotoProxyPath(largePhotoFileId, tenantKey)}
                    alt="Large preview"
                    style={{ maxWidth: "min(1200px, 95vw)", maxHeight: "90vh", borderRadius: 14, border: "1px solid var(--line)", background: "#fff" }}
                  />
                )}
              </div>
            ) : null}
          </>
        ) : null}

        {showAddSpouse ? (
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 145, display: "grid", placeItems: "center", padding: "1rem" }}
            onClick={() => setShowAddSpouse(false)}
          >
            <div
              className="card"
              style={{ width: "min(560px, 95vw)", maxHeight: "90vh", overflow: "auto" }}
              onClick={(event) => event.stopPropagation()}
            >
              <h4 style={{ marginTop: 0 }}>Create New Spouse</h4>
              <p className="page-subtitle" style={{ marginTop: "-0.25rem" }}>
                Use spouse dropdown for existing people. This dialog creates a new person and links spouse automatically.
              </p>
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
              <div className="settings-chip-list" style={{ marginTop: "0.75rem" }}>
                <button
                  type="button"
                  className="button tap-button"
                  disabled={creatingSpouse}
                  onClick={() => void createSpouseInline()}
                >
                  {creatingSpouse ? "Creating..." : "Create Spouse"}
                </button>
                <button
                  type="button"
                  className="button secondary tap-button"
                  disabled={creatingSpouse}
                  onClick={() => setShowAddSpouse(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
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
