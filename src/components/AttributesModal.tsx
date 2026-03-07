
"use client";

import { useEffect, useMemo, useState } from "react";
import { getPhotoProxyPath } from "@/lib/google/photo-path";
import type { AttributeCategory, AttributeEntityType } from "@/lib/attributes/types";
import type { AttributeEventDefinitions } from "@/lib/attributes/event-definitions-types";

type AttributeMedia = {
  linkId: string;
  fileId: string;
  label: string;
  description: string;
  photoDate: string;
  isPrimary: boolean;
  mediaMetadata: string;
  createdAt: string;
};

type AttributeItem = {
  attributeId: string;
  entityType: AttributeEntityType;
  entityId: string;
  category: AttributeCategory;
  attributeType: string;
  attributeTypeCategory: string;
  attributeDate: string;
  dateIsEstimated: boolean;
  estimatedTo: "" | "month" | "year";
  attributeDetail: string;
  attributeNotes: string;
  endDate: string;
  typeKey: string;
  label: string;
  valueText: string;
  dateStart: string;
  dateEnd: string;
  location: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  media: AttributeMedia[];
};

type AttributeTab = "all" | "descriptor" | "event";
type LibraryMediaItem = {
  fileId: string;
  name: string;
  description: string;
  date: string;
};

const DESCRIPTOR_TYPES = ["physical_attribute", "hobbies_interests", "talent", "other"];
const EVENT_TYPES = [
  "birth",
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
const EVENT_TYPE_CATEGORY_MAP: Record<string, string[]> = {
  education: ["enrolled", "awarded", "exam_test", "grade"],
  religious: ["baptism", "ordinance", "mission", "calling"],
  employment: ["hired", "departed", "promotion", "awarded"],
  family_relationship: ["married", "divorced", "adopted"],
};

function defaultEventDefinitions(): AttributeEventDefinitions {
  const categories = EVENT_TYPES.map((typeKey, index) => ({
    categoryKey: typeKey,
    categoryLabel: prettyLabel(typeKey, ""),
    description: "",
    sortOrder: (index + 1) * 10,
    isEnabled: true,
  }));
  const types = Object.entries(EVENT_TYPE_CATEGORY_MAP).flatMap(([categoryKey, items]) =>
    items.map((typeKey, index) => ({
      typeKey,
      categoryKey,
      typeLabel: prettyLabel(typeKey, ""),
      detailLabel: "Attribute Detail",
      dateMode: "single" as const,
      askEndDate: false,
      sortOrder: (index + 1) * 10,
      isEnabled: true,
    })),
  );
  return { version: 1, categories, types };
}
const THINGS_TYPE_CATEGORY_MAP: Record<string, string[]> = {
  physical_attribute: ["eyes", "height", "blood_type", "allergy", "other"],
};
const LEGACY_TYPE_MAP: Record<string, string> = {
  graduation: "education",
  missions: "religious",
  religious_event: "religious",
  injuries: "injury_health",
  accomplishments: "accomplishment",
  stories: "life_event",
  lived_in: "moved",
  jobs: "employment",
  hobbies: "hobbies_interests",
  likes: "hobbies_interests",
  allergies: "physical_attribute",
  blood_type: "physical_attribute",
  hair_color: "physical_attribute",
  height: "physical_attribute",
  health: "physical_attribute",
};

type AttributeFieldCopy = {
  valueLabel: string;
  valuePlaceholder: string;
  startDateLabel: string;
  endDateLabel: string;
  locationLabel: string;
  notesLabel: string;
};

function prettyLabel(typeKey: string, label: string) {
  if (label.trim()) return label.trim();
  return typeKey.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function normalizeTypeKey(value: string) {
  const key = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  return LEGACY_TYPE_MAP[key] ?? key;
}

function normalizeAttributeItem(item: AttributeItem): AttributeItem {
  const normalizedType = normalizeTypeKey(item.attributeType || item.typeKey || "");
  const attributeDate = getSafeAttributeValueText(item.attributeDate || item.dateStart);
  const category =
    normalizedType === "other"
      ? (attributeDate ? "event" : "descriptor")
      : inferCategory(normalizedType);
  const endDate = getSafeAttributeValueText(item.endDate || item.dateEnd);
  const attributeTypeCategory = getSafeAttributeValueText(item.attributeTypeCategory);
  const attributeDetail = getSafeAttributeValueText(item.attributeDetail || item.valueText);
  const attributeNotes = getSafeAttributeValueText(item.attributeNotes || item.notes);
  const label = getSafeAttributeValueText(item.label);
  return {
    ...item,
    category,
    attributeType: normalizedType,
    attributeTypeCategory,
    typeKey: normalizedType,
    attributeDate,
    endDate,
    attributeDetail,
    attributeNotes,
    label,
    valueText: attributeDetail,
    dateStart: attributeDate,
    dateEnd: endDate,
    notes: attributeNotes,
  };
}

function summarizeSingle(item: AttributeItem) {
  const value = item.valueText.trim();
  const datePart = item.dateStart
    ? item.dateEnd
      ? `${item.dateStart} - ${item.dateEnd}`
      : item.dateStart
    : "";
  const location = item.location.trim();
  const parts = [value, datePart, location].filter(Boolean);
  return parts.join(" | ") || "-";
}

function typeListForCategory(category: AttributeCategory) {
  return category === "event" ? EVENT_TYPES : DESCRIPTOR_TYPES;
}

function inferCategory(typeKey: string): AttributeCategory {
  return EVENT_TYPES.includes(normalizeTypeKey(typeKey)) ? "event" : "descriptor";
}

function fieldCopyFor(category: AttributeCategory, typeKey: string): AttributeFieldCopy {
  const normalizedType = typeKey.trim().toLowerCase();
  if (category === "event") {
    return {
      valueLabel: normalizedType === "education" ? "School / Program Detail" : "Attribute Detail",
      valuePlaceholder: normalizedType === "education" ? "e.g. School name, award name, or score detail" : "Enter detail",
      startDateLabel: "Date",
      endDateLabel: "End Date",
      locationLabel: "Attribute Notes",
      notesLabel: "Additional Notes",
    };
  }
  return {
    valueLabel: "Attribute Detail",
    valuePlaceholder: "Enter name/value/detail",
    startDateLabel: "Date",
    endDateLabel: "End Date",
    locationLabel: "Attribute Notes",
    notesLabel: "Additional Notes",
  };
}

function getTypeCategoryLabel(typeKey: string) {
  const normalized = normalizeTypeKey(typeKey);
  if (normalized === "physical_attribute") return "Type of Physical Attribute";
  return "Type Category";
}

function getDetailLabel(typeCategory: string) {
  const normalized = typeCategory.trim();
  if (!normalized) return "Attribute Detail";
  return `Describe ${normalized.replace(/_/g, " ").toLowerCase()}`;
}

function getSafeAttributeValueText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return getSafeAttributeValueText(JSON.parse(trimmed));
      } catch {
        return trimmed === "[object Object]" ? "" : trimmed;
      }
    }
    return trimmed === "[object Object]" ? "" : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((entry) => getSafeAttributeValueText(entry)).filter(Boolean).join(", ");
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
      record.fileId,
    ];
    for (const candidate of preferred) {
      const safe = getSafeAttributeValueText(candidate);
      if (safe) return safe;
    }
    const primitiveValues = Object.values(record)
      .map((entry) => getSafeAttributeValueText(entry))
      .filter(Boolean);
    if (primitiveValues.length > 0) return primitiveValues[0];
    return "";
  }
  return "";
}

function formatAttributeDate(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatAttributeDateRange(startDate: string, endDate: string) {
  const start = formatAttributeDate(startDate);
  const end = formatAttributeDate(endDate);
  if (start && end) return `${start} - ${end}`;
  return start || end || "";
}

function getAttributeDisplayType(item: AttributeItem) {
  return item.category === "event" ? "Event" : "Descriptor";
}

function getAttributeDisplayTitle(item: AttributeItem) {
  const categoryLabel = prettyLabel(item.typeKey, "");
  const preferred = [
    getSafeAttributeValueText(item.label),
    getSafeAttributeValueText(item.valueText),
  ].filter(Boolean);
  if (preferred[0] && preferred[1] && preferred[0] !== preferred[1]) return `${preferred[0]}  ${preferred[1]}`;
  if (preferred[0]) return `${categoryLabel}  ${preferred[0]}`;
  return categoryLabel || "Attribute";
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

export function AttributesModal({
  open,
  tenantKey,
  entityType,
  entityId,
  entityLabel,
  modalSubtitle = "Attributes",
  initialTypeKey,
  initialTypeCategory,
  initialEditAttributeId = "",
  startInAddMode = false,
  launchSourceLabel = "",
  onClose,
  onSaved,
}: {
  open: boolean;
  tenantKey: string;
  entityType: AttributeEntityType;
  entityId: string;
  entityLabel: string;
  modalSubtitle?: string;
  initialTypeKey?: string;
  initialTypeCategory?: string;
  initialEditAttributeId?: string;
  startInAddMode?: boolean;
  launchSourceLabel?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  // UI flow:
  // - Base view is list-only (grouped descriptors/events + search/filter).
  // - Item click opens detail drawer (view first, optional edit mode).
  // - Add flow uses a dedicated modal.
  // State:
  // - Parent owns fetched records + filtering state.
  // - Shared editor state powers both add and edit save behavior.
  const [items, setItems] = useState<AttributeItem[]>([]);
  const [rawItems, setRawItems] = useState<AttributeItem[]>([]);
  const [tab, setTab] = useState<AttributeTab>("all");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const [selectedAttributeId, setSelectedAttributeId] = useState("");
  const [drawerEditMode, setDrawerEditMode] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [pendingUploadIntent, setPendingUploadIntent] = useState<"" | "photo" | "video" | "library">("");

  const [editingId, setEditingId] = useState("");
  const [category, setCategory] = useState<AttributeCategory>("descriptor");
  const [typeKey, setTypeKey] = useState("hobbies_interests");
  const [attributeTypeCategory, setAttributeTypeCategory] = useState("");
  const [dateIsEstimated, setDateIsEstimated] = useState(false);
  const [estimatedTo, setEstimatedTo] = useState<"" | "month" | "year">("");
  const [label, setLabel] = useState("");
  const [valueText, setValueText] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [notes, setNotes] = useState("");

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState("");
  const [captureSource, setCaptureSource] = useState("library");
  const [showAddMediaMenu, setShowAddMediaMenu] = useState(false);
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryResults, setLibraryResults] = useState<LibraryMediaItem[]>([]);
  const [isLikelyMobile, setIsLikelyMobile] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [eventDefinitions, setEventDefinitions] = useState<AttributeEventDefinitions>(defaultEventDefinitions());
  const addFormCopy = useMemo(() => fieldCopyFor(category, typeKey), [category, typeKey]);
  const eventCategoryOptions = useMemo(
    () =>
      [...eventDefinitions.categories]
        .filter((item) => item.isEnabled)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.categoryLabel.localeCompare(b.categoryLabel)),
    [eventDefinitions],
  );
  const eventTypeOptionsByCategory = useMemo(() => {
    const map = new Map<string, Array<{ typeKey: string; typeLabel: string; detailLabel: string; dateMode: "single" | "range"; askEndDate: boolean }>>();
    for (const item of eventDefinitions.types) {
      if (!item.isEnabled) continue;
      const key = normalizeTypeKey(item.categoryKey);
      const list = map.get(key) ?? [];
      list.push({
        typeKey: normalizeTypeKey(item.typeKey),
        typeLabel: item.typeLabel,
        detailLabel: item.detailLabel,
        dateMode: item.dateMode,
        askEndDate: item.askEndDate,
      });
      map.set(key, list);
    }
    for (const [key, list] of map) {
      list.sort((a, b) => a.typeLabel.localeCompare(b.typeLabel));
      map.set(key, list);
    }
    return map;
  }, [eventDefinitions]);
  const addTypeSuggestions = useMemo(() => {
    if (category !== "event") return typeListForCategory(category);
    if (eventCategoryOptions.length === 0) return EVENT_TYPES;
    return eventCategoryOptions.map((item) => normalizeTypeKey(item.categoryKey));
  }, [category, eventCategoryOptions]);
  const typeCategorySuggestions = useMemo(() => {
    const normalizedType = normalizeTypeKey(typeKey);
    if (category === "event") return (eventTypeOptionsByCategory.get(normalizedType) ?? []).map((item) => item.typeKey);
    return THINGS_TYPE_CATEGORY_MAP[normalizedType] ?? [];
  }, [category, typeKey, eventTypeOptionsByCategory]);
  const selectedEventTypeOption = useMemo(() => {
    if (category !== "event") return null;
    const normalizedType = normalizeTypeKey(typeKey);
    const normalizedCategory = normalizeTypeKey(attributeTypeCategory);
    return (eventTypeOptionsByCategory.get(normalizedType) ?? []).find((item) => item.typeKey === normalizedCategory) ?? null;
  }, [category, typeKey, attributeTypeCategory, eventTypeOptionsByCategory]);
  const typeLabelByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of eventCategoryOptions) {
      map.set(normalizeTypeKey(item.categoryKey), item.categoryLabel);
    }
    return map;
  }, [eventCategoryOptions]);

  const refresh = async () => {
    const res = await fetch(
      `/api/attributes?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`,
      { cache: "no-store" },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setStatus(`Load failed: ${res.status}`);
      return;
    }
    const nextRawItems = Array.isArray(body?.attributes) ? (body.attributes as AttributeItem[]) : [];
    setRawItems(nextRawItems);
    setItems(nextRawItems.map((item) => normalizeAttributeItem(item)));
  };

  useEffect(() => {
    if (!open) return;
    setStatus("Loading...");
    setSelectedAttributeId("");
    setDrawerEditMode(false);
    setAddModalOpen(startInAddMode);
    void refresh().then(() => setStatus(""));
    if (initialTypeKey) {
      const normalizedType = normalizeTypeKey(initialTypeKey);
      setTypeKey(normalizedType);
      setCategory(inferCategory(normalizedType));
    }
    if (initialTypeCategory) {
      setAttributeTypeCategory(normalizeTypeKey(initialTypeCategory));
    }
  }, [open, entityType, entityId, initialTypeKey, initialTypeCategory, startInAddMode]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const loadDefinitions = async () => {
      const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/attribute-definitions`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.definitions) return;
      if (cancelled) return;
      setEventDefinitions(body.definitions as AttributeEventDefinitions);
    };
    void loadDefinitions();
    return () => {
      cancelled = true;
    };
  }, [open, tenantKey]);

  useEffect(() => {
    if (!open || !startInAddMode) return;
    const editId = initialEditAttributeId.trim();
    if (!editId) {
      setEditingId("");
      return;
    }
    const match = items.find((item) => item.attributeId === editId);
    if (!match) return;
    loadEditorFromItem(match);
    setEditingId(editId);
    setAddModalOpen(true);
    setDrawerEditMode(false);
    setStatus("");
  }, [initialEditAttributeId, items, open, startInAddMode]);

  useEffect(() => {
    if (!pendingPreview) return;
    return () => URL.revokeObjectURL(pendingPreview);
  }, [pendingPreview]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsLikelyMobile(window.matchMedia("(pointer: coarse)").matches || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const readDebugMode = () => {
      const value = window.localStorage.getItem("efl_debug_mode");
      setDebugMode(value === "1");
    };
    readDebugMode();
    const onStorage = () => readDebugMode();
    window.addEventListener("storage", onStorage);
    window.addEventListener("efl-debug-mode-changed", onStorage as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("efl-debug-mode-changed", onStorage as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!selectedAttributeId) {
      setShowAddMediaMenu(false);
      setShowLibraryPicker(false);
      setLibraryQuery("");
      setLibraryResults([]);
    }
  }, [selectedAttributeId]);

  useEffect(() => {
    if (category !== "event") return;
    if (selectedEventTypeOption && !selectedEventTypeOption.askEndDate && selectedEventTypeOption.dateMode !== "range") {
      setDateEnd("");
    }
  }, [category, selectedEventTypeOption]);

  useEffect(() => {
    const normalizedCurrent = normalizeTypeKey(typeKey);
    if (addTypeSuggestions.length === 0) return;
    if (addTypeSuggestions.includes(normalizedCurrent)) return;
    setTypeKey(addTypeSuggestions[0] ?? normalizedCurrent);
    setAttributeTypeCategory("");
  }, [addTypeSuggestions, typeKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (tab !== "all" && item.category !== tab) return false;
      if (!q) return true;
      const haystack = [
        item.typeKey,
        item.attributeTypeCategory,
        item.label,
        item.attributeDetail,
        item.attributeNotes,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, query, tab]);

  const selectedItem = useMemo(
    () => items.find((item) => item.attributeId === selectedAttributeId) ?? null,
    [items, selectedAttributeId],
  );
  const selectedRawItem = useMemo(() => {
    const currentId = editingId || selectedAttributeId || initialEditAttributeId.trim();
    if (!currentId) return null;
    return rawItems.find((item) => item.attributeId === currentId) ?? null;
  }, [editingId, initialEditAttributeId, rawItems, selectedAttributeId]);

  useEffect(() => {
    if (!selectedItem || !pendingUploadIntent) return;
    if (pendingUploadIntent === "library") {
      setShowLibraryPicker(true);
      setPendingUploadIntent("");
      return;
    }
    const id =
      pendingUploadIntent === "video"
        ? `attribute-upload-camera-${selectedItem.attributeId}`
        : `attribute-upload-${selectedItem.attributeId}`;
    setEditingId(selectedItem.attributeId);
    const timer = window.setTimeout(() => {
      document.getElementById(id)?.click();
      setPendingUploadIntent("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedItem, pendingUploadIntent]);

  const resetEditor = () => {
    setEditingId("");
    setCategory("descriptor");
    setTypeKey("hobbies_interests");
    setAttributeTypeCategory("");
    setDateIsEstimated(false);
    setEstimatedTo("");
    setLabel("");
    setValueText("");
    setDateStart("");
    setDateEnd("");
    setNotes("");
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingPreview("");
    setPendingFile(null);
    setCaptureSource("library");
    setShowAddMediaMenu(false);
    setShowLibraryPicker(false);
    setLibraryQuery("");
    setLibraryResults([]);
  };

  const loadEditorFromItem = (item: AttributeItem) => {
    setEditingId(item.attributeId);
    setCategory(item.category);
    setTypeKey(normalizeTypeKey(getSafeAttributeValueText(item.attributeType || item.typeKey)));
    setAttributeTypeCategory(getSafeAttributeValueText(item.attributeTypeCategory));
    setDateIsEstimated(Boolean(item.dateIsEstimated));
    setEstimatedTo((item.estimatedTo as "" | "month" | "year") || "");
    setLabel(getSafeAttributeValueText(item.label));
    setValueText(getSafeAttributeValueText(item.attributeDetail || item.valueText));
    setDateStart(getSafeAttributeValueText(item.attributeDate || item.dateStart));
    setDateEnd(getSafeAttributeValueText(item.endDate || item.dateEnd));
    setNotes(getSafeAttributeValueText(item.attributeNotes || item.notes));
  };

  const validateEditor = () => {
    const normalizedType = normalizeTypeKey(typeKey);
    if (!normalizedType) return "Type is required.";
    if (!valueText.trim()) return "Attribute detail is required.";
    if (category === "event" && !dateStart.trim()) return "Date is required for event attributes.";
    if (dateIsEstimated && !estimatedTo) return "Choose month or year for estimated date.";
    return "";
  };

  const saveAttribute = async () => {
    const validationError = validateEditor();
    if (validationError) {
      setStatus(validationError);
      setPendingUploadIntent("");
      return;
    }
    setBusy(true);
    const normalizedType = normalizeTypeKey(typeKey);
    const payload = {
      entityType,
      entityId,
      category,
      isDateRelated: category === "event",
      attributeType: normalizedType,
      attributeTypeCategory,
      attributeDate: dateStart,
      dateIsEstimated,
      ...(dateIsEstimated && estimatedTo ? { estimatedTo } : {}),
      attributeDetail: valueText,
      attributeNotes: notes,
      endDate: dateEnd,
      typeKey: normalizedType,
      label,
      valueText,
      dateStart,
      dateEnd,
      notes,
    };
    const res = await fetch(editingId ? `/api/attributes/${encodeURIComponent(editingId)}` : "/api/attributes", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setStatus(`Save failed: ${res.status} ${String(body?.message ?? body?.error ?? "").slice(0, 160)}`);
      setBusy(false);
      setPendingUploadIntent("");
      return;
    }
    const savedId = String(body?.attribute?.attributeId || editingId || "");
    const wasEdit = Boolean(editingId);
    const savedFromAddModal = addModalOpen;
    setBusy(false);
    setStatus("Saved.");
    await refresh();
    onSaved();
    if (wasEdit && savedId && !savedFromAddModal) {
      setSelectedAttributeId(savedId);
      setDrawerEditMode(false);
    }
    if (!wasEdit) {
      setAddModalOpen(false);
      resetEditor();
      setSelectedAttributeId("");
      setDrawerEditMode(false);
      if (startInAddMode) {
        onClose();
      }
    } else if (savedFromAddModal) {
      setAddModalOpen(false);
      resetEditor();
      if (startInAddMode) {
        onClose();
      }
    }
  };

  const removeAttribute = async (attributeId: string) => {
    if (!window.confirm("Delete this attribute?")) return;
    setBusy(true);
    const res = await fetch(`/api/attributes/${encodeURIComponent(attributeId)}`, { method: "DELETE" });
    if (!res.ok) {
      setStatus(`Delete failed: ${res.status}`);
      setBusy(false);
      return;
    }
    setItems((current) => current.filter((item) => item.attributeId !== attributeId));
    setBusy(false);
    setStatus("Deleted.");
    onSaved();
    if (editingId === attributeId) resetEditor();
    if (selectedAttributeId === attributeId) {
      setSelectedAttributeId("");
      setDrawerEditMode(false);
    }
    setAddModalOpen(false);
    if (startInAddMode) {
      onClose();
      return;
    }
    void refresh();
  };

  const removeMedia = async (attributeId: string, linkId: string) => {
    setBusy(true);
    const res = await fetch(`/api/attributes/${encodeURIComponent(attributeId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeMediaLinkId: linkId }),
    });
    if (!res.ok) {
      setStatus(`Media remove failed: ${res.status}`);
      setBusy(false);
      return;
    }
    setBusy(false);
    await refresh();
    onSaved();
  };

  const uploadAttachment = async () => {
    if (!editingId || !pendingFile) {
      setStatus("Save attribute first, then select a file.");
      return;
    }
    setBusy(true);
    setStatus("Uploading...");
    const form = new FormData();
    form.append("file", pendingFile);
    form.append("name", pendingFile.name || "media");
    form.append("description", notes.trim());
    form.append("photoDate", dateStart.trim());
    form.append("attributeId", editingId);
    form.append("captureSource", captureSource);
    form.append("attributeType", "media");
    const mediaMeta = await readClientMediaMetadata(pendingFile);
    if (typeof mediaMeta.width === "number") form.append("mediaWidth", String(Math.round(mediaMeta.width)));
    if (typeof mediaMeta.height === "number") form.append("mediaHeight", String(Math.round(mediaMeta.height)));
    if (typeof mediaMeta.durationSec === "number") form.append("mediaDurationSec", String(mediaMeta.durationSec));
    if (pendingFile.lastModified) form.append("fileCreatedAt", new Date(pendingFile.lastModified).toISOString());
    const url =
      entityType === "person"
        ? `/api/t/${encodeURIComponent(tenantKey)}/people/${encodeURIComponent(entityId)}/photos/upload`
        : `/api/t/${encodeURIComponent(tenantKey)}/households/${encodeURIComponent(entityId)}/photos/upload`;
    const res = await fetch(url, { method: "POST", body: form });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setStatus(`Upload failed: ${res.status} ${String(body?.message ?? body?.error ?? "").slice(0, 160)}`);
      setBusy(false);
      return;
    }
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingPreview("");
    setPendingFile(null);
    setCaptureSource("library");
    setStatus("Attachment uploaded.");
    setBusy(false);
    await refresh();
    onSaved();
  };

  const searchLibraryMedia = async () => {
    const q = libraryQuery.trim();
    if (!q) {
      setLibraryResults([]);
      return;
    }
    setLibraryBusy(true);
    try {
      const res = await fetch(
        `/api/t/${encodeURIComponent(tenantKey)}/photos/search?q=${encodeURIComponent(q)}&limit=40`,
        { cache: "no-store" },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus(`Media library search failed: ${res.status}`);
        setLibraryResults([]);
        return;
      }
      const items = Array.isArray(body?.items) ? (body.items as LibraryMediaItem[]) : [];
      setLibraryResults(items);
    } finally {
      setLibraryBusy(false);
    }
  };

  const selectLibraryMedia = async (item: LibraryMediaItem) => {
    try {
      const response = await fetch(getPhotoProxyPath(item.fileId, tenantKey), { cache: "no-store" });
      if (!response.ok) {
        setStatus(`Failed to fetch selected media: ${response.status}`);
        return;
      }
      const blob = await response.blob();
      const contentType = blob.type || "application/octet-stream";
      const fallbackName = item.name?.trim() || `${item.fileId}.bin`;
      const file = new File([blob], fallbackName, { type: contentType });
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
      setPendingFile(file);
      setPendingPreview(URL.createObjectURL(file));
      setCaptureSource("library");
      setShowLibraryPicker(false);
      setShowAddMediaMenu(false);
      setStatus("Selected media from library. Click Attach Media to link it.");
    } catch {
      setStatus("Failed to load selected media from library.");
    }
  };

  const openAddModal = () => {
    resetEditor();
    const normalizedInitialType = initialTypeKey ? normalizeTypeKey(initialTypeKey) : "";
    const defaultCategory: AttributeCategory =
      launchSourceLabel.toLowerCase().includes("things") ? "descriptor" : "event";
    const nextCategory = normalizedInitialType ? inferCategory(normalizedInitialType) : defaultCategory;
    setCategory(nextCategory);
    setTypeKey(normalizedInitialType || (nextCategory === "event" ? EVENT_TYPES[0] : DESCRIPTOR_TYPES[0]));
    setAddModalOpen(true);
    setDrawerEditMode(false);
  };

  const closeAddModal = () => {
    resetEditor();
    setAddModalOpen(false);
    if (startInAddMode) {
      onClose();
    }
  };

  const startAddAndAttach = (intent: "photo" | "video" | "library") => {
    setPendingUploadIntent(intent);
    void saveAttribute();
  };

  const openAttributeDrawer = (item: AttributeItem) => {
    setSelectedAttributeId(item.attributeId);
    setDrawerEditMode(false);
    setStatus("");
  };

  const beginEditSelected = () => {
    if (!selectedItem) return;
    loadEditorFromItem(selectedItem);
    setDrawerEditMode(true);
  };

  const cancelEditSelected = () => {
    if (!selectedItem) return;
    setDrawerEditMode(false);
    setEditingId("");
    loadEditorFromItem(selectedItem);
    setEditingId("");
  };

  const grouped = useMemo(() => {
    const descriptorMap = new Map<string, AttributeItem[]>();
    const eventMap = new Map<string, AttributeItem[]>();
    filtered.forEach((item) => {
      const map = item.category === "event" ? eventMap : descriptorMap;
      if (!map.has(item.typeKey)) map.set(item.typeKey, []);
      map.get(item.typeKey)!.push(item);
    });
    const toRows = (map: Map<string, AttributeItem[]>) =>
      Array.from(map.entries())
        .map(([key, rows]) => ({
          key,
          label: prettyLabel(key, rows[0]?.label || ""),
          rows: rows.slice().sort((a, b) => (b.dateStart || "").localeCompare(a.dateStart || "")),
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

    return {
      descriptor: toRows(descriptorMap),
      event: toRows(eventMap),
    };
  }, [filtered]);

  const showDescriptors = tab === "all" || tab === "descriptor";
  const showEvents = tab === "all" || tab === "event";

  if (!open) return null;

  return (
    <div className="person-modal-backdrop" onClick={onClose} onPointerDown={(event) => event.stopPropagation()}>
      <div className="person-modal-panel" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
        <div className="person-modal-sticky-head">
          <div className="person-modal-header">
            <div>
              <h3 className="person-modal-title">{entityLabel}</h3>
              <p className="person-modal-meta">{modalSubtitle}</p>
            </div>
            <button type="button" className="button secondary tap-button" onClick={onClose} aria-label="Close attributes">
              X
            </button>
          </div>
          <div className="settings-chip-list">
            <button type="button" className={`tab-pill ${tab === "all" ? "active" : ""}`} onClick={() => setTab("all")}>All</button>
            <button type="button" className={`tab-pill ${tab === "descriptor" ? "active" : ""}`} onClick={() => setTab("descriptor")}>Descriptors</button>
            <button type="button" className={`tab-pill ${tab === "event" ? "active" : ""}`} onClick={() => setTab("event")}>Events</button>
          </div>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search attributes"
            style={{ marginTop: "0.65rem" }}
          />
        </div>

        <div className="person-modal-body" style={{ background: "#F7F8FA", minHeight: "60vh" }}>
          {showDescriptors ? (
            <div className="card" style={{ border: "1px solid #E7EAF0", borderRadius: "1rem" }}>
              <h4 className="ui-section-title" style={{ marginTop: 0 }}>Descriptors</h4>
              <div style={{ display: "grid", gap: "0.8rem" }}>
                {grouped.descriptor.length > 0 ? grouped.descriptor.map((group) => (
                  <section key={`desc-${group.key}`}>
                    <h5 style={{ margin: "0 0 0.35rem" }}>{group.label}</h5>
                    <div className="settings-chip-list" style={{ rowGap: "0.4rem" }}>
                      {group.rows.map((item) => (
                        <button
                          key={item.attributeId}
                          type="button"
                          className="button secondary tap-button"
                          style={{ borderRadius: "999px" }}
                          onClick={() => openAttributeDrawer(item)}
                        >
                          {getSafeAttributeValueText(item.valueText) || "-"}
                          {(item.media?.length ?? 0) > 0 ? ` | Media ${item.media.length}` : ""}
                        </button>
                      ))}
                    </div>
                  </section>
                )) : (
                  <p className="page-subtitle" style={{ margin: 0 }}>No descriptor attributes.</p>
                )}
              </div>
            </div>
          ) : null}

          {showEvents ? (
            <div className="card" style={{ border: "1px solid #E7EAF0", borderRadius: "1rem" }}>
              <h4 className="ui-section-title" style={{ marginTop: 0 }}>Events</h4>
              <div style={{ display: "grid", gap: "0.8rem" }}>
                {grouped.event.length > 0 ? grouped.event.map((group) => (
                  <section key={`event-${group.key}`}>
                    <h5 style={{ margin: "0 0 0.35rem" }}>{group.label}</h5>
                    <div className="person-association-list">
                      {group.rows.map((item) => (
                        <button
                          key={item.attributeId}
                          type="button"
                          className="person-linked-row"
                          style={{ width: "100%", textAlign: "left", background: "#fff" }}
                          onClick={() => openAttributeDrawer(item)}
                        >
                          <div style={{ minWidth: 0 }}>
                            <strong>{getSafeAttributeValueText(item.valueText) || "-"}</strong>
                            <div className="page-subtitle" style={{ margin: 0 }}>
                              {[item.dateStart, item.dateEnd].filter(Boolean).join(" - ") || "No dates"}
                            </div>
                          </div>
                          {(item.media?.length ?? 0) > 0 ? <span className="status-chip status-chip--neutral">Media {item.media.length}</span> : null}
                        </button>
                      ))}
                    </div>
                  </section>
                )) : (
                  <p className="page-subtitle" style={{ margin: 0 }}>No event attributes.</p>
                )}
              </div>
            </div>
          ) : null}

          {filtered.length === 0 ? (
            <div className="card" style={{ border: "1px solid #E7EAF0", borderRadius: "1rem" }}>
              <p className="page-subtitle" style={{ margin: 0 }}>No attributes yet.</p>
            </div>
          ) : null}

          <div style={{ position: "sticky", bottom: 0, background: "linear-gradient(180deg, rgba(247,248,250,0) 0%, #F7F8FA 28%)", paddingTop: "1rem" }}>
            <button type="button" className="button tap-button" onClick={openAddModal} disabled={busy} style={{ width: "100%" }}>
              + Add Attribute
            </button>
          </div>

          {status ? <p className="page-subtitle" style={{ marginTop: "0.75rem" }}>{status}</p> : null}
        </div>
      </div>

      {selectedItem ? (
        <div className="person-modal-backdrop" onClick={() => { setSelectedAttributeId(""); setDrawerEditMode(false); setEditingId(""); }} style={{ zIndex: 1200 }}>
          <div className="person-modal-panel" style={{ maxWidth: "560px", marginLeft: "auto" }} onClick={(event) => event.stopPropagation()}>
            <div className="person-modal-sticky-head">
              <div className="person-modal-header">
                <div>
                  <h3 className="person-modal-title">{getAttributeDisplayTitle(selectedItem)}</h3>
                  <p className="person-modal-meta">
                    <span className="status-chip status-chip--neutral" style={{ marginRight: "0.45rem" }}>{getAttributeDisplayType(selectedItem)}</span>
                    <span>{entityLabel}</span>
                  </p>
                </div>
                <button type="button" className="button secondary tap-button" aria-label="Close attribute details" onClick={() => { setSelectedAttributeId(""); setDrawerEditMode(false); setEditingId(""); }}>
                  X
                </button>
              </div>
            </div>

            <div className="person-modal-body">
              {!drawerEditMode ? (
                <>
                  <div className="card" style={{ border: "1px solid #E7EAF0", borderRadius: "1rem" }}>
                    <h4 className="ui-section-title" style={{ marginTop: 0 }}>Details</h4>
                    <div style={{ display: "grid", gap: "0.55rem" }}>
                      <div className="person-linked-row"><strong>Type</strong><span>{getAttributeDisplayType(selectedItem)}</span></div>
                      {formatAttributeDateRange(selectedItem.attributeDate || selectedItem.dateStart, selectedItem.endDate || selectedItem.dateEnd) ? (
                        <div className="person-linked-row">
                          <strong>Dates</strong>
                          <span>{formatAttributeDateRange(selectedItem.attributeDate || selectedItem.dateStart, selectedItem.endDate || selectedItem.dateEnd)}</span>
                        </div>
                      ) : null}
                      {getSafeAttributeValueText(selectedItem.attributeTypeCategory) ? (
                        <div className="person-linked-row"><strong>Category</strong><span>{getSafeAttributeValueText(selectedItem.attributeTypeCategory)}</span></div>
                      ) : null}
                      {selectedItem.dateIsEstimated ? (
                        <div className="person-linked-row"><strong>Estimated</strong><span>{selectedItem.estimatedTo ? `To ${selectedItem.estimatedTo}` : "Yes"}</span></div>
                      ) : null}
                    </div>
                  </div>
                  {getSafeAttributeValueText(selectedItem.attributeNotes || selectedItem.notes) ? (
                    <div className="card" style={{ marginTop: "0.75rem", border: "1px solid #E7EAF0", borderRadius: "1rem" }}>
                      <h4 className="ui-section-title" style={{ marginTop: 0 }}>Notes</h4>
                      <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{getSafeAttributeValueText(selectedItem.attributeNotes || selectedItem.notes)}</p>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="card">
                  <h4 className="ui-section-title" style={{ marginTop: 0 }}>Edit Attribute</h4>
                  <div className="settings-chip-list">
                    <select className="input" value={category} onChange={(e) => {
                      const nextCategory = e.target.value as AttributeCategory;
                      setCategory(nextCategory);
                      const defaults = typeListForCategory(nextCategory);
                      const normalizedCurrent = normalizeTypeKey(typeKey);
                      if (!defaults.includes(normalizedCurrent)) {
                        setTypeKey(defaults[0] || "");
                        setAttributeTypeCategory("");
                      }
                    }}>
                      <option value="descriptor">Descriptor</option>
                      <option value="event">Event</option>
                    </select>
                    <select className="input" value={typeKey} onChange={(e) => {
                      setTypeKey(normalizeTypeKey(e.target.value));
                      setAttributeTypeCategory("");
                    }}>
                      {typeListForCategory(category).map((item) => (
                        <option key={item} value={item}>{prettyLabel(item, "")}</option>
                      ))}
                    </select>
                  </div>
                  {typeCategorySuggestions.length > 0 ? (
                    <>
                      <label className="label">Attribute Type Category</label>
                      <select className="input" value={attributeTypeCategory} onChange={(e) => setAttributeTypeCategory(e.target.value)}>
                        <option value="">Select category</option>
                        {typeCategorySuggestions.map((item) => (
                          <option key={item} value={item}>{prettyLabel(item, "")}</option>
                        ))}
                      </select>
                    </>
                  ) : null}
                  <label className="label">Display Label (optional)</label>
                  <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Override title shown on saved card" />
                  <label className="label">Attribute Detail</label>
                  <input className="input" value={valueText} onChange={(e) => setValueText(e.target.value)} placeholder="Event or mission name" />
                  <div className="settings-chip-list">
                    <div style={{ flex: 1, minWidth: "170px" }}>
                      <label className="label">Start Date</label>
                      <input className="input" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
                    </div>
                    <div style={{ flex: 1, minWidth: "170px" }}>
                      <label className="label">End Date</label>
                      <input className="input" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
                    </div>
                  </div>
                  <div className="settings-chip-list">
                    <div style={{ flex: 1, minWidth: "170px" }}>
                      <label className="label">Date Is Estimated?</label>
                      <select
                        className="input"
                        value={dateIsEstimated ? "yes" : "no"}
                        onChange={(e) => {
                          const next = e.target.value === "yes";
                          setDateIsEstimated(next);
                          if (!next) setEstimatedTo("");
                        }}
                      >
                        <option value="no">No</option>
                        <option value="yes">Yes</option>
                      </select>
                    </div>
                    {dateIsEstimated ? (
                      <div style={{ flex: 1, minWidth: "170px" }}>
                        <label className="label">Estimated To</label>
                        <select className="input" value={estimatedTo} onChange={(e) => setEstimatedTo(e.target.value as "" | "month" | "year")}>
                          <option value="">Select one</option>
                          <option value="month">Month</option>
                          <option value="year">Year</option>
                        </select>
                      </div>
                    ) : null}
                  </div>
                  <label className="label">Attribute Notes</label>
                  <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  <div className="settings-chip-list" style={{ marginTop: "0.75rem" }}>
                    <button type="button" className="button tap-button" disabled={busy} onClick={() => void saveAttribute()}>
                      {busy ? "Saving..." : "Save"}
                    </button>
                    <button type="button" className="button secondary tap-button" disabled={busy} onClick={cancelEditSelected}>Cancel</button>
                  </div>
                </div>
              )}

              <div className="card" style={{ marginTop: "0.75rem", border: "1px solid #E7EAF0", borderRadius: "1rem" }}>
                <h4 className="ui-section-title" style={{ marginTop: 0 }}>Media</h4>
                <div className="person-association-list">
                  {(selectedItem.media ?? []).length > 0 ? selectedItem.media.map((item) => (
                    <div key={item.linkId} className="person-linked-row">
                      <div className="person-linked-main">
                        <img src={getPhotoProxyPath(item.fileId, tenantKey)} alt={item.label || "media"} className="person-linked-avatar" />
                        <span>{item.label || item.fileId}</span>
                      </div>
                      <button
                        type="button"
                        className="person-chip-remove"
                        disabled={busy}
                        aria-label={`Remove ${item.label || item.fileId} from attribute`}
                        onClick={() => void removeMedia(selectedItem.attributeId, item.linkId)}
                      >
                        x
                      </button>
                    </div>
                  )) : (
                    <p className="page-subtitle" style={{ margin: 0 }}>No media linked yet.</p>
                  )}
                </div>
                {pendingPreview ? (
                  <div className="person-upload-preview-card" style={{ marginTop: "0.75rem" }}>
                    {pendingFile?.type?.startsWith("video/") ? (
                      <video src={pendingPreview} className="person-upload-preview-image" controls playsInline />
                    ) : pendingFile?.type?.startsWith("audio/") ? (
                      <audio src={pendingPreview} className="person-upload-preview-image" controls />
                    ) : (
                      <img src={pendingPreview} alt="Pending upload preview" className="person-upload-preview-image" />
                    )}
                    <div className="person-upload-preview-meta">
                      <strong>{pendingFile?.name || "Selected media"}</strong>
                      <span>Will attach to this attribute.</span>
                    </div>
                  </div>
                ) : null}
                <input
                  id={`attribute-upload-${selectedItem.attributeId}`}
                  type="file"
                  accept="image/*,video/*,audio/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    e.currentTarget.value = "";
                    if (!file) return;
                    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
                    setPendingFile(file);
                    setPendingPreview(URL.createObjectURL(file));
                    setCaptureSource("library");
                  }}
                />
                <input
                  id={`attribute-upload-camera-${selectedItem.attributeId}`}
                  type="file"
                  accept="image/*,video/*"
                  capture="environment"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    e.currentTarget.value = "";
                    if (!file) return;
                    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
                    setPendingFile(file);
                    setPendingPreview(URL.createObjectURL(file));
                    setCaptureSource("camera");
                  }}
                />
                <input
                  id={`attribute-upload-audio-${selectedItem.attributeId}`}
                  type="file"
                  accept="audio/*"
                  capture="user"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    e.currentTarget.value = "";
                    if (!file) return;
                    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
                    setPendingFile(file);
                    setPendingPreview(URL.createObjectURL(file));
                    setCaptureSource("microphone");
                  }}
                />
                <div className="settings-chip-list" style={{ marginTop: "0.75rem", alignItems: "center" }}>
                  <button type="button" className="button secondary tap-button" onClick={() => setShowAddMediaMenu((prev) => !prev)}>
                    Add Media
                  </button>
                  <button type="button" className="button tap-button" disabled={!pendingFile || busy} onClick={() => void uploadAttachment()}>
                    {busy ? "Uploading..." : "Attach Media"}
                  </button>
                </div>
                {showAddMediaMenu ? (
                  <div className="settings-chip-list" style={{ marginTop: "0.55rem" }}>
                    <button
                      type="button"
                      className="button secondary tap-button"
                      onClick={() => {
                        setEditingId(selectedItem.attributeId);
                        setShowAddMediaMenu(false);
                        document.getElementById(`attribute-upload-${selectedItem.attributeId}`)?.click();
                      }}
                    >
                      File From Device
                    </button>
                    {isLikelyMobile ? (
                      <button
                        type="button"
                        className="button secondary tap-button"
                        onClick={() => {
                          setEditingId(selectedItem.attributeId);
                          setShowAddMediaMenu(false);
                          document.getElementById(`attribute-upload-camera-${selectedItem.attributeId}`)?.click();
                        }}
                      >
                        Camera
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="button secondary tap-button"
                      onClick={() => {
                        setShowLibraryPicker(true);
                        setShowAddMediaMenu(false);
                      }}
                    >
                      Media Library
                    </button>
                  </div>
                ) : null}
                {showLibraryPicker ? (
                  <div className="card" style={{ marginTop: "0.75rem", border: "1px solid #E7EAF0", borderRadius: "0.9rem", padding: "0.7rem" }}>
                    <label className="label">Choose from Media Library</label>
                    <div className="settings-chip-list">
                      <input
                        className="input"
                        placeholder="Search library by file name or ID"
                        value={libraryQuery}
                        onChange={(e) => setLibraryQuery(e.target.value)}
                      />
                      <button type="button" className="button secondary tap-button" onClick={() => void searchLibraryMedia()} disabled={libraryBusy}>
                        {libraryBusy ? "Searching..." : "Search"}
                      </button>
                      <button type="button" className="button secondary tap-button" onClick={() => setShowLibraryPicker(false)}>
                        Close
                      </button>
                    </div>
                    <div className="person-association-list" style={{ marginTop: "0.55rem" }}>
                      {libraryResults.length > 0 ? libraryResults.map((item) => (
                        <button
                          key={item.fileId}
                          type="button"
                          className="person-linked-row"
                          style={{ width: "100%", textAlign: "left", background: "#fff" }}
                          onClick={() => void selectLibraryMedia(item)}
                        >
                          <span>{item.name || item.fileId}</span>
                          <span className="page-subtitle">{item.date || item.fileId}</span>
                        </button>
                      )) : <p className="page-subtitle" style={{ margin: 0 }}>No results yet.</p>}
                    </div>
                  </div>
                ) : null}
              </div>
              {!drawerEditMode ? (
                <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.45rem" }}>
                  <button type="button" className="button secondary tap-button" onClick={beginEditSelected} disabled={busy}>Edit Attribute</button>
                  <button
                    type="button"
                    className="button secondary tap-button"
                    style={{ opacity: 0.78 }}
                    onClick={() => void removeAttribute(selectedItem.attributeId)}
                    disabled={busy}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
              {status ? <p className="page-subtitle" style={{ marginTop: "0.75rem" }}>{status}</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      {addModalOpen ? (
        <div className="person-modal-backdrop" onClick={closeAddModal} style={{ zIndex: 1300 }}>
          <div className="person-modal-panel" style={{ maxWidth: "680px", height: "auto", maxHeight: "none" }} onClick={(event) => event.stopPropagation()}>
            <div className="person-modal-sticky-head">
                <div className="person-modal-header">
                  <div>
                    <h3 className="person-modal-title">Add Attribute</h3>
                    <p className="person-modal-meta">{launchSourceLabel ? `${entityLabel} | ${launchSourceLabel}` : entityLabel}</p>
                  </div>
              </div>
            </div>
            <div className="person-modal-body">
              <div className="card">
                <div className="settings-chip-list" style={{ gridTemplateColumns: "1fr" }}>
                  <div style={{ minWidth: "190px", display: "flex", alignItems: "end", paddingBottom: "0.45rem" }}>
                    <label className="label" style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginBottom: 0 }}>
                      <input
                        type="checkbox"
                        checked={category === "event"}
                        onChange={(e) => {
                          const nextCategory: AttributeCategory = e.target.checked ? "event" : "descriptor";
                          setCategory(nextCategory);
                          const defaults = typeListForCategory(nextCategory);
                          const normalizedCurrent = normalizeTypeKey(typeKey);
                          if (!defaults.includes(normalizedCurrent)) {
                            setTypeKey(defaults[0] || "");
                            setAttributeTypeCategory("");
                          }
                          if (!e.target.checked) {
                            setDateIsEstimated(false);
                            setEstimatedTo("");
                            setDateStart("");
                            setDateEnd("");
                          }
                        }}
                        style={{ width: "14px", height: "14px" }}
                      />
                      Date Related
                    </label>
                  </div>
                </div>

                <div
                  className="settings-chip-list"
                  style={{ gridTemplateColumns: typeCategorySuggestions.length > 0 ? "repeat(2, minmax(0, 1fr))" : "1fr" }}
                >
                  <div style={{ flex: 1, minWidth: "190px" }}>
                    <label className="label">Type</label>
                    <select
                      className="input"
                      value={typeKey}
                      onChange={(e) => {
                        setTypeKey(normalizeTypeKey(e.target.value));
                        setAttributeTypeCategory("");
                      }}
                    >
                      {addTypeSuggestions.map((item) => (
                        <option key={item} value={item}>
                          {category === "event" ? (typeLabelByKey.get(normalizeTypeKey(item)) ?? prettyLabel(item, "")) : prettyLabel(item, "")}
                        </option>
                      ))}
                    </select>
                  </div>
                  {typeCategorySuggestions.length > 0 ? (
                    <div style={{ flex: 1, minWidth: "220px" }}>
                      <label className="label">{getTypeCategoryLabel(typeKey)}</label>
                      <select
                        className="input"
                        value={attributeTypeCategory}
                        onChange={(e) => setAttributeTypeCategory(e.target.value)}
                      >
                        <option value="">Select category</option>
                        {typeCategorySuggestions.map((item) => (
                          <option key={item} value={item}>
                            {category === "event"
                              ? (eventTypeOptionsByCategory
                                .get(normalizeTypeKey(typeKey))
                                ?.find((entry) => entry.typeKey === normalizeTypeKey(item))
                                ?.typeLabel ?? prettyLabel(item, ""))
                              : prettyLabel(item, "")}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>
                <label className="label">
                  {category === "event" && selectedEventTypeOption?.detailLabel
                    ? selectedEventTypeOption.detailLabel
                    : getDetailLabel(attributeTypeCategory || typeKey)}
                </label>
                <input
                  className="input"
                  value={valueText}
                  onChange={(e) => setValueText(e.target.value)}
                  placeholder={
                    category === "event" && selectedEventTypeOption?.detailLabel
                      ? selectedEventTypeOption.detailLabel
                      : getDetailLabel(attributeTypeCategory || typeKey)
                  }
                />

                {category === "event" ? (
                  <div style={{ marginTop: "0.75rem" }}>
                    <div className="settings-chip-list">
                      <div style={{ flex: 1, minWidth: "170px" }}>
                        <label className="label">Date</label>
                        <input className="input" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
                      </div>
                      {selectedEventTypeOption == null || selectedEventTypeOption.askEndDate || selectedEventTypeOption.dateMode === "range" ? (
                        <div style={{ flex: 1, minWidth: "170px" }}>
                          <label className="label">{addFormCopy.endDateLabel}</label>
                          <input className="input" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
                        </div>
                      ) : null}
                    </div>
                    <div className="settings-chip-list">
                      <div style={{ flex: 1, minWidth: "170px", display: "flex", alignItems: "end", paddingBottom: "0.35rem" }}>
                        <label className="label" style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginBottom: 0 }}>
                          <input
                            type="checkbox"
                            checked={dateIsEstimated}
                            onChange={(e) => {
                              const next = e.target.checked;
                              setDateIsEstimated(next);
                              if (!next) setEstimatedTo("");
                            }}
                            style={{ width: "14px", height: "14px" }}
                          />
                          Date Is Estimated
                        </label>
                      </div>
                      {dateIsEstimated ? (
                        <div style={{ flex: 1, minWidth: "170px" }}>
                          <label className="label">Estimated To</label>
                          <select className="input" value={estimatedTo} onChange={(e) => setEstimatedTo(e.target.value as "" | "month" | "year")}>
                            <option value="">Select one</option>
                            <option value="month">Month</option>
                            <option value="year">Year</option>
                          </select>
                        </div>
                      ) : null}
                    </div>
                    <label className="label">Attribute Notes</label>
                    <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                ) : null}
                {category !== "event" ? (
                  <div style={{ marginTop: "0.75rem" }}>
                    <label className="label">Attribute Notes</label>
                    <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                ) : null}

                <div className="settings-chip-list" style={{ marginTop: "0.75rem", alignItems: "center" }}>
                  <button type="button" className="button secondary tap-button" onClick={() => setShowAddMediaMenu((prev) => !prev)} disabled={busy}>
                    Add Media
                  </button>
                </div>
                {showAddMediaMenu ? (
                  <div className="settings-chip-list" style={{ marginTop: "0.55rem" }}>
                    <button type="button" className="button secondary tap-button" onClick={() => startAddAndAttach("photo")} disabled={busy}>File From Device</button>
                    {isLikelyMobile ? (
                      <button type="button" className="button secondary tap-button" onClick={() => startAddAndAttach("video")} disabled={busy}>Camera</button>
                    ) : null}
                    <button type="button" className="button secondary tap-button" onClick={() => startAddAndAttach("library")} disabled={busy}>Media Library</button>
                  </div>
                ) : null}
                <p className="page-subtitle" style={{ marginTop: "0.5rem" }}>Selecting a media option saves first, then opens the chooser.</p>

                <div className="settings-chip-list" style={{ marginTop: "0.75rem" }}>
                  {editingId ? (
                    <button
                      type="button"
                      className="button secondary tap-button"
                      style={{ opacity: 0.82 }}
                      onClick={() => void removeAttribute(editingId)}
                      disabled={busy}
                    >
                      Delete
                    </button>
                  ) : null}
                  <button type="button" className="button secondary tap-button" onClick={closeAddModal} disabled={busy}>Cancel</button>
                  <button type="button" className="button tap-button" onClick={() => void saveAttribute()} disabled={busy}>
                    {busy ? "Saving..." : "Save"}
                  </button>
                </div>
                {debugMode ? (
                <div style={{ marginTop: "0.65rem" }}>
                  <label className="label" style={{ marginBottom: "0.35rem" }}>Debug: raw GET attribute JSON</label>
                  <pre
                    style={{
                      margin: 0,
                      padding: "0.65rem",
                      borderRadius: "0.65rem",
                      border: "1px solid #E7EAF0",
                      background: "#F8FAFC",
                      fontSize: "0.75rem",
                      overflowX: "auto",
                      maxHeight: "180px",
                    }}
                  >
                    {JSON.stringify(selectedRawItem ?? rawItems[0] ?? null, null, 2)}
                  </pre>
                </div>
                ) : null}
              </div>
              {status ? <p className="page-subtitle" style={{ marginTop: "0.75rem" }}>{status}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AttributeSummarySection({
  tenantKey,
  entityType,
  entityId,
  entityLabel,
  canManage,
  sectionTitle = "Attributes",
  manageLabel = "Manage Attributes",
  modalSubtitle = "Attributes",
}: {
  tenantKey: string;
  entityType: AttributeEntityType;
  entityId: string;
  entityLabel: string;
  canManage: boolean;
  sectionTitle?: string;
  manageLabel?: string;
  modalSubtitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const [initialTypeKey, setInitialTypeKey] = useState("");
  const [items, setItems] = useState<AttributeItem[]>([]);
  const [status, setStatus] = useState("");

  const refresh = async () => {
    const res = await fetch(
      `/api/attributes?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`,
      { cache: "no-store" },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setStatus(`Attributes load failed: ${res.status}`);
      return;
    }
    setItems(Array.isArray(body?.attributes) ? (body.attributes as AttributeItem[]) : []);
    setStatus("");
  };

  useEffect(() => {
    if (!entityId) return;
    void refresh();
  }, [entityType, entityId]);

  const grouped = useMemo(() => {
    const groupByCategory = (category: AttributeCategory) => {
      const map = new Map<string, AttributeItem[]>();
      items.filter((item) => item.category === category).forEach((item) => {
        if (!map.has(item.typeKey)) map.set(item.typeKey, []);
        map.get(item.typeKey)!.push(item);
      });
      return Array.from(map.entries())
        .map(([typeKey, entries]) => {
          const sorted = entries.slice().sort((a, b) => (b.dateStart || "").localeCompare(a.dateStart || ""));
          const latest = sorted[0];
          const mediaCount = entries.reduce((sum, current) => sum + (current.media?.length ?? 0), 0);
          return {
            typeKey,
            label: prettyLabel(typeKey, latest?.label || ""),
            count: entries.length,
            summary: entries.length === 1 ? summarizeSingle(latest) : `${entries.length} entries | ${summarizeSingle(latest)}`,
            mediaCount,
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label));
    };
    return {
      descriptor: groupByCategory("descriptor"),
      event: groupByCategory("event"),
    };
  }, [items]);

  return (
    <>
      <div className="card">
        <div className="person-photo-gallery-toolbar">
          <h4 className="ui-section-title" style={{ marginBottom: 0 }}>{sectionTitle}</h4>
          {canManage ? (
            <button type="button" className="button tap-button" onClick={() => {
              setInitialTypeKey("");
              setOpen(true);
            }}>
              {manageLabel}
            </button>
          ) : null}
        </div>

        <h5 style={{ margin: "0.5rem 0 0.45rem" }}>Descriptors</h5>
        <div className="person-association-list">
          {grouped.descriptor.length > 0 ? grouped.descriptor.map((row) => (
            <div key={`desc-${row.typeKey}`} className="person-linked-row">
              <div style={{ minWidth: 0 }}>
                <strong>{row.label}</strong>
                <div className="page-subtitle" style={{ margin: 0 }}>{row.summary}</div>
              </div>
              <div className="settings-chip-list">
                <span className="status-chip status-chip--neutral">Media {row.mediaCount}</span>
                {canManage ? (
                  <button type="button" className="button secondary tap-button" onClick={() => {
                    setInitialTypeKey(row.typeKey);
                    setOpen(true);
                  }}>
                    Edit
                  </button>
                ) : null}
              </div>
            </div>
          )) : <p className="page-subtitle" style={{ margin: 0 }}>No descriptors.</p>}
        </div>

        <h5 style={{ margin: "0.75rem 0 0.45rem" }}>Events</h5>
        <div className="person-association-list">
          {grouped.event.length > 0 ? grouped.event.map((row) => (
            <div key={`event-${row.typeKey}`} className="person-linked-row">
              <div style={{ minWidth: 0 }}>
                <strong>{row.label}</strong>
                <div className="page-subtitle" style={{ margin: 0 }}>{row.summary}</div>
              </div>
              <div className="settings-chip-list">
                <span className="status-chip status-chip--neutral">Media {row.mediaCount}</span>
                {canManage ? (
                  <button type="button" className="button secondary tap-button" onClick={() => {
                    setInitialTypeKey(row.typeKey);
                    setOpen(true);
                  }}>
                    Edit
                  </button>
                ) : null}
              </div>
            </div>
          )) : <p className="page-subtitle" style={{ margin: 0 }}>No events.</p>}
        </div>
        {status ? <p className="page-subtitle" style={{ marginTop: "0.6rem" }}>{status}</p> : null}
      </div>

      <AttributesModal
        open={open}
        tenantKey={tenantKey}
        entityType={entityType}
        entityId={entityId}
        entityLabel={entityLabel}
        modalSubtitle={modalSubtitle}
        initialTypeKey={initialTypeKey}
        onClose={() => setOpen(false)}
        onSaved={() => {
          void refresh();
        }}
      />
    </>
  );
}
