import { NextResponse } from "next/server";
import { requireTenantAdmin } from "@/lib/family-group/guard";
import { getPeople, getTableRecords } from "@/lib/google/sheets";
import { classifyOperationalError } from "@/lib/diagnostics/route";

function readCell(row: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export async function GET(_: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  try {
    const { tenantKey } = await params;
    const resolved = await requireTenantAdmin(tenantKey);
    if ("error" in resolved) {
      return resolved.error;
    }

    const [people, householdRows] = await Promise.all([
      getPeople(resolved.tenant.tenantKey),
      getTableRecords("Households"),
    ]);
    const peopleById = new Map(people.map((person) => [person.personId, person.displayName]));
    const allowedPersonIds = new Set(people.map((person) => person.personId));
    const byHouseholdId = new Map<
      string,
      {
        householdId: string;
        label: string;
        husbandPersonId: string;
        wifePersonId: string;
        husbandName: string;
        wifeName: string;
      }
    >();
    for (const row of householdRows) {
      const householdId = readCell(row.data, "household_id", "id");
      if (!householdId) continue;
      const husbandPersonId = readCell(row.data, "husband_person_id");
      const wifePersonId = readCell(row.data, "wife_person_id");
      if (!husbandPersonId || !wifePersonId) continue;
      if (!allowedPersonIds.has(husbandPersonId) || !allowedPersonIds.has(wifePersonId)) continue;
      const incoming = {
        householdId,
        label: readCell(row.data, "label", "family_label", "family_name"),
        husbandPersonId,
        wifePersonId,
        husbandName: peopleById.get(husbandPersonId) || husbandPersonId,
        wifeName: peopleById.get(wifePersonId) || wifePersonId,
      };
      const existing = byHouseholdId.get(householdId);
      if (!existing) {
        byHouseholdId.set(householdId, incoming);
        continue;
      }
      byHouseholdId.set(householdId, {
        ...existing,
        label: existing.label || incoming.label,
      });
    }
    const households = Array.from(byHouseholdId.values()).sort((a, b) => a.householdId.localeCompare(b.householdId));

    return NextResponse.json({ tenantKey: resolved.tenant.tenantKey, households });
  } catch (error) {
    const classified = classifyOperationalError(error);
    const isQuota = classified.status === 429;
    return NextResponse.json(
      {
        error: isQuota ? "households_load_quota_exceeded" : "households_load_failed",
        message: classified.message,
        hint: isQuota ? "Close the workbook if open, wait 60-90 seconds, and retry." : undefined,
      },
      { status: isQuota ? 429 : 500 },
    );
  }
}
