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

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.categoryLabel.localeCompare(b.categoryLabel)),
    [categories],
  );

  const load = useCallback(async () => {
    setBusy(true);
    const res = await fetch(`/api/t/${encodeURIComponent(selectedTenantKey)}/attribute-definitions`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setBusy(false);
      setStatus(`Load failed: ${res.status}`);
      return;
    }
    const defs = body?.definitions as DefinitionsPayload | undefined;
    setCategories(Array.isArray(defs?.categories) ? defs.categories : []);
    setTypes(Array.isArray(defs?.types) ? defs.types : []);
    setStatus("");
    setBusy(false);
  }, [selectedTenantKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setStatus("Saving...");
    const payload: DefinitionsPayload = {
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
    };
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
    setStatus("Saved.");
    setBusy(false);
    void load();
  };

  const addCategory = () => {
    const index = categories.length + 1;
    setCategories((prev) => [
      ...prev,
      {
        categoryKey: `category_${index}`,
        categoryLabel: `Category ${index}`,
        description: "",
        sortOrder: index * 10,
        isEnabled: true,
      },
    ]);
  };

  const updateCategory = (categoryKey: string, patch: Partial<CategoryRow>) => {
    setCategories((prev) => prev.map((row) => (row.categoryKey === categoryKey ? { ...row, ...patch } : row)));
  };

  const deleteCategory = (categoryKey: string) => {
    setCategories((prev) => prev.filter((row) => row.categoryKey !== categoryKey));
    setTypes((prev) => prev.filter((row) => row.categoryKey !== categoryKey));
  };

  const addType = (categoryKey: string) => {
    const next = types.filter((row) => row.categoryKey === categoryKey).length + 1;
    setTypes((prev) => [
      ...prev,
      {
        typeKey: `${categoryKey}_type_${next}`,
        categoryKey,
        typeLabel: `Type ${next}`,
        detailLabel: "Attribute Detail",
        dateMode: "single",
        askEndDate: false,
        sortOrder: next * 10,
        isEnabled: true,
      },
    ]);
  };

  const updateType = (typeKey: string, categoryKey: string, patch: Partial<TypeRow>) => {
    setTypes((prev) =>
      prev.map((row) => (row.typeKey === typeKey && row.categoryKey === categoryKey ? { ...row, ...patch } : row)),
    );
  };

  const deleteType = (typeKey: string, categoryKey: string) => {
    setTypes((prev) => prev.filter((row) => !(row.typeKey === typeKey && row.categoryKey === categoryKey)));
  };

  return (
    <section className="card settings-panel">
      <h2 style={{ marginTop: 0, marginBottom: "0.35rem" }}>Attribute Event Definitions</h2>
      <p className="page-subtitle" style={{ marginTop: 0 }}>
        Manage Event Category, Type options, detail label, and date behavior for Add Attribute.
      </p>

      <label className="label">Family Group</label>
      <select className="input" value={selectedTenantKey} onChange={(e) => onTenantChange(e.target.value)}>
        {tenantOptions.map((option) => (
          <option key={option.tenantKey} value={option.tenantKey}>
            {option.tenantName} ({option.role})
          </option>
        ))}
      </select>

      <div className="settings-chip-list" style={{ marginTop: "0.75rem" }}>
        <button type="button" className="button secondary tap-button" onClick={addCategory} disabled={busy}>
          Add Category
        </button>
        <button type="button" className="button tap-button" onClick={save} disabled={busy}>
          {busy ? "Saving..." : "Save Definitions"}
        </button>
      </div>

      {sortedCategories.map((category) => {
        const categoryTypes = types
          .filter((row) => row.categoryKey === category.categoryKey)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.typeLabel.localeCompare(b.typeLabel));
        return (
          <div key={category.categoryKey} className="card" style={{ marginTop: "0.75rem" }}>
            <div className="settings-chip-list">
              <div style={{ flex: 1, minWidth: "160px" }}>
                <label className="label">Category Label</label>
                <input
                  className="input"
                  value={category.categoryLabel}
                  onChange={(e) => updateCategory(category.categoryKey, { categoryLabel: e.target.value })}
                />
              </div>
              <div style={{ flex: 1, minWidth: "160px" }}>
                <label className="label">Category Key</label>
                <input
                  className="input"
                  value={category.categoryKey}
                  onChange={(e) => {
                    const nextKey = normalizeKey(e.target.value);
                    if (!nextKey) return;
                    setCategories((prev) =>
                      prev.map((row) => (row.categoryKey === category.categoryKey ? { ...row, categoryKey: nextKey } : row)),
                    );
                    setTypes((prev) =>
                      prev.map((row) => (row.categoryKey === category.categoryKey ? { ...row, categoryKey: nextKey } : row)),
                    );
                  }}
                />
              </div>
              <div style={{ width: "120px" }}>
                <label className="label">Enabled</label>
                <label className="label" style={{ marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    checked={category.isEnabled}
                    onChange={(e) => updateCategory(category.categoryKey, { isEnabled: e.target.checked })}
                  />{" "}
                  Yes
                </label>
              </div>
              <div style={{ width: "120px" }}>
                <label className="label">Sort</label>
                <input
                  className="input"
                  type="number"
                  value={category.sortOrder}
                  onChange={(e) => updateCategory(category.categoryKey, { sortOrder: Number.parseInt(e.target.value || "0", 10) || 0 })}
                />
              </div>
            </div>
            <label className="label">Description</label>
            <input
              className="input"
              value={category.description}
              onChange={(e) => updateCategory(category.categoryKey, { description: e.target.value })}
            />
            <div className="settings-chip-list" style={{ marginTop: "0.6rem" }}>
              <button type="button" className="button secondary tap-button" onClick={() => addType(category.categoryKey)} disabled={busy}>
                Add Type
              </button>
              <button type="button" className="button secondary tap-button" onClick={() => deleteCategory(category.categoryKey)} disabled={busy}>
                Delete Category
              </button>
            </div>

            {categoryTypes.length > 0 ? (
              <div className="settings-table-wrap" style={{ marginTop: "0.6rem" }}>
                <table className="settings-table settings-table-compact">
                  <thead>
                    <tr>
                      <th>Type Label</th>
                      <th>Type Key</th>
                      <th>Detail Label</th>
                      <th>Date Mode</th>
                      <th>Ask End Date</th>
                      <th>Enabled</th>
                      <th>Sort</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryTypes.map((type) => (
                      <tr key={`${type.categoryKey}-${type.typeKey}`}>
                        <td>
                          <input className="input" value={type.typeLabel} onChange={(e) => updateType(type.typeKey, type.categoryKey, { typeLabel: e.target.value })} />
                        </td>
                        <td>
                          <input className="input" value={type.typeKey} onChange={(e) => updateType(type.typeKey, type.categoryKey, { typeKey: normalizeKey(e.target.value) })} />
                        </td>
                        <td>
                          <input className="input" value={type.detailLabel} onChange={(e) => updateType(type.typeKey, type.categoryKey, { detailLabel: e.target.value })} />
                        </td>
                        <td>
                          <select className="input" value={type.dateMode} onChange={(e) => updateType(type.typeKey, type.categoryKey, { dateMode: e.target.value as "single" | "range" })}>
                            <option value="single">Single</option>
                            <option value="range">Range</option>
                          </select>
                        </td>
                        <td>
                          <input type="checkbox" checked={type.askEndDate} onChange={(e) => updateType(type.typeKey, type.categoryKey, { askEndDate: e.target.checked })} />
                        </td>
                        <td>
                          <input type="checkbox" checked={type.isEnabled} onChange={(e) => updateType(type.typeKey, type.categoryKey, { isEnabled: e.target.checked })} />
                        </td>
                        <td>
                          <input className="input" type="number" value={type.sortOrder} onChange={(e) => updateType(type.typeKey, type.categoryKey, { sortOrder: Number.parseInt(e.target.value || "0", 10) || 0 })} />
                        </td>
                        <td>
                          <button type="button" className="button secondary tap-button" onClick={() => deleteType(type.typeKey, type.categoryKey)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="page-subtitle" style={{ marginTop: "0.6rem" }}>
                No types yet. Add at least one type for this category.
              </p>
            )}
          </div>
        );
      })}
      {status ? <p style={{ marginTop: "0.75rem" }}>{status}</p> : null}
    </section>
  );
}
