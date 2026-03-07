"use client";

import { useEffect, useState } from "react";
import { getPhotoProxyPath } from "@/lib/google/photo-path";
import { AttributesModal } from "@/components/AttributesModal";

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
  birthDate: string;
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
  onEditPerson?: (personId: string) => void;
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

function parseMediaMetadata(raw?: string) {
  const text = (raw ?? "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as { mimeType?: string; fileName?: string };
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
        if (Number.isFinite(media.duration)) result.durationSec = Math.max(0, media.duration);
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

export function HouseholdEditModal({ open, tenantKey, householdId, onClose, onSaved, onEditPerson }: Props) {
  const [loading, setLoading] = useState(false);
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
  const [showHouseholdAttributesModal, setShowHouseholdAttributesModal] = useState(false);
  const [selectedHouseholdAttributeId, setSelectedHouseholdAttributeId] = useState("");
  const [photos, setPhotos] = useState<HouseholdPhoto[]>([]);
  const [selectedPhotoId, setSelectedPhotoId] = useState("");
  const [showPhotoDetail, setShowPhotoDetail] = useState(false);
  const [newPhotoName, setNewPhotoName] = useState("");
  const [newPhotoDescription, setNewPhotoDescription] = useState("");
  const [newPhotoDate, setNewPhotoDate] = useState("");
  const [newPhotoPrimary, setNewPhotoPrimary] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [pendingUploadPhotoFile, setPendingUploadPhotoFile] = useState<File | null>(null);
  const [pendingUploadPhotoPreviewUrl, setPendingUploadPhotoPreviewUrl] = useState("");
  const [pendingUploadCaptureSource, setPendingUploadCaptureSource] = useState("library");
  const [showPhotoUploadPicker, setShowPhotoUploadPicker] = useState(false);
  const [largePhotoFileId, setLargePhotoFileId] = useState("");
  const [largePhotoIsVideo, setLargePhotoIsVideo] = useState(false);
  const [largePhotoIsAudio, setLargePhotoIsAudio] = useState(false);
  const [addChildOpen, setAddChildOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nickName, setNickName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState<"" | "male" | "female">("");
  const [childAddress, setChildAddress] = useState("");
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

  const refresh = async () => {
    setLoading(true);
    const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(householdId)}`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.household) {
      const hint = typeof body?.hint === "string" ? body.hint : "";
      const message = typeof body?.message === "string" ? body.message : "";
      setStatus(`Load failed: ${res.status}${message ? ` ${message}` : ""}${hint ? ` | ${hint}` : ""}`);
      setLoading(false);
      return;
    }
    const next = body.household as HouseholdSummary;
    setHousehold(next);
    setChildren(Array.isArray(body.children) ? (body.children as ChildSummary[]) : []);
    setPhotos(Array.isArray(body.photos) ? (body.photos as HouseholdPhoto[]) : []);
    setSelectedPhotoId("");
    setShowPhotoDetail(false);
    setLargePhotoFileId("");
    setLargePhotoIsVideo(false);
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
    setSelectedPhotoAssociations({ people: [], households: [] });
    setAssociationStatus("");
    setLinkQuery("");
    await refreshHouseholdAttributes();
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
    if (!pendingUploadPhotoFile) {
      setStatus("Choose a photo first.");
      return;
    }
    setUploadingPhoto(true);
    setStatus("Adding photo...");
    const form = new FormData();
    form.append("file", pendingUploadPhotoFile);
    form.append("name", newPhotoName.trim() || pendingUploadPhotoFile.name || "photo");
    form.append("description", newPhotoDescription.trim());
    form.append("photoDate", newPhotoDate.trim());
    form.append("isPrimary", String(newPhotoPrimary));
    form.append("captureSource", pendingUploadCaptureSource);
    const mediaMeta = await readClientMediaMetadata(pendingUploadPhotoFile);
    if (typeof mediaMeta.width === "number") form.append("mediaWidth", String(Math.round(mediaMeta.width)));
    if (typeof mediaMeta.height === "number") form.append("mediaHeight", String(Math.round(mediaMeta.height)));
    if (typeof mediaMeta.durationSec === "number") form.append("mediaDurationSec", String(mediaMeta.durationSec));
    if (pendingUploadPhotoFile.lastModified) {
      form.append("fileCreatedAt", new Date(pendingUploadPhotoFile.lastModified).toISOString());
    }
    const res = await fetch(
      `/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(householdId)}/photos/upload`,
      { method: "POST", body: form },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message = body?.message || body?.error || "";
      setStatus(`Add photo failed: ${res.status} ${String(message).slice(0, 160)}`);
      setUploadingPhoto(false);
      return;
    }
    clearPendingUploadPhoto();
    setShowPhotoUploadPicker(false);
    setNewPhotoName("");
    setNewPhotoDescription("");
    setNewPhotoDate("");
    setNewPhotoPrimary(false);
    setStatus("Photo linked.");
    setUploadingPhoto(false);
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
      `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(targetPersonId)}/attributes`,
      { cache: "no-store" },
    );
    const attrsBody = await attrsRes.json().catch(() => null);
    if (!attrsRes.ok) {
      setAssociationStatus("Remove failed.");
      setAssociationBusy(false);
      return false;
    }
    const attrs = Array.isArray(attrsBody?.attributes)
      ? (attrsBody.attributes as Array<{ attributeId: string; attributeType: string; valueText: string }>)
      : [];
    const matches = attrs.filter((item) => {
      const type = item.attributeType.toLowerCase();
      return ["photo", "video", "audio", "media"].includes(type) && item.valueText.trim() === fileId;
    });
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
    if (!open || !householdId) {
      return;
    }
    setActiveTab("info");
    setAddChildOpen(false);
    setGender("");
    setChildAddress("");
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
    if (!selectedPhoto || !showPhotoDetail) {
      setSelectedPhotoAssociations({ people: [], households: [] });
      return;
    }
    void refreshSelectedPhotoAssociations(selectedPhoto.fileId);
  }, [selectedPhoto, showPhotoDetail, tenantKey]);

  useEffect(() => {
    return () => {
      if (pendingUploadPhotoPreviewUrl) {
        URL.revokeObjectURL(pendingUploadPhotoPreviewUrl);
      }
    };
  }, [pendingUploadPhotoPreviewUrl]);

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

  const husbandTile = household
    ? availablePeople.find((item) => item.personId === household.husbandPersonId) ?? {
        personId: household.husbandPersonId,
        displayName: household.husbandName || "Husband",
        gender: "male" as const,
        photoFileId: "",
      }
    : null;
  const wifeTile = household
    ? availablePeople.find((item) => item.personId === household.wifePersonId) ?? {
        personId: household.wifePersonId,
        displayName: household.wifeName || "Wife",
        gender: "female" as const,
        photoFileId: "",
      }
    : null;
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
  const imageSrc = weddingPhotoFileId
    ? getPhotoProxyPath(weddingPhotoFileId, tenantKey)
    : spouseHeadshotFileId
      ? getPhotoProxyPath(spouseHeadshotFileId, tenantKey)
      : "/WeddingAvatar1.png";

  const openPersonDetail = (personId: string) => {
    if (!personId) return;
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
              src={imageSrc}
              alt="Household cover"
              className="person-modal-avatar"
              style={{ width: 84, height: 64 }}
            />
            <div>
              <h3 className="person-modal-title">{household?.label || "Household"}</h3>
              <p className="person-modal-meta">
                Mother: {household?.wifeName || "-"} | Father: {household?.husbandName || "-"}
              </p>
              <p className="person-modal-meta">Household ID: {householdId}</p>
            </div>
            <button type="button" className="button secondary tap-button" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="person-modal-tabs">
          <button type="button" className={`tab-pill ${activeTab === "info" ? "active" : ""}`} onClick={() => setActiveTab("info")}>Info</button>
          <button type="button" className={`tab-pill ${activeTab === "children" ? "active" : ""}`} onClick={() => setActiveTab("children")}>Children</button>
          <button type="button" className={`tab-pill ${activeTab === "pictures" ? "active" : ""}`} onClick={() => setActiveTab("pictures")}>Pictures</button>
        </div>
        <div className="person-modal-content">

        {loading ? <p style={{ marginTop: "0.75rem" }}>{status}</p> : null}

        {!loading && household ? (
          <>
            {activeTab === "info" ? (
              <>
                <div className="person-section-grid">
                  <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: "260px" }}>
                    <h4 className="ui-section-title">Marriage</h4>
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
                                onClick={() => openPersonDetail(item.personId)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    openPersonDetail(item.personId);
                                  }
                                }}
                              >
                                <div className="person-photo-wrap">
                                  <img src={photoSrc} alt={item.displayName} className="person-photo" />
                                </div>
                                <div className="person-card-content">
                                  <h3>{item.displayName}</h3>
                                  <p className="person-meta-row">
                                    <span>{item.gender === "female" ? "Wife" : "Husband"}</span>
                                  </p>
                                </div>
                              </article>
                            );
                          })}
                      </div>
                    ) : null}
                    <label className="label">Married Date</label>
                    <input
                      className="input"
                      type="date"
                      value={marriedDate}
                      onChange={(e) => setMarriedDate(e.target.value)}
                    />
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
                              background: "#eef4ff",
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
                                onClick={() => openPersonDetail(child.personId)}
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
                      setFirstName("");
                      setMiddleName("");
                      setLastName("");
                      setNickName("");
                      setDisplayName("");
                      setBirthDate("");
                      setGender("");
                      setChildAddress("");
                    }
                    setAddChildOpen((value) => !value);
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

                    <button
                      type="button"
                      className="button tap-button"
                      style={{ marginTop: "0.75rem" }}
                      onClick={() =>
                        void (async () => {
                          if (!birthDate.trim()) {
                            setStatus("Birthdate is required before saving child.");
                            return;
                          }
                          if (!gender) {
                            setStatus("Gender is required before saving child.");
                            return;
                          }
                          setStatus("Adding child...");
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
                                birth_date: birthDate,
                                gender,
                                address: childAddress,
                              }),
                            },
                          );
                          const body = await res.json().catch(() => null);
                          if (!res.ok) {
                            setStatus(`Add child failed: ${res.status} ${JSON.stringify(body)}`);
                            return;
                          }
                          setStatus("Child added.");
                          setAddChildOpen(false);
                          setFirstName("");
                          setMiddleName("");
                          setLastName("");
                          setNickName("");
                          setDisplayName("");
                          setBirthDate("");
                          setGender("");
                          setChildAddress("");
                          await refresh();
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
                      <button type="button" className="button tap-button" onClick={() => setShowPhotoUploadPicker(true)}>
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
                          {isVideoMediaByMetadata(photo.mediaMetadata) ? (
                            <video
                              src={getPhotoProxyPath(photo.fileId, tenantKey)}
                              className="person-photo-tile-image"
                              muted
                              playsInline
                            />
                          ) : isAudioMediaByMetadata(photo.mediaMetadata) ? (
                            <div className="person-photo-tile-image" style={{ display: "grid", placeItems: "center", padding: "0.75rem" }}>
                              <audio src={getPhotoProxyPath(photo.fileId, tenantKey)} controls style={{ width: "100%" }} />
                            </div>
                          ) : (
                            <img
                              src={getPhotoProxyPath(photo.fileId, tenantKey)}
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
                              setLargePhotoIsVideo(isVideoMediaByMetadata(selectedPhoto.mediaMetadata));
                              setLargePhotoIsAudio(isAudioMediaByMetadata(selectedPhoto.mediaMetadata));
                            }}
                          >
                            View Large
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
                        {isVideoMediaByMetadata(selectedPhoto.mediaMetadata) ? (
                          <video
                            src={getPhotoProxyPath(selectedPhoto.fileId, tenantKey)}
                            className="person-photo-detail-preview"
                            controls
                            playsInline
                          />
                        ) : isAudioMediaByMetadata(selectedPhoto.mediaMetadata) ? (
                          <audio
                            src={getPhotoProxyPath(selectedPhoto.fileId, tenantKey)}
                            className="person-photo-detail-preview"
                            controls
                          />
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

                {showPhotoUploadPicker ? (
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
                      <label className="label">Name</label>
                      <input className="input" value={newPhotoName} onChange={(e) => setNewPhotoName(e.target.value)} placeholder="Photo name" />
                      <label className="label">Description</label>
                      <input className="input" value={newPhotoDescription} onChange={(e) => setNewPhotoDescription(e.target.value)} placeholder="Photo description" />
                      <label className="label">Date</label>
                      <input className="input" type="date" value={newPhotoDate} onChange={(e) => setNewPhotoDate(e.target.value)} />
                      <label className="label" style={{ marginTop: "0.5rem" }}>
                        <input type="checkbox" checked={newPhotoPrimary} onChange={(e) => setNewPhotoPrimary(e.target.checked)} /> Set as primary
                      </label>
                      {pendingUploadPhotoPreviewUrl ? (
                        <div className="person-upload-preview-card">
                          {pendingUploadPhotoFile?.type?.startsWith("video/") ? (
                            <video src={pendingUploadPhotoPreviewUrl} className="person-upload-preview-image" controls playsInline />
                          ) : pendingUploadPhotoFile?.type?.startsWith("audio/") ? (
                            <audio src={pendingUploadPhotoPreviewUrl} className="person-upload-preview-image" controls />
                          ) : (
                            <img src={pendingUploadPhotoPreviewUrl} alt="Selected upload preview" className="person-upload-preview-image" />
                          )}
                          <div className="person-upload-preview-meta">
                            <strong>{pendingUploadPhotoFile?.name || "Selected photo"}</strong>
                            <span>This photo will be uploaded with the metadata above.</span>
                          </div>
                        </div>
                      ) : (
                        <p className="page-subtitle" style={{ marginTop: "0.75rem" }}>No photo selected yet.</p>
                      )}
                      <input
                        id={`household-photo-upload-${householdId}`}
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
                        id={`household-photo-upload-camera-${householdId}`}
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
                        id={`household-photo-upload-audio-${householdId}`}
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
                          disabled={uploadingPhoto}
                          onClick={() => document.getElementById(`household-photo-upload-${householdId}`)?.click()}
                        >
                          {pendingUploadPhotoFile ? "Choose From Library" : "Choose From Library"}
                        </button>
                        <button
                          type="button"
                          className="button secondary tap-button"
                          disabled={uploadingPhoto}
                          onClick={() => document.getElementById(`household-photo-upload-camera-${householdId}`)?.click()}
                        >
                          Camera
                        </button>
                        <button
                          type="button"
                          className="button secondary tap-button"
                          disabled={uploadingPhoto}
                          onClick={() => document.getElementById(`household-photo-upload-audio-${householdId}`)?.click()}
                        >
                          Audio
                        </button>
                        <button
                          type="button"
                          className="button tap-button"
                          disabled={!pendingUploadPhotoFile || uploadingPhoto}
                          onClick={() => void submitPendingUploadPhoto()}
                        >
                          {uploadingPhoto ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          className="button secondary tap-button"
                          disabled={uploadingPhoto}
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

            <div className="settings-chip-list" style={{ marginTop: "0.8rem" }}>
              <button
                type="button"
                className="button tap-button"
                disabled={addChildOpen}
                onClick={() =>
                  void (async () => {
                    if (addChildOpen) {
                      setStatus("Finish saving the child or cancel Add Child before saving household.");
                      return;
                    }
                    setStatus("Saving household...");
                    const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(householdId)}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ label, notes, weddingPhotoFileId, marriedDate, address, city, state: stateValue, zip }),
                    });
                    if (!res.ok) {
                      const body = await res.text();
                      setStatus(`Save failed: ${res.status} ${body.slice(0, 140)}`);
                      return;
                    }
                    setStatus("Household saved.");
                    await refresh();
                    onSaved();
                  })()
                }
              >
                Save Household
              </button>
              <button type="button" className="button secondary tap-button" onClick={onClose}>Close</button>
            </div>
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

        {status ? <p style={{ marginTop: "0.75rem" }}>{status}</p> : null}
      </div>
      </div>
    </div>
  );
}
