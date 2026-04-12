import type { EffectType, LineageSide, RelationshipCategory } from "@/lib/model/relationships";
import { EFFECT_TYPES, LINEAGE_SIDES, RELATIONSHIP_CATEGORIES } from "@/lib/model/relationships";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown) {
  return String(value ?? "").trim();
}

function parseBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function parseNullableBoolean(value: unknown) {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === "null") return null;
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function isRelationshipCategory(value: string): value is RelationshipCategory {
  return (RELATIONSHIP_CATEGORIES as readonly string[]).includes(value);
}

function isLineageSide(value: string): value is LineageSide {
  return (LINEAGE_SIDES as readonly string[]).includes(value);
}

function isEffectType(value: string): value is EffectType {
  return (EFFECT_TYPES as readonly string[]).includes(value);
}

export function parseSubscriptionDefaultRows(payload: unknown) {
  if (!Array.isArray(payload)) {
    throw new Error("payload_must_be_array");
  }

  return payload.map((row) => {
    if (!isRecord(row)) {
      throw new Error("each_row_must_be_object");
    }

    const relationshipCategory = normalizeString(row.relationshipCategory);
    const lineageSide = normalizeString(row.lineageSide);
    if (!isRelationshipCategory(relationshipCategory)) {
      throw new Error(`invalid_relationship_category:${relationshipCategory}`);
    }
    if (!isLineageSide(lineageSide)) {
      throw new Error(`invalid_lineage_side:${lineageSide}`);
    }

    return {
      relationshipCategory,
      lineageSide,
      isSubscribed: parseBoolean(row.isSubscribed),
      isActive: parseBoolean(row.isActive, true),
    };
  });
}

export function parseSubscriptionPersonExceptionRows(payload: unknown) {
  if (!Array.isArray(payload)) {
    throw new Error("payload_must_be_array");
  }

  return payload.map((row) => {
    if (!isRecord(row)) {
      throw new Error("each_row_must_be_object");
    }

    const targetPersonId = normalizeString(row.targetPersonId);
    const effect = normalizeString(row.effect);
    if (!targetPersonId) {
      throw new Error("target_person_id_required");
    }
    if (!isEffectType(effect)) {
      throw new Error(`invalid_effect:${effect}`);
    }

    return {
      targetPersonId,
      effect,
    };
  });
}

export function parseShareDefaultRows(payload: unknown) {
  if (!Array.isArray(payload)) {
    throw new Error("payload_must_be_array");
  }

  return payload.map((row) => {
    if (!isRecord(row)) {
      throw new Error("each_row_must_be_object");
    }

    const relationshipCategory = normalizeString(row.relationshipCategory);
    const lineageSide = normalizeString(row.lineageSide);
    if (!isRelationshipCategory(relationshipCategory)) {
      throw new Error(`invalid_relationship_category:${relationshipCategory}`);
    }
    if (!isLineageSide(lineageSide)) {
      throw new Error(`invalid_lineage_side:${lineageSide}`);
    }

    return {
      relationshipCategory,
      lineageSide,
      shareVitals: parseBoolean(row.shareVitals),
      shareStories: parseBoolean(row.shareStories),
      shareMedia: parseBoolean(row.shareMedia),
      shareConversations: parseBoolean(row.shareConversations),
      isActive: parseBoolean(row.isActive, true),
    };
  });
}

export function parseSharePersonExceptionRows(payload: unknown) {
  if (!Array.isArray(payload)) {
    throw new Error("payload_must_be_array");
  }

  return payload.map((row) => {
    if (!isRecord(row)) {
      throw new Error("each_row_must_be_object");
    }

    const targetPersonId = normalizeString(row.targetPersonId);
    const effect = normalizeString(row.effect);
    if (!targetPersonId) {
      throw new Error("target_person_id_required");
    }
    if (!isEffectType(effect)) {
      throw new Error(`invalid_effect:${effect}`);
    }

    return {
      targetPersonId,
      effect,
      shareVitals: parseNullableBoolean(row.shareVitals),
      shareStories: parseNullableBoolean(row.shareStories),
      shareMedia: parseNullableBoolean(row.shareMedia),
      shareConversations: parseNullableBoolean(row.shareConversations),
    };
  });
}

export function parsePreviewTarget(payload: unknown) {
  if (!isRecord(payload)) {
    throw new Error("payload_must_be_object");
  }

  const targetPersonId = normalizeString(payload.targetPersonId);
  if (!targetPersonId) {
    throw new Error("target_person_id_required");
  }

  return { targetPersonId };
}
