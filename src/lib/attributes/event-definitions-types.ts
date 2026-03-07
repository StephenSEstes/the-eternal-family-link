export type EventTypeDateMode = "single" | "range";

export type AttributeEventCategoryDefinition = {
  categoryKey: string;
  categoryLabel: string;
  categoryColor: string;
  description: string;
  sortOrder: number;
  isEnabled: boolean;
};

export type AttributeEventTypeDefinition = {
  typeKey: string;
  categoryKey: string;
  typeLabel: string;
  detailLabel: string;
  dateMode: EventTypeDateMode;
  askEndDate: boolean;
  sortOrder: number;
  isEnabled: boolean;
};

export type AttributeEventDefinitions = {
  version: number;
  categories: AttributeEventCategoryDefinition[];
  types: AttributeEventTypeDefinition[];
};
