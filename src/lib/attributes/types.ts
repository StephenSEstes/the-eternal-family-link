export type AttributeEntityType = "person" | "household";
export type AttributeCategory = "descriptor" | "event";

export type AttributeRecord = {
  attributeId: string;
  entityType: AttributeEntityType;
  entityId: string;
  category: AttributeCategory;
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
  mediaMetadata: string;
  createdAt: string;
};
