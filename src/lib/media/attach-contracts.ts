export type PersonUploadContractInput = {
  label: string;
  description: string;
  photoDate: string;
  attributeType: "photo" | "video" | "audio" | "media";
  isHeadshot: boolean;
};

export type HouseholdUploadContractInput = {
  name: string;
  description: string;
  photoDate: string;
  isPrimary: boolean;
};

export type PersonAttributeLinkInput = {
  attributeType: "photo" | "video" | "audio" | "media";
  valueText: string;
  valueJson: string;
  label: string;
  notes: string;
  startDate: string;
  isPrimary?: boolean;
  shareScope?: "one_family" | "both_families";
  shareFamilyGroupKey?: string;
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
  const shareScope = input.shareScope === "one_family" ? "one_family" : "both_families";
  const shareFamilyGroupKey = shareScope === "one_family" ? (input.shareFamilyGroupKey ?? "").trim().toLowerCase() : "";
  return {
    attributeType: input.attributeType,
    valueText: input.valueText,
    valueJson: input.valueJson,
    label: input.label,
    isPrimary: Boolean(input.isPrimary),
    sortOrder: 0,
    startDate: input.startDate,
    endDate: "",
    visibility: "family",
    shareScope,
    shareFamilyGroupKey,
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
