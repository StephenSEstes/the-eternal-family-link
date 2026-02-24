"use client";

import { TenantSwitcher } from "@/components/TenantSwitcher";

type FamilyGroupOption = {
  familyGroupKey: string;
  familyGroupName: string;
  role: "ADMIN" | "USER";
};

type FamilyGroupSwitcherProps = {
  activeFamilyGroupKey: string;
  familyGroups: FamilyGroupOption[];
};

export function FamilyGroupSwitcher({ activeFamilyGroupKey, familyGroups }: FamilyGroupSwitcherProps) {
  return (
    <TenantSwitcher
      activeTenantKey={activeFamilyGroupKey}
      tenants={familyGroups.map((item) => ({
        tenantKey: item.familyGroupKey,
        tenantName: item.familyGroupName,
        role: item.role,
      }))}
    />
  );
}
