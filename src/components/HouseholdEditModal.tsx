"use client";

import { useEffect, useState } from "react";
import { getPhotoPreviewProxyPath, getPhotoProxyPath } from "@/lib/google/photo-path";
import { AttributesModal } from "@/components/AttributesModal";
import { MediaAttachWizard, formatMediaAttachUserSummary } from "@/components/media/MediaAttachWizard";
import {
  AsyncActionButton,
  ModalActionBar,
  ModalCloseButton,
  ModalStatusBanner,
  inferStatusTone,
} from "@/components/ui/primitives";
import { matchesCanonicalMediaFileId, type AttributeWithMedia } from "@/lib/attributes/media-response";
import type { AttributeEventDefinitions } from "@/lib/attributes/event-definitions-types";
import type { MediaAttachExecutionSummary } from "@/lib/media/attach-orchestrator";
import { inferStoredMediaKind } from "@/lib/media/upload";

type HouseholdSummary = {
  householdId: string;
  husbandPersonId: string;
  wifePersonId: string;
  husbandName: string;
  wifeName: string;
  label: string;
  notes: string;
  weddingPhotoFileId: string;
  marriedDate: string;
  address: string;
  city: string;
  state: string;
  zip: string;
};

type HouseholdAttribute = {
  attributeId: string;
  attributeType: string;
  attributeTypeCategory: string;
  attributeDate: string;
  endDate: string;
  attributeDetail: string;
  valueText: string;
  category: "descriptor" | "event";
  typeKey: string;
  createdAt: string;
};

type ChildSummary = {
  personId: string;
  displayName: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  maidenName?: string;
  nickName?: string;
  birthDate: string;
  gender: "male" | "female" | "unspecified";
  photoFileId?: string;
  phones?: string;
  email?: string;
  address?: string;
  hobbies?: string;
  notes?: string;
  familyGroupRelationshipType?: "founder" | "direct" | "in_law" | "undeclared";
};

type HouseholdPhoto = {
  photoId: string;
  fileId: string;
  name: string;
  description: string;
  photoDate: string;
  isPrimary: boolean;
  mediaMetadata?: string;
};

type PersonOption = {
  personId: string;
  displayName: string;
  gender?: "male" | "female" | "unspecified";
  photoFileId?: string;
};

type HouseholdOption = {
  householdId: string;
  label: string;
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
  householdId: string;
  onClose: () => void;
  onSaved: () => void;
  onEditPerson?: (personId: string, personSeed?: ChildSummary) => void;
};

type TabKey = "info" | "children" | "pictures";

type LinkedSearchResult =
  | { kind: "person"; key: string; displayName: string; personId: string; gender: "male" | "female" | "unspecified" }
  | { kind: "household"; key: string; displayName: string; householdId: string };

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

function inferHouseholdMediaKind(fileId: string, raw?: string) {
  return inferStoredMediaKind(fileId, raw);
}

function isVideoMediaByMetadata(fileId: string, raw?: string) {
  return inferHouseholdMediaKind(fileId, raw) === "video";
}

function isAudioMediaByMetadata(fileId: string, raw?: string) {
  return inferHouseholdMediaKind(fileId, raw) === "audio";
}

function isDocumentMediaByMetadata(fileId: string, raw?: string) {
  return inferHouseholdMediaKind(fileId, raw) === "document";
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

function toPlainText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => toPlainText(item)).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    return (
      toPlainText(source.label)
      || toPlainText(source.name)
      || toPlainText(source.valueText)
      || toPlainText(source.value)
      || toPlainText(source.text)
    );
  }
  return "";
}

function toPrettyLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .trim();
}

function householdAttributeChipLabel(item: HouseholdAttribute) {
  const category = toPrettyLabel(toPlainText(item.attributeTypeCategory) || toPlainText(item.attributeType) || toPlainText(item.typeKey));
  const detail = toPlainText(item.attributeDetail) || toPlainText(item.valueText);
  if (category && detail) return `${category}: ${detail}`;
  return category || detail || "Attribute";
}

function toSortTimestamp(item: HouseholdAttribute) {
  const first = Date.parse(toPlainText(item.attributeDate));
  if (Number.isFinite(first)) return first;
  const second = Date.parse(toPlainText(item.endDate));
  if (Number.isFinite(second)) return second;
  const created = Date.parse(toPlainText(item.createdAt));
  if (Number.isFinite(created)) return created;
  return Number.NaN;
}

function parseDate(value?: string) {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, year, month, day] = match;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function isOlderThanAge(value: string | undefined, minimumYears: number) {
  const parsed = parseDate(value);
  if (!parsed) {
    return false;
  }
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - minimumYears);
  return parsed < cutoff;
}

function extractLastName(value?: string) {
  const parts = String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function formatAddChildError(status: number, body: unknown) {
  const payload = (body && typeof body === "object" ? body : null) as
    | {
      message?: unknown;
      error?: unknown;
      issues?: { formErrors?: unknown[]; fieldErrors?: Record<string, unknown> };
    }
    | null;
  const fieldMessages = Object.values(payload?.issues?.fieldErrors ?? {})
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (fieldMessages.length > 0) {
    return `Cannot save child. ${fieldMessages.join(" ")}`;
  }
  const formMessages = Array.isArray(payload?.issues?.formErrors)
    ? payload.issues.formErrors.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  if (formMessages.length > 0) {
    return `Cannot save child. ${formMessages.join(" ")}`;
  }
  const message =
    (typeof payload?.message === "string" && payload.message.trim())
    || (typeof payload?.error === "string" && payload.error.trim().replace(/_/g, " "));
  return message ? `Add child failed: ${status} ${message}` : `Add child failed: ${status}`;
}

export function HouseholdEditModal({ open, tenantKey, householdId, onClose, onSaved, onEditPerson }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("info");
  const [household, setHousehold] = useState<HouseholdSummary | null>(null);
  const [children, setChildren] = useState<ChildSummary[]>([]);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [weddingPhotoFileId, setWeddingPhotoFileId] = useState("");
  const [marriedDate, setMarriedDate] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateValue, setStateValue] = useState("");
  const [zip, setZip] = useState("");
  const [householdAttributes, setHouseholdAttributes] = useState<HouseholdAttribute[]>([]);
  const [householdAttributeStatus, setHouseholdAttributeStatus] = useState("");
  const [householdTimelineSort, setHouseholdTimelineSort] = useState<"asc" | "desc">("desc");
  const [eventCategoryColorByKey, setEventCategoryColorByKey] = useState<Record<string, string>>({});
  const [showHouseholdAttributesModal, setShowHouseholdAttributesModal] = useState(false);
  const [selectedHouseholdAttributeId, setSelectedHouseholdAttributeId] = useState("");
  const [photos, setPhotos] = useState<HouseholdPhoto[]>([]);
  const [selectedPhotoId, setSelectedPhotoId] = useState("");
  const [showPhotoDetail, setShowPhotoDetail] = useState(false);
  const [showMediaAttachWizard, setShowMediaAttachWizard] = useState(false);
  const [largePhotoFileId, setLargePhotoFileId] = useState("");
  const [largePhotoIsVideo, setLargePhotoIsVideo] = useState(false);
  const [largePhotoIsDocument, setLargePhotoIsDocument] = useState(false);
  const [largePhotoIsAudio, setLargePhotoIsAudio] = useState(false);
  const [addChildOpen, setAddChildOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [maidenName, setMaidenName] = useState("");
  const [nickName, setNickName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState<"" | "male" | "female">("");
  const [childAddress, setChildAddress] = useState("");
  const [addChildStatus, setAddChildStatus] = useState("");
  const [availablePeople, setAvailablePeople] = useState<PersonOption[]>([]);
  const [availableHouseholds, setAvailableHouseholds] = useState<HouseholdOption[]>([]);
  const [linkOptionsLoaded, setLinkOptionsLoaded] = useState(false);
  const [selectedPhotoAssociations, setSelectedPhotoAssociations] = useState<{
    people: Array<{ personId: string; displayName: string }>;
    households: Array<{ householdId: string; label: string }>;
  }>({ people: [], households: [] });
  const [associationStatus, setAssociationStatus] = useState("");
  const [linkQuery, setLinkQuery] = useState("");
  const [associationBusy, setAssociationBusy] = useState(false);
  const [pendingOps, setPendingOps] = useState<Set<string>>(new Set());
  const canShowChildMaidenName = gender === "female" && isOlderThanAge(birthDate, 19);
  const defaultChildLastName = extractLastName(household?.husbandName);
  const householdStatusTone = inferStatusTone(status);

  const resetAddChildForm = () => {
    setFirstName("");
    setMiddleName("");
    setLastName(defaultChildLastName);
    setMaidenName("");
    setNickName("");
    setDisplayName("");
    setBirthDate("");
    setGender("");
    setChildAddress("");
    setAddChildStatus("");
  };

  const refresh = async () => {
    setLoading(true);
    const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(householdId)}`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.household) {
      const hint = typeof body?.hint === "string" ? body.hint : "";
      const message = typeof body?.message === "string" ? body.message : "";
      setStatus(`Load failed: ${res.status}${message ? ` ${message}` : ""}${hint ? ` | ${hint}` : ""}`);
      setLoading(false);
      return false;
    }
    const next = body.household as HouseholdSummary;
    setHousehold(next);
    setChildren(Array.isArray(body.children) ? (body.children as ChildSummary[]) : []);
    setPhotos(Array.isArray(body.photos) ? (body.photos as HouseholdPhoto[]) : []);
    setSelectedPhotoId("");
    setShowPhotoDetail(false);
    setLargePhotoFileId("");
    setLargePhotoIsVideo(false);
    setLargePhotoIsDocument(false);
    setLargePhotoIsAudio(false);
    setWeddingPhotoFileId(String(next.weddingPhotoFileId ?? ""));
    setMarriedDate(String(next.marriedDate ?? ""));
    setLabel(String(next.label ?? ""));
    setNotes(String(next.notes ?? ""));
    setAddress(String(next.address ?? ""));
    setCity(String(next.city ?? ""));
    setStateValue(String(next.state ?? ""));
    setZip(String(next.zip ?? ""));
    setLoading(false);
    setStatus("");
    setAddChildStatus("");
    setSelectedPhotoAssociations({ people: [], households: [] });
    setAssociationStatus("");
    setLinkQuery("");
    await refreshHouseholdAttributes();
    return true;
  };

  const refreshHouseholdAttributes = async () => {
    const res = await fetch(
      `/api/attributes?entity_type=household&entity_id=${encodeURIComponent(householdId)}`,
      { cache: "no-store" },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setHouseholdAttributeStatus(`Attributes load failed: ${res.status}`);
      setHouseholdAttributes([]);
      return;
    }
    const next = Array.isArray(body?.attributes) ? (body.attributes as HouseholdAttribute[]) : [];
    setHouseholdAttributes(next);
    setHouseholdAttributeStatus("");
  };

  const refreshSelectedPhotoAssociations = async (fileId: string) => {
    const res = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/photos/search?q=${encodeURIComponent(fileId)}`,
      { cache: "no-store" },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setSelectedPhotoAssociations({ people: [], households: [] });
      return;
    }
    const item = (Array.isArray(body?.items) ? (body.items as PhotoLibraryItem[]) : []).find((entry) => entry.fileId === fileId);
    setSelectedPhotoAssociations({
      people: item?.people ?? [],
      households: item?.households ?? [],
    });
  };

  const loadLinkOptions = async () => {
    const [peopleRes, householdsRes] = await Promise.all([
      fetch(`/api/t/${encodeURIComponent(tenantKey)}/people`, { cache: "no-store" }),
      fetch(`/api/t/${encodeURIComponent(tenantKey)}/households`, { cache: "no-store" }),
    ]);
    const peopleBody = await peopleRes.json().catch(() => null);
    const householdsBody = await householdsRes.json().catch(() => null);
    if (peopleRes.ok) {
      const items = Array.isArray(peopleBody?.people)
        ? (peopleBody.people as Array<{ personId: string; displayName: string; gender?: "male" | "female" | "unspecified"; photoFileId?: string }>)
        : [];
      setAvailablePeople(
        items.map((item) => ({
          personId: item.personId,
          displayName: item.displayName,
          gender: item.gender ?? "unspecified",
          photoFileId: item.photoFileId ?? "",
        })),
      );
    }
    if (householdsRes.ok) {
      const items = Array.isArray(householdsBody?.households)
        ? (householdsBody.households as Array<{ householdId: string; label: string }>)
        : [];
      setAvailableHouseholds(items.map((item) => ({ householdId: item.householdId, label: item.label || item.householdId })));
    }
  };

  const handleWizardComplete = async (summary: MediaAttachExecutionSummary) => {
    setStatus(formatMediaAttachUserSummary(summary));
    await refresh();
    onSaved();
  };

  const selectedPhoto = photos.find((photo) => photo.photoId === selectedPhotoId) ?? null;

  const linkSelectedPhotoToPerson = async (targetPersonId: string) => {
    if (!selectedPhoto || !targetPersonId) return false;
    setAssociationBusy(true);
    setAssociationStatus("Linking person...");
    const res = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(targetPersonId)}/attributes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attributeType: "photo",
          valueText: selectedPhoto.fileId,
          label: selectedPhoto.name || "photo",
          notes: selectedPhoto.description || "",
          startDate: selectedPhoto.photoDate || "",
          visibility: "family",
          shareScope: "both_families",
          shareFamilyGroupKey: "",
          sortOrder: 0,
          isPrimary: false,
        }),
      },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message = body?.message || body?.error || "";
      setAssociationStatus(`Link failed: ${res.status} ${String(message).slice(0, 120)}`);
      setAssociationBusy(false);
      return false;
    }
    await refreshSelectedPhotoAssociations(selectedPhoto.fileId);
    setAssociationStatus("Person linked.");
    setAssociationBusy(false);
    return true;
  };

  const removePhotoAssociationFromPerson = async (targetPersonId: string, fileId: string) => {
    setAssociationBusy(true);
    setAssociationStatus("Removing person link...");
    const attrsRes = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/attributes?entity_type=person&entity_id=${encodeURIComponent(targetPersonId)}`,
      { cache: "no-store" },
    );
    const attrsBody = await attrsRes.json().catch(() => null);
    if (!attrsRes.ok) {
      setAssociationStatus("Remove failed.");
      setAssociationBusy(false);
      return false;
    }
    const attrs = Array.isArray(attrsBody?.attributes) ? (attrsBody.attributes as AttributeWithMedia[]) : [];
    const matches = attrs.filter((item) => matchesCanonicalMediaFileId(item, fileId));
    for (const match of matches) {
      await fetch(
        `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(targetPersonId)}/attributes/${encodeURIComponent(match.attributeId)}`,
        { method: "DELETE" },
      );
    }
    await refreshSelectedPhotoAssociations(fileId);
    setAssociationStatus("Person link removed.");
    setAssociationBusy(false);
    return true;
  };

  const linkSelectedPhotoToHousehold = async (targetHouseholdId: string) => {
    if (!selectedPhoto || !targetHouseholdId) return false;
    setAssociationBusy(true);
    setAssociationStatus("Linking household...");
    const res = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(targetHouseholdId)}/photos/link`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: selectedPhoto.fileId,
          name: selectedPhoto.name || "photo",
          description: selectedPhoto.description || "",
          photoDate: selectedPhoto.photoDate || "",
          mediaMetadata: selectedPhoto.mediaMetadata || "",
          isPrimary: false,
        }),
      },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message = body?.message || body?.error || "";
      setAssociationStatus(`Link failed: ${res.status} ${String(message).slice(0, 120)}`);
      setAssociationBusy(false);
      return false;
    }
    await refreshSelectedPhotoAssociations(selectedPhoto.fileId);
    setAssociationStatus("Household linked.");
    setAssociationBusy(false);
    return true;
  };

  const removePhotoAssociationFromHousehold = async (targetHouseholdId: string, fileId: string) => {
    setAssociationBusy(true);
    setAssociationStatus("Removing household link...");
    const res = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(targetHouseholdId)}/photos/${encodeURIComponent(fileId)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      setAssociationStatus("Remove failed.");
      setAssociationBusy(false);
      return false;
    }
    await refreshSelectedPhotoAssociations(fileId);
    if (targetHouseholdId === householdId) {
      await refresh();
      setShowPhotoDetail(false);
      setSelectedPhotoId("");
      onSaved();
    }
    setAssociationStatus("Household link removed.");
    setAssociationBusy(false);
    return true;
  };

  useEffect(() => {
    if (canShowChildMaidenName) {
      return;
    }
    if (maidenName) {
      setMaidenName("");
    }
  }, [canShowChildMaidenName, maidenName]);

  useEffect(() => {
    if (!open || !householdId) {
      return;
    }
    setActiveTab("info");
    setAddChildOpen(false);
    resetAddChildForm();
    setLinkOptionsLoaded(false);
    setStatus("Loading household...");
    void refresh();
  }, [open, householdId, tenantKey]);

  useEffect(() => {
    if (!open || activeTab !== "pictures" || linkOptionsLoaded) return;
    void (async () => {
      await loadLinkOptions();
      setLinkOptionsLoaded(true);
    })();
  }, [activeTab, linkOptionsLoaded, open, tenantKey]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const loadDefinitions = async () => {
      const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/attribute-definitions`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.definitions || cancelled) return;
      const defs = body.definitions as AttributeEventDefinitions;
      const next: Record<string, string> = {};
      for (const row of defs.categories ?? []) {
        const key = toPlainText(row.categoryKey).toLowerCase();
        const color = toPlainText(row.categoryColor) || "#e5e7eb";
        if (key) next[key] = color;
      }
      setEventCategoryColorByKey(next);
    };
    void loadDefinitions();
    return () => {
      cancelled = true;
    };
  }, [open, tenantKey]);

  useEffect(() => {
    if (!selectedPhoto || !showPhotoDetail) {
      setSelectedPhotoAssociations({ people: [], households: [] });
      return;
    }
    void refreshSelectedPhotoAssociations(selectedPhoto.fileId);
  }, [selectedPhoto, showPhotoDetail, tenantKey]);

  if (!open) {
    return null;
  }

  const linkedPersonIds = new Set(selectedPhotoAssociations.people.map((item) => item.personId));
  const linkedHouseholdIds = new Set(selectedPhotoAssociations.households.map((item) => item.householdId));
  const peopleById = new Map(availablePeople.map((item) => [item.personId, item]));
  const linkQueryNormalized = linkQuery.trim().toLowerCase();
  const linkSearchResults: LinkedSearchResult[] =
    !linkQueryNormalized
      ? []
      : [
          ...availablePeople
            .filter((item) => item.displayName.toLowerCase().includes(linkQueryNormalized) && !linkedPersonIds.has(item.personId))
            .map((item) => ({
              kind: "person" as const,
              key: `person-${item.personId}`,
              displayName: item.displayName,
              personId: item.personId,
              gender: item.gender ?? "unspecified",
            })),
          ...availableHouseholds
            .filter((item) => item.label.toLowerCase().includes(linkQueryNormalized) && !linkedHouseholdIds.has(item.householdId))
            .map((item) => ({
              kind: "household" as const,
              key: `household-${item.householdId}`,
              displayName: item.label || item.householdId,
              householdId: item.householdId,
            })),
        ].slice(0, 10);

  const husbandTile = household?.husbandPersonId
    ? availablePeople.find((item) => item.personId === household.husbandPersonId) ?? {
        personId: household.husbandPersonId,
        displayName: household.husbandName || "Husband",
        gender: "male" as const,
        photoFileId: "",
      }
    : null;
  const wifeTile = household?.wifePersonId
    ? availablePeople.find((item) => item.personId === household.wifePersonId) ?? {
        personId: household.wifePersonId,
        displayName: household.wifeName || "Wife",
        gender: "female" as const,
        photoFileId: "",
      }
    : null;
  const householdParentSummary = [household?.wifeName, household?.husbandName].filter(Boolean).join(" | ") || "-";
  const householdHeading = husbandTile && wifeTile ? "Marriage" : "Household";
  const spouseHeadshotFileId = wifeTile?.photoFileId || husbandTile?.photoFileId || "";
  const sortedHouseholdTimeline = householdAttributes
    .filter((item) => {
      const typeKey = toPlainText(item.attributeType || item.typeKey).toLowerCase();
      return !["photo", "video", "audio", "media", "in_law"].includes(typeKey);
    })
    .slice()
    .sort((a, b) => {
      const aMs = toSortTimestamp(a);
      const bMs = toSortTimestamp(b);
      const aHas = Number.isFinite(aMs);
      const bHas = Number.isFinite(bMs);
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      if (aHas && bHas) return householdTimelineSort === "asc" ? aMs - bMs : bMs - aMs;
      return householdAttributeChipLabel(a).localeCompare(householdAttributeChipLabel(b));
    });
  const chipColorStyle = (rawTypeKey: string) => {
    const color = eventCategoryColorByKey[toPlainText(rawTypeKey).toLowerCase()] || "#d9e2ec";
    return {
      borderColor: color,
      background: `${color}33`,
    } as const;
  };
  const imageSrc = weddingPhotoFileId
    ? getPhotoProxyPath(weddingPhotoFileId, tenantKey)
    : spouseHeadshotFileId
      ? getPhotoProxyPath(spouseHeadshotFileId, tenantKey)
      : "/WeddingAvatar1.png";

  const openPersonDetail = (child: ChildSummary) => {
    if (!child.personId) return;
    if (onEditPerson) {
      onClose();
      onEditPerson(child.personId, child);
      return;
    }
    if (typeof window !== "undefined") {
      window.location.href = `/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(child.personId)}`;
    }
  };

  const openPersonDetailById = (personId: string) => {
    if (!personId) return;
    const child = children.find((item) => item.personId === personId);
    if (child) {
      openPersonDetail(child);
      return;
    }
    if (onEditPerson) {
      onClose();
      onEditPerson(personId);
      return;
    }
    if (typeof window !== "undefined") {
      window.location.href = `/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(personId)}`;
    }
  };

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
              src={imageSrc}
              alt="Household cover"
              className="person-modal-avatar"
              style={{ width: 84, height: 64 }}
            />
            <div>
              <h3 className="person-modal-title">{household?.label || "Household"}</h3>
              <p className="person-modal-meta">
                {householdParentSummary}
              </p>
              <p className="person-modal-meta">Household ID: {householdId}</p>
            </div>
            <ModalCloseButton className="modal-close-button--floating" disabled={loading || saving} onClick={onClose} />
          </div>
        </div>

        <div className="person-modal-tabs">
          <button type="button" className={`tab-pill ${activeTab === "info" ? "active" : ""}`} onClick={() => setActiveTab("info")}>Info</button>
          <button type="button" className={`tab-pill ${activeTab === "children" ? "active" : ""}`} onClick={() => setActiveTab("children")}>Children</button>
          <button type="button" className={`tab-pill ${activeTab === "pictures" ? "active" : ""}`} onClick={() => setActiveTab("pictures")}>Pictures</button>
        </div>
        <div className="person-modal-content">

        {loading && status ? <ModalStatusBanner tone="pending">{status}</ModalStatusBanner> : null}

        {!loading && household ? (
          <>
            {activeTab === "info" ? (
              <>
                <div className="person-section-grid">
                  <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: "260px" }}>
                    <h4 className="ui-section-title">{householdHeading}</h4>
                    <label className="label">Household Label</label>
                    <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Household name" />
                    {(husbandTile || wifeTile) ? (
                      <div className="people-grid album-grid" style={{ marginTop: "0.65rem", marginBottom: "0.55rem" }}>
                        {[husbandTile, wifeTile]
                          .filter((item): item is NonNullable<typeof husbandTile> => Boolean(item))
                          .map((item) => {
                            const fallbackAvatar = getGenderAvatarSrc(item.gender ?? "unspecified");
                            const photoSrc = item.photoFileId
                              ? getPhotoProxyPath(item.photoFileId, tenantKey)
                              : fallbackAvatar;
                            return (
                              <article
                                key={`household-tile-${item.personId}`}
                                className="person-card album-card"
                                role="button"
                                tabIndex={0}
                                onClick={() => openPersonDetailById(item.personId)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    openPersonDetailById(item.personId);
                                  }
                                }}
                              >
                                <div className="person-photo-wrap">
                                  <img src={photoSrc} alt={item.displayName} className="person-photo" />
                                </div>
                                <div className="person-card-content">
                                  <h3>{item.displayName}</h3>
                                  <p className="person-meta-row">
                                    <span>{item.gender === "female" ? "Mother" : "Father"}</span>
                                  </p>
                                </div>
                              </article>
                            );
                          })}
                      </div>
                    ) : null}
                    {husbandTile && wifeTile ? (
                      <>
                        <label className="label">Married Date</label>
                        <input
                          className="input"
                          type="date"
                          value={marriedDate}
                          onChange={(e) => setMarriedDate(e.target.value)}
                        />
                      </>
                    ) : null}
                  </div>

                  <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: "260px" }}>
                    <h4 className="ui-section-title">Attributes</h4>
                    <div className="settings-chip-list" style={{ marginBottom: "0.55rem" }}>
                      <button
                        type="button"
                        className={`button secondary tap-button ${householdTimelineSort === "asc" ? "game-option-selected" : ""}`}
                        onClick={() => setHouseholdTimelineSort("asc")}
                      >
                        Ascending
                      </button>
                      <button
                        type="button"
                        className={`button secondary tap-button ${householdTimelineSort === "desc" ? "game-option-selected" : ""}`}
                        onClick={() => setHouseholdTimelineSort("desc")}
                      >
                        Descending
                      </button>
                    </div>
                    <div className="settings-chip-list" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                      {sortedHouseholdTimeline.length > 0 ? (
                        sortedHouseholdTimeline.map((item) => (
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
                              width: "auto",
                              maxWidth: "100%",
                            }}
                            onClick={() => {
                              setSelectedHouseholdAttributeId(item.attributeId);
                              setShowHouseholdAttributesModal(true);
                            }}
                          >
                            <span>{householdAttributeChipLabel(item)}</span>
                          </button>
                        ))
                      ) : (
                        <p className="page-subtitle" style={{ margin: 0 }}>No attributes listed yet.</p>
                      )}
                    </div>
                    <button
                      type="button"
                      className="button secondary tap-button"
                      style={{ marginTop: "auto" }}
                      onClick={() => {
                        setSelectedHouseholdAttributeId("");
                        setShowHouseholdAttributesModal(true);
                      }}
                    >
                      Add Attribute
                    </button>
                    {householdAttributeStatus ? (
                      <p className="page-subtitle" style={{ marginTop: "0.55rem", marginBottom: 0 }}>{householdAttributeStatus}</p>
                    ) : null}
                  </div>

                  <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: "240px" }}>
                    <h4 className="ui-section-title">Address</h4>
                    <label className="label">Address</label>
                    <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address" />
                    <div className="settings-chip-list">
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <label className="label">City</label>
                        <input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
                      </div>
                      <div style={{ flex: 1, minWidth: 110 }}>
                        <label className="label">State</label>
                        <input className="input" value={stateValue} onChange={(e) => setStateValue(e.target.value)} />
                      </div>
                      <div style={{ flex: 1, minWidth: 110 }}>
                        <label className="label">ZIP</label>
                        <input className="input" value={zip} onChange={(e) => setZip(e.target.value)} />
                      </div>
                    </div>
                  </div>

                  <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: "240px" }}>
                    <h4 className="ui-section-title">Household Notes</h4>
                    <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Household notes" />
                  </div>
                </div>
              </>
            ) : null}

            {activeTab === "children" ? (
              <>
                <div className="card">
                  <h4 className="ui-section-title">Children</h4>
                  <div className="settings-table-wrap">
                    <table className="settings-table">
                      <thead>
                        <tr><th>Name</th><th>Birthdate</th></tr>
                      </thead>
                      <tbody>
                        {children.length > 0 ? children.map((child) => (
                          <tr key={child.personId}>
                            <td>
                              <button
                                type="button"
                                className="button secondary tap-button"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "0.45rem",
                                  border: "none",
                                  background: "transparent",
                                  padding: 0,
                                  minHeight: 0,
                                }}
                                onClick={() => openPersonDetail(child)}
                              >
                                <img
                                  src={
                                    (() => {
                                      const person = peopleById.get(child.personId);
                                      if (person?.photoFileId) return getPhotoProxyPath(person.photoFileId, tenantKey);
                                      return getGenderAvatarSrc(person?.gender ?? "unspecified");
                                    })()
                                  }
                                  alt={child.displayName}
                                  style={{
                                    width: "26px",
                                    height: "26px",
                                    borderRadius: "999px",
                                    border: "1px solid #d1d5db",
                                    objectFit: "cover",
                                    background: "#f3f4f6",
                                    flex: "0 0 auto",
                                  }}
                                />
                                <span>{child.displayName}</span>
                              </button>
                            </td>
                            <td>{child.birthDate || "-"}</td>
                          </tr>
                        )) : (
                          <tr><td colSpan={2}>No children linked yet.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <button
                  type="button"
                  className="button secondary tap-button"
                  onClick={() => {
                    if (addChildOpen) {
                      resetAddChildForm();
                      setAddChildOpen(false);
                      return;
                    }
                    resetAddChildForm();
                    setAddChildOpen(true);
                  }}
                >
                  {addChildOpen ? "Cancel Add Child" : "Add Child"}
                </button>

                {addChildOpen ? (
                  <div className="card" style={{ marginTop: "0.75rem" }}>
                    <h4 style={{ marginTop: 0 }}>Add Child</h4>
                    <div className="settings-chip-list">
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <label className="label">First Name</label>
                        <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                      </div>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <label className="label">Middle Name</label>
                        <input className="input" value={middleName} onChange={(e) => setMiddleName(e.target.value)} />
                      </div>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <label className="label">Last Name</label>
                        <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                      </div>
                    </div>
                    <div className="settings-chip-list">
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <label className="label">Nick Name</label>
                        <input className="input" value={nickName} onChange={(e) => setNickName(e.target.value)} />
                      </div>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <label className="label">Display Name</label>
                        <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                      </div>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <label className="label">Birthdate</label>
                        <input className="input" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
                      </div>
                    </div>
                    <label className="label">Child Address (optional)</label>
                    <input
                      className="input"
                      value={childAddress}
                      onChange={(e) => setChildAddress(e.target.value)}
                      placeholder="Physical address if different from household"
                    />
                    <label className="label">Gender</label>
                    <select className="input" value={gender} onChange={(e) => setGender(e.target.value as "" | "male" | "female")}>
                      <option value="">Select gender</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                    {canShowChildMaidenName ? (
                      <>
                        <label className="label">Maiden Name (optional)</label>
                        <input className="input" value={maidenName} onChange={(e) => setMaidenName(e.target.value)} />
                      </>
                    ) : null}
                    {addChildStatus ? (
                      <p style={{ marginTop: "0.75rem", marginBottom: 0, color: addChildStatus.startsWith("Cannot") || addChildStatus.startsWith("Add child failed") ? "#b42318" : "inherit" }}>
                        {addChildStatus}
                      </p>
                    ) : null}

                    <button
                      type="button"
                      className="button tap-button"
                      style={{ marginTop: "0.75rem" }}
                      onClick={() =>
                        void (async () => {
                          const missingFields = [
                            !firstName.trim() ? "First Name" : "",
                            !lastName.trim() ? "Last Name" : "",
                            !birthDate.trim() ? "Birthdate" : "",
                            !gender ? "Gender" : "",
                          ].filter(Boolean);
                          if (missingFields.length > 0) {
                            setAddChildStatus(`Cannot save child. Missing: ${missingFields.join(", ")}.`);
                            return;
                          }
                          setAddChildStatus("Saving child...");
                          const res = await fetch(
                            `/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(householdId)}/children`,
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                first_name: firstName,
                                middle_name: middleName,
                                last_name: lastName,
                                nick_name: nickName,
                                display_name: displayName,
                                maiden_name: canShowChildMaidenName ? maidenName : "",
                                birth_date: birthDate,
                                gender,
                                address: childAddress,
                              }),
                            },
                          );
                          const body = await res.json().catch(() => null);
                          if (!res.ok) {
                            setAddChildStatus(formatAddChildError(res.status, body));
                            return;
                          }
                          setAddChildOpen(false);
                          resetAddChildForm();
                          const refreshed = await refresh();
                          if (refreshed) {
                            setStatus("Child saved.");
                          }
                          onSaved();
                        })()
                      }
                    >
                      Save Child
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}

            {activeTab === "pictures" ? (
              <>
                <div className="card person-photo-gallery-card">
                  <div className="person-photo-gallery-toolbar">
                    <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Gallery</h4>
                    <div className="person-photo-gallery-actions">
                      <button type="button" className="button tap-button" onClick={() => setShowMediaAttachWizard(true)}>
                        + Add Photo
                      </button>
                    </div>
                  </div>
                  {photos.length > 0 ? (
                    <div className="person-photo-grid">
                      {photos.map((photo) => (
                        <button
                          key={photo.photoId}
                          type="button"
                          className="person-photo-tile"
                          onClick={() => {
                            setSelectedPhotoId(photo.photoId);
                            setShowPhotoDetail(true);
                          }}
                        >
                          {isVideoMediaByMetadata(photo.fileId, photo.mediaMetadata) ? (
                            <video
                              src={getPhotoProxyPath(photo.fileId, tenantKey)}
                              className="person-photo-tile-image"
                              muted
                              playsInline
                            />
                          ) : isAudioMediaByMetadata(photo.fileId, photo.mediaMetadata) ? (
                            <div className="person-photo-tile-image" style={{ display: "grid", placeItems: "center", padding: "0.75rem" }}>
                              <audio src={getPhotoProxyPath(photo.fileId, tenantKey)} controls style={{ width: "100%" }} />
                            </div>
                          ) : isDocumentMediaByMetadata(photo.fileId, photo.mediaMetadata) ? (
                            <div className="person-photo-tile-image" style={{ display: "grid", placeItems: "center", gap: "0.35rem", padding: "0.75rem", textAlign: "center", color: "#0f4c81" }}>
                              <DocumentIcon />
                              <strong style={{ fontSize: "0.85rem" }}>Document</strong>
                            </div>
                          ) : (
                            <img
                              src={getPhotoPreviewProxyPath(photo.fileId, photo.mediaMetadata, tenantKey)}
                              alt={photo.name || "photo"}
                              className="person-photo-tile-image"
                            />
                          )}
                          <div className="person-photo-tile-meta">
                            <span className="person-photo-tile-label">{photo.name || "photo"}</span>
                            {photo.isPrimary ? <span className="person-photo-primary-badge">Primary</span> : null}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="page-subtitle">No linked photos yet.</p>
                  )}
                </div>
                {selectedPhoto && showPhotoDetail ? (
                  <div className="person-photo-detail-shell">
                    <div className="person-photo-detail-card">
                      <div className="person-photo-detail-head">
                        <h4 className="ui-section-title" style={{ marginBottom: 0 }}>Edit Photo</h4>
                        <div className="settings-chip-list">
                          <button
                            type="button"
                              className="button secondary tap-button"
                              onClick={() => {
                                setLargePhotoFileId(selectedPhoto.fileId);
                                setLargePhotoIsVideo(isVideoMediaByMetadata(selectedPhoto.fileId, selectedPhoto.mediaMetadata));
                                setLargePhotoIsDocument(isDocumentMediaByMetadata(selectedPhoto.fileId, selectedPhoto.mediaMetadata));
                                setLargePhotoIsAudio(isAudioMediaByMetadata(selectedPhoto.fileId, selectedPhoto.mediaMetadata));
                              }}
                            >
                              {isDocumentMediaByMetadata(selectedPhoto.fileId, selectedPhoto.mediaMetadata) ? "Open Document" : "View Large"}
                            </button>
                          <button
                            type="button"
                            className="button secondary tap-button"
                            onClick={() => setShowPhotoDetail(false)}
                            aria-label="Close edit photo"
                          >
                            x
                          </button>
                        </div>
                      </div>
                      <div className="card">
                        {isVideoMediaByMetadata(selectedPhoto.fileId, selectedPhoto.mediaMetadata) ? (
                          <video
                            src={getPhotoProxyPath(selectedPhoto.fileId, tenantKey)}
                            className="person-photo-detail-preview"
                            controls
                            playsInline
                          />
                        ) : isAudioMediaByMetadata(selectedPhoto.fileId, selectedPhoto.mediaMetadata) ? (
                          <audio
                            src={getPhotoProxyPath(selectedPhoto.fileId, tenantKey)}
                            className="person-photo-detail-preview"
                            controls
                          />
                        ) : isDocumentMediaByMetadata(selectedPhoto.fileId, selectedPhoto.mediaMetadata) ? (
                          <div className="person-photo-detail-preview" style={{ display: "grid", placeItems: "center", gap: "0.65rem", alignContent: "center", padding: "1.5rem", textAlign: "center" }}>
                            <span style={{ color: "#0f4c81" }}><DocumentIcon /></span>
                            <strong>{selectedPhoto.name || "Document"}</strong>
                            <a
                              href={getPhotoProxyPath(selectedPhoto.fileId, tenantKey)}
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
                            src={getPhotoProxyPath(selectedPhoto.fileId, tenantKey)}
                            alt={selectedPhoto.name || "photo"}
                            className="person-photo-detail-preview"
                          />
                        )}
                      </div>
                      <div className="card">
                        <h5 style={{ margin: "0 0 0.5rem" }}>Photo Info</h5>
                        <label className="label">Name</label>
                        <input className="input" value={selectedPhoto.name || ""} disabled />
                        <label className="label">Description</label>
                        <input className="input" value={selectedPhoto.description || ""} disabled />
                        <label className="label">Date</label>
                        <input className="input" value={selectedPhoto.photoDate || ""} disabled />
                        <label className="label">Primary</label>
                        <input className="input" value={selectedPhoto.isPrimary ? "Yes" : "No"} disabled />
                      </div>
                      <div className="person-photo-tags-card card">
                        <h5 style={{ margin: "0 0 0.5rem" }}>Linked To</h5>
                        <div className="person-association-list">
                          {selectedPhotoAssociations.people.map((item) => (
                            <div key={`p-chip-${item.personId}`} className="person-linked-row">
                              <div className="person-linked-main">
                                <span className="person-linked-icon" aria-hidden="true">
                                  <img
                                    src={getGenderAvatarSrc(peopleById.get(item.personId)?.gender ?? "unspecified")}
                                    alt=""
                                    className="person-linked-avatar"
                                  />
                                </span>
                                <span>{item.displayName}</span>
                              </div>
                              <button
                                type="button"
                                className="person-chip-remove"
                                disabled={associationBusy || pendingOps.has(`p-${item.personId}`)}
                                onClick={() => {
                                  const key = `p-${item.personId}`;
                                  setPendingOps((current) => new Set(current).add(key));
                                  void (async () => {
                                    await removePhotoAssociationFromPerson(item.personId, selectedPhoto.fileId);
                                    setPendingOps((current) => {
                                      const next = new Set(current);
                                      next.delete(key);
                                      return next;
                                    });
                                  })();
                                }}
                                aria-label={`Remove ${item.displayName} from photo`}
                              >
                                x
                              </button>
                            </div>
                          ))}
                          {selectedPhotoAssociations.households.map((item) => (
                            <div key={`h-chip-${item.householdId}`} className="person-linked-row">
                              <div className="person-linked-main">
                                <span className="person-linked-icon person-linked-icon--household" aria-hidden="true">
                                  <HouseholdIcon />
                                </span>
                                <span>{item.label || item.householdId}</span>
                              </div>
                              <button
                                type="button"
                                className="person-chip-remove"
                                disabled={associationBusy || pendingOps.has(`h-${item.householdId}`)}
                                onClick={() => {
                                  const key = `h-${item.householdId}`;
                                  setPendingOps((current) => new Set(current).add(key));
                                  void (async () => {
                                    await removePhotoAssociationFromHousehold(item.householdId, selectedPhoto.fileId);
                                    setPendingOps((current) => {
                                      const next = new Set(current);
                                      next.delete(key);
                                      return next;
                                    });
                                  })();
                                }}
                                aria-label={`Remove ${item.label || item.householdId} from photo`}
                              >
                                x
                              </button>
                            </div>
                          ))}
                          {selectedPhotoAssociations.people.length === 0 && selectedPhotoAssociations.households.length === 0 ? (
                            <span className="status-chip status-chip--neutral">None</span>
                          ) : null}
                        </div>
                        <label className="label" style={{ marginTop: "0.75rem" }}>Search</label>
                        <input
                          className="input"
                          value={linkQuery}
                          onChange={(e) => setLinkQuery(e.target.value)}
                          placeholder="Search people, households"
                        />
                        {linkQuery.trim() ? (
                          <div className="person-typeahead-list">
                            {linkSearchResults.length > 0 ? (
                              linkSearchResults.map((entry) => (
                                <button
                                  key={entry.key}
                                  type="button"
                                  className="person-typeahead-item"
                                  disabled={associationBusy}
                                  onClick={() => {
                                    setLinkQuery("");
                                    if (entry.kind === "person") {
                                      void linkSelectedPhotoToPerson(entry.personId);
                                      return;
                                    }
                                    void linkSelectedPhotoToHousehold(entry.householdId);
                                  }}
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
                        {associationStatus ? <p className="page-subtitle" style={{ marginTop: "0.7rem" }}>{associationStatus}</p> : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                <MediaAttachWizard
                  open={showMediaAttachWizard}
                  context={{
                    tenantKey,
                    source: "household",
                    canManage: true,
                    allowHouseholdLinks: true,
                    householdId,
                    entityType: "household",
                    defaultAttributeType: "photo",
                    defaultLabel: "photo",
                    preselectedHouseholdIds: [householdId],
                    peopleOptions: availablePeople.map((item) => ({
                      personId: item.personId,
                      displayName: item.displayName,
                      gender: item.gender ?? "unspecified",
                    })),
                    householdOptions: availableHouseholds.map((item) => ({
                      householdId: item.householdId,
                      label: item.label,
                    })),
                  }}
                  onClose={() => setShowMediaAttachWizard(false)}
                  onComplete={(summary) => {
                    void handleWizardComplete(summary);
                  }}
                />
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
                    ) : largePhotoIsDocument ? (
                      <div style={{ width: "min(640px, 95vw)", borderRadius: 14, border: "1px solid var(--line)", background: "#fff", padding: "1.25rem", display: "grid", placeItems: "center", gap: "0.65rem", textAlign: "center" }}>
                        <span style={{ color: "#0f4c81" }}><DocumentIcon /></span>
                        <strong>Document</strong>
                        <a
                          href={getPhotoProxyPath(largePhotoFileId, tenantKey)}
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
                        src={getPhotoProxyPath(largePhotoFileId, tenantKey)}
                        alt="Large preview"
                        style={{ maxWidth: "min(1200px, 95vw)", maxHeight: "90vh", borderRadius: 14, border: "1px solid var(--line)", background: "#fff" }}
                      />
                    )}
                  </div>
                ) : null}
              </>
            ) : null}

            <ModalActionBar
              status={status ? <ModalStatusBanner tone={householdStatusTone}>{status}</ModalStatusBanner> : null}
              actions={
                <>
                  <AsyncActionButton type="button" tone="secondary" className="tap-button" disabled={saving} onClick={onClose}>
                    Cancel
                  </AsyncActionButton>
                  <AsyncActionButton
                    type="button"
                    className="tap-button"
                    pending={saving}
                    pendingLabel="Saving..."
                    disabled={addChildOpen || saving}
                    onClick={() =>
                      void (async () => {
                        if (addChildOpen) {
                          setStatus("Finish saving the child or cancel Add Child before saving household.");
                          return;
                        }
                        setSaving(true);
                        setStatus("Saving household...");
                        const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(householdId)}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ label, notes, weddingPhotoFileId, marriedDate, address, city, state: stateValue, zip }),
                        });
                        if (!res.ok) {
                          const body = await res.text();
                          setStatus(`Save failed: ${res.status} ${body.slice(0, 140)}`);
                          setSaving(false);
                          return;
                        }
                        setStatus("Household saved.");
                        setSaving(false);
                        onSaved();
                        onClose();
                      })()
                    }
                  >
                    Save and Close
                  </AsyncActionButton>
                </>
              }
            />
            <AttributesModal
              open={showHouseholdAttributesModal}
              tenantKey={tenantKey}
              entityType="household"
              entityId={householdId}
              entityLabel={label || household.label || householdId}
              modalSubtitle="Attributes"
              initialTypeKey="life_event"
              initialTypeCategory="story"
              initialEditAttributeId={selectedHouseholdAttributeId}
              startInAddMode
              onClose={() => {
                setShowHouseholdAttributesModal(false);
                setSelectedHouseholdAttributeId("");
              }}
              onSaved={() => {
                void refreshHouseholdAttributes();
                onSaved();
              }}
            />
          </>
        ) : null}
      </div>
      </div>
    </div>
  );
}
