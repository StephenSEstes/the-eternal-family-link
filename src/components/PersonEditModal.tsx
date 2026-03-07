"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getPhotoProxyPath } from "@/lib/google/photo-path";
import { PrimaryButton, SecondaryButton } from "@/components/ui/primitives";
import { formatUsPhoneForEdit } from "@/lib/phone-format";
import { AttributesModal } from "@/components/AttributesModal";
import { extractPhoneLinkItems } from "@/lib/phone-links";

type PersonItem = {
  personId: string;
  displayName: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  maidenName?: string;
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

type AboutAttribute = {
  attributeId: string;
  category?: "descriptor" | "event";
  typeKey?: string;
  attributeType?: string;
  attributeTypeCategory?: string;
  attributeDetail?: string;
  attributeDate?: string;
  endDate?: string;
  label?: string;
  valueText?: string;
  shareScope?: string;
  shareFamilyGroupKey?: string;
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
type AttributeLaunchSource = "main_events" | "things" | "stories" | "timeline";
type DraftMeta = {
  label: string;
  description: string;
  date: string;
  isPrimary: boolean;
};

type LinkedSearchResult =
  | { kind: "person"; key: string; displayName: string; personId: string; gender: "male" | "female" | "unspecified" }
  | { kind: "household"; key: string; displayName: string; householdId: string };

function toMonthDay(value: string) {
  const raw = value.trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return `${match[2]}/${match[3]}`;
  }
  return raw || "-";
}

function firstNameFromDisplayName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Person";
  return trimmed.split(/\s+/)[0] || "Person";
}

function parseDate(value?: string) {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch;
    const parsed = new Date(Number(y), Number(m) - 1, Number(d));
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatDisplayDate(value?: string) {
  const parsed = parseDate(value);
  if (!parsed) return "-";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
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

function isAudioMediaByMetadata(raw?: string) {
  const parsed = parseMediaMetadata(raw);
  const mime = (parsed?.mimeType ?? "").toLowerCase();
  const fileName = (parsed?.fileName ?? "").toLowerCase();
  return mime.startsWith("audio/") || fileName.endsWith(".mp3") || fileName.endsWith(".m4a") || fileName.endsWith(".wav");
}

function normalizeAttributeKey(value?: string) {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

function toTitleWords(value?: string) {
  return (value ?? "")
    .replace(/_/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function getSafeAttributeText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "[object Object]") return "";
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return getSafeAttributeText(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((entry) => getSafeAttributeText(entry)).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferred = [
      record.displayLabel,
      record.label,
      record.title,
      record.name,
      record.valueText,
      record.value,
      record.text,
    ];
    for (const candidate of preferred) {
      const resolved = getSafeAttributeText(candidate);
      if (resolved) return resolved;
    }
    const primitiveValues = Object.values(record).map((entry) => getSafeAttributeText(entry)).filter(Boolean);
    if (primitiveValues.length > 0) return primitiveValues[0];
    return "";
  }
  return "";
}

function getThingsChipLabel(item: AboutAttribute) {
  const typeKey = normalizeAttributeKey(item.attributeType || item.typeKey);
  const typeCategoryText = getSafeAttributeText(item.attributeTypeCategory);
  const typeCategory = normalizeAttributeKey(typeCategoryText);
  const detail = getSafeAttributeText(item.attributeDetail || item.valueText);
  const categoryLabel = toTitleWords(typeCategory);
  if (typeKey === "physical_attribute") {
    if (categoryLabel && detail) return `${categoryLabel}: ${detail}`;
    if (detail) return `Physical Attribute: ${detail}`;
    return "Physical Attribute";
  }
  if (typeKey === "hobbies_interests") return detail ? `Hobby: ${detail}` : "Hobby";
  if (typeKey === "talent") return detail ? `Talent: ${detail}` : "Talent";
  if (detail) return `${toTitleWords(typeKey) || "Attribute"}: ${detail}`;
  return toTitleWords(typeCategory || typeKey) || "Attribute";
}

async function readClientMediaMetadata(file: File): Promise<{ width?: number; height?: number; durationSec?: number }> {
  const result: { width?: number; height?: number; durationSec?: number } = {};
  if (file.type.startsWith("image/")) {
    await new Promise<void>((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        result.width = img.naturalWidth;
        result.height = img.naturalHeight;
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      img.src = url;
    });
    return result;
  }
  if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
    await new Promise<void>((resolve) => {
      const url = URL.createObjectURL(file);
      const media = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
      media.preload = "metadata";
      media.onloadedmetadata = () => {
        if (Number.isFinite(media.duration)) {
          result.durationSec = Math.max(0, media.duration);
        }
        if (file.type.startsWith("video/")) {
          const video = media as HTMLVideoElement;
          result.width = video.videoWidth || undefined;
          result.height = video.videoHeight || undefined;
        }
        URL.revokeObjectURL(url);
        resolve();
      };
      media.onerror = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      media.src = url;
    });
  }
  return result;
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

function normalizeId(value?: string) {
  return (value ?? "").trim();
}

function isTruthyFlag(value?: string) {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
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

function getGenderAvatarSrc(gender: "male" | "female" | "unspecified") {
  if (gender === "female") return "/placeholders/avatar-female.png";
  return "/placeholders/avatar-male.png";
}

function HouseholdIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PhotoDetailHeader({
  onClose,
  onViewLarge,
}: {
  onClose: () => void;
  onViewLarge: () => void;
}) {
  return (
    <div className="person-photo-detail-head">
      <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Edit Photo</h4>
      <div className="settings-chip-list">
        <button type="button" className="button secondary tap-button" onClick={onViewLarge}>
          View Large
        </button>
        <button type="button" className="button secondary tap-button" onClick={onClose} aria-label="Close edit photo">
          x
        </button>
      </div>
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
      <p className="page-subtitle" style={{ marginTop: "0.35rem", marginBottom: 0 }}>
        Highlight and show first for this person.
      </p>
    </div>
  );
}

function StickySaveBar({
  dirty,
  saving,
  onCancel,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const label = saving ? "Saving..." : "Save Changes";
  return (
    <div className="photo-save-sticky-bar">
      <div className="photo-save-sticky-actions">
        <SecondaryButton type="button" disabled={saving} onClick={onCancel}>
          Cancel
        </SecondaryButton>
        <PrimaryButton type="button" disabled={!dirty || saving} onClick={onSave}>
          {label}
        </PrimaryButton>
      </div>
    </div>
  );
}

function PeopleTagger({
  taggedPeople,
  taggedHouseholds,
  searchQuery,
  onSearchQueryChange,
  results,
  pendingOps,
  canManage,
  onAddLink,
  onRemovePerson,
  onRemoveHousehold,
  getGenderForPerson,
  busy,
  statusText,
}: {
  taggedPeople: Array<{ personId: string; displayName: string }>;
  taggedHouseholds: Array<{ householdId: string; label: string }>;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  results: LinkedSearchResult[];
  pendingOps: Set<string>;
  canManage: boolean;
  onAddLink: (result: LinkedSearchResult) => void;
  onRemovePerson: (personId: string) => void;
  onRemoveHousehold: (householdId: string) => void;
  getGenderForPerson: (personId: string) => "male" | "female" | "unspecified";
  busy: boolean;
  statusText: string;
}) {
  return (
    <div className="person-photo-tags-card card">
      <h5 style={{ margin: "0 0 0.5rem" }}>Linked To</h5>
      <div className="person-association-list">
        {taggedPeople.map((item) => (
          <div key={`person-linked-${item.personId}`} className="person-linked-row">
            <div className="person-linked-main">
              <span className="person-linked-icon" aria-hidden="true">
                <img
                  src={getGenderAvatarSrc(getGenderForPerson(item.personId))}
                  alt=""
                  className="person-linked-avatar"
                />
              </span>
              <span>{item.displayName}</span>
            </div>
            {canManage ? (
              <button
                type="button"
                className="person-chip-remove"
                disabled={busy || pendingOps.has(item.personId)}
                onClick={() => onRemovePerson(item.personId)}
                aria-label={`Remove ${item.displayName} from photo`}
              >
                {pendingOps.has(item.personId) ? "..." : "x"}
              </button>
            ) : null}
          </div>
        ))}
        {taggedHouseholds.map((household) => (
          <div key={`household-linked-${household.householdId}`} className="person-linked-row">
            <div className="person-linked-main">
              <span className="person-linked-icon person-linked-icon--household" aria-hidden="true">
                <HouseholdIcon />
              </span>
              <span>{household.label || household.householdId}</span>
            </div>
            {canManage ? (
              <button
                type="button"
                className="person-chip-remove"
                disabled={busy || pendingOps.has(`h-${household.householdId}`)}
                onClick={() => onRemoveHousehold(household.householdId)}
                aria-label={`Remove ${household.label || household.householdId} from photo`}
              >
                {pendingOps.has(`h-${household.householdId}`) ? "..." : "x"}
              </button>
            ) : null}
          </div>
        ))}
        {taggedPeople.length === 0 && taggedHouseholds.length === 0 ? (
          <span className="status-chip status-chip--neutral">None</span>
        ) : null}
      </div>
      {canManage ? (
        <>
          <label className="label" style={{ marginTop: "0.75rem" }}>Search</label>
          <input
            className="input"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Search people, households"
          />
          {searchQuery.trim() ? (
            <div className="person-typeahead-list">
              {results.length > 0 ? (
                results.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    className="person-typeahead-item"
                    onClick={() => onAddLink(entry)}
                    disabled={busy || pendingOps.has(entry.kind === "person" ? entry.personId : `h-${entry.householdId}`)}
                  >
                    <span className="person-linked-main">
                      <span className={`person-linked-icon${entry.kind === "household" ? " person-linked-icon--household" : ""}`} aria-hidden="true">
                        {entry.kind === "person" ? (
                          <img src={getGenderAvatarSrc(entry.gender)} alt="" className="person-linked-avatar" />
                        ) : (
                          <HouseholdIcon />
                        )}
                      </span>
                      <span>{entry.displayName}</span>
                    </span>
                  </button>
                ))
              ) : (
                <p className="page-subtitle" style={{ margin: 0 }}>No matching results.</p>
              )}
            </div>
          ) : null}
        </>
      ) : null}
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
  const [maidenName, setMaidenName] = useState("");
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
  const [familyTouched, setFamilyTouched] = useState(false);
  const [localPeople, setLocalPeople] = useState<PersonItem[]>(people);
  const [attributes, setAttributes] = useState<PersonAttribute[]>([]);
  const [aboutAttributes, setAboutAttributes] = useState<AboutAttribute[]>([]);
  const [newPhotoLabel, setNewPhotoLabel] = useState("portrait");
  const [newPhotoDescription, setNewPhotoDescription] = useState("");
  const [newPhotoDate, setNewPhotoDate] = useState("");
  const [newPhotoHeadshot, setNewPhotoHeadshot] = useState(false);
  const [pendingUploadPhotoFile, setPendingUploadPhotoFile] = useState<File | null>(null);
  const [pendingUploadPhotoPreviewUrl, setPendingUploadPhotoPreviewUrl] = useState("");
  const [pendingUploadCaptureSource, setPendingUploadCaptureSource] = useState("library");
  const [selectedPhotoAttributeId, setSelectedPhotoAttributeId] = useState("");
  const [draftMeta, setDraftMeta] = useState<DraftMeta>({ label: "", description: "", date: "", isPrimary: false });
  const [tagQuery, setTagQuery] = useState("");
  const [taggedPeople, setTaggedPeople] = useState<Array<{ personId: string; displayName: string }>>([]);
  const [pendingOps, setPendingOps] = useState<Set<string>>(new Set());
  const [largePhotoFileId, setLargePhotoFileId] = useState("");
  const [largePhotoIsVideo, setLargePhotoIsVideo] = useState(false);
  const [largePhotoIsAudio, setLargePhotoIsAudio] = useState(false);
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
  const [uploadTarget, setUploadTarget] = useState<"photo" | "attribute-media">("photo");
  const [showAddSpouse, setShowAddSpouse] = useState(false);
  const [showAttributeAddModal, setShowAttributeAddModal] = useState(false);
  const [selectedAboutAttributeId, setSelectedAboutAttributeId] = useState("");
  const [attributeLaunchSource, setAttributeLaunchSource] = useState<AttributeLaunchSource>("main_events");
  const [newSpouseFirstName, setNewSpouseFirstName] = useState("");
  const [newSpouseMiddleName, setNewSpouseMiddleName] = useState("");
  const [newSpouseLastName, setNewSpouseLastName] = useState("");
  const [newSpouseNickName, setNewSpouseNickName] = useState("");
  const [newSpouseDisplayName, setNewSpouseDisplayName] = useState("");
  const [newSpouseBirthDate, setNewSpouseBirthDate] = useState("");
  const [newSpouseGender, setNewSpouseGender] = useState<"male" | "female" | "unspecified">("unspecified");
  const [newSpouseInLaw, setNewSpouseInLaw] = useState(true);
  const [creatingSpouse, setCreatingSpouse] = useState(false);
  const pendingCreatedSpouseIdRef = useRef("");
  const initialFamilyRef = useRef<{ parent1Id: string; parent2Id: string; spouseId: string }>({
    parent1Id: "",
    parent2Id: "",
    spouseId: "",
  });
  const previousPersonIdRef = useRef("");
  const wasOpenRef = useRef(false);
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
  const spouseByRelationshipId = useMemo(() => {
    if (!person) return "";
    for (const edge of edges) {
      const relType = edge.label.trim().toLowerCase();
      if (relType !== "spouse" && relType !== "family") continue;
      if (edge.fromPersonId === person.personId && edge.toPersonId && edge.toPersonId !== person.personId) {
        return edge.toPersonId;
      }
      if (edge.toPersonId === person.personId && edge.fromPersonId && edge.fromPersonId !== person.personId) {
        return edge.fromPersonId;
      }
    }
    return "";
  }, [edges, person]);
  const aboutLabel = useMemo(() => `About ${firstNameFromDisplayName(displayName || person?.displayName || "")}`, [displayName, person?.displayName]);
  const phoneActionItems = useMemo(() => extractPhoneLinkItems(phones), [phones]);
  const attributeLaunchMeta = useMemo(() => {
    if (attributeLaunchSource === "main_events") {
      return { label: "Main Events", initialTypeKey: "life_event" };
    }
    if (attributeLaunchSource === "things") {
      return { label: "Things About", initialTypeKey: "physical_attribute" };
    }
    if (attributeLaunchSource === "stories") {
      return { label: "Stories", initialTypeKey: "life_event" };
    }
    return { label: "Timeline", initialTypeKey: "life_event" };
  }, [attributeLaunchSource]);

  useEffect(() => {
    setLocalPeople(people);
  }, [people]);

  const fallbackAvatar = (person?.gender ?? "unspecified") === "female"
    ? "/placeholders/avatar-female.png"
    : "/placeholders/avatar-male.png";
  const headerAvatar = person?.photoFileId ? getPhotoProxyPath(person.photoFileId, tenantKey) : fallbackAvatar;
  const photoAttributes = attributes.filter((item) => item.attributeType.toLowerCase() === "photo");
  const allMediaAttributes = attributes.filter((item) => {
    const type = item.attributeType.toLowerCase();
    return type === "photo" || type === "media" || type === "audio" || type === "video";
  });
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

  const loadAboutAttributes = async (personId: string) => {
    const res = await fetch(
      `/api/attributes?entity_type=person&entity_id=${encodeURIComponent(personId)}`,
      { cache: "no-store" },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setStatus(`About attribute load failed: ${res.status}`);
      return;
    }
    setAboutAttributes(Array.isArray(body?.attributes) ? (body.attributes as AboutAttribute[]) : []);
  };

  useEffect(() => {
    if (!open || !person) {
      setShowAttributeAddModal(false);
      wasOpenRef.current = false;
      return;
    }
    const shouldResetTab = !wasOpenRef.current || previousPersonIdRef.current !== person.personId;
    if (shouldResetTab) {
      setActiveTab("contact");
    }
    wasOpenRef.current = true;
    previousPersonIdRef.current = person.personId;
    setDisplayName(person.displayName || "");
    setFirstName(person.firstName || "");
    setMiddleName(person.middleName || "");
    setLastName(person.lastName || "");
    setMaidenName(person.maidenName || "");
    setNickName(person.nickName || "");
    setBirthDate(person.birthDate || "");
    setGender(person.gender || "unspecified");
    setPhones(formatUsPhoneForEdit(person.phones || ""));
    setEmail(person.email || "");
    setAddress(person.address || "");
    setHobbies(person.hobbies || "");
    setNotes(person.notes || "");
    const initialParent1Id = parentSelection.motherId;
    const initialParent2Id = parentSelection.fatherId;
    setParent1Id(initialParent1Id);
    setParent2Id(initialParent2Id);
    const partner = households.find((item) => item.partner1PersonId === person.personId || item.partner2PersonId === person.personId);
    let initialSpouseId = "";
    if (partner) {
      initialSpouseId = partner.partner1PersonId === person.personId ? partner.partner2PersonId : partner.partner1PersonId;
      setSpouseId(initialSpouseId);
    } else {
      initialSpouseId = spouseByRelationshipId;
      setSpouseId(initialSpouseId);
    }
    initialFamilyRef.current = {
      parent1Id: normalizeId(initialParent1Id),
      parent2Id: normalizeId(initialParent2Id),
      spouseId: normalizeId(initialSpouseId),
    };
    setFamilyTouched(false);
    setNewPhotoLabel("portrait");
    setNewPhotoDescription("");
    setNewPhotoDate("");
    setNewPhotoHeadshot(false);
    setPendingUploadPhotoFile(null);
    setPendingUploadPhotoPreviewUrl("");
    setPendingUploadCaptureSource("library");
    setSelectedPhotoAttributeId("");
    setDraftMeta({ label: "", description: "", date: "", isPrimary: false });
    setTagQuery("");
    setTaggedPeople([]);
    setPendingOps(new Set());
    setLargePhotoFileId("");
    setLargePhotoIsVideo(false);
    setLargePhotoIsAudio(false);
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
    setUploadTarget("photo");
    setShowAddSpouse(false);
    setSelectedAboutAttributeId("");
    setNewSpouseFirstName("");
    setNewSpouseMiddleName("");
    setNewSpouseLastName("");
    setNewSpouseNickName("");
    setNewSpouseDisplayName("");
    setNewSpouseBirthDate("");
    setNewSpouseGender(oppositeGender(person.gender || "unspecified"));
    setNewSpouseInLaw(true);
    pendingCreatedSpouseIdRef.current = "";
    setStatus("");
    void loadAttributes(person.personId);
    void loadAboutAttributes(person.personId);
  }, [open, person, households, parentSelection, spouseByRelationshipId, tenantKey]);

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
    () => {
      const base = personOptions.filter((option) => {
        const marriedTo = spouseByPersonId.get(option.personId);
        return !marriedTo || marriedTo === person?.personId;
      });
      if (spouseId && !base.some((option) => option.personId === spouseId)) {
        const selected = personOptions.find((option) => option.personId === spouseId) ?? localPeople.find((option) => option.personId === spouseId);
        if (selected && selected.personId !== person?.personId) {
          return [selected, ...base];
        }
      }
      return base;
    },
    [localPeople, person?.personId, personOptions, spouseByPersonId, spouseId],
  );
  const hasVisibleSpouseSelection = useMemo(
    () => Boolean(spouseId && spouseOptions.some((option) => option.personId === spouseId)),
    [spouseId, spouseOptions],
  );
  const selectedSpouseName = useMemo(() => {
    if (!spouseId) return "-";
    const spouse = localPeople.find((item) => item.personId === spouseId);
    return spouse?.displayName || "-";
  }, [localPeople, spouseId]);
  const timelineItems = useMemo(() => {
    const mediaTypes = new Set(["photo", "media", "audio", "video"]);
    return attributes
      .filter((item) => !mediaTypes.has(item.attributeType.toLowerCase()))
      .sort((a, b) => {
        const aDate = parseDate(a.startDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bDate = parseDate(b.startDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return aDate - bDate;
      })
      .slice(0, 8);
  }, [attributes]);
  const isInLawPerson = useMemo(() => {
    const inLegacyAttributes = attributes.some((item) => normalizeAttributeKey(item.attributeType) === "in_law" && isTruthyFlag(item.valueText));
    const inUnifiedAttributes = aboutAttributes.some((item) => normalizeAttributeKey(item.attributeType || item.typeKey) === "in_law" && isTruthyFlag(getSafeAttributeText(item.attributeDetail || item.valueText)));
    return inLegacyAttributes || inUnifiedAttributes;
  }, [aboutAttributes, attributes]);
  const aboutDescriptorAttributes = useMemo(() => {
    return aboutAttributes.filter((item) => {
      if (item.category) return item.category === "descriptor";
      const typeKey = normalizeAttributeKey(item.attributeType || item.typeKey);
      return !["birth", "education", "religious", "accomplishment", "injury_health", "life_event", "moved", "employment", "family_relationship", "pet", "travel", "other"].includes(typeKey);
    });
  }, [aboutAttributes]);
  const thingsChips = useMemo(() => {
    return aboutDescriptorAttributes
      .map((item) => ({
        attributeId: item.attributeId,
        label: getThingsChipLabel(item),
      }))
      .filter((item) => item.label.trim().length > 0);
  }, [aboutDescriptorAttributes]);
  useEffect(() => {
    if (!spouseId) {
      pendingCreatedSpouseIdRef.current = "";
      return;
    }
    if (spouseOptions.some((option) => option.personId === spouseId)) {
      if (pendingCreatedSpouseIdRef.current === spouseId) {
        pendingCreatedSpouseIdRef.current = "";
      }
      return;
    }
    if (pendingCreatedSpouseIdRef.current === spouseId) {
      return;
    }
  }, [spouseId, spouseOptions]);
  const selectedPhoto = useMemo(
    () => allMediaAttributes.find((item) => item.attributeId === selectedPhotoAttributeId) ?? null,
    [allMediaAttributes, selectedPhotoAttributeId],
  );
  const linkedPhotoFileIds = useMemo(
    () => new Set(allMediaAttributes.map((item) => item.valueText.trim()).filter(Boolean)),
    [allMediaAttributes],
  );
  const filteredPhotoAttributes = useMemo(() => {
    const query = personPhotoQuery.trim().toLowerCase();
    if (!query) return allMediaAttributes;
    return allMediaAttributes.filter((item) =>
      [item.label, item.notes, item.startDate, item.valueText].some((value) => (value || "").toLowerCase().includes(query)),
    );
  }, [allMediaAttributes, personPhotoQuery]);
  const linkablePeople = useMemo(
    () => personOptions.slice().sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [personOptions],
  );
  const peopleByIdForLinks = useMemo(
    () =>
      new Map(
        personOptions.map((item) => [
          item.personId,
          { displayName: item.displayName, gender: (item.gender ?? "unspecified") as "male" | "female" | "unspecified" },
        ]),
      ),
    [personOptions],
  );
  const availableHouseholdLinks = useMemo(() => {
    const unique = new Map<string, { householdId: string; label: string }>();
    households.forEach((item) => {
      const key = item.id.trim();
      if (!key) return;
      if (unique.has(key)) return;
      unique.set(key, { householdId: key, label: key });
    });
    return Array.from(unique.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [households]);
  const linkedPersonIdsForSelectedPhoto = useMemo(
    () => new Set(taggedPeople.map((entry) => entry.personId)),
    [taggedPeople],
  );
  const linkedHouseholdIdsForSelectedPhoto = useMemo(
    () => new Set(selectedPhotoAssociations.households.map((entry) => entry.householdId)),
    [selectedPhotoAssociations.households],
  );
  const tagSearchResults = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    if (!q) return [] as LinkedSearchResult[];
    const personMatches: LinkedSearchResult[] = linkablePeople
      .filter((item) => item.displayName.toLowerCase().includes(q) && !linkedPersonIdsForSelectedPhoto.has(item.personId))
      .map((item) => ({
        kind: "person",
        key: `person-${item.personId}`,
        displayName: item.displayName,
        personId: item.personId,
        gender: item.gender ?? "unspecified",
      }));
    const householdMatches: LinkedSearchResult[] = availableHouseholdLinks
      .filter((item) => item.label.toLowerCase().includes(q) && !linkedHouseholdIdsForSelectedPhoto.has(item.householdId))
      .map((item) => ({
        kind: "household",
        key: `household-${item.householdId}`,
        displayName: item.label,
        householdId: item.householdId,
      }));
    return [...personMatches, ...householdMatches].slice(0, 10);
  }, [availableHouseholdLinks, linkablePeople, linkedHouseholdIdsForSelectedPhoto, linkedPersonIdsForSelectedPhoto, tagQuery]);
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
    const selectedType = selectedPhoto.attributeType.toLowerCase();
    const nextAttributeType = selectedType === "photo" ? "photo" : "media";
    setPhotoAssociationStatus("Saving association...");
    setStatus("Linking photo to selected person...");
    const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(targetPersonId)}/attributes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attributeType: nextAttributeType,
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

  const linkSelectedPhotoToHousehold = async (targetHouseholdId: string) => {
    if (!selectedPhoto || !targetHouseholdId) return false;
    setPhotoAssociationStatus("Saving association...");
    setStatus("Linking photo to selected household...");
    const res = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(targetHouseholdId)}/photos/link`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: selectedPhoto.valueText,
          name: draftMeta.label || selectedPhoto.label || "photo",
          description: draftMeta.description || selectedPhoto.notes || "",
          photoDate: draftMeta.date || selectedPhoto.startDate || "",
          mediaMetadata: selectedPhoto.mediaMetadata || selectedPhoto.valueJson || "",
          isPrimary: false,
        }),
      },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message = body?.message || body?.error || "";
      setStatus(`Link photo failed: ${res.status} ${String(message).slice(0, 160)}`);
      setPhotoAssociationStatus("Association save failed.");
      return false;
    }
    setStatus("Photo linked to selected household.");
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
      (item) => {
        const type = item.attributeType.toLowerCase();
        return ["photo", "video", "audio", "media"].includes(type) && item.valueText.trim() === fileId;
      },
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

  const addTagByTypeahead = async (candidate: LinkedSearchResult) => {
    if (!selectedPhoto) {
      return;
    }
    if (candidate.kind === "person" && linkedPersonIdsForSelectedPhoto.has(candidate.personId)) {
      setPhotoAssociationStatus("Already linked.");
      return;
    }
    if (candidate.kind === "household" && linkedHouseholdIdsForSelectedPhoto.has(candidate.householdId)) {
      setPhotoAssociationStatus("Already linked.");
      return;
    }
    setTagQuery("");
    if (candidate.kind === "person") {
      setTaggedPeople((current) => [...current, { personId: candidate.personId, displayName: candidate.displayName }]);
    }
    const key = candidate.kind === "person" ? candidate.personId : `h-${candidate.householdId}`;
    setPendingOps((current) => new Set(current).add(key));
    try {
      const ok =
        candidate.kind === "person"
          ? await linkSelectedPhotoToPerson(candidate.personId)
          : await linkSelectedPhotoToHousehold(candidate.householdId);
      if (!ok) {
        if (candidate.kind === "person") {
          setTaggedPeople((current) => current.filter((item) => item.personId !== candidate.personId));
        }
      }
    } finally {
      setPendingOps((current) => {
        const next = new Set(current);
        next.delete(key);
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
    setPendingUploadCaptureSource("library");
  };

  const setPendingUploadFromInput = (file: File | null, source = "library") => {
    if (!file) return;
    if (pendingUploadPhotoPreviewUrl) {
      URL.revokeObjectURL(pendingUploadPhotoPreviewUrl);
    }
    const previewUrl = URL.createObjectURL(file);
    setPendingUploadPhotoFile(file);
    setPendingUploadPhotoPreviewUrl(previewUrl);
    setPendingUploadCaptureSource(source);
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
      form.append("captureSource", pendingUploadCaptureSource);
      form.append("attributeType", uploadTarget === "attribute-media" ? "media" : "photo");
      const mediaMeta = await readClientMediaMetadata(pendingUploadPhotoFile);
      if (typeof mediaMeta.width === "number") form.append("mediaWidth", String(Math.round(mediaMeta.width)));
      if (typeof mediaMeta.height === "number") form.append("mediaHeight", String(Math.round(mediaMeta.height)));
      if (typeof mediaMeta.durationSec === "number") form.append("mediaDurationSec", String(mediaMeta.durationSec));
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
      setUploadTarget("photo");
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
              familyChanged: true,
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
      pendingCreatedSpouseIdRef.current = createdPersonId;
      setSpouseId(createdPersonId);
      setFamilyTouched(true);
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
          </div>
        </div>

        <div className="person-modal-tabs">
          <button type="button" className={`tab-pill ${activeTab === "contact" ? "active" : ""}`} onClick={() => setActiveTab("contact")}>Contact Info</button>
          <button type="button" className={`tab-pill ${activeTab === "attributes" ? "active" : ""}`} onClick={() => setActiveTab("attributes")}>{aboutLabel}</button>
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
                <h4 className="ui-section-title">Name</h4>
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
                <div className="settings-chip-list" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", marginBottom: "0.6rem" }}>
                  <input
                    className="input"
                    value={phones}
                    onChange={(e) => setPhones(e.target.value)}
                    onBlur={() => setPhones((current) => formatUsPhoneForEdit(current))}
                    disabled={showReadOnly}
                  />
                  {phoneActionItems.length > 0 ? (
                    <div style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center", alignSelf: "stretch" }}>
                      {phoneActionItems.map((item) => (
                        <span key={item.smsHref} style={{ display: "inline-flex", gap: "0.4rem" }}>
                          <a href={item.telHref} className="button secondary tap-button" style={{ minHeight: "44px", padding: "0 0.8rem", whiteSpace: "nowrap" }}>
                            Call
                          </a>
                          <a href={item.smsHref} className="button secondary tap-button" style={{ minHeight: "44px", padding: "0 0.8rem", whiteSpace: "nowrap" }}>
                            Text
                          </a>
                        </span>
                      ))}
                    </div>
                  ) : <span />}
                </div>
                <label className="label">Email</label>
                <div className="settings-chip-list" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", marginBottom: "0.6rem" }}>
                  <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} disabled={showReadOnly} />
                  {email.trim() ? (
                    <a
                      href={`mailto:${email.trim()}`}
                      className="button secondary tap-button"
                      style={{ minHeight: "44px", padding: "0 0.8rem", whiteSpace: "nowrap" }}
                    >
                      Email
                    </a>
                  ) : null}
                </div>
                <label className="label">Address</label>
                <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} disabled={showReadOnly} />
              </div>

              <div className="card">
                <h4 className="ui-section-title">Family</h4>
                {canManage ? (
                  <>
                    <div className="settings-chip-list">
                      {!isInLawPerson ? (
                        <>
                          <div style={{ flex: 1, minWidth: 180 }}>
                            <label className="label">Mother</label>
                            <select
                              className="input"
                              value={parent1Id}
                              onChange={(e) => {
                                const next = e.target.value;
                                setParent1Id(next);
                                setFamilyTouched(true);
                                const spouse = next ? spouseByPersonId.get(next) ?? "" : "";
                                if (spouse) {
                                  setSpouseId(spouse);
                                }
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
                                setFamilyTouched(true);
                                const spouse = next ? spouseByPersonId.get(next) ?? "" : "";
                                if (spouse) {
                                  setSpouseId(spouse);
                                }
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
                        </>
                      ) : (
                        <p className="page-subtitle field-span-2" style={{ marginBottom: 0 }}>
                          As an in-law your parents are not visible in this view. To see/Select your parents, change the family group.
                        </p>
                      )}
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <label className="label">Spouse</label>
                        <select className="input" value={spouseId} onChange={(e) => {
                          setSpouseId(e.target.value);
                          setFamilyTouched(true);
                        }}>
                          <option value="">None</option>
                          {spouseOptions.map((option) => (
                            <option key={`sp-${option.personId}`} value={option.personId}>{option.displayName}</option>
                          ))}
                        </select>
                      </div>
                      {gender === "female" && spouseId ? (
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <label className="label">Maiden Name</label>
                          <input className="input" value={maidenName} onChange={(e) => setMaidenName(e.target.value)} disabled={showReadOnly} />
                        </div>
                      ) : null}
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
                          Add New Person as Spouse
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
              </div>

              <div className="card field-span-2">
                <h4 className="ui-section-title">Notes</h4>
                <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={showReadOnly} />
              </div>
            </div>
          </>
        ) : null}

        {activeTab === "attributes" ? (
          <>
            <div className="person-section-grid">
              <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: "230px" }}>
                <h4 className="ui-section-title">Life Events</h4>
                <div className="field-grid" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
                  <p className="page-subtitle" style={{ margin: 0 }}><strong>Born:</strong> {formatDisplayDate(birthDate)}</p>
                  <p className="page-subtitle" style={{ margin: 0 }}><strong>Schools Attended:</strong> -</p>
                  <p className="page-subtitle" style={{ margin: 0 }}><strong>Married:</strong> {selectedSpouseName}</p>
                  <p className="page-subtitle" style={{ margin: 0 }}><strong>Major Accomplishments and Events:</strong> -</p>
                </div>
                <button
                  type="button"
                  className="button secondary tap-button"
                  style={{ marginTop: "auto" }}
                  onClick={() => {
                    setAttributeLaunchSource("main_events");
                    setSelectedAboutAttributeId("");
                    setShowAttributeAddModal(true);
                  }}
                >
                  Add Life Event
                </button>
              </div>

              <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: "230px" }}>
                <h4 className="ui-section-title">Things about {firstNameFromDisplayName(displayName || person.displayName)}</h4>
                <div className="settings-chip-list" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", marginBottom: "0.6rem" }}>
                  {thingsChips.length > 0 ? (
                    thingsChips.map((chip) => (
                      <button
                        key={chip.attributeId}
                        type="button"
                        className="status-chip status-chip--neutral"
                        style={{
                          textAlign: "left",
                          width: "100%",
                          borderRadius: "999px",
                          border: "1px solid #d9e2ec",
                          background: "#eef4ff",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.45rem",
                          padding: "0.45rem 0.7rem",
                          cursor: "pointer",
                        }}
                        onClick={() => {
                          setAttributeLaunchSource("things");
                          setSelectedAboutAttributeId(chip.attributeId);
                          setShowAttributeAddModal(true);
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: "0.52rem",
                            height: "0.52rem",
                            borderRadius: "999px",
                            background: "#5b6b85",
                            flex: "0 0 auto",
                          }}
                        />
                        {chip.label}
                      </button>
                    ))
                  ) : (
                    <p className="page-subtitle" style={{ margin: 0 }}>No attributes added yet.</p>
                  )}
                </div>
                <button
                  type="button"
                  className="button secondary tap-button"
                  style={{ marginTop: "auto" }}
                  onClick={() => {
                    setAttributeLaunchSource("things");
                    setSelectedAboutAttributeId("");
                    setShowAttributeAddModal(true);
                  }}
                >
                  Add something about {firstNameFromDisplayName(displayName || person.displayName)}
                </button>
              </div>

              <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: "230px" }}>
                <h4 className="ui-section-title">Stories</h4>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  className="button secondary tap-button"
                  style={{ marginTop: "auto" }}
                  onClick={() => {
                    setAttributeLaunchSource("stories");
                    setSelectedAboutAttributeId("");
                    setShowAttributeAddModal(true);
                  }}
                >
                  + Add Attribute
                </button>
              </div>

              <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: "230px" }}>
                <h4 className="ui-section-title">Timeline</h4>
                <div className="field-grid" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
                  {timelineItems.length > 0 ? (
                    timelineItems.map((item) => (
                      <p key={item.attributeId} className="page-subtitle" style={{ margin: 0 }}>
                        <strong>{item.startDate ? `${formatDisplayDate(item.startDate)}:` : "Event:"}</strong> {item.label || item.valueText || item.attributeType}
                      </p>
                    ))
                  ) : (
                    <p className="page-subtitle" style={{ margin: 0 }}>No events listed yet.</p>
                  )}
                </div>
                <button
                  type="button"
                  className="button secondary tap-button"
                  style={{ marginTop: "auto" }}
                  onClick={() => {
                    setAttributeLaunchSource("timeline");
                    setSelectedAboutAttributeId("");
                    setShowAttributeAddModal(true);
                  }}
                >
                  + Add Attribute
                </button>
              </div>

              <div className="card field-span-2">
                <h4 className="ui-section-title">What we don&apos;t yet know about you</h4>
                <p className="page-subtitle" style={{ marginBottom: 0 }}>
                  This section will list missing details to collect.
                </p>
              </div>
            </div>
          </>
        ) : null}

        {person ? (
          <AttributesModal
            open={showAttributeAddModal}
            tenantKey={tenantKey}
            entityType="person"
            entityId={person.personId}
            entityLabel={displayName || person.displayName}
            modalSubtitle={aboutLabel}
            initialTypeKey={attributeLaunchMeta.initialTypeKey}
            initialEditAttributeId={selectedAboutAttributeId}
            startInAddMode
            launchSourceLabel={attributeLaunchMeta.label}
            onClose={() => {
              setShowAttributeAddModal(false);
              setSelectedAboutAttributeId("");
            }}
            onSaved={() => {
              void loadAttributes(person.personId);
              void loadAboutAttributes(person.personId);
              onSaved();
            }}
          />
        ) : null}

        {activeTab === "photos" ? (
          <>
            <div className="card person-photo-gallery-card">
              <div className="person-photo-gallery-toolbar">
                <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Media Gallery</h4>
                <div className="person-photo-gallery-actions">
                  {canManage ? (
                    <button
                      type="button"
                      className="button tap-button"
                      onClick={() => {
                        setUploadTarget("photo");
                        setShowPhotoUploadPicker(true);
                      }}
                    >
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
                      ) : isAudioMediaByMetadata(item.mediaMetadata || item.valueJson) ? (
                        <div className="person-photo-tile-image" style={{ display: "grid", placeItems: "center", padding: "0.75rem" }}>
                          <audio src={getPhotoProxyPath(item.valueText, tenantKey)} controls style={{ width: "100%" }} />
                        </div>
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
                    onClose={() => setShowPhotoDetail(false)}
                    onViewLarge={() => {
                      setLargePhotoFileId(selectedPhoto.valueText);
                      setLargePhotoIsVideo(isVideoMediaByMetadata(selectedPhoto.mediaMetadata || selectedPhoto.valueJson));
                      setLargePhotoIsAudio(isAudioMediaByMetadata(selectedPhoto.mediaMetadata || selectedPhoto.valueJson));
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
                    ) : isAudioMediaByMetadata(selectedPhoto.mediaMetadata || selectedPhoto.valueJson) ? (
                      <audio
                        src={getPhotoProxyPath(selectedPhoto.valueText, tenantKey)}
                        className="person-photo-detail-preview"
                        controls
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
                    taggedPeople={taggedPeople}
                    taggedHouseholds={selectedPhotoAssociations.households}
                    searchQuery={tagQuery}
                    onSearchQueryChange={setTagQuery}
                    results={tagSearchResults}
                    pendingOps={pendingOps}
                    canManage={canManage}
                    onAddLink={(candidate) => {
                      void addTagByTypeahead(candidate);
                    }}
                    onRemovePerson={(personIdToRemove) => {
                      void removeTagByChip(personIdToRemove);
                    }}
                    onRemoveHousehold={(householdIdToRemove) => {
                      void removeHouseholdByChip(householdIdToRemove);
                    }}
                    getGenderForPerson={(personId) => peopleByIdForLinks.get(personId)?.gender ?? "unspecified"}
                    busy={photoBusy || selectedPhotoAssociationsBusy}
                    statusText={photoAssociationStatus}
                  />
                  <StickySaveBar
                    dirty={
                      draftMeta.label !== (selectedPhoto.label || "") ||
                      draftMeta.description !== (selectedPhoto.notes || "") ||
                      draftMeta.date !== (selectedPhoto.startDate || "") ||
                      draftMeta.isPrimary !== selectedPhoto.isPrimary
                    }
                    saving={photoBusy}
                    onCancel={() => setShowPhotoDetail(false)}
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
                              alt={item.name || "media"}
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
                    <h4 className="ui-section-title" style={{ marginBottom: 0 }}>
                      {uploadTarget === "attribute-media" ? "Upload Media Attribute" : "Upload Photo"}
                    </h4>
                    <button
                      type="button"
                      className="button secondary tap-button"
                      onClick={() => {
                        clearPendingUploadPhoto();
                        setShowPhotoUploadPicker(false);
                        setUploadTarget("photo");
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
                    <input type="checkbox" checked={newPhotoHeadshot} onChange={(e) => setNewPhotoHeadshot(e.target.checked)} disabled={uploadTarget === "attribute-media"} /> Set as primary headshot
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
                      ) : pendingUploadPhotoFile?.type?.startsWith("audio/") ? (
                        <audio src={pendingUploadPhotoPreviewUrl} className="person-upload-preview-image" controls />
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
                    accept="image/*,video/*,audio/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      e.currentTarget.value = "";
                      setPendingUploadFromInput(file, "library");
                    }}
                  />
                  <input
                    id={`person-photo-upload-camera-${person.personId}`}
                    type="file"
                    accept="image/*,video/*"
                    capture="environment"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      e.currentTarget.value = "";
                      setPendingUploadFromInput(file, "camera");
                    }}
                  />
                  <input
                    id={`person-photo-upload-audio-${person.personId}`}
                    type="file"
                    accept="audio/*"
                    capture="user"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      e.currentTarget.value = "";
                      setPendingUploadFromInput(file, "audio-capture");
                    }}
                  />
                  <div className="settings-chip-list" style={{ marginTop: "0.75rem" }}>
                    <button
                      type="button"
                      className="button secondary tap-button"
                      disabled={photoBusy}
                      onClick={() => document.getElementById(`person-photo-upload-${person.personId}`)?.click()}
                    >
                      {pendingUploadPhotoFile ? "Choose From Library" : "Choose From Library"}
                    </button>
                    <button
                      type="button"
                      className="button secondary tap-button"
                      disabled={photoBusy}
                      onClick={() => document.getElementById(`person-photo-upload-camera-${person.personId}`)?.click()}
                    >
                      Camera
                    </button>
                    <button
                      type="button"
                      className="button secondary tap-button"
                      disabled={photoBusy}
                      onClick={() => document.getElementById(`person-photo-upload-audio-${person.personId}`)?.click()}
                    >
                      Audio
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
                        setUploadTarget("photo");
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
      setLargePhotoIsAudio(false);
                }}
              >
                {largePhotoIsVideo ? (
                  <video
                    src={getPhotoProxyPath(largePhotoFileId, tenantKey)}
                    controls
                    playsInline
                    style={{ maxWidth: "min(1200px, 95vw)", maxHeight: "90vh", borderRadius: 14, border: "1px solid var(--line)", background: "#fff" }}
                  />
                ) : largePhotoIsAudio ? (
                  <audio
                    src={getPhotoProxyPath(largePhotoFileId, tenantKey)}
                    controls
                    style={{ width: "min(640px, 95vw)", borderRadius: 14, border: "1px solid var(--line)", background: "#fff" }}
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
                      maiden_name: maidenName,
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
                  const initialFamily = initialFamilyRef.current;
                  const familyChanged =
                    familyTouched ||
                    normalizeId(parent1Id) !== normalizeId(initialFamily.parent1Id) ||
                    normalizeId(parent2Id) !== normalizeId(initialFamily.parent2Id) ||
                    normalizeId(spouseId) !== normalizeId(initialFamily.spouseId);
                  if (familyChanged) {
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
                        familyChanged: true,
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
