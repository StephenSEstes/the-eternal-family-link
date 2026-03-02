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
  showRole?: boolean;
};

export function FamilyGroupSwitcher({ activeFamilyGroupKey, familyGroups, showRole = true }: FamilyGroupSwitcherProps) {
  return (
    <TenantSwitcher
      activeTenantKey={activeFamilyGroupKey}
      showRole={showRole}
      tenants={familyGroups.map((item) => ({
        tenantKey: item.familyGroupKey,
        tenantName: item.familyGroupName,
        role: item.role,
      }))}
    />
  );
}
