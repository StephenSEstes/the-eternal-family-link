import { NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { getPeople, getPersonAttributes, getTableRecords } from "@/lib/google/sheets";

type SearchItem = {
  fileId: string;
  name: string;
  description: string;
  date: string;
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

export async function GET(request: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const query = q.toLowerCase();

  const [people, attributes, householdRows, householdPhotoRows] = await Promise.all([
    getPeople(resolved.tenant.tenantKey),
    getPersonAttributes(resolved.tenant.tenantKey),
    getTableRecords("Households", resolved.tenant.tenantKey).catch(() => []),
    getTableRecords("HouseholdPhotos", resolved.tenant.tenantKey).catch(() => []),
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
        people: [],
        households: [],
      });
    }
    return catalog.get(key)!;
  };

  for (const attr of attributes) {
    if (norm(attr.attributeType) !== "photo") continue;
    const fileId = attr.valueText.trim();
    if (!fileId) continue;
    const item = ensureItem(fileId);
    if (!item.name && attr.label.trim()) item.name = attr.label.trim();
    if (!item.description && attr.notes?.trim()) item.description = attr.notes.trim();
    if (!item.date && attr.startDate?.trim()) item.date = attr.startDate.trim();
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
    if (householdId && !item.households.some((household) => household.householdId === householdId)) {
      item.households.push({
        householdId,
        label: householdsById.get(householdId) || householdId,
      });
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
    .slice(0, 200);

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    query: q,
    count: matches.length,
    items: matches,
  });
}
