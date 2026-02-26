"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
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

  const buildSwitchPath = (currentPath: string, nextTenantKey: string) => {
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

      const nextPath = buildSwitchPath(pathname || "/", nextKey);
      const query = searchParams?.toString() ?? "";
      router.push(query ? `${nextPath}?${query}` : nextPath);
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
