"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  makeAttributeDefinitionCategoryId,
  makeAttributeDefinitionTypeId,
  normalizeAttributeTypeKey,
} from "@/lib/attributes/definition-defaults";
import type { AttributeCategory } from "@/lib/attributes/types";
import type {
  AttributeEventCategoryDefinition,
  AttributeEventDefinitions,
  AttributeEventTypeDefinition,
} from "@/lib/attributes/event-definitions-types";

type TenantOption = {
  tenantKey: string;
  tenantName: string;
  role: "ADMIN" | "USER";
};

type CategoryRow = AttributeEventCategoryDefinition;
type TypeRow = AttributeEventTypeDefinition;
type DefinitionsPayload = AttributeEventDefinitions;

function normalizeLabel(value: string) {
  return value.trim();
}

function categoryIdFor(row: Pick<CategoryRow, "kind" | "categoryKey">) {
  return makeAttributeDefinitionCategoryId(row.kind, row.categoryKey);
}

function typeIdFor(row: Pick<TypeRow, "kind" | "categoryKey" | "typeKey">) {
  return makeAttributeDefinitionTypeId(row.kind, row.categoryKey, row.typeKey);
}

function stableStringify(payload: DefinitionsPayload) {
  const sortedCategories = [...payload.categories].sort(
    (a, b) => a.sortOrder - b.sortOrder || `${a.kind}:${a.categoryKey}`.localeCompare(`${b.kind}:${b.categoryKey}`),
  );
  const sortedTypes = [...payload.types].sort(
    (a, b) => a.sortOrder - b.sortOrder || `${a.kind}:${a.categoryKey}:${a.typeKey}`.localeCompare(`${b.kind}:${b.categoryKey}:${b.typeKey}`),
  );
  return JSON.stringify({ version: payload.version, categories: sortedCategories, types: sortedTypes });
}

export function AttributeDefinitionsAdmin({
  tenantOptions,
  selectedTenantKey,
  onTenantChange,
}: {
  tenantOptions: TenantOption[];
  selectedTenantKey: string;
  onTenantChange: (tenantKey: string) => void;
}) {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [types, setTypes] = useState<TypeRow[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | AttributeCategory>("all");
  const [baseline, setBaseline] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setStatus("Loading...");
    const res = await fetch(`/api/t/${encodeURIComponent(selectedTenantKey)}/attribute-definitions`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setBusy(false);
      setStatus(`Load failed: ${res.status}`);
      return;
    }
    const defs = body?.definitions as DefinitionsPayload | undefined;
    const nextCategories = Array.isArray(defs?.categories)
      ? defs.categories.map((row) => {
          const kind: AttributeCategory = row.kind === "event" ? "event" : "descriptor";
          return {
            ...row,
            categoryKey: normalizeAttributeTypeKey(row.categoryKey),
            categoryColor: (row.categoryColor || "#e5e7eb").trim() || "#e5e7eb",
            kind,
          };
        })
      : [];
    const nextTypes = Array.isArray(defs?.types)
      ? defs.types.map((row) => {
          const kind: AttributeCategory = row.kind === "event" ? "event" : "descriptor";
          return {
            ...row,
            typeKey: normalizeAttributeTypeKey(row.typeKey),
            categoryKey: normalizeAttributeTypeKey(row.categoryKey),
            kind,
          };
        })
      : [];
    setCategories(nextCategories);
    setTypes(nextTypes);
    const firstCategory = [...nextCategories]
      .sort((a, b) => a.sortOrder - b.sortOrder || `${a.kind}:${a.categoryLabel}`.localeCompare(`${b.kind}:${b.categoryLabel}`))[0] ?? null;
    const firstCategoryId = firstCategory ? categoryIdFor(firstCategory) : "";
    setSelectedCategoryId(firstCategoryId);
    const firstType = [...nextTypes]
      .filter((row) => firstCategory && row.kind === firstCategory.kind && row.categoryKey === firstCategory.categoryKey)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.typeLabel.localeCompare(b.typeLabel))[0] ?? null;
    setSelectedTypeId(firstType ? typeIdFor(firstType) : "");
    const snapshot = stableStringify({ version: defs?.version ?? 2, categories: nextCategories, types: nextTypes });
    setBaseline(snapshot);
    setStatus("");
    setBusy(false);
  }, [selectedTenantKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.sortOrder - b.sortOrder || `${a.kind}:${a.categoryLabel}`.localeCompare(`${b.kind}:${b.categoryLabel}`)),
    [categories],
  );

  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortedCategories.filter((row) => {
      if (kindFilter !== "all" && row.kind !== kindFilter) {
        return false;
      }
      if (!q) return true;
      const haystack = `${row.categoryLabel} ${row.description}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [kindFilter, search, sortedCategories]);

  const selectedCategory = useMemo(
    () => sortedCategories.find((row) => categoryIdFor(row) === selectedCategoryId) ?? null,
    [sortedCategories, selectedCategoryId],
  );

  useEffect(() => {
    if (filteredCategories.length === 0) {
      return;
    }
    if (!filteredCategories.some((row) => categoryIdFor(row) === selectedCategoryId)) {
      setSelectedCategoryId(categoryIdFor(filteredCategories[0]!));
    }
  }, [filteredCategories, selectedCategoryId]);

  const categoryTypes = useMemo(
    () =>
      selectedCategory
        ? types
            .filter((row) => row.kind === selectedCategory.kind && row.categoryKey === selectedCategory.categoryKey)
            .sort((a, b) => a.sortOrder - b.sortOrder || a.typeLabel.localeCompare(b.typeLabel))
        : [],
    [selectedCategory, types],
  );

  const selectedType = useMemo(
    () => categoryTypes.find((row) => typeIdFor(row) === selectedTypeId) ?? null,
    [categoryTypes, selectedTypeId],
  );

  useEffect(() => {
    if (categoryTypes.length === 0) {
      setSelectedTypeId("");
      return;
    }
    if (!categoryTypes.some((row) => typeIdFor(row) === selectedTypeId)) {
      setSelectedTypeId(typeIdFor(categoryTypes[0]!));
    }
  }, [categoryTypes, selectedTypeId]);

  const duplicateCategoryKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of categories) {
      const key = categoryIdFor({ kind: row.kind, categoryKey: normalizeAttributeTypeKey(row.categoryKey) });
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([key]) => key));
  }, [categories]);

  const duplicateTypeKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of types) {
      const key = typeIdFor({ kind: row.kind, categoryKey: normalizeAttributeTypeKey(row.categoryKey), typeKey: normalizeAttributeTypeKey(row.typeKey) });
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([key]) => key));
  }, [types]);

  const hasValidationErrors = useMemo(() => {
    if (duplicateCategoryKeys.size > 0 || duplicateTypeKeys.size > 0) return true;
    if (categories.some((row) => !row.categoryLabel.trim() || !normalizeAttributeTypeKey(row.categoryKey))) return true;
    if (types.some((row) => !row.typeLabel.trim() || !normalizeAttributeTypeKey(row.typeKey) || !normalizeAttributeTypeKey(row.categoryKey))) return true;
    return false;
  }, [categories, duplicateCategoryKeys, duplicateTypeKeys, types]);

  const payloadSnapshot = useMemo(
    () =>
      stableStringify({
        version: 2,
        categories: categories.map((row, index) => ({
          ...row,
          kind: row.kind,
          categoryKey: normalizeAttributeTypeKey(row.categoryKey),
          categoryLabel: normalizeLabel(row.categoryLabel),
          categoryColor: row.categoryColor.trim(),
          description: row.description.trim(),
          sortOrder: Number.isFinite(row.sortOrder) ? row.sortOrder : (index + 1) * 10,
        })),
        types: types.map((row, index) => ({
          ...row,
          kind: row.kind,
          typeKey: normalizeAttributeTypeKey(row.typeKey),
          categoryKey: normalizeAttributeTypeKey(row.categoryKey),
          typeLabel: normalizeLabel(row.typeLabel),
          detailLabel: normalizeLabel(row.detailLabel),
          sortOrder: Number.isFinite(row.sortOrder) ? row.sortOrder : (index + 1) * 10,
        })),
      }),
    [categories, types],
  );

  const hasUnsavedChanges = payloadSnapshot !== baseline;

  const save = async () => {
    if (hasValidationErrors) {
      setStatus("Fix validation errors before saving.");
      return;
    }
    setBusy(true);
    setStatus("Saving...");
    const payload = JSON.parse(payloadSnapshot) as DefinitionsPayload;
    const res = await fetch(`/api/t/${encodeURIComponent(selectedTenantKey)}/attribute-definitions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setStatus(`Save failed: ${res.status} ${String(body?.error ?? "").slice(0, 120)}`.trim());
      setBusy(false);
      return;
    }
    setBaseline(payloadSnapshot);
    setStatus("Saved.");
    setBusy(false);
  };

  const discard = async () => {
    await load();
    setStatus("Changes discarded.");
  };

  const addCategory = () => {
    const index = categories.length + 1;
    const nextKind: AttributeCategory = kindFilter === "all" ? "descriptor" : kindFilter;
    const next: CategoryRow = {
      kind: nextKind,
      categoryKey: `category_${index}`,
      categoryLabel: `Category ${index}`,
      categoryColor: "#e5e7eb",
      description: "",
      sortOrder: index * 10,
      isEnabled: true,
    };
    setCategories((prev) => [...prev, next]);
    setSelectedCategoryId(categoryIdFor(next));
    setSelectedTypeId("");
  };

  const updateCategory = (categoryId: string, patch: Partial<CategoryRow>) => {
    const current = categories.find((row) => categoryIdFor(row) === categoryId);
    if (!current) return;
    const nextCategory: CategoryRow = { ...current, ...patch };
    const nextCategoryId = categoryIdFor(nextCategory);
    setCategories((prev) => prev.map((row) => (categoryIdFor(row) === categoryId ? nextCategory : row)));
    setTypes((prev) =>
      prev.map((row) =>
        row.kind === current.kind && row.categoryKey === current.categoryKey
          ? { ...row, kind: nextCategory.kind, categoryKey: nextCategory.categoryKey }
          : row,
      ),
    );
    if (selectedCategoryId === categoryId) {
      setSelectedCategoryId(nextCategoryId);
    }
    if (selectedTypeId) {
      const currentType = types.find((row) => typeIdFor(row) === selectedTypeId);
      if (currentType && currentType.kind === current.kind && currentType.categoryKey === current.categoryKey) {
        setSelectedTypeId(typeIdFor({ ...currentType, kind: nextCategory.kind, categoryKey: nextCategory.categoryKey }));
      }
    }
  };

  const deleteCategory = (categoryId: string) => {
    const current = categories.find((row) => categoryIdFor(row) === categoryId);
    if (!current) return;
    const nextCategories = categories.filter((row) => categoryIdFor(row) !== categoryId);
    setCategories(nextCategories);
    setTypes((prev) => prev.filter((row) => !(row.kind === current.kind && row.categoryKey === current.categoryKey)));
    if (selectedCategoryId === categoryId) {
      const fallback = [...nextCategories].sort((a, b) => a.sortOrder - b.sortOrder || a.categoryLabel.localeCompare(b.categoryLabel))[0] ?? null;
      setSelectedCategoryId(fallback ? categoryIdFor(fallback) : "");
      const fallbackType = fallback
        ? types
            .filter((row) => row.kind === fallback.kind && row.categoryKey === fallback.categoryKey)
            .sort((a, b) => a.sortOrder - b.sortOrder || a.typeLabel.localeCompare(b.typeLabel))[0] ?? null
        : null;
      setSelectedTypeId(fallbackType ? typeIdFor(fallbackType) : "");
    }
  };

  const addType = () => {
    if (!selectedCategory) return;
    const next = categoryTypes.length + 1;
    const created: TypeRow = {
      kind: selectedCategory.kind,
      typeKey: `${selectedCategory.categoryKey}_type_${next}`,
      categoryKey: selectedCategory.categoryKey,
      typeLabel: `Type ${next}`,
      detailLabel: "Attribute Detail",
      dateMode: "none",
      askEndDate: false,
      sortOrder: next * 10,
      isEnabled: true,
    };
    setTypes((prev) => [...prev, created]);
    setSelectedTypeId(typeIdFor(created));
  };

  const updateType = (typeId: string, patch: Partial<TypeRow>) => {
    setTypes((prev) => {
      const nextRows = prev.map((row) => (typeIdFor(row) === typeId ? { ...row, ...patch } : row));
      const selected = nextRows.find((row) => typeIdFor(row) === typeId);
      if (selected && selectedTypeId === typeId) {
        setSelectedTypeId(typeIdFor(selected));
      }
      return nextRows;
    });
  };

  const deleteType = (typeId: string) => {
    const nextTypes = types.filter((row) => typeIdFor(row) !== typeId);
    setTypes(nextTypes);
    if (selectedTypeId === typeId) {
      const fallback = categoryTypes.find((row) => typeIdFor(row) !== typeId) ?? null;
      setSelectedTypeId(fallback ? typeIdFor(fallback) : "");
    }
  };

  return (
    <section className="card settings-panel">
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "end", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ marginTop: 0, marginBottom: "0.35rem" }}>Attribute Definitions</h2>
          <p className="page-subtitle" style={{ marginTop: 0 }}>
            Configure descriptor and event categories and types used by Add Attribute.
          </p>
        </div>
        <div style={{ minWidth: "240px" }}>
          <label className="label">Family Group</label>
          <select className="input" value={selectedTenantKey} onChange={(e) => onTenantChange(e.target.value)}>
            {tenantOptions.map((option) => (
              <option key={option.tenantKey} value={option.tenantKey}>
                {option.tenantName} ({option.role})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card" style={{ marginTop: "0.75rem", position: "sticky", top: 0, zIndex: 2 }}>
        <div className="settings-chip-list">
          <button type="button" className="button secondary tap-button" onClick={() => void discard()} disabled={busy || !hasUnsavedChanges}>
            Discard
          </button>
          <button type="button" className="button tap-button" onClick={save} disabled={busy || hasValidationErrors}>
            {busy ? "Saving..." : "Save Definitions"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "minmax(280px, 340px) minmax(0, 1fr)", marginTop: "0.75rem" }}>
        <div className="card">
          <div
            style={{
              display: "grid",
              gap: "0.6rem",
              gridTemplateColumns: "minmax(0, 1fr) 160px",
              alignItems: "end",
            }}
          >
            <div>
              <label className="label">Search Categories</label>
              <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search label or description" />
            </div>
            <div>
              <label className="label">Kind Filter</label>
              <select className="input" value={kindFilter} onChange={(e) => setKindFilter(e.target.value as "all" | AttributeCategory)}>
                <option value="all">All</option>
                <option value="descriptor">Attributes</option>
                <option value="event">Events</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.45rem", maxHeight: "55vh", overflow: "auto" }}>
            {filteredCategories.map((row) => {
              const rowId = categoryIdFor(row);
              const active = rowId === selectedCategoryId;
              return (
                <button
                  key={rowId}
                  type="button"
                  className="button secondary tap-button"
                  onClick={() => {
                    setSelectedCategoryId(rowId);
                    const firstType = types
                      .filter((item) => item.kind === row.kind && item.categoryKey === row.categoryKey)
                      .sort((a, b) => a.sortOrder - b.sortOrder || a.typeLabel.localeCompare(b.typeLabel))[0] ?? null;
                    setSelectedTypeId(firstType ? typeIdFor(firstType) : "");
                  }}
                  style={{ textAlign: "left", borderColor: active ? "#1f2937" : undefined, background: active ? "#eef2ff" : undefined }}
                >
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", fontWeight: 700 }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: "0.75rem",
                        height: "0.75rem",
                        borderRadius: "999px",
                        background: row.categoryColor || "#e5e7eb",
                        border: "1px solid rgba(17,24,39,0.15)",
                        flex: "0 0 auto",
                      }}
                    />
                    <span>{row.categoryLabel || row.categoryKey}</span>
                  </div>
                </button>
              );
            })}
            {filteredCategories.length === 0 ? <p className="page-subtitle" style={{ margin: 0 }}>No categories found.</p> : null}
          </div>
          <div className="settings-chip-list" style={{ marginTop: "0.6rem" }}>
            <button type="button" className="button secondary tap-button" onClick={addCategory} disabled={busy}>
              Add Category
            </button>
          </div>
        </div>

        <div className="card">
          {selectedCategory ? (
            <>
              <div
                className="settings-chip-list"
                style={{
                  display: "grid",
                  gridTemplateColumns: "140px minmax(220px, 1fr)",
                  gap: "0.6rem",
                  alignItems: "end",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <label className="label">Kind</label>
                  <select className="input" value={selectedCategory.kind} onChange={(e) => updateCategory(selectedCategoryId, { kind: e.target.value as AttributeCategory })}>
                    <option value="descriptor">Attribute</option>
                    <option value="event">Event</option>
                  </select>
                </div>
                <div style={{ minWidth: 0 }}>
                  <label className="label">Category Label</label>
                  <input className="input" value={selectedCategory.categoryLabel} onChange={(e) => updateCategory(selectedCategoryId, { categoryLabel: e.target.value })} />
                </div>
              </div>
              <div style={{ marginTop: "0.6rem" }}>
                <label className="label">Description</label>
                <input className="input" value={selectedCategory.description} onChange={(e) => updateCategory(selectedCategoryId, { description: e.target.value })} />
              </div>
              <div className="settings-chip-list" style={{ marginTop: "0.6rem", alignItems: "end" }}>
                <div style={{ width: "88px" }}>
                  <label className="label">Sort</label>
                  <input className="input" type="number" value={selectedCategory.sortOrder} onChange={(e) => updateCategory(selectedCategoryId, { sortOrder: Number.parseInt(e.target.value || "0", 10) || 0 })} />
                </div>
                <div style={{ width: "120px" }}>
                  <label className="label">Color</label>
                  <input className="input" type="color" value={selectedCategory.categoryColor || "#e5e7eb"} onChange={(e) => updateCategory(selectedCategoryId, { categoryColor: e.target.value })} />
                </div>
                <label className="label" style={{ marginBottom: 0, display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                  <input type="checkbox" checked={selectedCategory.isEnabled} onChange={(e) => updateCategory(selectedCategoryId, { isEnabled: e.target.checked })} />
                  Enabled
                </label>
                <button type="button" className="button secondary tap-button" onClick={() => deleteCategory(selectedCategoryId)} disabled={busy}>
                  Delete Category
                </button>
              </div>

              <div className="settings-chip-list" style={{ marginTop: "0.75rem", justifyContent: "space-between", alignItems: "center" }}>
                <label className="label" style={{ marginBottom: 0 }}>Types</label>
                <button type="button" className="button secondary tap-button" onClick={addType} disabled={busy || !selectedCategoryId}>
                  Add Type
                </button>
              </div>
              <div className="card" style={{ maxHeight: "220px", overflow: "auto", display: "grid", gap: "0.45rem" }}>
                {categoryTypes.map((row) => {
                  const rowId = typeIdFor(row);
                  const active = rowId === selectedTypeId;
                  return (
                    <button
                      key={rowId}
                      type="button"
                      className="button secondary tap-button"
                      onClick={() => setSelectedTypeId(rowId)}
                      style={{ textAlign: "left", borderColor: active ? "#1f2937" : undefined, background: active ? "#eef2ff" : undefined }}
                    >
                      {row.typeLabel || "Untitled Type"}
                    </button>
                  );
                })}
                {categoryTypes.length === 0 ? <p className="page-subtitle" style={{ margin: 0 }}>No types yet.</p> : null}
              </div>

              {selectedType ? (
                <div className="card" style={{ marginTop: "0.75rem" }}>
                  <h4 style={{ marginTop: 0, marginBottom: "0.6rem" }}>Edit Type</h4>
                  <div className="settings-chip-list">
                    <div style={{ flex: 1, minWidth: "180px" }}>
                      <label className="label">Type Label</label>
                      <input className="input" value={selectedType.typeLabel} onChange={(e) => updateType(selectedTypeId, { typeLabel: e.target.value })} />
                    </div>
                    <div style={{ flex: 1, minWidth: "180px" }}>
                      <label className="label">Type Key</label>
                      <input className="input" value={selectedType.typeKey} onChange={(e) => updateType(selectedTypeId, { typeKey: normalizeAttributeTypeKey(e.target.value) })} />
                    </div>
                    <div style={{ flex: 1, minWidth: "180px" }}>
                      <label className="label">Detail Label</label>
                      <input className="input" value={selectedType.detailLabel} onChange={(e) => updateType(selectedTypeId, { detailLabel: e.target.value })} />
                    </div>
                  </div>
                  <div className="settings-chip-list">
                    <div style={{ minWidth: "180px" }}>
                      <label className="label">Date Mode</label>
                      <select
                        className="input"
                        value={selectedType.dateMode}
                        onChange={(e) => {
                          const nextMode = e.target.value as "none" | "single" | "range";
                          updateType(selectedTypeId, {
                            dateMode: nextMode,
                            askEndDate: nextMode === "range",
                          });
                        }}
                      >
                        <option value="none">No Date</option>
                        <option value="single">Date</option>
                        <option value="range">Range</option>
                      </select>
                    </div>
                  </div>
                  <div className="settings-chip-list">
                    <div style={{ minWidth: "120px" }}>
                      <label className="label">Enabled</label>
                      <label className="label" style={{ marginBottom: 0 }}>
                        <input type="checkbox" checked={selectedType.isEnabled} onChange={(e) => updateType(selectedTypeId, { isEnabled: e.target.checked })} /> Yes
                      </label>
                    </div>
                    <div style={{ minWidth: "120px" }}>
                      <label className="label">Sort Order</label>
                      <input className="input" type="number" value={selectedType.sortOrder} onChange={(e) => updateType(selectedTypeId, { sortOrder: Number.parseInt(e.target.value || "0", 10) || 0 })} />
                    </div>
                  </div>
                  <div className="settings-chip-list" style={{ marginTop: "0.6rem" }}>
                    <button type="button" className="button secondary tap-button" onClick={() => deleteType(selectedTypeId)}>
                      Delete Type
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="page-subtitle" style={{ margin: 0 }}>Select a category on the left.</p>
          )}
        </div>
      </div>

      {status ? <p style={{ marginTop: "0.75rem" }}>{status}</p> : null}
      {hasValidationErrors ? <p className="page-subtitle" style={{ color: "#b91c1c", marginTop: "0.25rem" }}>Fix duplicate or empty keys/labels before save.</p> : null}
      {hasUnsavedChanges ? <p className="page-subtitle" style={{ marginTop: "0.25rem" }}>Unsaved changes</p> : null}
    </section>
  );
}
