"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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

  const handleSwitch = () => {
    if (selected === activeTenantKey) {
      return;
    }

    startTransition(async () => {
      setError(null);
      const response = await fetch("/api/tenants/active", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tenantKey: selected }),
      });

      if (!response.ok) {
        setError("Could not switch tenant.");
        return;
      }

      router.refresh();
    });
  };

  return (
    <div className="tenant-switcher">
      <select
        className="tenant-select"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
        aria-label="Active tenant"
      >
        {tenants.map((tenant) => (
          <option key={tenant.tenantKey} value={tenant.tenantKey}>
            {tenant.tenantName} ({tenant.role})
          </option>
        ))}
      </select>
      <button type="button" className="tenant-switch-button" onClick={handleSwitch} disabled={isPending}>
        {isPending ? "Switching..." : "Switch"}
      </button>
      {error ? <span className="status-warn">{error}</span> : null}
    </div>
  );
}
