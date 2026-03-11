import type { AttributeCategory } from "@/lib/attributes/types";

export type EventTypeDateMode = "single" | "range";

export type AttributeEventCategoryDefinition = {
  categoryKey: string;
  categoryLabel: string;
  categoryColor: string;
  description: string;
  sortOrder: number;
  isEnabled: boolean;
  kind: AttributeCategory;
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
  kind: AttributeCategory;
};

export type AttributeEventDefinitions = {
  version: number;
  categories: AttributeEventCategoryDefinition[];
  types: AttributeEventTypeDefinition[];
};
