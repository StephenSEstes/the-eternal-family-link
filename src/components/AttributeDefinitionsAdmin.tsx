"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type TenantOption = {
  tenantKey: string;
  tenantName: string;
  role: "ADMIN" | "USER";
};

type CategoryRow = {
  categoryKey: string;
  categoryLabel: string;
  description: string;
  sortOrder: number;
  isEnabled: boolean;
};

type TypeRow = {
  typeKey: string;
  categoryKey: string;
  typeLabel: string;
  detailLabel: string;
  dateMode: "single" | "range";
  askEndDate: boolean;
  sortOrder: number;
  isEnabled: boolean;
};

type DefinitionsPayload = {
  version: number;
  categories: CategoryRow[];
  types: TypeRow[];
};

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_ -]/g, "").replace(/\s+/g, "_").replace(/-+/g, "_");
}

function stableStringify(payload: DefinitionsPayload) {
  const sortedCategories = [...payload.categories].sort((a, b) => a.sortOrder - b.sortOrder || a.categoryKey.localeCompare(b.categoryKey));
  const sortedTypes = [...payload.types].sort((a, b) => a.sortOrder - b.sortOrder || `${a.categoryKey}:${a.typeKey}`.localeCompare(`${b.categoryKey}:${b.typeKey}`));
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
  const [selectedCategoryKey, setSelectedCategoryKey] = useState("");
  const [selectedTypeKey, setSelectedTypeKey] = useState("");
  const [search, setSearch] = useState("");
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
    const nextCategories = Array.isArray(defs?.categories) ? defs.categories : [];
    const nextTypes = Array.isArray(defs?.types) ? defs.types : [];
    setCategories(nextCategories);
    setTypes(nextTypes);
    const firstCategory = [...nextCategories]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.categoryLabel.localeCompare(b.categoryLabel))[0]
      ?.categoryKey ?? "";
    setSelectedCategoryKey(firstCategory);
    const firstType = [...nextTypes]
      .filter((row) => row.categoryKey === firstCategory)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.typeLabel.localeCompare(b.typeLabel))[0]
      ?.typeKey ?? "";
    setSelectedTypeKey(firstType);
    const snapshot = stableStringify({ version: 1, categories: nextCategories, types: nextTypes });
    setBaseline(snapshot);
    setStatus("");
    setBusy(false);
  }, [selectedTenantKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.categoryLabel.localeCompare(b.categoryLabel)),
    [categories],
  );

  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedCategories;
    return sortedCategories.filter((row) => {
      const haystack = `${row.categoryLabel} ${row.categoryKey} ${row.description}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [search, sortedCategories]);

  const selectedCategory = useMemo(
    () => sortedCategories.find((row) => row.categoryKey === selectedCategoryKey) ?? null,
    [sortedCategories, selectedCategoryKey],
  );

  const categoryTypes = useMemo(
    () =>
      types
        .filter((row) => row.categoryKey === selectedCategoryKey)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.typeLabel.localeCompare(b.typeLabel)),
    [types, selectedCategoryKey],
  );

  const selectedType = useMemo(
    () => categoryTypes.find((row) => row.typeKey === selectedTypeKey) ?? null,
    [categoryTypes, selectedTypeKey],
  );

  useEffect(() => {
    if (categoryTypes.length === 0) {
      setSelectedTypeKey("");
      return;
    }
    if (!categoryTypes.some((row) => row.typeKey === selectedTypeKey)) {
      setSelectedTypeKey(categoryTypes[0]?.typeKey ?? "");
    }
  }, [categoryTypes, selectedTypeKey]);

  const duplicateCategoryKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of categories) counts.set(normalizeKey(row.categoryKey), (counts.get(normalizeKey(row.categoryKey)) ?? 0) + 1);
    return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([key]) => key));
  }, [categories]);

  const duplicateTypeKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of types) {
      const key = `${normalizeKey(row.categoryKey)}:${normalizeKey(row.typeKey)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([key]) => key));
  }, [types]);

  const hasValidationErrors = useMemo(() => {
    if (duplicateCategoryKeys.size > 0 || duplicateTypeKeys.size > 0) return true;
    if (categories.some((row) => !row.categoryLabel.trim() || !normalizeKey(row.categoryKey))) return true;
    if (types.some((row) => !row.typeLabel.trim() || !normalizeKey(row.typeKey) || !normalizeKey(row.categoryKey))) return true;
    return false;
  }, [categories, duplicateCategoryKeys, duplicateTypeKeys, types]);

  const payloadSnapshot = useMemo(
    () =>
      stableStringify({
        version: 1,
        categories: categories.map((row, index) => ({
          ...row,
          categoryKey: normalizeKey(row.categoryKey),
          categoryLabel: row.categoryLabel.trim(),
          description: row.description.trim(),
          sortOrder: Number.isFinite(row.sortOrder) ? row.sortOrder : (index + 1) * 10,
        })),
        types: types.map((row, index) => ({
          ...row,
          typeKey: normalizeKey(row.typeKey),
          categoryKey: normalizeKey(row.categoryKey),
          typeLabel: row.typeLabel.trim(),
          detailLabel: row.detailLabel.trim(),
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
    const next: CategoryRow = {
      categoryKey: `category_${index}`,
      categoryLabel: `Category ${index}`,
      description: "",
      sortOrder: index * 10,
      isEnabled: true,
    };
    setCategories((prev) => [...prev, next]);
    setSelectedCategoryKey(next.categoryKey);
    setSelectedTypeKey("");
  };

  const updateCategory = (categoryKey: string, patch: Partial<CategoryRow>) => {
    setCategories((prev) => prev.map((row) => (row.categoryKey === categoryKey ? { ...row, ...patch } : row)));
  };

  const deleteCategory = (categoryKey: string) => {
    setCategories((prev) => prev.filter((row) => row.categoryKey !== categoryKey));
    setTypes((prev) => prev.filter((row) => row.categoryKey !== categoryKey));
    if (selectedCategoryKey === categoryKey) {
      const fallback = sortedCategories.find((row) => row.categoryKey !== categoryKey)?.categoryKey ?? "";
      setSelectedCategoryKey(fallback);
      const fallbackType = types
        .filter((row) => row.categoryKey === fallback)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.typeLabel.localeCompare(b.typeLabel))[0]
        ?.typeKey ?? "";
      setSelectedTypeKey(fallbackType);
    }
  };

  const addType = () => {
    if (!selectedCategoryKey) return;
    const next = types.filter((row) => row.categoryKey === selectedCategoryKey).length + 1;
    setTypes((prev) => [
      ...prev,
      {
        typeKey: `${selectedCategoryKey}_type_${next}`,
        categoryKey: selectedCategoryKey,
        typeLabel: `Type ${next}`,
        detailLabel: "Attribute Detail",
        dateMode: "single",
        askEndDate: false,
        sortOrder: next * 10,
        isEnabled: true,
      },
    ]);
    setSelectedTypeKey(`${selectedCategoryKey}_type_${next}`);
  };

  const updateType = (typeKey: string, categoryKey: string, patch: Partial<TypeRow>) => {
    setTypes((prev) =>
      prev.map((row) => (row.typeKey === typeKey && row.categoryKey === categoryKey ? { ...row, ...patch } : row)),
    );
  };

  const deleteType = (typeKey: string, categoryKey: string) => {
    setTypes((prev) => prev.filter((row) => !(row.typeKey === typeKey && row.categoryKey === categoryKey)));
    if (selectedTypeKey === typeKey) {
      const fallback = categoryTypes.find((row) => row.typeKey !== typeKey)?.typeKey ?? "";
      setSelectedTypeKey(fallback);
    }
  };

  return (
    <section className="card settings-panel">
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "end", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ marginTop: 0, marginBottom: "0.35rem" }}>Attribute Event Definitions</h2>
          <p className="page-subtitle" style={{ marginTop: 0 }}>
            Configure event categories and category types used by Add Attribute.
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
          <label className="label">Search Categories</label>
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search label or key" />
          <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.45rem", maxHeight: "55vh", overflow: "auto" }}>
            {filteredCategories.map((row) => {
              const active = row.categoryKey === selectedCategoryKey;
              return (
                <button
                  key={row.categoryKey}
                  type="button"
                  className="button secondary tap-button"
                  onClick={() => {
                    setSelectedCategoryKey(row.categoryKey);
                    const firstType = types
                      .filter((item) => item.categoryKey === row.categoryKey)
                      .sort((a, b) => a.sortOrder - b.sortOrder || a.typeLabel.localeCompare(b.typeLabel))[0]
                      ?.typeKey ?? "";
                    setSelectedTypeKey(firstType);
                  }}
                  style={{ textAlign: "left", borderColor: active ? "#1f2937" : undefined, background: active ? "#eef2ff" : undefined }}
                >
                  <div style={{ fontWeight: 700 }}>{row.categoryLabel || row.categoryKey}</div>
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
                style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) 96px minmax(220px, 1.2fr)", gap: "0.6rem", alignItems: "end" }}
              >
                <div style={{ minWidth: 0 }}>
                  <label className="label">Category Label</label>
                  <input className="input" value={selectedCategory.categoryLabel} onChange={(e) => updateCategory(selectedCategory.categoryKey, { categoryLabel: e.target.value })} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <label className="label">Sort</label>
                  <input className="input" type="number" value={selectedCategory.sortOrder} onChange={(e) => updateCategory(selectedCategory.categoryKey, { sortOrder: Number.parseInt(e.target.value || "0", 10) || 0 })} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <label className="label">Description</label>
                  <input className="input" value={selectedCategory.description} onChange={(e) => updateCategory(selectedCategory.categoryKey, { description: e.target.value })} />
                </div>
              </div>
              <div className="settings-chip-list" style={{ marginTop: "0.6rem" }}>
                <button type="button" className="button secondary tap-button" onClick={() => deleteCategory(selectedCategory.categoryKey)} disabled={busy}>
                  Delete Category
                </button>
                <label className="label" style={{ marginBottom: 0, display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                  <input type="checkbox" checked={selectedCategory.isEnabled} onChange={(e) => updateCategory(selectedCategory.categoryKey, { isEnabled: e.target.checked })} />
                  Enabled
                </label>
              </div>

              <label className="label" style={{ marginTop: "0.75rem" }}>Type Categories</label>
              <div className="card" style={{ maxHeight: "220px", overflow: "auto", display: "grid", gap: "0.45rem" }}>
                {categoryTypes.map((row) => {
                  const active = row.typeKey === selectedTypeKey;
                  return (
                    <button
                      key={`${row.categoryKey}:${row.typeKey}`}
                      type="button"
                      className="button secondary tap-button"
                      onClick={() => setSelectedTypeKey(row.typeKey)}
                      style={{ textAlign: "left", borderColor: active ? "#1f2937" : undefined, background: active ? "#eef2ff" : undefined }}
                    >
                      {row.typeLabel || "Untitled Type"}
                    </button>
                  );
                })}
                {categoryTypes.length === 0 ? <p className="page-subtitle" style={{ margin: 0 }}>No types yet. Click Add Type.</p> : null}
              </div>

              {selectedType ? (
                <div className="card" style={{ marginTop: "0.75rem" }}>
                  <h4 style={{ marginTop: 0, marginBottom: "0.6rem" }}>Edit Type Category</h4>
                  <div className="settings-chip-list">
                    <div style={{ flex: 1, minWidth: "180px" }}>
                      <label className="label">Type Category</label>
                      <input className="input" value={selectedType.typeLabel} onChange={(e) => updateType(selectedType.typeKey, selectedType.categoryKey, { typeLabel: e.target.value })} />
                    </div>
                    <div style={{ flex: 1, minWidth: "180px" }}>
                      <label className="label">Detail Label</label>
                      <input className="input" value={selectedType.detailLabel} onChange={(e) => updateType(selectedType.typeKey, selectedType.categoryKey, { detailLabel: e.target.value })} />
                    </div>
                  </div>
                  <div className="settings-chip-list">
                    <div style={{ minWidth: "180px" }}>
                      <label className="label">Date Mode</label>
                      <select className="input" value={selectedType.dateMode} onChange={(e) => updateType(selectedType.typeKey, selectedType.categoryKey, { dateMode: e.target.value as "single" | "range" })}>
                        <option value="single">Single</option>
                        <option value="range">Range</option>
                      </select>
                    </div>
                    <div style={{ minWidth: "140px" }}>
                      <label className="label">Ask End Date</label>
                      <label className="label" style={{ marginBottom: 0 }}>
                        <input type="checkbox" checked={selectedType.askEndDate} onChange={(e) => updateType(selectedType.typeKey, selectedType.categoryKey, { askEndDate: e.target.checked })} /> Yes
                      </label>
                    </div>
                    <div style={{ minWidth: "120px" }}>
                      <label className="label">Enabled</label>
                      <label className="label" style={{ marginBottom: 0 }}>
                        <input type="checkbox" checked={selectedType.isEnabled} onChange={(e) => updateType(selectedType.typeKey, selectedType.categoryKey, { isEnabled: e.target.checked })} /> Yes
                      </label>
                    </div>
                    <div style={{ minWidth: "120px" }}>
                      <label className="label">Sort Order</label>
                      <input className="input" type="number" value={selectedType.sortOrder} onChange={(e) => updateType(selectedType.typeKey, selectedType.categoryKey, { sortOrder: Number.parseInt(e.target.value || "0", 10) || 0 })} />
                    </div>
                  </div>
                  <div className="settings-chip-list" style={{ marginTop: "0.6rem" }}>
                    <button type="button" className="button secondary tap-button" onClick={addType} disabled={busy || !selectedCategoryKey}>
                      Add Type
                    </button>
                    <button type="button" className="button secondary tap-button" onClick={() => deleteType(selectedType.typeKey, selectedType.categoryKey)}>
                      Delete Type Category
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
