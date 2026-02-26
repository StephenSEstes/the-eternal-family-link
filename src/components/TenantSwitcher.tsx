"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DEFAULT_FAMILY_GROUP_KEY } from "@/lib/family-group/constants";

type TenantOption = {
  tenantKey: string;
  tenantName: string;
  role: "ADMIN" | "USER";
};

type TenantSwitcherProps = {
  activeTenantKey: string;
  tenants: TenantOption[];
};

export function TenantSwitcher({ activeTenantKey, tenants }: TenantSwitcherProps) {
  const router = useRouter();
  const [selected, setSelected] = useState(activeTenantKey);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (tenants.length <= 1) {
    return null;
  }

  const formatFamilyGroupName = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return value;
    if (trimmed.includes("-") || trimmed.includes(" ")) return trimmed;
    if (!/[a-z][A-Z]/.test(trimmed)) return trimmed;
    return trimmed.replace(/([a-z])([A-Z])/g, "$1-$2");
  };

  const handleSwitch = (nextKey: string) => {
    setSelected(nextKey);
    if (nextKey === activeTenantKey) {
      return;
    }

    startTransition(async () => {
      setError(null);
      const response = await fetch("/api/family-groups/active", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ familyGroupKey: nextKey }),
      });

      if (!response.ok) {
        setError("Could not switch family group.");
        return;
      }

      const normalized = nextKey.trim().toLowerCase();
      const nextPath =
        normalized === DEFAULT_FAMILY_GROUP_KEY ? "/" : `/t/${encodeURIComponent(normalized)}`;
      router.push(nextPath);
      router.refresh();
    });
  };

  return (
    <div className="tenant-switcher">
      <select
        className="tenant-select"
        value={selected}
        onChange={(event) => handleSwitch(event.target.value)}
        aria-label="Active family group"
        disabled={isPending}
      >
        {tenants.map((tenant) => (
          <option key={tenant.tenantKey} value={tenant.tenantKey}>
            {formatFamilyGroupName(tenant.tenantName)} ({tenant.role})
          </option>
        ))}
      </select>
      {error ? <span className="status-warn">{error}</span> : null}
    </div>
  );
}
