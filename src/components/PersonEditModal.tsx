"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { getPhotoAvatarProxyPath, getPhotoPreviewProxyPath, getPhotoProxyPath } from "@/lib/google/photo-path";
import {
  AsyncActionButton,
  ModalActionBar,
  ModalCloseButton,
  ModalStatusBanner,
  inferStatusTone,
} from "@/components/ui/primitives";
import { formatUsPhoneForEdit } from "@/lib/phone-format";
import { AttributesModal } from "@/components/AttributesModal";
import { MediaAttachWizard, formatMediaAttachUserSummary } from "@/components/media/MediaAttachWizard";
import type { AiStoryImportProposal } from "@/lib/ai/story-import-types";
import {
  matchesCanonicalMediaFileId,
  toPersonMediaAttributes,
  type AttributeWithMedia,
  type PersonMediaAttributeRecord,
} from "@/lib/attributes/media-response";
import { extractPhoneLinkItems } from "@/lib/phone-links";
import type { AttributeEventDefinitions } from "@/lib/attributes/event-definitions-types";
import {
  defaultAttributeDefinitions,
  makeAttributeDefinitionCategoryId,
} from "@/lib/attributes/definition-defaults";
import type { MediaAttachExecutionSummary } from "@/lib/media/attach-orchestrator";
import { inferStoredMediaKind } from "@/lib/media/upload";
import { DEFAULT_FAMILY_GROUP_KEY } from "@/lib/family-group/constants";
import { getDeathDateFromAttributes } from "@/lib/person/vital-dates";

type FamilyGroupRelationshipType = "founder" | "direct" | "in_law" | "undeclared";

type PersonItem = {
  personId: string;
  displayName: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  maidenName?: string;
  nickName?: string;
  birthDate?: string;
  deathDate?: string;
  gender?: "male" | "female" | "unspecified";
  photoFileId?: string;
  phones?: string;
  email?: string;
  address?: string;
  hobbies?: string;
  notes?: string;
  familyGroupRelationshipType?: FamilyGroupRelationshipType;
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

type PersonAttribute = PersonMediaAttributeRecord;

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
  createdAt?: string;
  updatedAt?: string;
};

type PhotoLibraryItem = {
  fileId: string;
  name: string;
  description: string;
  date: string;
  people: Array<{ personId: string; displayName: string }>;
  households: Array<{ householdId: string; label: string }>;
};

type StoryChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type StoryChatSuggestion = {
  titleHint: string;
  startDate: string;
  endDate: string;
  attributeKind: "event" | "descriptor";
  attributeType: string;
  attributeTypeCategory: string;
  reasoning: string;
};

type StoryImportHints = {
  titleHint: string;
  startDate: string;
  endDate: string;
  attributeType: string;
  attributeTypeCategory: string;
};
type StoryWorkspaceStep = 1 | 2;
type StoryWorkspaceDraft = AiStoryImportProposal & {
  localId: string;
  selected: boolean;
  saveBusy: boolean;
  saveStatus: string;
};

type Props = {
  open: boolean;
  tenantKey: string;
  canManage: boolean;
  canManageRelationshipType?: boolean;
  person: PersonItem | null;
  people: PersonItem[];
  edges: GraphEdge[];
  households: HouseholdLink[];
  onClose: () => void;
  onSaved: () => void;
  onEditHousehold: (householdId: string) => void;
};

type FamilyGroupOption = {
  key: string;
  name: string;
  role: "ADMIN" | "USER";
};

function normalizeFamilyGroupKey(value?: string) {
  return String(value ?? "").trim().toLowerCase();
}

type TabKey = "contact" | "attributes" | "photos";
type ProfileSectionKey = "identity" | "name" | "contact" | "family" | "notes";
type AttributeLaunchSource = "main_events" | "things" | "stories" | "timeline";
const ADD_NEW_SPOUSE_OPTION = "__add_new_spouse__";
const DIVORCE_SPOUSE_OPTION = "__divorce_spouse__";
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

function stripStorySeedPrefix(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";
  const lines = normalized.split("\n");
  const first = lines[0]?.trim() ?? "";
  if (/^top-level\b/i.test(first) && /\b(matriarch|patriarch|ancestor|founder)\b/i.test(first)) {
    return lines.slice(1).join("\n").trim();
  }
  return normalized;
}

function buildSwitchedFamilyPath(currentPath: string, nextTenantKey: string) {
  const normalizedNext = nextTenantKey.trim().toLowerCase();
  const isDefaultNext = normalizedNext === DEFAULT_FAMILY_GROUP_KEY;
  const parts = currentPath.split("/").filter(Boolean);
  const hasTenantPrefix = parts[0] === "t" && Boolean(parts[1]);

  if (hasTenantPrefix) {
    const tail = parts.slice(2).join("/");
    if (isDefaultNext) {
      return tail ? `/${tail}` : "/";
    }
    return tail ? `/t/${encodeURIComponent(normalizedNext)}/${tail}` : `/t/${encodeURIComponent(normalizedNext)}`;
  }

  if (isDefaultNext) {
    return currentPath || "/";
  }
  if (!currentPath || currentPath === "/") {
    return `/t/${encodeURIComponent(normalizedNext)}`;
  }
  return `/t/${encodeURIComponent(normalizedNext)}${currentPath}`;
}

function buildSwitchedFamilyFallbackPath(nextTenantKey: string) {
  const normalizedNext = nextTenantKey.trim().toLowerCase();
  if (normalizedNext === DEFAULT_FAMILY_GROUP_KEY) {
    return "/people";
  }
  return `/t/${encodeURIComponent(normalizedNext)}/people`;
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

function formatSummaryValue(value?: string, emptyLabel = "Not added") {
  const trimmed = String(value ?? "").trim();
  return trimmed || emptyLabel;
}

function summarizeNames(values: Array<string | undefined>, emptyLabel = "None") {
  const cleaned = values.map((value) => String(value ?? "").trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return emptyLabel;
  }
  return cleaned.join(", ");
}

function computeYearsSince(value?: string) {
  const parsed = parseDate(value);
  if (!parsed) return "";
  const now = new Date();
  let years = now.getFullYear() - parsed.getFullYear();
  const beforeAnniversary =
    now.getMonth() < parsed.getMonth() ||
    (now.getMonth() === parsed.getMonth() && now.getDate() < parsed.getDate());
  if (beforeAnniversary) years -= 1;
  return years >= 0 ? String(years) : "";
}

function isAtLeastAge(value: string | undefined, minYears = 19) {
  const parsed = parseDate(value);
  if (!parsed) return false;
  const now = new Date();
  let years = now.getFullYear() - parsed.getFullYear();
  const beforeBirthday =
    now.getMonth() < parsed.getMonth() ||
    (now.getMonth() === parsed.getMonth() && now.getDate() < parsed.getDate());
  if (beforeBirthday) years -= 1;
  return years >= minYears;
}

function inferPersonMediaKind(fileId: string, raw?: string) {
  return inferStoredMediaKind(fileId, raw);
}

function isVideoMediaByMetadata(fileId: string, raw?: string) {
  return inferPersonMediaKind(fileId, raw) === "video";
}

function isAudioMediaByMetadata(fileId: string, raw?: string) {
  return inferPersonMediaKind(fileId, raw) === "audio";
}

function isDocumentMediaByMetadata(fileId: string, raw?: string) {
  return inferPersonMediaKind(fileId, raw) === "document";
}

function normalizeAttributeKey(value?: string) {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

function normalizeFamilyGroupRelationshipType(value?: string): FamilyGroupRelationshipType {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "founder" || normalized === "direct" || normalized === "in_law" || normalized === "undeclared") {
    return normalized;
  }
  return "undeclared";
}

const EVENT_FALLBACK_TYPE_KEYS = [
  "birth",
  "death",
  "education",
  "religious",
  "accomplishment",
  "injury_health",
  "life_event",
  "moved",
  "employment",
  "family_relationship",
  "pet",
  "travel",
  "other",
];

function isAnchorFamilyGroupRelationshipType(value?: string) {
  const normalized = normalizeFamilyGroupRelationshipType(value);
  return normalized === "founder" || normalized === "direct";
}

function formatFamilyGroupRelationshipTypeLabel(value?: string) {
  const normalized = normalizeFamilyGroupRelationshipType(value);
  if (normalized === "in_law") return "In-law";
  if (normalized === "undeclared") return "Needs Placement";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
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

function getTimelineChipLabel(item: AboutAttribute) {
  const typeKey = normalizeAttributeKey(item.attributeType || item.typeKey);
  const typeCategoryLabel = toTitleWords(getSafeAttributeText(item.attributeTypeCategory));
  const detail = getSafeAttributeText(item.attributeDetail || item.valueText || item.label);
  const primary = typeCategoryLabel || toTitleWords(typeKey) || "Attribute";
  if (detail) return `${primary}: ${detail}`;
  return primary;
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

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.18" />
      <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2zm7 1.2V8h3.3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8.5 12.2h7M8.5 15h7M8.5 17.8h4.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PhotoDetailHeader({
  onClose,
  onViewLarge,
  viewLabel = "View Large",
}: {
  onClose: () => void;
  onViewLarge: () => void;
  viewLabel?: string;
}) {
  return (
    <div className="person-photo-detail-head">
      <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Edit Photo</h4>
      <div className="settings-chip-list">
        <button type="button" className="button secondary tap-button" onClick={onViewLarge}>
          {viewLabel}
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
  saveLabel = "Save Changes",
}: {
  dirty: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
  saveLabel?: string;
}) {
  return (
    <div className="photo-save-sticky-bar">
      <ModalActionBar
        actions={
          <>
            <AsyncActionButton type="button" tone="secondary" disabled={saving} onClick={onCancel}>
              Cancel
            </AsyncActionButton>
            <AsyncActionButton
              type="button"
              pending={saving}
              pendingLabel="Saving..."
              disabled={!dirty || saving}
              onClick={onSave}
            >
              {saveLabel}
            </AsyncActionButton>
          </>
        }
      />
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
  canManageRelationshipType = false,
  person,
  people,
  edges,
  households,
  onClose,
  onSaved,
  onEditHousehold,
}: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>("contact");
  const [editingSection, setEditingSection] = useState<ProfileSectionKey | null>(null);
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
  const [showStoryImportModal, setShowStoryImportModal] = useState(false);
  const [storyImportText, setStoryImportText] = useState("");
  const [storyImportBusy, setStoryImportBusy] = useState(false);
  const [storyImportStatus, setStoryImportStatus] = useState("");
  const [storyImportPromptPreview, setStoryImportPromptPreview] = useState("");
  const [storyImportDrafts, setStoryImportDrafts] = useState<AiStoryImportProposal[]>([]);
  const [storyImportDraftIndex, setStoryImportDraftIndex] = useState(0);
  const [storyWorkspaceStep, setStoryWorkspaceStep] = useState<StoryWorkspaceStep>(1);
  const [storyWorkspaceDrafts, setStoryWorkspaceDrafts] = useState<StoryWorkspaceDraft[]>([]);
  const [storyWorkspaceDraftIndex, setStoryWorkspaceDraftIndex] = useState(0);
  const [storyImportHints, setStoryImportHints] = useState<StoryImportHints>({
    titleHint: "",
    startDate: "",
    endDate: "",
    attributeType: "",
    attributeTypeCategory: "",
  });
  const [storyChatMessages, setStoryChatMessages] = useState<StoryChatMessage[]>([]);
  const [storyChatInput, setStoryChatInput] = useState("");
  const [storyChatBusy, setStoryChatBusy] = useState(false);
  const [storyChatStatus, setStoryChatStatus] = useState("");
  const [storyChatSuggestion, setStoryChatSuggestion] = useState<StoryChatSuggestion | null>(null);
  const [parent1Id, setParent1Id] = useState("");
  const [parent2Id, setParent2Id] = useState("");
  const [spouseId, setSpouseId] = useState("");
  const [divorceSpouseId, setDivorceSpouseId] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [familyTouched, setFamilyTouched] = useState(false);
  const [storedFamilyGroupRelationshipType, setStoredFamilyGroupRelationshipType] = useState<FamilyGroupRelationshipType>("undeclared");
  const [familyRelationshipTypeBusy, setFamilyRelationshipTypeBusy] = useState(false);
  const [localPeople, setLocalPeople] = useState<PersonItem[]>(people);
  const [attributes, setAttributes] = useState<PersonAttribute[]>([]);
  const [aboutAttributes, setAboutAttributes] = useState<AboutAttribute[]>([]);
  const [selectedPhotoFileId, setSelectedPhotoFileId] = useState("");
  const [draftMeta, setDraftMeta] = useState<DraftMeta>({ label: "", description: "", date: "", isPrimary: false });
  const [tagQuery, setTagQuery] = useState("");
  const [taggedPeople, setTaggedPeople] = useState<Array<{ personId: string; displayName: string }>>([]);
  const [pendingOps, setPendingOps] = useState<Set<string>>(new Set());
  const [failedDirectPreviewFileIds, setFailedDirectPreviewFileIds] = useState<Set<string>>(new Set());
  const [failedDirectOriginalFileIds, setFailedDirectOriginalFileIds] = useState<Set<string>>(new Set());
  const [largePhotoFileId, setLargePhotoFileId] = useState("");
  const [largePhotoIsVideo, setLargePhotoIsVideo] = useState(false);
  const [largePhotoIsDocument, setLargePhotoIsDocument] = useState(false);
  const personStatusTone = inferStatusTone(status);
  const [largePhotoIsAudio, setLargePhotoIsAudio] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [personPhotoQuery, setPersonPhotoQuery] = useState("");
  const [selectedPhotoAssociationsBusy, setSelectedPhotoAssociationsBusy] = useState(false);
  const [selectedPhotoAssociations, setSelectedPhotoAssociations] = useState<{
    people: Array<{ personId: string; displayName: string }>;
    households: Array<{ householdId: string; label: string }>;
  }>({ people: [], households: [] });
  const [photoAssociationStatus, setPhotoAssociationStatus] = useState("");
  const [showPhotoDetail, setShowPhotoDetail] = useState(false);
  const [showMediaAttachWizard, setShowMediaAttachWizard] = useState(false);
  const [showAddSpouse, setShowAddSpouse] = useState(false);
  const [showAttributeAddModal, setShowAttributeAddModal] = useState(false);
  const [selectedAboutAttributeId, setSelectedAboutAttributeId] = useState("");
  const [familyGroupOptions, setFamilyGroupOptions] = useState<FamilyGroupOption[]>([]);
  const [personEnabledFamilyGroupKeys, setPersonEnabledFamilyGroupKeys] = useState<string[]>([]);
  const [familySwitchBusy, setFamilySwitchBusy] = useState(false);
  const [activeTenantKey, setActiveTenantKey] = useState(tenantKey);
  const [contextEdges, setContextEdges] = useState<GraphEdge[]>(edges);
  const [contextHouseholds, setContextHouseholds] = useState<HouseholdLink[]>(households);
  const [attributeLaunchSource, setAttributeLaunchSource] = useState<AttributeLaunchSource>("main_events");
  const [timelineSortOrder, setTimelineSortOrder] = useState<"asc" | "desc">("asc");
  const [eventCategoryColorByKey, setEventCategoryColorByKey] = useState<Record<string, string>>({});
  const [eventDefinitions, setEventDefinitions] = useState<AttributeEventDefinitions>(defaultAttributeDefinitions());
  const [newSpouseFirstName, setNewSpouseFirstName] = useState("");
  const [newSpouseMiddleName, setNewSpouseMiddleName] = useState("");
  const [newSpouseLastName, setNewSpouseLastName] = useState("");
  const [newSpouseNickName, setNewSpouseNickName] = useState("");
  const [newSpouseDisplayName, setNewSpouseDisplayName] = useState("");
  const [newSpouseMaidenName, setNewSpouseMaidenName] = useState("");
  const [newSpouseBirthDate, setNewSpouseBirthDate] = useState("");
  const [newSpouseGender, setNewSpouseGender] = useState<"male" | "female" | "unspecified">("unspecified");
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
  const peopleNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of localPeople) {
      const personId = item.personId.trim();
      if (!personId) continue;
      const displayName = item.displayName.trim() || personId;
      map.set(personId, displayName);
    }
    if (person?.personId?.trim()) {
      map.set(person.personId.trim(), person.displayName?.trim() || person.personId.trim());
    }
    return map;
  }, [localPeople, person]);

  const parentEdges = useMemo(
    () => contextEdges.filter((edge) => (edge.label ?? "").trim().toLowerCase() === "parent"),
    [contextEdges],
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
    const match = contextHouseholds.find(
      (item) => item.partner1PersonId === person.personId || item.partner2PersonId === person.personId,
    );
    return match?.id ?? "";
  }, [contextHouseholds, person]);
  const spouseByPersonId = useMemo(() => {
    const map = new Map<string, string>();
    contextHouseholds.forEach((unit) => {
      if (!unit.partner1PersonId || !unit.partner2PersonId) {
        return;
      }
      map.set(unit.partner1PersonId, unit.partner2PersonId);
      map.set(unit.partner2PersonId, unit.partner1PersonId);
    });
    return map;
  }, [contextHouseholds]);
  const spouseByRelationshipId = useMemo(() => {
    if (!person) return "";
    for (const edge of edges) {
      const relType = (edge.label ?? "").trim().toLowerCase();
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
  const primaryPhoneAction = phoneActionItems[0] ?? null;
  const emailActionHref = email.trim() ? `mailto:${email.trim()}` : "";
  const attributeLaunchMeta = useMemo(() => {
    if (attributeLaunchSource === "main_events") {
      return { label: "Main Events", initialTypeKey: "life_event", initialTypeCategory: "", addTitle: "Add Event" };
    }
    if (attributeLaunchSource === "things") {
      return { label: "Things About", initialTypeKey: "physical_attribute", initialTypeCategory: "", addTitle: "Add Attribute" };
    }
    if (attributeLaunchSource === "stories") {
      return { label: "Stories", initialTypeKey: "life_event", initialTypeCategory: "story", addTitle: "Add Story" };
    }
    return { label: "Timeline", initialTypeKey: "life_event", initialTypeCategory: "", addTitle: "Add Event" };
  }, [attributeLaunchSource]);
  const currentStoryImportDraft = useMemo(
    () => storyImportDrafts[storyImportDraftIndex] ?? null,
    [storyImportDraftIndex, storyImportDrafts],
  );
  const storyImportDraftTitle = useMemo(() => {
    if (!currentStoryImportDraft) {
      return attributeLaunchMeta.addTitle;
    }
    return `Review AI Draft ${storyImportDraftIndex + 1} of ${storyImportDrafts.length}`;
  }, [attributeLaunchMeta.addTitle, currentStoryImportDraft, storyImportDraftIndex, storyImportDrafts.length]);
  const currentWorkspaceDraft = useMemo(
    () => storyWorkspaceDrafts[storyWorkspaceDraftIndex] ?? null,
    [storyWorkspaceDraftIndex, storyWorkspaceDrafts],
  );
  const workspaceTypeOptionsByKind = useMemo(() => {
    const byKind: Record<"descriptor" | "event", Array<{ value: string; label: string }>> = {
      descriptor: [],
      event: [],
    };
    for (const row of eventDefinitions.categories ?? []) {
      if (!row?.isEnabled) continue;
      const key = normalizeAttributeKey(row.categoryKey);
      const kind = row.kind === "event" ? "event" : "descriptor";
      if (!key) continue;
      byKind[kind].push({
        value: key,
        label: String(row.categoryLabel || toTitleWords(key) || "Type"),
      });
    }
    byKind.descriptor.sort((a, b) => a.label.localeCompare(b.label));
    byKind.event.sort((a, b) => a.label.localeCompare(b.label));
    return byKind;
  }, [eventDefinitions]);
  const workspaceTypeCategoryOptionsByType = useMemo(() => {
    const map = new Map<string, Array<{ value: string; label: string; detailLabel: string }>>();
    for (const row of eventDefinitions.types ?? []) {
      if (!row?.isEnabled) continue;
      const typeGroupKey = makeAttributeDefinitionCategoryId(
        row.kind === "event" ? "event" : "descriptor",
        normalizeAttributeKey(row.categoryKey),
      );
      const options = map.get(typeGroupKey) ?? [];
      options.push({
        value: normalizeAttributeKey(row.typeKey),
        label: String(row.typeLabel || toTitleWords(row.typeKey) || "Type"),
        detailLabel: String(row.detailLabel || "Attribute Detail"),
      });
      map.set(typeGroupKey, options);
    }
    for (const [key, options] of map) {
      options.sort((a, b) => a.label.localeCompare(b.label));
      map.set(key, options);
    }
    return map;
  }, [eventDefinitions]);
  const currentWorkspaceTypeOptions = useMemo(() => {
    if (!currentWorkspaceDraft) return [] as Array<{ value: string; label: string }>;
    const kind = currentWorkspaceDraft.attributeKind === "event" ? "event" : "descriptor";
    return workspaceTypeOptionsByKind[kind];
  }, [currentWorkspaceDraft, workspaceTypeOptionsByKind]);
  const currentWorkspaceTypeCategoryOptions = useMemo(() => {
    if (!currentWorkspaceDraft) return [] as Array<{ value: string; label: string; detailLabel: string }>;
    const kind = currentWorkspaceDraft.attributeKind === "event" ? "event" : "descriptor";
    const typeKey = normalizeAttributeKey(currentWorkspaceDraft.attributeType);
    if (!typeKey) return [] as Array<{ value: string; label: string; detailLabel: string }>;
    return workspaceTypeCategoryOptionsByType.get(makeAttributeDefinitionCategoryId(kind, typeKey)) ?? [];
  }, [currentWorkspaceDraft, workspaceTypeCategoryOptionsByType]);
  const workspaceDetailSuggestionOptions = useMemo(() => {
    if (!currentWorkspaceDraft) return [] as string[];
    const selectedType = normalizeAttributeKey(currentWorkspaceDraft.attributeType);
    const selectedTypeCategory = normalizeAttributeKey(currentWorkspaceDraft.attributeTypeCategory);
    const options = new Set<string>();
    for (const item of aboutAttributes) {
      const type = normalizeAttributeKey(item.attributeType || item.typeKey);
      const typeCategory = normalizeAttributeKey(item.attributeTypeCategory);
      if (type !== selectedType) continue;
      if (selectedTypeCategory && typeCategory && typeCategory !== selectedTypeCategory) continue;
      const detail = getSafeAttributeText(item.attributeDetail || item.valueText || item.label);
      if (detail) {
        options.add(detail);
      }
    }
    for (const item of storyWorkspaceDrafts) {
      if (item.localId === currentWorkspaceDraft.localId) continue;
      const type = normalizeAttributeKey(item.attributeType);
      const typeCategory = normalizeAttributeKey(item.attributeTypeCategory);
      if (type !== selectedType) continue;
      if (selectedTypeCategory && typeCategory && typeCategory !== selectedTypeCategory) continue;
      const detail = getSafeAttributeText(item.attributeDetail || item.label);
      if (detail) {
        options.add(detail);
      }
    }
    return Array.from(options).slice(0, 40);
  }, [aboutAttributes, currentWorkspaceDraft, storyWorkspaceDrafts]);
  const currentWorkspaceDetailLabel = useMemo(() => {
    if (!currentWorkspaceDraft) return "Title / Detail";
    const selectedTypeCategory = normalizeAttributeKey(currentWorkspaceDraft.attributeTypeCategory);
    if (!selectedTypeCategory) return "Title / Detail";
    const option = currentWorkspaceTypeCategoryOptions.find((item) => normalizeAttributeKey(item.value) === selectedTypeCategory);
    return option?.detailLabel || "Title / Detail";
  }, [currentWorkspaceDraft, currentWorkspaceTypeCategoryOptions]);

  const resetProfileEditorState = (nextPerson: PersonItem, clearStatus = true) => {
    setDisplayName(nextPerson.displayName || "");
    setFirstName(nextPerson.firstName || "");
    setMiddleName(nextPerson.middleName || "");
    setLastName(nextPerson.lastName || "");
    setMaidenName(nextPerson.maidenName || "");
    setNickName(nextPerson.nickName || "");
    setBirthDate(nextPerson.birthDate || "");
    setGender(nextPerson.gender || "unspecified");
    setPhones(formatUsPhoneForEdit(nextPerson.phones || ""));
    setEmail(nextPerson.email || "");
    setAddress(nextPerson.address || "");
    setHobbies(nextPerson.hobbies || "");
    setNotes(nextPerson.notes || "");
    const initialParent1Id = parentSelection.motherId;
    const initialParent2Id = parentSelection.fatherId;
    setParent1Id(initialParent1Id);
    setParent2Id(initialParent2Id);
    const partner = contextHouseholds.find((item) => item.partner1PersonId === nextPerson.personId || item.partner2PersonId === nextPerson.personId);
    let initialSpouseId = "";
    if (partner) {
      initialSpouseId = partner.partner1PersonId === nextPerson.personId ? partner.partner2PersonId : partner.partner1PersonId;
      setSpouseId(initialSpouseId);
    } else {
      initialSpouseId = spouseByRelationshipId;
      setSpouseId(initialSpouseId);
    }
    setDivorceSpouseId("");
    initialFamilyRef.current = {
      parent1Id: normalizeId(initialParent1Id),
      parent2Id: normalizeId(initialParent2Id),
      spouseId: normalizeId(initialSpouseId),
    };
    setFamilyTouched(false);
    setShowAddSpouse(false);
    setNewSpouseFirstName("");
    setNewSpouseMiddleName("");
    setNewSpouseLastName("");
    setNewSpouseNickName("");
    setNewSpouseDisplayName("");
    setNewSpouseMaidenName("");
    setNewSpouseBirthDate("");
    setNewSpouseGender(oppositeGender(nextPerson.gender || "unspecified"));
    pendingCreatedSpouseIdRef.current = "";
    setEditingSection(null);
    if (clearStatus) {
      setStatus("");
    }
    setPersonEnabledFamilyGroupKeys([normalizeFamilyGroupKey(tenantKey)]);
    setStoredFamilyGroupRelationshipType(
      normalizeFamilyGroupRelationshipType(
        peopleById.get(nextPerson.personId)?.familyGroupRelationshipType ?? nextPerson.familyGroupRelationshipType,
      ),
    );
  };

  useEffect(() => {
    setLocalPeople(people);
    setContextEdges(edges);
    setContextHouseholds(households);
    setActiveTenantKey(tenantKey);
  }, [edges, households, people, tenantKey]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const loadDefinitions = async () => {
      const res = await fetch(`/api/t/${encodeURIComponent(activeTenantKey)}/attribute-definitions`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.definitions || cancelled) return;
      const defs = body.definitions as AttributeEventDefinitions;
      setEventDefinitions(defs);
      const next: Record<string, string> = {};
      for (const row of defs.categories ?? []) {
        const key = normalizeAttributeKey(row.categoryKey);
        const color = String(row.categoryColor ?? "").trim() || "#e5e7eb";
        if (key) next[key] = color;
      }
      setEventCategoryColorByKey(next);
    };
    void loadDefinitions();
    return () => {
      cancelled = true;
    };
  }, [activeTenantKey, open]);

  const fallbackAvatar = (person?.gender ?? "unspecified") === "female"
    ? "/placeholders/avatar-female.png"
    : "/placeholders/avatar-male.png";
  const headerAvatar = person?.photoFileId ? getPhotoAvatarProxyPath(person.photoFileId, activeTenantKey) : fallbackAvatar;
  const allMediaAttributes = attributes.filter((item) => {
    const type = item.attributeType.toLowerCase();
    return type === "photo" || type === "media" || type === "audio" || type === "video";
  });
  const mediaByFileId = useMemo(() => {
    const map = new Map<string, PersonAttribute>();
    for (const item of allMediaAttributes) {
      const fileId = item.valueText.trim();
      if (!fileId || map.has(fileId)) continue;
      map.set(fileId, item);
    }
    return map;
  }, [allMediaAttributes]);
  const getPersonMediaPreviewSrc = (item: PersonAttribute) =>
    item.previewUrl && !failedDirectPreviewFileIds.has(item.valueText)
      ? item.previewUrl
      : item.originalUrl && !failedDirectOriginalFileIds.has(item.valueText)
        ? item.originalUrl
        : getPhotoPreviewProxyPath(item.valueText, item.mediaMetadata || item.valueJson, activeTenantKey);
  const getPersonMediaOriginalSrc = (item: PersonAttribute) =>
    item.originalUrl && !failedDirectOriginalFileIds.has(item.valueText)
      ? item.originalUrl
      : getPhotoProxyPath(item.valueText, activeTenantKey);
  const largePhotoSelectedItem = useMemo(
    () => (largePhotoFileId ? mediaByFileId.get(largePhotoFileId) ?? null : null),
    [largePhotoFileId, mediaByFileId],
  );
  const largePhotoOriginalSrc = largePhotoSelectedItem
    ? getPersonMediaOriginalSrc(largePhotoSelectedItem)
    : getPhotoProxyPath(largePhotoFileId, activeTenantKey);
  const loadPersonAttributeState = async (personId: string, scopedTenantKey = activeTenantKey) => {
    const res = await fetch(
      `/api/t/${encodeURIComponent(scopedTenantKey)}/attributes?entity_type=person&entity_id=${encodeURIComponent(personId)}`,
      { cache: "no-store" },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setStatus(`Attribute load failed: ${res.status}`);
      return;
    }
    const canonicalAttributes = Array.isArray(body?.attributes) ? (body.attributes as AttributeWithMedia[]) : [];
    setAboutAttributes(canonicalAttributes as AboutAttribute[]);
    const canonicalPrimaryPhotoFileId = person?.photoFileId ?? "";
    const attributeMedia = toPersonMediaAttributes(canonicalAttributes, canonicalPrimaryPhotoFileId);
    const existingFileIds = new Set(attributeMedia.map((item) => item.valueText.trim()).filter(Boolean));
    const directMediaLinks = Array.isArray(body?.directMediaLinks)
      ? (body.directMediaLinks as Array<Record<string, unknown>>)
      : [];
    const directPersonMedia: PersonAttribute[] = [];
    for (const rawLink of directMediaLinks) {
      const fileId = String(rawLink.fileId ?? "").trim();
      if (!fileId || existingFileIds.has(fileId)) {
        continue;
      }
      existingFileIds.add(fileId);
      directPersonMedia.push({
        attributeId: String(rawLink.linkId ?? `direct-link:${fileId}`),
        attributeType: "media",
        valueText: fileId,
        valueJson: String(rawLink.mediaMetadata ?? "").trim(),
        mediaMetadata: String(rawLink.mediaMetadata ?? "").trim(),
        label: String(rawLink.label ?? "").trim(),
        isPrimary: Boolean(canonicalPrimaryPhotoFileId) && fileId === canonicalPrimaryPhotoFileId.trim(),
        sortOrder: Number(rawLink.sortOrder ?? 0) || 0,
        startDate: String(rawLink.photoDate ?? "").trim(),
        notes: String(rawLink.description ?? "").trim(),
        sourceProvider: String(rawLink.sourceProvider ?? "").trim(),
        originalObjectKey: String(rawLink.originalObjectKey ?? "").trim(),
        thumbnailObjectKey: String(rawLink.thumbnailObjectKey ?? "").trim(),
        previewUrl: String(rawLink.previewUrl ?? "").trim(),
        originalUrl: String(rawLink.originalUrl ?? "").trim(),
      });
    }
    const mergedMedia = [...attributeMedia, ...directPersonMedia].sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) {
        return Number(b.isPrimary) - Number(a.isPrimary);
      }
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      if (a.startDate !== b.startDate) {
        return (b.startDate || "").localeCompare(a.startDate || "");
      }
      return a.valueText.localeCompare(b.valueText);
    });
    setAttributes(mergedMedia);
    setFailedDirectPreviewFileIds(new Set());
    setFailedDirectOriginalFileIds(new Set());
  };

  const clearStoryImportQueue = () => {
    setStoryImportDrafts([]);
    setStoryImportDraftIndex(0);
    setStoryWorkspaceDrafts([]);
    setStoryWorkspaceDraftIndex(0);
  };

  const clearStoryChatState = () => {
    setStoryChatMessages([]);
    setStoryChatInput("");
    setStoryChatBusy(false);
    setStoryChatStatus("");
    setStoryChatSuggestion(null);
    setStoryImportHints({
      titleHint: "",
      startDate: "",
      endDate: "",
      attributeType: "",
      attributeTypeCategory: "",
    });
    setStoryWorkspaceStep(1);
  };

  const openStoryImportModal = () => {
    setStoryImportText(stripStorySeedPrefix(notes.trim() || person?.notes || ""));
    setStoryImportStatus("");
    setStoryImportPromptPreview("");
    clearStoryChatState();
    setShowStoryImportModal(true);
  };

  const cancelStoryImportQueue = (message = "") => {
    clearStoryImportQueue();
    setShowAttributeAddModal(false);
    setSelectedAboutAttributeId("");
    if (message) {
      setStatus(message);
    }
  };

  const generateStoryImportDrafts = async () => {
    if (!person?.personId) return;
    const sourceText = storyImportText.trim();
    if (!sourceText) {
      setStoryImportStatus("Story text is required.");
      return;
    }

    setStoryImportBusy(true);
    setStoryImportStatus("Generating drafts...");
    const transcript = storyChatMessages
      .map((message) => `${message.role === "user" ? "User" : "AI"}: ${message.content.trim()}`)
      .filter(Boolean)
      .join("\n");
    const pendingUserPrompt = storyChatInput.trim();
    const guidanceText = [transcript, pendingUserPrompt]
      .filter(Boolean)
      .join("\n")
      .trim();
    const res = await fetch(
      `/api/t/${encodeURIComponent(activeTenantKey)}/people/${encodeURIComponent(person.personId)}/story-import`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceText,
          hints: {
            ...storyImportHints,
            refinementPrompt: guidanceText,
          },
        }),
      },
    );
    const body = await res.json().catch(() => null);
    setStoryImportPromptPreview(String(body?.prompt ?? "").trim());
    if (!res.ok) {
      setStoryImportBusy(false);
      setStoryImportStatus(String(body?.message || body?.error || `Story import failed (${res.status}).`).slice(0, 220));
      return;
    }

    const proposals = Array.isArray(body?.proposals) ? (body.proposals as AiStoryImportProposal[]) : [];
    setStoryImportBusy(false);
    if (proposals.length === 0) {
      setStoryImportStatus("AI did not find any supported attributes to propose from that story text.");
      return;
    }

    setStoryImportDrafts(proposals);
    setStoryImportDraftIndex(0);
    setStoryWorkspaceDrafts(
      proposals.map((proposal, index) => ({
        ...proposal,
        localId: `${proposal.proposalId || "proposal"}-${index}`,
        selected: true,
        saveBusy: false,
        saveStatus: "",
      })),
    );
    setStoryWorkspaceDraftIndex(0);
    setStoryImportStatus(`AI prepared ${proposals.length} potential attributes/stories below. Review Step 1 then Step 2 to save.`);
  };

  const updateStoryWorkspaceDraft = (localId: string, patch: Partial<StoryWorkspaceDraft>) => {
    setStoryWorkspaceDrafts((current) =>
      current.map((draft) => (draft.localId === localId ? { ...draft, ...patch } : draft)),
    );
  };

  const consolidateSelectedWorkspaceDrafts = () => {
    const selected = storyWorkspaceDrafts.filter((item) => item.selected);
    if (selected.length < 2) {
      setStoryImportStatus("Select at least two items to consolidate.");
      return;
    }
    const first = selected[0];
    const mergedNotes = selected
      .map((item, index) => `Item ${index + 1}: ${item.attributeNotes || item.attributeDetail || item.label || ""}`)
      .join("\n\n");
    const keepIds = new Set(storyWorkspaceDrafts.filter((item) => !item.selected).map((item) => item.localId));
    keepIds.add(first.localId);
    setStoryWorkspaceDrafts((current) =>
      current
        .filter((item) => keepIds.has(item.localId))
        .map((item) =>
          item.localId === first.localId
            ? {
                ...item,
                attributeKind: "event",
                attributeType: "life_event",
                attributeTypeCategory: "story",
                attributeDetail: first.attributeDetail || first.label || "Combined Story",
                attributeNotes: mergedNotes,
                selected: false,
              }
            : item,
        ),
    );
    setStoryImportStatus(`Consolidated ${selected.length} selected items into one story draft.`);
  };

  const saveWorkspaceDraft = async (localId: string) => {
    if (!person?.personId) return;
    const draft = storyWorkspaceDrafts.find((item) => item.localId === localId);
    if (!draft) return;
    if (!draft.attributeDetail.trim()) {
      updateStoryWorkspaceDraft(localId, { saveStatus: "Detail is required." });
      return;
    }
    if (draft.attributeKind === "event" && !draft.attributeDate.trim()) {
      updateStoryWorkspaceDraft(localId, { saveStatus: "Date is required for event." });
      return;
    }
    updateStoryWorkspaceDraft(localId, { saveBusy: true, saveStatus: "Saving..." });
    const payload = {
      entityType: "person",
      entityId: person.personId,
      category: draft.attributeKind,
      attributeKind: draft.attributeKind,
      isDateRelated: draft.attributeKind === "event",
      attributeType: draft.attributeType,
      attributeTypeCategory: draft.attributeTypeCategory,
      attributeDate: draft.attributeDate,
      dateIsEstimated: draft.dateIsEstimated,
      ...(draft.dateIsEstimated && draft.estimatedTo ? { estimatedTo: draft.estimatedTo } : {}),
      attributeDetail: draft.attributeDetail,
      attributeNotes: draft.attributeNotes,
      endDate: draft.endDate,
      typeKey: draft.attributeType,
      label: draft.label,
      valueText: draft.attributeDetail,
      dateStart: draft.attributeDate,
      dateEnd: draft.endDate,
      notes: draft.attributeNotes,
    };
    const res = await fetch("/api/attributes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      updateStoryWorkspaceDraft(localId, {
        saveBusy: false,
        saveStatus: String(body?.message || body?.error || `Save failed (${res.status})`).slice(0, 180),
      });
      return;
    }
    updateStoryWorkspaceDraft(localId, { saveBusy: false, saveStatus: "Saved." });
    void loadPersonAttributeState(person.personId);
    onSaved();
  };

  const requestStoryChatSuggestion = async () => {
    if (!person?.personId) return;
    const sourceText = storyImportText.trim();
    if (!sourceText) {
      setStoryChatStatus("Story text is required before chat.");
      return;
    }
    const prompt = storyChatInput.trim();
    if (!prompt) {
      setStoryChatStatus("Ask a question for AI.");
      return;
    }
    const nextMessages = [...storyChatMessages, { role: "user", content: prompt }] as StoryChatMessage[];
    setStoryChatBusy(true);
    setStoryChatStatus("AI is thinking...");
    const res = await fetch(
      `/api/t/${encodeURIComponent(activeTenantKey)}/people/${encodeURIComponent(person.personId)}/story-chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storyText: sourceText,
          messages: nextMessages,
        }),
      },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setStoryChatBusy(false);
      setStoryChatStatus(String(body?.message || body?.error || `Story chat failed (${res.status}).`).slice(0, 220));
      return;
    }
    const answerText = String(body?.answer || "").trim();
    const assistantMessage = answerText ? [{ role: "assistant", content: answerText } as StoryChatMessage] : [];
    setStoryChatMessages([...nextMessages, ...assistantMessage]);
    setStoryChatBusy(false);
    setStoryChatStatus("");
    const suggestion = body?.suggestion as StoryChatSuggestion | undefined;
    if (suggestion) {
      setStoryChatSuggestion({
        titleHint: String(suggestion.titleHint || ""),
        startDate: String(suggestion.startDate || ""),
        endDate: String(suggestion.endDate || ""),
        attributeKind: suggestion.attributeKind === "descriptor" ? "descriptor" : "event",
        attributeType: String(suggestion.attributeType || ""),
        attributeTypeCategory: String(suggestion.attributeTypeCategory || ""),
        reasoning: String(suggestion.reasoning || ""),
      });
    }
  };

  const applyStoryChatSuggestion = () => {
    if (!storyChatSuggestion) return;
    setStoryImportHints({
      titleHint: storyChatSuggestion.titleHint || "",
      startDate: storyChatSuggestion.startDate || "",
      endDate: storyChatSuggestion.endDate || "",
      attributeType: storyChatSuggestion.attributeType || "",
      attributeTypeCategory: storyChatSuggestion.attributeTypeCategory || "",
    });
    setStoryChatStatus("Applied AI suggestion for next draft generation.");
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
    resetProfileEditorState(person);
    setShowStoryImportModal(false);
    setStoryImportText(stripStorySeedPrefix(person.notes || ""));
    setStoryImportStatus("");
    clearStoryChatState();
    clearStoryImportQueue();
    setSelectedPhotoFileId("");
    setDraftMeta({ label: "", description: "", date: "", isPrimary: false });
    setTagQuery("");
    setTaggedPeople([]);
    setPendingOps(new Set());
    setLargePhotoFileId("");
    setLargePhotoIsVideo(false);
    setLargePhotoIsDocument(false);
    setLargePhotoIsAudio(false);
    setPhotoBusy(false);
    setPersonPhotoQuery("");
    setPhotoAssociationStatus("");
    setShowPhotoDetail(false);
    setSelectedAboutAttributeId("");
    void loadPersonAttributeState(person.personId, tenantKey);
  }, [open, peopleById, person, contextHouseholds, parentSelection, spouseByRelationshipId, tenantKey]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const res = await fetch("/api/family-groups", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) return;
      const list = Array.isArray(body?.familyGroups)
        ? (body.familyGroups as Array<{ key: string; name: string; role: "ADMIN" | "USER" }>)
        : [];
      setFamilyGroupOptions(list.filter((item) => item.key && item.name));
    })();
  }, [open]);

  useEffect(() => {
    if (!open || !person?.personId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetch(
        `/api/t/${encodeURIComponent(activeTenantKey)}/people/${encodeURIComponent(person.personId)}`,
        { cache: "no-store" },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok || cancelled) {
        return;
      }
      const keys = Array.isArray(body?.enabledFamilyGroupKeys)
        ? (body.enabledFamilyGroupKeys as string[]).map((item) => normalizeFamilyGroupKey(item)).filter(Boolean)
        : [];
      const normalizedActiveKey = normalizeFamilyGroupKey(activeTenantKey);
      const nextKeys = Array.from(new Set([normalizedActiveKey, ...keys]));
      setPersonEnabledFamilyGroupKeys(nextKeys);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTenantKey, open, person?.personId]);

  const personOptions = localPeople.filter((item) => item.personId !== person?.personId);
  const childBirthDate = birthDate || person?.birthDate;
  const motherOptions = useMemo(() => {
    const base = personOptions.filter(
      (item) =>
        isAnchorFamilyGroupRelationshipType(item.familyGroupRelationshipType) &&
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
        isAnchorFamilyGroupRelationshipType(item.familyGroupRelationshipType) &&
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

  const marriedAttribute = useMemo(() => {
    const rows = aboutAttributes.filter((item) => normalizeAttributeKey(item.attributeType || item.typeKey) === "family_relationship");
    return rows.find((item) => normalizeAttributeKey(item.attributeTypeCategory) === "married") ?? null;
  }, [aboutAttributes]);
  const marriedDateText = useMemo(() => {
    const raw = marriedAttribute?.attributeDate || "";
    if (!raw) return "";
    const formatted = formatDisplayDate(raw);
    return formatted === "-" ? "" : formatted;
  }, [marriedAttribute]);
  const deathDateValue = useMemo(() => {
    return getDeathDateFromAttributes(aboutAttributes) || person?.deathDate || "";
  }, [aboutAttributes, person?.deathDate]);
  const deathDateText = useMemo(() => {
    const raw = deathDateValue;
    if (!raw) return "";
    const formatted = formatDisplayDate(raw);
    return formatted === "-" ? "" : formatted;
  }, [deathDateValue]);
  const yearsMarriedText = useMemo(() => computeYearsSince(marriedAttribute?.attributeDate || ""), [marriedAttribute]);
  const chipColorStyle = (rawTypeKey: string) => {
    const color = eventCategoryColorByKey[normalizeAttributeKey(rawTypeKey)] || "#d9e2ec";
    return {
      borderColor: color,
      background: `${color}33`,
    } as const;
  };
  const timelineItems = useMemo(() => {
    const filtered = aboutAttributes.filter((item) => {
      const typeKey = normalizeAttributeKey(item.attributeType || item.typeKey);
      const itemKind = item.category ?? (
        EVENT_FALLBACK_TYPE_KEYS.includes(typeKey)
          ? "event"
          : "descriptor"
      );
      const hasDate = Boolean(parseDate(item.attributeDate)?.getTime() || parseDate(item.endDate)?.getTime());
      return itemKind === "event" && hasDate && !["photo", "media", "audio", "video", "in_law"].includes(typeKey);
    });
    const toDateMs = (item: AboutAttribute) =>
      parseDate(item.attributeDate)?.getTime()
      ?? parseDate(item.endDate)?.getTime()
      ?? parseDate(item.createdAt)?.getTime()
      ?? Number.NaN;

    return filtered.sort((a, b) => {
      const aMs = toDateMs(a);
      const bMs = toDateMs(b);
      const aHas = Number.isFinite(aMs);
      const bHas = Number.isFinite(bMs);
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      if (aHas && bHas) {
        return timelineSortOrder === "asc" ? aMs - bMs : bMs - aMs;
      }
      return getTimelineChipLabel(a).localeCompare(getTimelineChipLabel(b));
    });
  }, [aboutAttributes, timelineSortOrder]);
  const storyItems = useMemo(() => {
    return aboutAttributes.filter((item) => {
      const typeCategory = normalizeAttributeKey(item.attributeTypeCategory);
      const typeKey = normalizeAttributeKey(item.attributeType || item.typeKey);
      const itemKind = item.category ?? (
        EVENT_FALLBACK_TYPE_KEYS.includes(typeKey)
          ? "event"
          : "descriptor"
      );
      return itemKind === "event" && typeCategory === "story";
    });
  }, [aboutAttributes]);
  const displayedFamilyGroupRelationshipType = useMemo<FamilyGroupRelationshipType>(() => {
    if (storedFamilyGroupRelationshipType === "founder" || storedFamilyGroupRelationshipType === "direct") {
      return storedFamilyGroupRelationshipType;
    }
    if (!familyTouched) {
      return storedFamilyGroupRelationshipType;
    }
    if (parentIds.length > 0) {
      return "direct";
    }
    const spouseRelationshipType = normalizeFamilyGroupRelationshipType(
      localPeople.find((item) => item.personId === spouseId)?.familyGroupRelationshipType,
    );
    if (spouseId && isAnchorFamilyGroupRelationshipType(spouseRelationshipType)) {
      return "in_law";
    }
    return "undeclared";
  }, [familyTouched, localPeople, parentIds.length, spouseId, storedFamilyGroupRelationshipType]);
  const isFounderPerson = displayedFamilyGroupRelationshipType === "founder";
  const isInLawPerson = displayedFamilyGroupRelationshipType === "in_law";
  const isUndeclaredPerson = displayedFamilyGroupRelationshipType === "undeclared";
  const familyRelationshipHint = useMemo(() => {
    if (isUndeclaredPerson) {
      return "This person belongs to the family group but is not yet placed in the tree. Add a direct parent or marry into a direct/founder line to place them.";
    }
    if (isFounderPerson) {
      return "Founders anchor this family group. Founders cannot have parents assigned in this family.";
    }
    if (isInLawPerson) {
      return "In-laws can be spouses and parents in this family, but their own parents are not shown in this family view.";
    }
    return "";
  }, [isFounderPerson, isInLawPerson, isUndeclaredPerson]);
  const currentPersonCanAnchorMarriage = isFounderPerson || parentIds.length > 0;
  const currentPersonCanHaveSpouse = isAtLeastAge(childBirthDate, 19);
  const spouseOptions = useMemo(
    () => {
      if (!currentPersonCanHaveSpouse) {
        return [] as typeof personOptions;
      }
      const base = personOptions.filter((option) => {
        const marriedTo = spouseByPersonId.get(option.personId);
        const validAnchorMatch =
          currentPersonCanAnchorMarriage || isAnchorFamilyGroupRelationshipType(option.familyGroupRelationshipType);
        const isParent = option.personId === parent1Id || option.personId === parent2Id;
        const isOldEnough = isAtLeastAge(option.birthDate, 19);
        return (!marriedTo || marriedTo === person?.personId) && validAnchorMatch && !isParent && isOldEnough;
      });
      if (spouseId && !base.some((option) => option.personId === spouseId)) {
        const selected =
          personOptions.find((option) => option.personId === spouseId) ?? localPeople.find((option) => option.personId === spouseId);
        if (
          selected &&
          selected.personId !== person?.personId &&
          selected.personId !== parent1Id &&
          selected.personId !== parent2Id &&
          isAtLeastAge(selected.birthDate, 19)
        ) {
          return [selected, ...base];
        }
      }
      return base;
    },
    [currentPersonCanAnchorMarriage, currentPersonCanHaveSpouse, localPeople, parent1Id, parent2Id, person?.personId, personOptions, spouseByPersonId, spouseId],
  );
  const hasVisibleSpouseSelection = useMemo(
    () => Boolean(spouseId && spouseOptions.some((option) => option.personId === spouseId)),
    [spouseId, spouseOptions],
  );
  const spouseSelectValue = divorceSpouseId ? DIVORCE_SPOUSE_OPTION : spouseId;
  const canRequestDivorce = Boolean(
    isAnchorFamilyGroupRelationshipType(displayedFamilyGroupRelationshipType) &&
      (divorceSpouseId || spouseId || initialFamilyRef.current.spouseId),
  );
  const selectedSpouseName = useMemo(() => {
    const selectedId = divorceSpouseId || spouseId;
    if (!selectedId) return "-";
    const spouse = localPeople.find((item) => item.personId === selectedId);
    return spouse?.displayName || "-";
  }, [divorceSpouseId, localPeople, spouseId]);
  const marriedSummaryText = useMemo(() => {
    if (!spouseId || selectedSpouseName === "-") return "coming";
    const parts = [selectedSpouseName];
    if (marriedDateText) parts.push(marriedDateText);
    if (yearsMarriedText) parts.push(`${yearsMarriedText} years married`);
    return parts.join(", ");
  }, [marriedDateText, selectedSpouseName, spouseId, yearsMarriedText]);
  const founderCount = useMemo(
    () => localPeople.filter((item) => normalizeFamilyGroupRelationshipType(item.familyGroupRelationshipType) === "founder").length,
    [localPeople],
  );
  const linkedFamilyGroupOptions = useMemo(() => {
    const allowedKeys = new Set(personEnabledFamilyGroupKeys.map((item) => normalizeFamilyGroupKey(item)));
    return familyGroupOptions.filter((option) => allowedKeys.has(normalizeFamilyGroupKey(option.key)));
  }, [familyGroupOptions, personEnabledFamilyGroupKeys]);
  const canSwitchPersonFamilyGroup = linkedFamilyGroupOptions.length > 1;
  const activeFamilyGroupName = useMemo(() => {
    return (
      familyGroupOptions.find((option) => normalizeFamilyGroupKey(option.key) === normalizeFamilyGroupKey(activeTenantKey))?.name
      || linkedFamilyGroupOptions.find((option) => normalizeFamilyGroupKey(option.key) === normalizeFamilyGroupKey(activeTenantKey))?.name
      || activeTenantKey
    );
  }, [activeTenantKey, familyGroupOptions, linkedFamilyGroupOptions]);
  const parentSummaryText = useMemo(
    () =>
      summarizeNames(
        [
          parent1Id ? peopleNameById.get(parent1Id) ?? parent1Id : "",
          parent2Id ? peopleNameById.get(parent2Id) ?? parent2Id : "",
        ],
        isFounderPerson
          ? "Not shown for founders"
          : isInLawPerson
            ? "Visible in the direct family group"
            : "Not connected",
      ),
    [isFounderPerson, isInLawPerson, parent1Id, parent2Id, peopleNameById],
  );
  const childrenSummaryText = useMemo(() => {
    if (childIds.length === 0) {
      return "No children linked";
    }
    const names = childIds.map((childId) => peopleNameById.get(childId) ?? childId).filter(Boolean);
    if (names.length <= 3) {
      return names.join(", ");
    }
    return `${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
  }, [childIds, peopleNameById]);
  const spouseSummaryText = useMemo(() => {
    if (selectedSpouseName !== "-") {
      return selectedSpouseName;
    }
    if (!currentPersonCanHaveSpouse) {
      return "Unavailable before age 19";
    }
    return "None";
  }, [currentPersonCanHaveSpouse, selectedSpouseName]);
  const notesPreviewText = useMemo(() => {
    const trimmed = notes.trim();
    return trimmed || "No notes added yet.";
  }, [notes]);
  const activeEditSectionLabel = useMemo(() => {
    if (editingSection === "family") return "family";
    if (editingSection === "notes") return "notes";
    if (editingSection === "contact") return "contact";
    if (editingSection === "name") return "name";
    return "profile";
  }, [editingSection]);
  const applyLocalFamilyGroupRelationshipType = (personId: string, nextType: FamilyGroupRelationshipType) => {
    setLocalPeople((current) =>
      current.map((item) =>
        item.personId === personId ? { ...item, familyGroupRelationshipType: nextType } : item,
      ),
    );
    if (person?.personId === personId) {
      setStoredFamilyGroupRelationshipType(nextType);
      setFamilyTouched(false);
    }
  };
  const saveFounderDesignation = async (nextFounderValue: boolean) => {
    if (!person) return;
    setFamilyRelationshipTypeBusy(true);
    setStatus("");
    const response = await fetch(
      `/api/t/${encodeURIComponent(activeTenantKey)}/people/${encodeURIComponent(person.personId)}/family-relationship-type`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ founder: nextFounderValue }),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setFamilyRelationshipTypeBusy(false);
      setStatus(String(body?.message ?? body?.error ?? "Family relationship type update failed."));
      return;
    }
    const nextType = normalizeFamilyGroupRelationshipType(body?.familyGroupRelationshipType);
    applyLocalFamilyGroupRelationshipType(person.personId, nextType);
    setFamilyRelationshipTypeBusy(false);
    setStatus(nextFounderValue ? "Founder designation saved." : "Founder designation removed.");
    onSaved();
  };
  const saveProfileSection = async () => {
    if (!person?.personId || !editingSection) return;
    setSaving(true);
    setStatus(`Saving ${activeEditSectionLabel}...`);
    const personRes = await fetch(
      `/api/t/${encodeURIComponent(activeTenantKey)}/people/${encodeURIComponent(person.personId)}`,
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
          `/api/t/${encodeURIComponent(activeTenantKey)}/relationships/builder`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              personId: person.personId,
              parentIds: [parent1Id, parent2Id].filter(Boolean),
              childIds,
              spouseId: divorceSpouseId || spouseId,
              spouseAction: divorceSpouseId ? "divorce" : "link",
              familyChanged: true,
            }),
          },
        );
        if (!relationshipRes.ok) {
          const body = await relationshipRes.json().catch(() => null);
          const message = body?.message || body?.error || "";
          const hint = body?.hint ? ` | ${body.hint}` : "";
          setStatus(
            `Saved person, relationship save failed: ${relationshipRes.status} ${String(message).slice(0, 150)}${hint}`,
          );
          setSaving(false);
          return;
        }
        applyLocalFamilyGroupRelationshipType(person.personId, displayedFamilyGroupRelationshipType);
      }
    }
    setStatus(
      editingSection === "family"
        ? "Family saved."
        : editingSection === "notes"
          ? "Notes saved."
          : "Profile saved.",
    );
    setSaving(false);
    setEditingSection(null);
    onSaved();
  };
  const handleCancelSectionEdit = () => {
    if (!person) return;
    resetProfileEditorState(person);
  };
  const handleSelectTab = (nextTab: TabKey) => {
    if (nextTab === activeTab) return;
    if (activeTab === "contact" && editingSection && person) {
      resetProfileEditorState(person);
    }
    setActiveTab(nextTab);
  };
  const aboutDescriptorAttributes = useMemo(() => {
    return aboutAttributes.filter((item) => {
      if (item.category) return item.category === "descriptor";
      const typeKey = normalizeAttributeKey(item.attributeType || item.typeKey);
      return !EVENT_FALLBACK_TYPE_KEYS.includes(typeKey);
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
    () => allMediaAttributes.find((item) => item.valueText.trim() === selectedPhotoFileId.trim()) ?? null,
    [allMediaAttributes, selectedPhotoFileId],
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
  const mediaAttachPeopleOptions = useMemo(() => {
    const map = new Map<string, { personId: string; displayName: string; gender: "male" | "female" | "unspecified" }>();
    if (person?.personId?.trim()) {
      map.set(person.personId.trim(), {
        personId: person.personId.trim(),
        displayName: (displayName || person.displayName || person.personId).trim(),
        gender: person.gender ?? "unspecified",
      });
    }
    personOptions.forEach((item) => {
      const personId = item.personId.trim();
      if (!personId || map.has(personId)) return;
      map.set(personId, {
        personId,
        displayName: item.displayName,
        gender: item.gender ?? "unspecified",
      });
    });
    return Array.from(map.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [displayName, person, personOptions]);
  const availableHouseholdLinks = useMemo(() => {
    const unique = new Map<string, { householdId: string; label: string }>();
    contextHouseholds.forEach((item) => {
      const key = item.id.trim();
      if (!key) return;
      if (unique.has(key)) return;
      unique.set(key, { householdId: key, label: key });
    });
    return Array.from(unique.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [contextHouseholds]);
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
      `/api/t/${encodeURIComponent(activeTenantKey)}/photos/search?q=${encodeURIComponent(fileId)}`,
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
      people: (item?.people ?? []).map((entry) => ({
        personId: entry.personId,
        displayName: peopleNameById.get(entry.personId.trim()) || entry.displayName || entry.personId,
      })),
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
  }, [peopleNameById, selectedPhoto, showPhotoDetail, tenantKey]);

  const openPhotoDetail = (fileId: string) => {
    setSelectedPhotoFileId(fileId);
    setShowPhotoDetail(true);
  };

  const saveSelectedPhotoMetadata = async () => {
    if (!selectedPhoto || !person) return;
    setPhotoBusy(true);
    setStatus("Saving photo metadata...");
    const res = await fetch(
      `/api/t/${encodeURIComponent(activeTenantKey)}/people/${encodeURIComponent(person.personId)}/attributes/${encodeURIComponent(selectedPhoto.attributeId)}`,
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
    await loadPersonAttributeState(person.personId);
    await refreshSelectedPhotoAssociations(selectedPhoto.valueText);
    setShowPhotoDetail(false);
    setSelectedPhotoFileId("");
    onSaved();
  };

  const linkSelectedPhotoToPerson = async (targetPersonId: string) => {
    if (!selectedPhoto || !targetPersonId || !person) return false;
    const selectedType = selectedPhoto.attributeType.toLowerCase();
    const nextAttributeType = selectedType === "photo" ? "photo" : "media";
    setPhotoAssociationStatus("Saving association...");
    setStatus("Linking photo to selected person...");
    const res = await fetch(`/api/t/${encodeURIComponent(activeTenantKey)}/people/${encodeURIComponent(targetPersonId)}/attributes`, {
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
      `/api/t/${encodeURIComponent(activeTenantKey)}/households/${encodeURIComponent(targetHouseholdId)}/photos/link`,
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
      `/api/t/${encodeURIComponent(activeTenantKey)}/attributes?entity_type=person&entity_id=${encodeURIComponent(targetPersonId)}`,
      { cache: "no-store" },
    );
    const attrsBody = await attrsRes.json().catch(() => null);
    if (!attrsRes.ok) {
      setPhotoAssociationStatus("Association remove failed.");
      setPhotoBusy(false);
      return false;
    }
    const attrs = Array.isArray(attrsBody?.attributes) ? (attrsBody.attributes as AttributeWithMedia[]) : [];
    const matches = attrs.filter((item) => matchesCanonicalMediaFileId(item, fileId));
    for (const match of matches) {
      await fetch(
        `/api/t/${encodeURIComponent(activeTenantKey)}/people/${encodeURIComponent(targetPersonId)}/attributes/${encodeURIComponent(match.attributeId)}`,
        { method: "DELETE" },
      );
    }
    await refreshSelectedPhotoAssociations(fileId);
    if (targetPersonId === person.personId) {
      setSelectedPhotoFileId("");
      setShowPhotoDetail(false);
      await loadPersonAttributeState(person.personId);
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
      `/api/t/${encodeURIComponent(activeTenantKey)}/households/${encodeURIComponent(householdIdToUnlink)}/photos/${encodeURIComponent(fileId)}`,
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

  const handleWizardComplete = async (summary: MediaAttachExecutionSummary) => {
    if (!person) return;
    setStatus(formatMediaAttachUserSummary(summary));
    await loadPersonAttributeState(person.personId);
    onSaved();
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
      maiden_name: newSpouseGender === "female" ? newSpouseMaidenName.trim() : "",
      nick_name: newSpouseNickName.trim(),
      display_name: newSpouseDisplayName.trim(),
      birth_date: newSpouseBirthDate.trim(),
      gender: newSpouseGender,
    };

    try {
      let response = await fetch(`/api/t/${encodeURIComponent(activeTenantKey)}/people`, {
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
          response = await fetch(`/api/t/${encodeURIComponent(activeTenantKey)}/people`, {
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

      let relationSaved = false;
      if (canManage) {
        const relationshipRes = await fetch(
          `/api/t/${encodeURIComponent(activeTenantKey)}/relationships/builder`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                personId: person.personId,
                parentIds: [parent1Id, parent2Id].filter(Boolean),
                childIds,
                spouseId: createdPersonId,
                spouseAction: "link",
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
        return [
          ...current,
          {
            personId: createdPersonId,
            displayName: createdDisplayName,
            gender: newSpouseGender,
            familyGroupRelationshipType: "undeclared",
          },
        ];
      });
      pendingCreatedSpouseIdRef.current = createdPersonId;
      setSpouseId(createdPersonId);
      setDivorceSpouseId("");
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

  const isEditingIdentity = editingSection === "identity";
  const isEditingName = editingSection === "name";
  const isEditingContact = editingSection === "contact";
  const isEditingFamily = editingSection === "family";
  const isEditingNotes = editingSection === "notes";
  const isContactTabEditing = activeTab === "contact" && Boolean(editingSection);
  const allowSectionEdit = (section: ProfileSectionKey) => !showReadOnly && (!editingSection || editingSection === section) && !saving;

  return (
    <div
      className="person-modal-backdrop"
      onClick={(event) => event.stopPropagation()}
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
            <div className="person-modal-header-copy">
              <h3 className="person-modal-title">{displayName || person.displayName}</h3>
              <p className="person-modal-meta">
                {deathDateText
                  ? `From: ${formatDisplayDate(birthDate || person.birthDate || "")} | To: ${deathDateText} | ID: ${person.personId}`
                  : `Birthdate: ${toMonthDay(birthDate || person.birthDate || "")} | ID: ${person.personId}`}
              </p>
              <p className="person-modal-meta">
                Email: {email || "-"} | Phone: {phones || "-"}
              </p>
            </div>
            <div className="person-modal-header-actions">
              {primaryPhoneAction || emailActionHref ? (
                <div className="person-modal-contact-actions" aria-label="Quick contact actions">
                  {primaryPhoneAction ? (
                    <>
                      <a href={primaryPhoneAction.telHref} className="person-modal-contact-action">
                        Call
                      </a>
                      <a href={primaryPhoneAction.smsHref} className="person-modal-contact-action">
                        Text
                      </a>
                    </>
                  ) : null}
                  {emailActionHref ? (
                    <a href={emailActionHref} className="person-modal-contact-action">
                      Email
                    </a>
                  ) : null}
                </div>
              ) : null}
              <ModalCloseButton className="modal-close-button--floating" disabled={saving} onClick={onClose} />
            </div>
          </div>
        </div>

        <div className="person-modal-tabs">
          <button type="button" className={`tab-pill ${activeTab === "contact" ? "active" : ""}`} onClick={() => handleSelectTab("contact")}>Profile</button>
          <button type="button" className={`tab-pill ${activeTab === "attributes" ? "active" : ""}`} onClick={() => handleSelectTab("attributes")}>{aboutLabel}</button>
          <button type="button" className={`tab-pill ${activeTab === "photos" ? "active" : ""}`} onClick={() => handleSelectTab("photos")}>Media</button>
        </div>
        <div className="person-modal-content">

        {activeTab === "contact" ? (
          <>
            <div className="person-section-grid person-profile-grid">
              <div className="card person-profile-card">
                <div className="person-profile-card-header">
                  <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Identity</h4>
                  {!showReadOnly ? (
                    <button
                      type="button"
                      className="button secondary tap-button"
                      disabled={!allowSectionEdit("identity")}
                      onClick={() => {
                        setEditingSection("identity");
                        setStatus("");
                      }}
                    >
                      {isEditingIdentity ? "Editing" : "Edit"}
                    </button>
                  ) : null}
                </div>
                {isEditingIdentity ? (
                  <div className="field-grid">
                    <div>
                      <label className="label">Display Name</label>
                      <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={showReadOnly} />
                    </div>
                    <div>
                      <label className="label">{deathDateValue.trim() ? "From Date" : "Birthdate"}</label>
                      <input className="input" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} disabled={showReadOnly} />
                    </div>
                    {deathDateValue.trim() ? (
                      <div>
                        <label className="label">To Date</label>
                        <input className="input" type="date" value={deathDateValue} disabled readOnly />
                      </div>
                    ) : null}
                    <div className="field-span-2">
                      <label className="label">Gender</label>
                      <select className="input" value={gender} onChange={(e) => setGender(e.target.value as "male" | "female" | "unspecified")} disabled={showReadOnly}>
                        <option value="unspecified">Unspecified</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="person-summary-grid">
                    <div className="person-summary-row">
                      <span className="person-summary-label">Display Name</span>
                      <span className="person-summary-value">{formatSummaryValue(displayName)}</span>
                    </div>
                    <div className="person-summary-row">
                      <span className="person-summary-label">{deathDateText ? "From Date" : "Birthdate"}</span>
                      <span className="person-summary-value">{formatDisplayDate(birthDate)}</span>
                    </div>
                    {deathDateText ? (
                      <div className="person-summary-row">
                        <span className="person-summary-label">To Date</span>
                        <span className="person-summary-value">{deathDateText}</span>
                      </div>
                    ) : null}
                    <div className="person-summary-row">
                      <span className="person-summary-label">Gender</span>
                      <span className="person-summary-value">{formatSummaryValue(gender === "unspecified" ? "" : gender)}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="card person-profile-card">
                <div className="person-profile-card-header">
                  <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Name</h4>
                  {!showReadOnly ? (
                    <button
                      type="button"
                      className="button secondary tap-button"
                      disabled={!allowSectionEdit("name")}
                      onClick={() => {
                        setEditingSection("name");
                        setStatus("");
                      }}
                    >
                      {isEditingName ? "Editing" : "Edit"}
                    </button>
                  ) : null}
                </div>
                {isEditingName ? (
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
                    {gender === "female" || maidenName.trim() ? (
                      <div className="field-span-2">
                        <label className="label">Maiden Name</label>
                        <input className="input" value={maidenName} onChange={(e) => setMaidenName(e.target.value)} disabled={showReadOnly} />
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="person-summary-grid">
                    <div className="person-summary-row">
                      <span className="person-summary-label">First Name</span>
                      <span className="person-summary-value">{formatSummaryValue(firstName)}</span>
                    </div>
                    <div className="person-summary-row">
                      <span className="person-summary-label">Middle Name</span>
                      <span className="person-summary-value">{formatSummaryValue(middleName)}</span>
                    </div>
                    <div className="person-summary-row">
                      <span className="person-summary-label">Last Name</span>
                      <span className="person-summary-value">{formatSummaryValue(lastName)}</span>
                    </div>
                    <div className="person-summary-row">
                      <span className="person-summary-label">Nick Name</span>
                      <span className="person-summary-value">{formatSummaryValue(nickName)}</span>
                    </div>
                    {maidenName.trim() ? (
                      <div className="person-summary-row">
                        <span className="person-summary-label">Maiden Name</span>
                        <span className="person-summary-value">{maidenName.trim()}</span>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="card person-profile-card">
                <div className="person-profile-card-header">
                  <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Contact</h4>
                  {!showReadOnly ? (
                    <button
                      type="button"
                      className="button secondary tap-button"
                      disabled={!allowSectionEdit("contact")}
                      onClick={() => {
                        setEditingSection("contact");
                        setStatus("");
                      }}
                    >
                      {isEditingContact ? "Editing" : "Edit"}
                    </button>
                  ) : null}
                </div>
                {isEditingContact ? (
                  <>
                    <label className="label">Phone</label>
                    <div className="settings-chip-list person-inline-input-actions">
                      <input
                        className="input"
                        value={phones}
                        onChange={(e) => setPhones(e.target.value)}
                        onBlur={() => setPhones((current) => formatUsPhoneForEdit(current))}
                        disabled={showReadOnly}
                      />
                      {phoneActionItems.length > 0 ? (
                        <div className="person-summary-actions">
                          {phoneActionItems.map((item) => (
                            <span key={item.smsHref} className="person-summary-actions">
                              <a href={item.telHref} className="button secondary tap-button person-profile-inline-action">Call</a>
                              <a href={item.smsHref} className="button secondary tap-button person-profile-inline-action">Text</a>
                            </span>
                          ))}
                        </div>
                      ) : <span />}
                    </div>
                    <label className="label">Email</label>
                    <div className="settings-chip-list person-inline-input-actions">
                      <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} disabled={showReadOnly} />
                      {email.trim() ? (
                        <a href={`mailto:${email.trim()}`} className="button secondary tap-button person-profile-inline-action">
                          Email
                        </a>
                      ) : null}
                    </div>
                    <label className="label">Address</label>
                    <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} disabled={showReadOnly} />
                  </>
                ) : (
                  <div className="person-summary-grid">
                    <div className="person-summary-row">
                      <span className="person-summary-label">Phone</span>
                      <div className="person-summary-value person-summary-value--actions">
                        <span>{formatSummaryValue(formatUsPhoneForEdit(phones), "Not added")}</span>
                        {primaryPhoneAction ? (
                          <span className="person-summary-actions">
                            <a href={primaryPhoneAction.telHref} className="person-modal-contact-action">Call</a>
                            <a href={primaryPhoneAction.smsHref} className="person-modal-contact-action">Text</a>
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="person-summary-row">
                      <span className="person-summary-label">Email</span>
                      <div className="person-summary-value person-summary-value--actions">
                        <span>{formatSummaryValue(email)}</span>
                        {emailActionHref ? (
                          <span className="person-summary-actions">
                            <a href={emailActionHref} className="person-modal-contact-action">Email</a>
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="person-summary-row person-summary-row--stacked">
                      <span className="person-summary-label">Address</span>
                      <span className="person-summary-value">{formatSummaryValue(address)}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="card person-profile-card field-span-2">
                <div className="person-profile-card-header">
                  <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Family</h4>
                  <div className="person-profile-card-actions">
                    {householdId ? (
                      <button type="button" className="button secondary tap-button" onClick={() => onEditHousehold(householdId)}>
                        Edit Household
                      </button>
                    ) : null}
                    {!showReadOnly ? (
                      <button
                        type="button"
                        className="button secondary tap-button"
                        disabled={!allowSectionEdit("family")}
                        onClick={() => {
                          setEditingSection("family");
                          setStatus("");
                        }}
                      >
                        {isEditingFamily ? "Editing" : "Edit"}
                      </button>
                    ) : null}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.6rem 0.9rem",
                    flexWrap: "wrap",
                    marginBottom: "0.75rem",
                  }}
                >
                  <span className="label" style={{ marginBottom: 0 }}>Relationship</span>
                  <span
                    title={familyRelationshipHint || undefined}
                    aria-label={familyRelationshipHint ? `${formatFamilyGroupRelationshipTypeLabel(displayedFamilyGroupRelationshipType)}. ${familyRelationshipHint}` : formatFamilyGroupRelationshipTypeLabel(displayedFamilyGroupRelationshipType)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "0.25rem 0.6rem",
                      borderRadius: 999,
                      border: `1px solid ${
                        isUndeclaredPerson ? "#d98c7a" : isFounderPerson ? "#b29a59" : isInLawPerson ? "#7b8db8" : "#8aa8a0"
                      }`,
                      background: isUndeclaredPerson
                        ? "#fff3ef"
                        : isFounderPerson
                          ? "#fff7df"
                          : isInLawPerson
                            ? "#eef2fb"
                            : "#edf8f3",
                      fontSize: "0.82rem",
                      fontWeight: 700,
                      color: "#1f2937",
                      cursor: familyRelationshipHint ? "help" : "default",
                    }}
                  >
                    {formatFamilyGroupRelationshipTypeLabel(displayedFamilyGroupRelationshipType)}
                  </span>
                </div>
                {canSwitchPersonFamilyGroup ? (
                  <div style={{ marginBottom: "0.75rem" }}>
                    <label className="label">View Family Group</label>
                    <select
                      className="input"
                      value={activeTenantKey}
                      disabled={familySwitchBusy}
                      onChange={(e) =>
                        void (async () => {
                          const nextKey = e.target.value;
                          if (!nextKey || nextKey === activeTenantKey) return;
                          setFamilySwitchBusy(true);
                          const response = await fetch("/api/family-groups/active", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ familyGroupKey: nextKey }),
                          });
                          if (!response.ok) {
                            setFamilySwitchBusy(false);
                            setStatus("Family group switch failed.");
                            return;
                          }
                          const [peopleRes, treeRes] = await Promise.all([
                            fetch(`/api/t/${encodeURIComponent(nextKey)}/people`, { cache: "no-store" }),
                            fetch(`/api/t/${encodeURIComponent(nextKey)}/tree`, { cache: "no-store" }),
                          ]);
                          const peopleBody = await peopleRes.json().catch(() => null);
                          const treeBody = await treeRes.json().catch(() => null);
                          if (!peopleRes.ok || !treeRes.ok) {
                            setFamilySwitchBusy(false);
                            setStatus("Family group switch loaded session but failed to load data.");
                            return;
                          }
                          const nextPeople = Array.isArray(peopleBody?.items) ? (peopleBody.items as PersonItem[]) : [];
                          const nextRelationships = Array.isArray(treeBody?.relationships)
                            ? (treeBody.relationships as Array<{
                                id?: string;
                                fromPersonId?: string;
                                toPersonId?: string;
                                relationshipType?: string;
                                label?: string;
                              }>)
                                .map((item) => ({
                                  id: String(item.id ?? ""),
                                  fromPersonId: String(item.fromPersonId ?? ""),
                                  toPersonId: String(item.toPersonId ?? ""),
                                  label: String(item.label ?? item.relationshipType ?? ""),
                                }))
                                .filter((item) => item.fromPersonId && item.toPersonId && item.label)
                            : [];
                          const nextHouseholds = Array.isArray(treeBody?.households)
                            ? (treeBody.households as HouseholdLink[])
                            : [];
                          const nextPersonRecord = nextPeople.find((item) => item.personId === person?.personId);
                          setActiveTenantKey(nextKey);
                          setLocalPeople(nextPeople);
                          setContextEdges(nextRelationships);
                          setContextHouseholds(nextHouseholds);
                          setStoredFamilyGroupRelationshipType(
                            normalizeFamilyGroupRelationshipType(
                              nextPersonRecord?.familyGroupRelationshipType ?? person?.familyGroupRelationshipType,
                            ),
                          );
                          const isPersonProfilePath = Boolean(
                            person?.personId && pathname?.match(/\/people\/[^/]+$/i),
                          );
                          const switchedPath =
                            isPersonProfilePath && !nextPersonRecord
                              ? buildSwitchedFamilyFallbackPath(nextKey)
                              : buildSwitchedFamilyPath(pathname || "/", nextKey);
                          const query = searchParams?.toString() ?? "";
                          const destination = query ? `${switchedPath}?${query}` : switchedPath;
                          window.location.assign(destination);
                        })()
                      }
                    >
                      {linkedFamilyGroupOptions.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : isInLawPerson && familyGroupOptions.length > 1 ? (
                  <p className="page-subtitle" style={{ marginTop: 0, marginBottom: "0.75rem" }}>
                    This in-law is not linked to another family group, so family-group switching is unavailable here.
                  </p>
                ) : null}
                {isEditingFamily ? (
                  canManage ? (
                  <>
                    {canManageRelationshipType ? (
                      <label
                        className="label"
                        style={{
                          marginBottom: "0.75rem",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.4rem",
                          fontSize: "0.82rem",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isFounderPerson}
                          disabled={familyRelationshipTypeBusy || (!isFounderPerson && founderCount >= 2)}
                          onChange={(e) => void saveFounderDesignation(e.target.checked)}
                        />
                        Founder
                      </label>
                    ) : null}
                    <div className="settings-chip-list">
                      {!isInLawPerson && !isFounderPerson ? (
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
                      ) : isFounderPerson ? (
                        <p className="page-subtitle field-span-2" style={{ marginBottom: 0 }}>
                          Founders cannot have parents assigned in this family group.
                        </p>
                      ) : (
                        <p className="page-subtitle field-span-2" style={{ marginBottom: 0 }}>
                          As an in-law your parents are not visible in this family view. To see or select your parents, change to the family group where you are direct.
                        </p>
                      )}
                      {currentPersonCanHaveSpouse ? (
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <label className="label">Spouse</label>
                          <select className="input" value={spouseSelectValue} onChange={(e) => {
                            const nextValue = e.target.value;
                            if (nextValue === ADD_NEW_SPOUSE_OPTION) {
                              if (!isAnchorFamilyGroupRelationshipType(displayedFamilyGroupRelationshipType)) {
                                return;
                              }
                              setShowAddSpouse(true);
                              setNewSpouseGender(oppositeGender(gender));
                              setStatus("");
                              return;
                            }
                            if (nextValue === DIVORCE_SPOUSE_OPTION) {
                              const currentSpouseId = spouseId || initialFamilyRef.current.spouseId;
                              if (!currentSpouseId) {
                                return;
                              }
                              setDivorceSpouseId(currentSpouseId);
                              setSpouseId("");
                              setFamilyTouched(true);
                              setStatus("Divorce selected. Save to remove the spouse, disable their access, and keep this household with the direct family member.");
                              return;
                            }
                            if (nextValue && (nextValue === parent1Id || nextValue === parent2Id)) {
                              setStatus("A parent cannot also be selected as spouse.");
                              return;
                            }
                            setDivorceSpouseId("");
                            setSpouseId(nextValue);
                            setFamilyTouched(true);
                          }}>
                            {!canRequestDivorce ? (
                              <option value="">None</option>
                            ) : null}
                            {spouseOptions.map((option) => (
                              <option key={`sp-${option.personId}`} value={option.personId}>{option.displayName}</option>
                            ))}
                            {canRequestDivorce ? (
                              <option value={DIVORCE_SPOUSE_OPTION}>Div</option>
                            ) : null}
                            {isAnchorFamilyGroupRelationshipType(displayedFamilyGroupRelationshipType) ? (
                              <option value={ADD_NEW_SPOUSE_OPTION}>+ Add Person</option>
                            ) : null}
                          </select>
                        </div>
                      ) : (
                        <div style={{ flex: 1, minWidth: 220 }}>
                          <label className="label">Spouse</label>
                          <p className="page-subtitle" style={{ marginBottom: 0 }}>
                            Spouse links are not available before age 19.
                          </p>
                        </div>
                      )}
                    </div>
                      {!hasVisibleSpouseSelection && !isAnchorFamilyGroupRelationshipType(displayedFamilyGroupRelationshipType) ? (
                        <div style={{ marginTop: "0.75rem" }}>
                          <p className="page-subtitle" style={{ margin: "0.45rem 0 0" }}>
                            Add or connect this person to a direct parent first, or choose an existing direct/founder spouse.
                          </p>
                        </div>
                      ) : null}
                    {divorceSpouseId ? (
                      <div style={{ marginTop: "0.75rem" }}>
                        <p className="page-subtitle" style={{ margin: "0.45rem 0 0" }}>
                          Divorce is pending. Save to remove {selectedSpouseName} from this family, disable their access if no other family links remain, and keep this household with the direct family member.
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="page-subtitle" style={{ marginBottom: "0.5rem" }}>
                    Relationship editing is available to administrators.
                  </p>
                )
                ) : (
                  <div className="person-summary-grid">
                    <div className="person-summary-row">
                      <span className="person-summary-label">Family Group</span>
                      <span className="person-summary-value">{formatSummaryValue(activeFamilyGroupName, activeTenantKey)}</span>
                    </div>
                    <div className="person-summary-row">
                      <span className="person-summary-label">Parents</span>
                      <span className="person-summary-value">{parentSummaryText}</span>
                    </div>
                    <div className="person-summary-row">
                      <span className="person-summary-label">Spouse</span>
                      <span className="person-summary-value">{spouseSummaryText}</span>
                    </div>
                    <div className="person-summary-row">
                      <span className="person-summary-label">Children</span>
                      <span className="person-summary-value">{childrenSummaryText}</span>
                    </div>
                    {marriedSummaryText !== "coming" ? (
                      <div className="person-summary-row">
                        <span className="person-summary-label">Married</span>
                        <span className="person-summary-value">{marriedSummaryText}</span>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="card person-profile-card field-span-2">
                <div className="person-profile-card-header">
                  <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Notes</h4>
                  <div className="person-profile-card-actions">
                    {canManage ? (
                      <button
                        type="button"
                        className="button secondary tap-button"
                        onClick={openStoryImportModal}
                      >
                        Import Story with AI (testing)
                      </button>
                    ) : null}
                    {!showReadOnly ? (
                      <button
                        type="button"
                        className="button secondary tap-button"
                        disabled={!allowSectionEdit("notes")}
                        onClick={() => {
                          setEditingSection("notes");
                          setStatus("");
                        }}
                      >
                        {isEditingNotes ? "Editing" : "Edit"}
                      </button>
                    ) : null}
                  </div>
                </div>
                {isEditingNotes ? (
                  <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={showReadOnly} />
                ) : (
                  <p className="person-notes-preview">{notesPreviewText}</p>
                )}
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
                  <p className="page-subtitle" style={{ margin: 0 }}>
                    {deathDateValue.trim()
                      ? <><strong>From:</strong> {formatDisplayDate(birthDate)} <strong style={{ marginLeft: "0.4rem" }}>To:</strong> {formatDisplayDate(deathDateValue)}</>
                      : <><strong>Born:</strong> {formatDisplayDate(birthDate)}</>}
                  </p>
                  <p className="page-subtitle" style={{ margin: 0 }}><strong>Schools Attended:</strong> coming</p>
                  <p className="page-subtitle" style={{ margin: 0 }}><strong>Married:</strong> {marriedSummaryText}</p>
                  <p className="page-subtitle" style={{ margin: 0 }}><strong>Major Accomplishments and Events:</strong> coming</p>
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
                <div className="settings-chip-list" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.6rem" }}>
                  {thingsChips.length > 0 ? (
                    thingsChips.map((chip) => (
                      <button
                        key={chip.attributeId}
                        type="button"
                        className="status-chip status-chip--neutral"
                        style={{
                          textAlign: "left",
                          width: "auto",
                          maxWidth: "100%",
                          borderRadius: "999px",
                          border: "1px solid #d9e2ec",
                          ...chipColorStyle(aboutDescriptorAttributes.find((row) => row.attributeId === chip.attributeId)?.attributeType || ""),
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
                <div className="settings-chip-list" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.6rem" }}>
                  {storyItems.length > 0 ? (
                    storyItems.map((item) => (
                      <button
                        key={item.attributeId}
                        type="button"
                        className="status-chip status-chip--neutral"
                        style={{
                          textAlign: "left",
                          width: "auto",
                          maxWidth: "100%",
                          borderRadius: "999px",
                          border: "1px solid #d9e2ec",
                          ...chipColorStyle(item.attributeType || item.typeKey || ""),
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.45rem",
                          padding: "0.45rem 0.7rem",
                          cursor: "pointer",
                        }}
                        onClick={() => {
                          setAttributeLaunchSource("stories");
                          setSelectedAboutAttributeId(item.attributeId);
                          setShowAttributeAddModal(true);
                        }}
                      >
                        <span>{getTimelineChipLabel(item)}</span>
                      </button>
                    ))
                  ) : (
                    <p className="page-subtitle" style={{ margin: 0 }}>No stories added yet.</p>
                  )}
                </div>
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
                  + Add Story
                </button>
              </div>

              <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: "230px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", marginBottom: "0.55rem" }}>
                  <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Timeline</h4>
                  <button
                    type="button"
                    className="button secondary tap-button"
                    style={{
                      minWidth: 0,
                      padding: "0.32rem 0.6rem",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.4rem",
                      borderRadius: 999,
                      fontSize: "0.78rem",
                      fontWeight: 700,
                      lineHeight: 1.1,
                      whiteSpace: "nowrap",
                    }}
                    aria-label={timelineSortOrder === "asc" ? "Show newest first" : "Show oldest first"}
                    onClick={() => setTimelineSortOrder((current) => (current === "asc" ? "desc" : "asc"))}
                  >
                    <span>{timelineSortOrder === "asc" ? "Oldest first" : "Newest first"}</span>
                    <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" style={{ display: "block" }}>
                      {timelineSortOrder === "asc" ? (
                        <path d="M8 3 4.25 6.75l.9.9L7.35 5.45V13h1.3V5.45l2.2 2.2.9-.9Z" fill="currentColor" />
                      ) : (
                        <path d="M8 13l3.75-3.75-.9-.9-2.2 2.2V3h-1.3v7.55l-2.2-2.2-.9.9Z" fill="currentColor" />
                      )}
                    </svg>
                  </button>
                </div>
                <div className="settings-chip-list" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  {timelineItems.length > 0 ? (
                    timelineItems.map((item) => (
                      <button
                        key={item.attributeId}
                        type="button"
                        className="status-chip status-chip--neutral"
                        style={{
                          borderRadius: "999px",
                          border: "1px solid #d9e2ec",
                          ...chipColorStyle(item.attributeType || item.typeKey || ""),
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.35rem",
                          padding: "0.4rem 0.65rem",
                          cursor: "pointer",
                        }}
                        onClick={() => {
                          setAttributeLaunchSource("timeline");
                          setSelectedAboutAttributeId(item.attributeId);
                          setShowAttributeAddModal(true);
                        }}
                      >
                        {item.attributeDate ? <strong>{formatDisplayDate(item.attributeDate)}</strong> : null}
                        <span>{getTimelineChipLabel(item)}</span>
                      </button>
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
            tenantKey={activeTenantKey}
            entityType="person"
            entityId={person.personId}
            entityLabel={displayName || person.displayName}
            modalSubtitle={currentStoryImportDraft ? `${aboutLabel} · AI Story Import` : aboutLabel}
            initialTypeKey={currentStoryImportDraft?.attributeType || attributeLaunchMeta.initialTypeKey}
            initialTypeCategory={currentStoryImportDraft?.attributeTypeCategory || attributeLaunchMeta.initialTypeCategory}
            initialDraft={currentStoryImportDraft}
            initialDraftKey={currentStoryImportDraft ? `${currentStoryImportDraft.proposalId}:${storyImportDraftIndex}` : ""}
            initialEditAttributeId={currentStoryImportDraft ? "" : selectedAboutAttributeId}
            startInAddMode
            closeAfterAddSave={!currentStoryImportDraft}
            addModalTitle={storyImportDraftTitle}
            launchSourceLabel={currentStoryImportDraft ? "AI Story Import" : attributeLaunchMeta.label}
            onSkipDraft={() => {
              if (!currentStoryImportDraft) {
                return;
              }
              const nextIndex = storyImportDraftIndex + 1;
              if (nextIndex < storyImportDrafts.length) {
                setStoryImportDraftIndex(nextIndex);
                setStatus(`Skipped AI draft ${storyImportDraftIndex + 1} of ${storyImportDrafts.length}. Review the next proposal.`);
                return;
              }
              clearStoryImportQueue();
              setShowAttributeAddModal(false);
              setSelectedAboutAttributeId("");
              setStatus("Skipped final AI draft. No more drafts to review.");
            }}
            onClose={() => {
              if (currentStoryImportDraft) {
                const remaining = storyImportDrafts.length - storyImportDraftIndex;
                cancelStoryImportQueue(
                  remaining > 1
                    ? `AI story import stopped. ${remaining} proposals were not saved.`
                    : "AI story import stopped. The current proposal was not saved.",
                );
                return;
              }
              setShowAttributeAddModal(false);
              setSelectedAboutAttributeId("");
            }}
            onSaved={() => {
              void loadPersonAttributeState(person.personId);
              onSaved();
              if (currentStoryImportDraft) {
                const nextIndex = storyImportDraftIndex + 1;
                if (nextIndex < storyImportDrafts.length) {
                  setStoryImportDraftIndex(nextIndex);
                  setStatus(`Saved AI draft ${storyImportDraftIndex + 1} of ${storyImportDrafts.length}. Review the next proposal.`);
                  return;
                }
                clearStoryImportQueue();
                setShowAttributeAddModal(false);
                setSelectedAboutAttributeId("");
                setStatus(`Saved all ${storyImportDrafts.length} AI-generated attribute drafts.`);
              }
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
                        setShowMediaAttachWizard(true);
                      }}
                    >
                      + Add Photo
                    </button>
                  ) : null}
                </div>
              </div>
              <label className="label">Search this person&apos;s media</label>
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
                      key={`${item.attributeId}:${item.valueText}`}
                      type="button"
                      className="person-photo-tile"
                      onClick={() => openPhotoDetail(item.valueText)}
                    >
                      {isVideoMediaByMetadata(item.valueText, item.mediaMetadata || item.valueJson) ? (
                        <video
                          src={getPersonMediaOriginalSrc(item)}
                          className="person-photo-tile-image"
                          muted
                          playsInline
                        />
                      ) : isAudioMediaByMetadata(item.valueText, item.mediaMetadata || item.valueJson) ? (
                        <div className="person-photo-tile-image" style={{ display: "grid", placeItems: "center", padding: "0.75rem" }}>
                          <audio src={getPersonMediaOriginalSrc(item)} controls style={{ width: "100%" }} />
                        </div>
                      ) : isDocumentMediaByMetadata(item.valueText, item.mediaMetadata || item.valueJson) ? (
                        <div className="person-photo-tile-image" style={{ display: "grid", placeItems: "center", gap: "0.35rem", padding: "0.75rem", textAlign: "center", color: "#0f4c81" }}>
                          <DocumentIcon />
                          <strong style={{ fontSize: "0.85rem" }}>Document</strong>
                        </div>
                      ) : (
                        <img
                          src={getPersonMediaPreviewSrc(item)}
                          alt={item.label || "photo"}
                          className="person-photo-tile-image"
                          onError={() => {
                            const fileId = item.valueText.trim();
                            if (!fileId) {
                              return;
                            }
                            if (item.previewUrl && !failedDirectPreviewFileIds.has(fileId)) {
                              setFailedDirectPreviewFileIds((current) => {
                                if (current.has(fileId)) {
                                  return current;
                                }
                                const next = new Set(current);
                                next.add(fileId);
                                return next;
                              });
                              return;
                            }
                            if (item.originalUrl && !failedDirectOriginalFileIds.has(fileId)) {
                              setFailedDirectOriginalFileIds((current) => {
                                if (current.has(fileId)) {
                                  return current;
                                }
                                const next = new Set(current);
                                next.add(fileId);
                                return next;
                              });
                            }
                          }}
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
                  No media recorded.
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
                      setLargePhotoIsVideo(isVideoMediaByMetadata(selectedPhoto.valueText, selectedPhoto.mediaMetadata || selectedPhoto.valueJson));
                      setLargePhotoIsDocument(isDocumentMediaByMetadata(selectedPhoto.valueText, selectedPhoto.mediaMetadata || selectedPhoto.valueJson));
                      setLargePhotoIsAudio(isAudioMediaByMetadata(selectedPhoto.valueText, selectedPhoto.mediaMetadata || selectedPhoto.valueJson));
                    }}
                    viewLabel={isDocumentMediaByMetadata(selectedPhoto.valueText, selectedPhoto.mediaMetadata || selectedPhoto.valueJson) ? "Open Document" : "View Large"}
                  />
                  <div className="card">
                    {isVideoMediaByMetadata(selectedPhoto.valueText, selectedPhoto.mediaMetadata || selectedPhoto.valueJson) ? (
                      <video
                        src={getPersonMediaOriginalSrc(selectedPhoto)}
                        className="person-photo-detail-preview"
                        controls
                        playsInline
                      />
                    ) : isAudioMediaByMetadata(selectedPhoto.valueText, selectedPhoto.mediaMetadata || selectedPhoto.valueJson) ? (
                      <audio
                        src={getPersonMediaOriginalSrc(selectedPhoto)}
                        className="person-photo-detail-preview"
                        controls
                      />
                    ) : isDocumentMediaByMetadata(selectedPhoto.valueText, selectedPhoto.mediaMetadata || selectedPhoto.valueJson) ? (
                      <div className="person-photo-detail-preview" style={{ display: "grid", placeItems: "center", gap: "0.65rem", alignContent: "center", padding: "1.5rem", textAlign: "center" }}>
                        <span style={{ color: "#0f4c81" }}><DocumentIcon /></span>
                        <strong>{selectedPhoto.label || "Document"}</strong>
                        <a
                          href={getPersonMediaOriginalSrc(selectedPhoto)}
                          target="_blank"
                          rel="noreferrer"
                          className="button secondary tap-button"
                          style={{ textDecoration: "none" }}
                        >
                          Open Document
                        </a>
                      </div>
                    ) : (
                      <img
                        src={getPersonMediaOriginalSrc(selectedPhoto)}
                        alt={selectedPhoto.label || "photo"}
                        className="person-photo-detail-preview"
                        onError={() => {
                          if (!selectedPhoto.originalUrl) {
                            return;
                          }
                          setFailedDirectOriginalFileIds((current) => {
                            if (current.has(selectedPhoto.valueText)) {
                              return current;
                            }
                            const next = new Set(current);
                            next.add(selectedPhoto.valueText);
                            return next;
                          });
                        }}
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
                    saveLabel="Save and Close"
                    onCancel={() => setShowPhotoDetail(false)}
                    onSave={() => {
                      void saveSelectedPhotoMetadata();
                    }}
                  />
                </div>
              </div>
            ) : null}

            {person ? (
              <MediaAttachWizard
                open={showMediaAttachWizard}
                context={{
                  tenantKey: activeTenantKey,
                  source: "person",
                  canManage,
                  allowHouseholdLinks: canManage,
                  personId: person.personId,
                  entityType: "person",
                  defaultAttributeType: "photo",
                  defaultIsPrimary: true,
                  defaultLabel: "photo",
                  preselectedPersonIds: [person.personId],
                  peopleOptions: mediaAttachPeopleOptions,
                  householdOptions: availableHouseholdLinks.map((item) => ({
                    householdId: item.householdId,
                    label: item.label,
                  })),
                }}
                onClose={() => setShowMediaAttachWizard(false)}
                onComplete={(summary) => {
                  void handleWizardComplete(summary);
                }}
              />
            ) : null}

            {largePhotoFileId ? (
              <div
                style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 140, display: "grid", placeItems: "center", padding: "1rem" }}
                onClick={() => {
      setLargePhotoFileId("");
      setLargePhotoIsVideo(false);
      setLargePhotoIsDocument(false);
      setLargePhotoIsAudio(false);
                }}
              >
                {largePhotoIsVideo ? (
                  <video
                    src={largePhotoOriginalSrc}
                    controls
                    playsInline
                    style={{ maxWidth: "min(1200px, 95vw)", maxHeight: "90vh", borderRadius: 14, border: "1px solid var(--line)", background: "#fff" }}
                  />
                ) : largePhotoIsAudio ? (
                  <audio
                    src={largePhotoOriginalSrc}
                    controls
                    style={{ width: "min(640px, 95vw)", borderRadius: 14, border: "1px solid var(--line)", background: "#fff" }}
                  />
                ) : largePhotoIsDocument ? (
                  <div style={{ width: "min(640px, 95vw)", borderRadius: 14, border: "1px solid var(--line)", background: "#fff", padding: "1.25rem", display: "grid", placeItems: "center", gap: "0.65rem", textAlign: "center" }}>
                    <span style={{ color: "#0f4c81" }}><DocumentIcon /></span>
                    <strong>Document</strong>
                    <a
                      href={largePhotoOriginalSrc}
                      target="_blank"
                      rel="noreferrer"
                      className="button secondary tap-button"
                      style={{ textDecoration: "none" }}
                    >
                      Open Document
                    </a>
                  </div>
                ) : (
                  <img
                    src={largePhotoOriginalSrc}
                    alt="Large preview"
                    style={{ maxWidth: "min(1200px, 95vw)", maxHeight: "90vh", borderRadius: 14, border: "1px solid var(--line)", background: "#fff" }}
                    onError={() => {
                      if (!largePhotoSelectedItem?.originalUrl || !largePhotoFileId) {
                        return;
                      }
                      setFailedDirectOriginalFileIds((current) => {
                        if (current.has(largePhotoFileId)) {
                          return current;
                        }
                        const next = new Set(current);
                        next.add(largePhotoFileId);
                        return next;
                      });
                    }}
                  />
                )}
              </div>
            ) : null}
          </>
        ) : null}

        {showAddSpouse ? (
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 145, display: "grid", placeItems: "center", padding: "1rem" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className="card"
              style={{ width: "min(560px, 95vw)", maxHeight: "90vh", overflow: "auto", display: "grid", gap: "0.55rem", paddingTop: "1.1rem" }}
              onClick={(event) => event.stopPropagation()}
            >
              <h4 style={{ marginTop: 0 }}>Add Person</h4>
              <p className="page-subtitle" style={{ marginTop: 0, marginBottom: 0 }}>
                Use the spouse dropdown for existing people. This dialog creates a new person and links them as spouse automatically.
              </p>
              <label className="label">First Name</label>
              <input className="input" value={newSpouseFirstName} onChange={(e) => setNewSpouseFirstName(e.target.value)} />
              <label className="label">Middle Name</label>
              <input className="input" value={newSpouseMiddleName} onChange={(e) => setNewSpouseMiddleName(e.target.value)} />
              <label className="label">Last Name</label>
              <input className="input" value={newSpouseLastName} onChange={(e) => setNewSpouseLastName(e.target.value)} />
              {newSpouseGender === "female" ? (
                <>
                  <label className="label">Maiden Name (optional)</label>
                  <input
                    className="input"
                    value={newSpouseMaidenName}
                    onChange={(e) => setNewSpouseMaidenName(e.target.value)}
                    placeholder="If known"
                  />
                </>
              ) : null}
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
                onChange={(e) => {
                  const nextGender = e.target.value as "male" | "female" | "unspecified";
                  setNewSpouseGender(nextGender);
                  if (nextGender !== "female") {
                    setNewSpouseMaidenName("");
                  }
                }}
              >
                <option value="unspecified">Unspecified</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
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

        {showStoryImportModal ? (
          <div
            className="story-workspace-backdrop"
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className="story-workspace-panel"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="story-workspace-header">
                <h4 style={{ margin: 0 }}>Story Import Workspace (testing)</h4>
              </div>
              <p className="page-subtitle" style={{ marginTop: "-0.25rem" }}>
                Desktop-first review layout for story extraction. Nothing is saved until you review each generated draft.
              </p>
              <div className="story-workspace-body">
                <div className="card story-workspace-story-pane">
                  <div className="story-workspace-section-head">
                    <h5 style={{ margin: 0 }}>Story Text</h5>
                    <span className="status-chip status-chip--neutral">Chars {storyImportText.trim().length}</span>
                  </div>
              <label className="label">Story Text</label>
              <textarea
                className="textarea"
                value={storyImportText}
                onChange={(event) => setStoryImportText(event.target.value)}
                placeholder="Paste a life story, biography, or story excerpt here."
                style={{ minHeight: "18rem", flex: 1 }}
                disabled={storyImportBusy || storyChatBusy}
              />
                  <div className="story-workspace-controls">
                    <button
                      type="button"
                      className="button tap-button"
                      disabled={storyImportBusy || storyChatBusy}
                      onClick={() => void generateStoryImportDrafts()}
                    >
                      {storyImportBusy ? "Generating..." : "Generate Drafts"}
                    </button>
                  </div>
                  <div style={{ marginTop: "0.65rem" }}>
                    <label className="label">Exact Prompt Sent To AI</label>
                    <textarea
                      className="textarea"
                      value={storyImportPromptPreview}
                      readOnly
                      placeholder="Generate Drafts to view the full prompt sent to AI."
                      style={{ minHeight: "11rem", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
                    />
                  </div>
                  {storyImportDrafts.length > 0 ? (
                    <div className="card" style={{ border: "1px solid #E7EAF0", borderRadius: "0.8rem" }}>
                      <div className="story-workspace-section-head">
                        <h5 style={{ margin: 0 }}>
                          {storyWorkspaceStep === 2 ? "Step 2 Queue" : "Potential Attributes / Stories"}
                        </h5>
                        <span className="status-chip status-chip--neutral">{storyImportDrafts.length}</span>
                      </div>
                      <div style={{ marginTop: "0.55rem", display: "grid", gap: "0.5rem", maxHeight: "280px", overflowY: "auto" }}>
                        {storyWorkspaceDrafts.length > 0 ? storyWorkspaceDrafts.map((proposal, index) => (
                          <button
                            key={proposal.localId || proposal.proposalId || `draft-${index}`}
                            type="button"
                            onClick={() => setStoryWorkspaceDraftIndex(index)}
                            className="button secondary tap-button"
                            style={{
                              textAlign: "left",
                              border: `1px solid ${index === storyWorkspaceDraftIndex ? "#2563eb" : "#E7EAF0"}`,
                              borderRadius: "0.6rem",
                              padding: "0.55rem",
                              background: index === storyWorkspaceDraftIndex ? "#eff6ff" : "#fff",
                              color: "inherit",
                            }}
                          >
                            <p style={{ margin: 0, fontWeight: 700 }}>
                              {index + 1}. {proposal.attributeDetail || proposal.label || "(no title)"}
                            </p>
                            <p className="page-subtitle" style={{ margin: "0.2rem 0 0" }}>
                              {proposal.attributeKind} / {proposal.attributeType}{proposal.attributeTypeCategory ? ` / ${proposal.attributeTypeCategory}` : ""}
                            </p>
                            <p className="page-subtitle" style={{ margin: "0.2rem 0 0" }}>
                              Date: {proposal.attributeDate || "-"}{proposal.endDate ? ` to ${proposal.endDate}` : ""}
                            </p>
                          </button>
                        )) : storyImportDrafts.map((proposal, index) => (
                          <div key={proposal.proposalId || `draft-${index}`} style={{ border: "1px solid #E7EAF0", borderRadius: "0.6rem", padding: "0.55rem" }}>
                            <p style={{ margin: 0, fontWeight: 700 }}>
                              {index + 1}. {proposal.attributeDetail || proposal.label || "(no title)"}
                            </p>
                            <p className="page-subtitle" style={{ margin: "0.2rem 0 0" }}>
                              {proposal.attributeKind} / {proposal.attributeType}{proposal.attributeTypeCategory ? ` / ${proposal.attributeTypeCategory}` : ""}
                            </p>
                            <p className="page-subtitle" style={{ margin: "0.2rem 0 0" }}>
                              Date: {proposal.attributeDate || "-"}{proposal.endDate ? ` to ${proposal.endDate}` : ""}
                            </p>
                          </div>
                        ))}
                      </div>
                      {storyWorkspaceStep === 2 && storyWorkspaceDrafts.length > 1 ? (
                        <div className="settings-chip-list" style={{ marginTop: "0.6rem" }}>
                          <button
                            type="button"
                            className="button secondary tap-button"
                            onClick={() => setStoryWorkspaceDraftIndex((idx) => Math.max(0, idx - 1))}
                            disabled={storyWorkspaceDraftIndex === 0}
                          >
                            Previous
                          </button>
                          <button
                            type="button"
                            className="button secondary tap-button"
                            onClick={() => setStoryWorkspaceDraftIndex((idx) => Math.min(storyWorkspaceDrafts.length - 1, idx + 1))}
                            disabled={storyWorkspaceDraftIndex >= storyWorkspaceDrafts.length - 1}
                          >
                            Next
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="story-workspace-side">
                  <div className="card" style={{ border: "1px solid #E7EAF0", borderRadius: "0.8rem" }}>
                    <div className="settings-chip-list" style={{ justifyContent: "space-between" }}>
                      <h5 style={{ margin: 0 }}>Guided Workflow</h5>
                      <div className="settings-chip-list">
                        <button
                          type="button"
                          className={`tab-pill ${storyWorkspaceStep === 1 ? "active" : ""}`}
                          onClick={() => setStoryWorkspaceStep(1)}
                        >
                          Step 1
                        </button>
                        <button
                          type="button"
                          className={`tab-pill ${storyWorkspaceStep === 2 ? "active" : ""}`}
                          onClick={() => setStoryWorkspaceStep(2)}
                          disabled={storyWorkspaceDrafts.length === 0}
                        >
                          Step 2
                        </button>
                      </div>
                    </div>

                    {storyWorkspaceStep === 1 ? (
                      <div style={{ marginTop: "0.6rem", display: "grid", gap: "0.55rem" }}>
                        <p className="page-subtitle" style={{ margin: 0 }}>
                          Step 1: identify attributes/stories, consolidate related facts, and add AI guidance for missing or too-granular discovery.
                        </p>
                        <div style={{ maxHeight: "210px", overflowY: "auto", display: "grid", gap: "0.45rem" }}>
                          {storyWorkspaceDrafts.length > 0 ? storyWorkspaceDrafts.map((draft) => (
                            <label key={draft.localId} style={{ border: "1px solid #E7EAF0", borderRadius: "0.6rem", padding: "0.5rem", display: "grid", gap: "0.35rem" }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
                                <input
                                  type="checkbox"
                                  checked={draft.selected}
                                  onChange={(event) => updateStoryWorkspaceDraft(draft.localId, { selected: event.target.checked })}
                                />
                                <strong>{draft.attributeDetail || draft.label || "(untitled)"}</strong>
                              </span>
                              <span className="page-subtitle">{draft.attributeKind} / {draft.attributeType}{draft.attributeTypeCategory ? ` / ${draft.attributeTypeCategory}` : ""}</span>
                            </label>
                          )) : <p className="page-subtitle" style={{ margin: 0 }}>Generate drafts to begin Step 1.</p>}
                        </div>
                        <button
                          type="button"
                          className="button secondary tap-button"
                          onClick={consolidateSelectedWorkspaceDrafts}
                          disabled={storyImportBusy || storyChatBusy || storyWorkspaceDrafts.filter((item) => item.selected).length < 2}
                        >
                          Consolidate Selected Into One Story
                        </button>
                        <label className="label">Ask AI</label>
                        <textarea
                          className="textarea"
                          value={storyChatInput}
                          onChange={(event) => setStoryChatInput(event.target.value)}
                          placeholder="Ask AI what to consolidate, what is missing, or how to adjust granularity."
                          style={{ minHeight: "4.8rem" }}
                          disabled={storyChatBusy || storyImportBusy}
                        />
                        {storyChatSuggestion ? (
                          <div style={{ border: "1px solid #E7EAF0", borderRadius: "0.6rem", padding: "0.55rem", background: "#fff" }}>
                            <p style={{ margin: 0 }}><strong>Latest AI Suggestion</strong></p>
                            <p className="page-subtitle" style={{ margin: "0.25rem 0 0" }}>
                              Title: {storyChatSuggestion.titleHint || "-"} | Dates: {storyChatSuggestion.startDate || "-"}{storyChatSuggestion.endDate ? ` to ${storyChatSuggestion.endDate}` : ""} | Type: {storyChatSuggestion.attributeType || "-"}{storyChatSuggestion.attributeTypeCategory ? `/${storyChatSuggestion.attributeTypeCategory}` : ""}
                            </p>
                            <div className="settings-chip-list" style={{ marginTop: "0.45rem" }}>
                              <button
                                type="button"
                                className="button secondary tap-button"
                                onClick={applyStoryChatSuggestion}
                                disabled={storyChatBusy || storyImportBusy}
                              >
                                Apply Suggestion
                              </button>
                            </div>
                          </div>
                        ) : null}
                        {storyChatMessages.length > 0 ? (
                          <div style={{ border: "1px solid #E7EAF0", borderRadius: "0.6rem", padding: "0.55rem", maxHeight: "140px", overflowY: "auto" }}>
                            {storyChatMessages.map((message, index) => (
                              <p key={`step1-chat-${index}`} className="page-subtitle" style={{ margin: "0.15rem 0" }}>
                                <strong>{message.role === "user" ? "You" : "AI"}:</strong> {message.content}
                              </p>
                            ))}
                          </div>
                        ) : null}
                        <div className="settings-chip-list">
                          <button
                            type="button"
                            className="button secondary tap-button"
                            onClick={() => void requestStoryChatSuggestion()}
                            disabled={storyChatBusy || storyImportBusy}
                          >
                            {storyChatBusy ? "Asking..." : "Ask AI"}
                          </button>
                          <button
                            type="button"
                            className="button secondary tap-button"
                            onClick={() => void generateStoryImportDrafts()}
                            disabled={storyImportBusy || storyChatBusy}
                          >
                            {storyImportBusy ? "Rebuilding..." : "Rebuild Drafts"}
                          </button>
                          <button
                            type="button"
                            className="button tap-button"
                            onClick={() => setStoryWorkspaceStep(2)}
                            disabled={storyWorkspaceDrafts.length === 0}
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ marginTop: "0.6rem", display: "grid", gap: "0.55rem" }}>
                        <p className="page-subtitle" style={{ margin: 0 }}>
                          Step 2: review draft attribute form fields, edit as needed, then save.
                        </p>
                        {currentWorkspaceDraft ? (
                          <div style={{ border: "1px solid #E7EAF0", borderRadius: "0.7rem", padding: "0.6rem", display: "grid", gap: "0.45rem" }}>
                            <div className="settings-chip-list" style={{ justifyContent: "space-between" }}>
                              <strong>Draft {storyWorkspaceDraftIndex + 1} of {storyWorkspaceDrafts.length}</strong>
                              <span className="status-chip status-chip--neutral">{currentWorkspaceDraft.attributeKind}</span>
                            </div>
                            <div className="settings-chip-list" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                              <div style={{ minWidth: 0 }}>
                                <label className="label">Attribute Type</label>
                                <select
                                  className="input"
                                  value={currentWorkspaceDraft.attributeType}
                                  onChange={(event) => {
                                    const nextType = event.target.value;
                                    const nextTypeCategoryOptions =
                                      workspaceTypeCategoryOptionsByType.get(
                                        makeAttributeDefinitionCategoryId(
                                          currentWorkspaceDraft.attributeKind === "event" ? "event" : "descriptor",
                                          normalizeAttributeKey(nextType),
                                        ),
                                      ) ?? [];
                                    updateStoryWorkspaceDraft(currentWorkspaceDraft.localId, {
                                      attributeType: nextType,
                                      attributeTypeCategory:
                                        nextTypeCategoryOptions.some(
                                          (item) => normalizeAttributeKey(item.value) === normalizeAttributeKey(currentWorkspaceDraft.attributeTypeCategory),
                                        )
                                          ? currentWorkspaceDraft.attributeTypeCategory
                                          : "",
                                    });
                                  }}
                                >
                                  {currentWorkspaceTypeOptions.length === 0 ? (
                                    <option value={currentWorkspaceDraft.attributeType || ""}>
                                      {toTitleWords(currentWorkspaceDraft.attributeType || "type")}
                                    </option>
                                  ) : (
                                    currentWorkspaceTypeOptions.map((item) => (
                                      <option key={item.value} value={item.value}>
                                        {item.label}
                                      </option>
                                    ))
                                  )}
                                </select>
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <label className="label">Type Category</label>
                                <select
                                  className="input"
                                  value={currentWorkspaceDraft.attributeTypeCategory}
                                  onChange={(event) => updateStoryWorkspaceDraft(currentWorkspaceDraft.localId, { attributeTypeCategory: event.target.value })}
                                >
                                  <option value="">Select category</option>
                                  {currentWorkspaceTypeCategoryOptions.map((item) => (
                                    <option key={item.value} value={item.value}>
                                      {item.label}
                                    </option>
                                  ))}
                                  {currentWorkspaceDraft.attributeTypeCategory &&
                                  !currentWorkspaceTypeCategoryOptions.some(
                                    (item) => normalizeAttributeKey(item.value) === normalizeAttributeKey(currentWorkspaceDraft.attributeTypeCategory),
                                  ) ? (
                                    <option value={currentWorkspaceDraft.attributeTypeCategory}>{toTitleWords(currentWorkspaceDraft.attributeTypeCategory)}</option>
                                  ) : null}
                                </select>
                              </div>
                            </div>
                            <label className="label">{currentWorkspaceDetailLabel}</label>
                            <input
                              className="input"
                              list="story-workspace-detail-picklist"
                              value={currentWorkspaceDraft.attributeDetail}
                              onChange={(event) => updateStoryWorkspaceDraft(currentWorkspaceDraft.localId, { attributeDetail: event.target.value })}
                            />
                            {workspaceDetailSuggestionOptions.length > 0 ? (
                              <datalist id="story-workspace-detail-picklist">
                                {workspaceDetailSuggestionOptions.map((item) => (
                                  <option key={item} value={item} />
                                ))}
                              </datalist>
                            ) : null}
                            <div className="settings-chip-list" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                              <div style={{ minWidth: 0 }}>
                                <label className="label">Date</label>
                                <input
                                  className="input"
                                  type="date"
                                  value={currentWorkspaceDraft.attributeDate}
                                  onChange={(event) => updateStoryWorkspaceDraft(currentWorkspaceDraft.localId, { attributeDate: event.target.value })}
                                />
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <label className="label">End Date</label>
                                <input
                                  className="input"
                                  type="date"
                                  value={currentWorkspaceDraft.endDate}
                                  onChange={(event) => updateStoryWorkspaceDraft(currentWorkspaceDraft.localId, { endDate: event.target.value })}
                                />
                              </div>
                            </div>
                            <label className="label">Notes</label>
                            <textarea
                              className="textarea"
                              value={currentWorkspaceDraft.attributeNotes}
                              onChange={(event) => updateStoryWorkspaceDraft(currentWorkspaceDraft.localId, { attributeNotes: event.target.value })}
                              style={{ minHeight: "8rem" }}
                            />
                            <div className="settings-chip-list">
                              <button
                                type="button"
                                className="button secondary tap-button"
                                onClick={() => setStoryWorkspaceDraftIndex((idx) => Math.max(0, idx - 1))}
                                disabled={storyWorkspaceDraftIndex === 0}
                              >
                                Previous Draft
                              </button>
                              <button
                                type="button"
                                className="button secondary tap-button"
                                onClick={() => setStoryWorkspaceDraftIndex((idx) => Math.min(storyWorkspaceDrafts.length - 1, idx + 1))}
                                disabled={storyWorkspaceDraftIndex >= storyWorkspaceDrafts.length - 1}
                              >
                                Next Draft
                              </button>
                              <button
                                type="button"
                                className="button tap-button"
                                onClick={() => void saveWorkspaceDraft(currentWorkspaceDraft.localId)}
                                disabled={currentWorkspaceDraft.saveBusy}
                              >
                                {currentWorkspaceDraft.saveBusy ? "Saving..." : "Save Draft"}
                              </button>
                            </div>
                            {currentWorkspaceDraft.saveStatus ? <p className="page-subtitle" style={{ margin: 0 }}>{currentWorkspaceDraft.saveStatus}</p> : null}
                          </div>
                        ) : <p className="page-subtitle" style={{ margin: 0 }}>No drafts available yet.</p>}
                        <div className="settings-chip-list">
                          <button
                            type="button"
                            className="button secondary tap-button"
                            onClick={() => setStoryWorkspaceStep(1)}
                          >
                            Back
                          </button>
                        </div>
                      </div>
                    )}
                    {storyChatStatus ? <p style={{ marginTop: "0.55rem", marginBottom: 0 }}>{storyChatStatus}</p> : null}
                  </div>
                </div>
              </div>
              {(storyImportHints.titleHint || storyImportHints.startDate || storyImportHints.endDate || storyImportHints.attributeType || storyImportHints.attributeTypeCategory) ? (
                <p className="page-subtitle" style={{ marginTop: "0.7rem", marginBottom: 0 }}>
                  Draft hints applied: title={storyImportHints.titleHint || "-"}, dates={storyImportHints.startDate || "-"}{storyImportHints.endDate ? ` to ${storyImportHints.endDate}` : ""}, type={storyImportHints.attributeType || "-"}{storyImportHints.attributeTypeCategory ? `/${storyImportHints.attributeTypeCategory}` : ""}
                </p>
              ) : null}
              {storyImportStatus ? <p style={{ marginTop: "0.75rem", marginBottom: 0 }}>{storyImportStatus}</p> : null}
              <div className="settings-chip-list" style={{ marginTop: "0.75rem" }}>
                <button
                  type="button"
                  className="button secondary tap-button"
                  disabled={storyImportBusy || storyChatBusy}
                  onClick={() => {
                    setShowStoryImportModal(false);
                    setStoryImportStatus("");
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <ModalActionBar
          status={status ? <ModalStatusBanner tone={personStatusTone}>{status}</ModalStatusBanner> : null}
          actions={
            <>
              <AsyncActionButton
                type="button"
                tone="secondary"
                className="tap-button"
                disabled={saving}
                onClick={isContactTabEditing ? handleCancelSectionEdit : onClose}
              >
                {isContactTabEditing ? "Cancel" : "Close"}
              </AsyncActionButton>
              {isContactTabEditing ? (
                <AsyncActionButton
                  type="button"
                  className="tap-button"
                  pending={saving}
                  pendingLabel="Saving..."
                  disabled={showReadOnly || saving}
                  onClick={() => {
                    void saveProfileSection();
                  }}
                >
                  Save and Close
                </AsyncActionButton>
              ) : null}
            </>
          }
        />
        </div>
      </div>
    </div>
  );
}
