import { NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { listFilesInFolder } from "@/lib/google/drive";
import { getPeople, getTenantConfig } from "@/lib/data/runtime";
import { resolvePersonDisplayName } from "@/lib/person/display-name";
import {
  getOciHouseholdsForTenant,
  getOciMediaLinksForTenant,
  getOciPersonMediaAttributeRowsForTenant,
} from "@/lib/oci/tables";

type SearchItem = {
  fileId: string;
  name: string;
  description: string;
  date: string;
  createdAt?: string;
  mediaMetadata?: string;
  mimeType?: string;
  fileSizeBytes?: string;
  checksumSha256?: string;
  mediaWidth?: number;
  mediaHeight?: number;
  mediaDurationSec?: number;
  people: Array<{ personId: string; displayName: string }>;
  households: Array<{ householdId: string; label: string }>;
};

function norm(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function readCell(row: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function parseSortableTimestamp(value: string | undefined) {
  const parsed = Date.parse(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

const MEDIA_SEARCH_CACHE_TTL_MS = 20_000;
const MEDIA_SEARCH_CACHE_MAX_KEYS = 200;
const mediaSearchCache = new Map<string, { expiresAt: number; payload: unknown }>();

function makeMediaSearchCacheKey(input: {
  tenantKey: string;
  query: string;
  limit: number;
  includeDrive: boolean;
}) {
  return [
    norm(input.tenantKey),
    input.query.trim().toLowerCase(),
    String(input.limit),
    input.includeDrive ? "1" : "0",
  ].join("|");
}

function readCachedMediaSearch(key: string) {
  const hit = mediaSearchCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    mediaSearchCache.delete(key);
    return null;
  }
  return hit.payload;
}

function writeCachedMediaSearch(key: string, payload: unknown) {
  const now = Date.now();
  mediaSearchCache.set(key, {
    payload,
    expiresAt: now + MEDIA_SEARCH_CACHE_TTL_MS,
  });
  if (mediaSearchCache.size <= MEDIA_SEARCH_CACHE_MAX_KEYS) return;
  for (const [entryKey, entry] of mediaSearchCache.entries()) {
    if (entry.expiresAt <= now) {
      mediaSearchCache.delete(entryKey);
    }
  }
  if (mediaSearchCache.size <= MEDIA_SEARCH_CACHE_MAX_KEYS) return;
  const overflow = mediaSearchCache.size - MEDIA_SEARCH_CACHE_MAX_KEYS;
  let removed = 0;
  for (const entryKey of mediaSearchCache.keys()) {
    mediaSearchCache.delete(entryKey);
    removed += 1;
    if (removed >= overflow) break;
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const query = q.toLowerCase();
  const rawLimit = Number(url.searchParams.get("limit") ?? "200");
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(5000, Math.trunc(rawLimit))) : 200;
  const includeDrive = ["1", "true", "yes"].includes(norm(url.searchParams.get("includeDrive") ?? ""));
  const bypassCache = ["1", "true", "yes"].includes(norm(url.searchParams.get("noCache") ?? ""));
  const cacheKey = makeMediaSearchCacheKey({
    tenantKey: resolved.tenant.tenantKey,
    query: q,
    limit,
    includeDrive,
  });
  if (!bypassCache) {
    const cached = readCachedMediaSearch(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }
  }

  const [people, personMediaAttributeRows, householdRows, mediaLinkRows] = await Promise.all([
    getPeople(resolved.tenant.tenantKey),
    getOciPersonMediaAttributeRowsForTenant(resolved.tenant.tenantKey).catch(() => []),
    getOciHouseholdsForTenant(resolved.tenant.tenantKey).catch(() => []),
    getOciMediaLinksForTenant(resolved.tenant.tenantKey).catch(() => []),
  ]);

  const peopleById = new Map(
    people
      .map((person) => [
        person.personId.trim(),
        resolvePersonDisplayName({
          personId: person.personId,
          displayName: person.displayName,
          firstName: person.firstName,
          middleName: person.middleName,
          lastName: person.lastName,
        }),
      ] as const)
      .filter(([personId]) => Boolean(personId)),
  );
  const householdsById = new Map(
    householdRows.map((row) => {
      const householdId = readCell(row.data, "household_id", "id");
      const label = readCell(row.data, "label", "family_label", "family_name");
      return [householdId, label || householdId] as const;
    }),
  );

  const catalog = new Map<string, SearchItem>();
  const ensureItem = (fileId: string) => {
    const key = fileId.trim();
    if (!catalog.has(key)) {
      catalog.set(key, {
        fileId: key,
        name: "",
        description: "",
        date: "",
        createdAt: "",
        mediaMetadata: "",
        mimeType: "",
        fileSizeBytes: "",
        checksumSha256: "",
        mediaWidth: 0,
        mediaHeight: 0,
        mediaDurationSec: 0,
        people: [],
        households: [],
      });
    }
    return catalog.get(key)!;
  };

  const personAttributeById = new Map(
    personMediaAttributeRows
      .map((row) => {
        const attributeId = row.attributeId.trim();
        const personId = row.entityId.trim();
        const entityType = norm(row.entityType);
        const attributeType = norm(row.attributeType);
        return [
          attributeId,
          {
            attributeId,
            personId: personId.trim(),
            entityType,
            attributeType,
            label: row.attributeTypeCategory.trim(),
            notes: row.attributeNotes.trim(),
            date: row.attributeDate.trim(),
            detail: row.attributeDetail.trim(),
          },
        ] as const;
      })
      .filter(
        ([attributeId, item]) =>
          Boolean(attributeId && item.personId && item.entityType === "person" && peopleById.has(item.personId.trim())),
      ),
  );
  for (const row of mediaLinkRows) {
    const entityType = norm(row.entityType);
    const entityId = row.entityId.trim();
    const fileId = row.fileId.trim();
    if (!fileId) continue;

    const item = ensureItem(fileId);
    if (!item.name) item.name = row.label.trim() || row.fileName.trim();
    if (!item.description) item.description = row.description.trim();
    if (!item.date) item.date = row.photoDate.trim();
    if (!item.createdAt) item.createdAt = row.createdAt.trim();
    if (!item.mediaMetadata) item.mediaMetadata = row.mediaMetadata.trim();
    if (!item.mimeType) item.mimeType = row.mimeType.trim();
    if (!item.fileSizeBytes) item.fileSizeBytes = row.fileSizeBytes.trim();
    if (!item.checksumSha256) item.checksumSha256 = row.checksumSha256.trim();
    if (!item.mediaWidth) item.mediaWidth = row.mediaWidth;
    if (!item.mediaHeight) item.mediaHeight = row.mediaHeight;
    if (!item.mediaDurationSec) item.mediaDurationSec = row.mediaDurationSec;

    if (entityType === "person") {
      if (!item.people.some((person) => person.personId === entityId)) {
        item.people.push({
          personId: entityId,
          displayName: peopleById.get(entityId) || entityId,
        });
      }
      continue;
    }

    if (entityType === "household") {
      if (!item.households.some((household) => household.householdId === entityId)) {
        item.households.push({
          householdId: entityId,
          label: householdsById.get(entityId) || entityId,
        });
      }
      continue;
    }

    if (entityType === "attribute") {
      const attr = personAttributeById.get(entityId);
      if (!attr) {
        continue;
      }
      if (!item.name && attr.label.trim()) item.name = attr.label.trim();
      if (!item.description && attr.notes.trim()) item.description = attr.notes.trim();
      if (!item.date && attr.date.trim()) item.date = attr.date.trim();
      if (!item.people.some((person) => person.personId === attr.personId)) {
        item.people.push({
          personId: attr.personId,
          displayName: peopleById.get(attr.personId) || attr.personId,
        });
      }
    }
  }

  // Keep direct profile pointers visible alongside normalized media links.
  for (const person of people) {
    const fileId = person.photoFileId.trim();
    if (!fileId) continue;
    const item = ensureItem(fileId);
    if (!item.name) item.name = "Headshot";
    if (!item.people.some((entry) => entry.personId === person.personId)) {
      item.people.push({
        personId: person.personId,
        displayName: peopleById.get(person.personId) || person.personId,
      });
    }
  }

  for (const attr of personAttributeById.values()) {
    const fileId = attr.detail.trim();
    if (!fileId) continue;
    const item = ensureItem(fileId);
    if (!item.name && attr.label.trim()) item.name = attr.label.trim();
    if (!item.description && attr.notes.trim()) item.description = attr.notes.trim();
    if (!item.date && attr.date.trim()) item.date = attr.date.trim();
    if (!item.people.some((person) => person.personId === attr.personId)) {
      item.people.push({
        personId: attr.personId,
        displayName: peopleById.get(attr.personId) || attr.personId,
      });
    }
  }

  if (includeDrive) {
    try {
      const tenantConfig = await getTenantConfig(resolved.tenant.tenantKey);
      const driveFiles = await listFilesInFolder(tenantConfig.photosFolderId, {
        nameContains: q,
        maxItems: limit,
      });
      for (const file of driveFiles) {
        if (norm(file.mimeType) === "application/vnd.google-apps.folder") continue;
        const item = ensureItem(file.fileId);
        if (!item.name) item.name = file.name;
        if (!item.date) item.date = file.createdTime.slice(0, 10) || file.modifiedTime.slice(0, 10);
        if (!item.createdAt) item.createdAt = file.createdTime || file.modifiedTime || "";
      }
    } catch {
      // Drive listing is best-effort so media search still returns table-linked results when Drive lookup fails.
    }
  }

  const matches = Array.from(catalog.values())
    .map((item) => ({
      ...item,
      people: item.people.sort((a, b) => a.displayName.localeCompare(b.displayName)),
      households: item.households.sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .filter((item) => {
      if (!query) return true;
      const haystack = [
        item.fileId,
        item.name,
        item.description,
        item.date,
        ...item.people.map((person) => person.displayName),
        ...item.households.map((household) => household.label),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => {
      if (!query) {
        const byCreatedAt = parseSortableTimestamp(b.createdAt) - parseSortableTimestamp(a.createdAt);
        if (byCreatedAt !== 0) return byCreatedAt;
      }
      return a.name.localeCompare(b.name) || a.fileId.localeCompare(b.fileId);
    })
    .slice(0, limit);

  const payload = {
    tenantKey: resolved.tenant.tenantKey,
    query: q,
    limit,
    count: matches.length,
    items: matches,
  };
  if (!bypassCache) {
    writeCachedMediaSearch(cacheKey, payload);
  }
  return NextResponse.json(payload);
}
