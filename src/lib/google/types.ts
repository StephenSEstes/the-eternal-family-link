export type AppRole = "ADMIN" | "USER";

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
  phones: string;
  address: string;
  hobbies: string;
  notes: string;
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

export type RelationshipRecord = {
  id: string;
  tenantKey: string;
  fromPersonId: string;
  toPersonId: string;
  relationshipType: string;
};

export type FamilyUnitRecord = {
  id: string;
  tenantKey: string;
  partner1PersonId: string;
  partner2PersonId: string;
};
