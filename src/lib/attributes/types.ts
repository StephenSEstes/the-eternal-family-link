export type AttributeEntityType = "person" | "household";
export type AttributeCategory = "descriptor" | "event";

export type AttributeDraftPrefill = {
  attributeKind: AttributeCategory;
  attributeType: string;
  attributeTypeCategory?: string;
  attributeDate?: string;
  endDate?: string;
  dateIsEstimated?: boolean;
  estimatedTo?: "month" | "year" | "";
  label?: string;
  attributeDetail?: string;
  attributeNotes?: string;
};

export type AttributeRecord = {
  attributeId: string;
  entityType: AttributeEntityType;
  entityId: string;
  category: AttributeCategory;
  attributeKind: AttributeCategory;
  attributeType: string;
  attributeTypeCategory: string;
  attributeDate: string;
  dateIsEstimated: boolean;
  estimatedTo: "month" | "year" | "";
  attributeDetail: string;
  attributeNotes: string;
  endDate: string;
  typeKey: string;
  label: string;
  valueText: string;
  dateStart: string;
  dateEnd: string;
  location: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type AttributeMediaLink = {
  linkId: string;
  fileId: string;
  label: string;
  description: string;
  photoDate: string;
  isPrimary: boolean;
  sortOrder: number;
  mediaMetadata: string;
  createdAt: string;
  sourceProvider: string;
  originalObjectKey: string;
  thumbnailObjectKey: string;
  previewUrl?: string;
  originalUrl?: string;
};
