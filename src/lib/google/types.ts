export type AppRole = "ADMIN" | "USER";

export type FamilyGroupAccess = {
  familyGroupKey: string;
  familyGroupName: string;
  role: AppRole;
  personId: string;
};

export type UserAccessRecord = {
  userEmail: string;
  isEnabled: boolean;
  role: AppRole;
  personId: string;
  tenantKey: string;
  tenantName: string;
};

export type TenantAccess = {
  tenantKey: string;
  tenantName: string;
  role: AppRole;
  personId: string;
};
export type FamilyGroupConfig = {
  familyGroupKey: string;
  familyGroupName: string;
  viewerPinHash: string;
  photosFolderId: string;
};

export type FamilyGroupSecurityPolicy = {
  familyGroupKey: string;
  minLength: number;
  requireNumber: boolean;
  requireUppercase: boolean;
  requireLowercase: boolean;
  lockoutAttempts: number;
};

export type PersonRecord = {
  personId: string;
  displayName: string;
  birthDate: string;
  phones: string;
  address: string;
  hobbies: string;
  notes: string;
  photoFileId: string;
  isPinned: boolean;
  relationships: string[];
};

export type PersonUpdateInput = {
  display_name: string;
  birth_date: string;
  phones: string;
  address: string;
  hobbies: string;
  notes: string;
};

export type PersonAttributeRecord = {
  attributeId: string;
  tenantKey: string;
  personId: string;
  attributeType: string;
  valueText: string;
  valueJson: string;
  label: string;
  isPrimary: boolean;
  sortOrder: number;
  startDate: string;
  endDate: string;
  visibility: string;
  notes: string;
  shareScope: "both_families" | "one_family";
  shareFamilyGroupKey: string;
};

export type ImportantDateRecord = {
  id: string;
  title: string;
  date: string;
  description: string;
  personId: string;
};

export type TenantConfig = {
  tenantKey: string;
  tenantName: string;
  viewerPinHash: string;
  photosFolderId: string;
};

export type TenantSecurityPolicy = {
  tenantKey: string;
  minLength: number;
  requireNumber: boolean;
  requireUppercase: boolean;
  requireLowercase: boolean;
  lockoutAttempts: number;
};
export type TenantAccessLegacy = TenantAccess;
export type TenantConfigLegacy = TenantConfig;
export type TenantSecurityPolicyLegacy = TenantSecurityPolicy;

export type LocalUserRecord = {
  tenantKey: string;
  username: string;
  passwordHash: string;
  role: AppRole;
  personId: string;
  isEnabled: boolean;
  failedAttempts: number;
  lockedUntil: string;
  mustChangePassword: boolean;
};

export type RelationshipRecord = {
  id: string;
  tenantKey: string;
  fromPersonId: string;
  toPersonId: string;
  relationshipType: string;
};

export type HouseholdRecord = {
  id: string;
  tenantKey: string;
  partner1PersonId: string;
  partner2PersonId: string;
  label?: string;
  notes?: string;
};
