import { NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { listFilesInFolder } from "@/lib/google/drive";
import { getPeople, getPersonAttributes, getTableRecords, getTenantConfig } from "@/lib/google/sheets";

type SearchItem = {
  fileId: string;
  name: string;
  description: string;
  date: string;
  mediaMetadata?: string;
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

function isOciDataSource() {
  return (process.env.EFL_DATA_SOURCE ?? "").trim().toLowerCase() === "oci";
}

const MEDIA_SEARCH_CACHE_TTL_MS = 20_000;
const MEDIA_SEARCH_CACHE_MAX_KEYS = 200;
const mediaSearchCache = new Map<string, { expiresAt: number; payload: unknown }>();

function makeMediaSearchCacheKey(input: {
  tenantKey: string;
  query: string;
  limit: number;
  includeDrive: boolean;
  oci: boolean;
}) {
  return [
    norm(input.tenantKey),
    input.query.trim().toLowerCase(),
    String(input.limit),
    input.includeDrive ? "1" : "0",
    input.oci ? "oci" : "sheets",
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
  const oci = isOciDataSource();
  const cacheKey = makeMediaSearchCacheKey({
    tenantKey: resolved.tenant.tenantKey,
    query: q,
    limit,
    includeDrive,
    oci,
  });
  if (!bypassCache) {
    const cached = readCachedMediaSearch(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }
  }

  const [people, attributes, householdRows, householdPhotoRows, mediaLinkRows, mediaAssetRows] = await Promise.all([
    getPeople(resolved.tenant.tenantKey),
    getPersonAttributes(resolved.tenant.tenantKey),
    getTableRecords("Households", resolved.tenant.tenantKey).catch(() => []),
    getTableRecords("HouseholdPhotos", resolved.tenant.tenantKey).catch(() => []),
    oci ? getTableRecords("MediaLinks", resolved.tenant.tenantKey).catch(() => []) : Promise.resolve([]),
    oci ? getTableRecords("MediaAssets", resolved.tenant.tenantKey).catch(() => []) : Promise.resolve([]),
  ]);

  const peopleById = new Map(people.map((person) => [person.personId, person.displayName]));
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
        mediaMetadata: "",
        people: [],
        households: [],
      });
    }
    return catalog.get(key)!;
  };

  if (oci) {
    const mediaById = new Map(
      mediaAssetRows.map((row) => [readCell(row.data, "media_id"), readCell(row.data, "file_id")] as const),
    );
    for (const row of mediaLinkRows) {
      const familyGroupKey = readCell(row.data, "family_group_key");
      if (norm(familyGroupKey) !== norm(resolved.tenant.tenantKey)) continue;
      const entityType = norm(readCell(row.data, "entity_type"));
      const entityId = readCell(row.data, "entity_id");
      const mediaId = readCell(row.data, "media_id");
      const fileId = mediaById.get(mediaId) || "";
      if (!fileId) continue;

      const item = ensureItem(fileId);
      if (!item.name) item.name = readCell(row.data, "label");
      if (!item.description) item.description = readCell(row.data, "description");
      if (!item.date) item.date = readCell(row.data, "photo_date");
      if (!item.mediaMetadata) item.mediaMetadata = readCell(row.data, "media_metadata");

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
        const attr = attributes.find((entry) => entry.attributeId === entityId);
        if (attr && !item.people.some((person) => person.personId === attr.personId)) {
          item.people.push({
            personId: attr.personId,
            displayName: peopleById.get(attr.personId) || attr.personId,
          });
        }
      }
    }
  }

  // Always merge legacy links so OCI mode includes pre-existing media not yet backfilled into media_links.
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

  for (const attr of attributes) {
    const type = norm(attr.attributeType);
    if (!["photo", "video", "audio", "media"].includes(type)) continue;
    const fileId = attr.valueText.trim();
    if (!fileId) continue;
    const item = ensureItem(fileId);
    if (!item.name && attr.label.trim()) item.name = attr.label.trim();
    if (!item.description && attr.notes?.trim()) item.description = attr.notes.trim();
    if (!item.date && attr.startDate?.trim()) item.date = attr.startDate.trim();
    if (!item.mediaMetadata && attr.valueJson?.trim()) item.mediaMetadata = attr.valueJson.trim();
    if (!item.people.some((person) => person.personId === attr.personId)) {
      item.people.push({
        personId: attr.personId,
        displayName: peopleById.get(attr.personId) || attr.personId,
      });
    }
  }

  for (const row of householdPhotoRows) {
    const fileId = readCell(row.data, "file_id");
    if (!fileId) continue;
    const item = ensureItem(fileId);
    const householdId = readCell(row.data, "household_id");
    if (!item.name) item.name = readCell(row.data, "name");
    if (!item.description) item.description = readCell(row.data, "description");
    if (!item.date) item.date = readCell(row.data, "photo_date");
    if (!item.mediaMetadata) item.mediaMetadata = readCell(row.data, "media_metadata");
    if (householdId && !item.households.some((household) => household.householdId === householdId)) {
      item.households.push({
        householdId,
        label: householdsById.get(householdId) || householdId,
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
    .sort((a, b) => a.name.localeCompare(b.name) || a.fileId.localeCompare(b.fileId))
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
