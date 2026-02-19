export type AppRole = "ADMIN" | "USER";

export type UserAccessRecord = {
  userEmail: string;
  isEnabled: boolean;
  role: AppRole;
  personId: string;
  tenantKey: string;
  tenantName: string;
};

export type PersonRecord = {
  personId: string;
  displayName: string;
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
