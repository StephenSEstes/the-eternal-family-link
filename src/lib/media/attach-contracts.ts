export type PersonUploadContractInput = {
  label: string;
  description: string;
  photoDate: string;
  attributeType: "photo" | "media";
  isHeadshot: boolean;
};

export type HouseholdUploadContractInput = {
  name: string;
  description: string;
  photoDate: string;
  isPrimary: boolean;
};

export type PersonAttributeLinkInput = {
  attributeType: "photo" | "media";
  valueText: string;
  valueJson: string;
  label: string;
  notes: string;
  startDate: string;
};

export type HouseholdLinkInput = {
  fileId: string;
  name: string;
  description: string;
  photoDate: string;
  mediaMetadata: string;
};

export function buildPersonUploadContractFields(input: PersonUploadContractInput) {
  return {
    label: input.label,
    description: input.description,
    photoDate: input.photoDate,
    isHeadshot: input.isHeadshot ? "true" : "false",
    attributeType: input.attributeType,
  } as const;
}

export function buildHouseholdUploadContractFields(input: HouseholdUploadContractInput) {
  return {
    name: input.name,
    description: input.description,
    photoDate: input.photoDate,
    isPrimary: input.isPrimary ? "true" : "false",
  } as const;
}

export function buildPersonAttributeLinkPayload(input: PersonAttributeLinkInput) {
  return {
    attributeType: input.attributeType,
    valueText: input.valueText,
    valueJson: input.valueJson,
    label: input.label,
    isPrimary: false,
    sortOrder: 0,
    startDate: input.startDate,
    endDate: "",
    visibility: "family",
    shareScope: "both_families",
    shareFamilyGroupKey: "",
    notes: input.notes,
  } as const;
}

export function buildHouseholdLinkPayload(input: HouseholdLinkInput) {
  return {
    fileId: input.fileId,
    name: input.name,
    description: input.description,
    photoDate: input.photoDate,
    mediaMetadata: input.mediaMetadata,
    isPrimary: false,
  } as const;
}
