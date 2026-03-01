import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantAdmin } from "@/lib/family-group/guard";
import { classifyOperationalError } from "@/lib/diagnostics/route";
import {
  appendAuditLog,
  ensureResolvedTabColumns,
  getPeople,
  getTableRecords,
  updateTableRecordById,
} from "@/lib/google/sheets";

type RouteProps = {
  params: Promise<{ tenantKey: string; householdId: string }>;
};

const patchSchema = z.object({
  label: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(4000).optional(),
  weddingPhotoFileId: z.string().trim().max(256).optional(),
});

function normalize(value: string | undefined) {
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

async function resolveHousehold(tenantKey: string, householdId: string, peopleById: Map<string, string>) {
  const rows = await getTableRecords("Households", tenantKey);
  const match = rows.find((row) => {
    const rowId = readCell(row.data, "household_id", "id");
    return rowId === householdId;
  });
  if (!match) {
    return null;
  }
  const husbandPersonId = readCell(match.data, "husband_person_id");
  const wifePersonId = readCell(match.data, "wife_person_id");

  return {
    row: match,
    dto: {
      householdId,
      husbandPersonId,
      wifePersonId,
      husbandName: peopleById.get(husbandPersonId) || husbandPersonId,
      wifeName: peopleById.get(wifePersonId) || wifePersonId,
      label: readCell(match.data, "label", "family_label", "family_name"),
      notes: readCell(match.data, "notes", "family_notes"),
      weddingPhotoFileId: readCell(match.data, "wedding_photo_file_id"),
    },
  };
}

export async function GET(_: Request, { params }: RouteProps) {
  try {
    const { tenantKey, householdId } = await params;
    const resolved = await requireTenantAdmin(tenantKey);
    if ("error" in resolved) {
      return resolved.error;
    }

    const people = await getPeople(resolved.tenant.tenantKey);
    const peopleById = new Map(people.map((person) => [person.personId, person.displayName]));
    const household = await resolveHousehold(resolved.tenant.tenantKey, householdId, peopleById);
    if (!household) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const relationships = await getTableRecords("Relationships");
    const parentLinks = relationships
      .map((row) => ({
        fromPersonId: String(row.data.from_person_id ?? "").trim(),
        toPersonId: String(row.data.to_person_id ?? "").trim(),
        relType: normalize(row.data.rel_type),
      }))
      .filter((row) => row.relType === "parent");
    const parentSet = new Set([household.dto.husbandPersonId, household.dto.wifePersonId]);
    const childIds = Array.from(
      new Set(
        parentLinks
          .filter((row) => parentSet.has(row.fromPersonId))
          .map((row) => row.toPersonId)
          .filter(Boolean),
      ),
    );
    const peopleByIdFull = new Map(people.map((person) => [person.personId, person]));
    const children = childIds.map((childId) => {
      const person = peopleByIdFull.get(childId);
      return {
        personId: childId,
        displayName: person?.displayName || childId,
        birthDate: person?.birthDate || "",
      };
    });

    return NextResponse.json({
      tenantKey: resolved.tenant.tenantKey,
      household: household.dto,
      children,
    });
  } catch (error) {
    const classified = classifyOperationalError(error);
    const isQuota = classified.status === 429;
    return NextResponse.json(
      {
        error: isQuota ? "household_load_quota_exceeded" : "household_load_failed",
        message: classified.message,
        hint: isQuota ? "Close the workbook if open, wait 60-90 seconds, and retry." : undefined,
      },
      { status: isQuota ? 429 : 500 },
    );
  }
}

export async function PATCH(request: Request, { params }: RouteProps) {
  try {
    const { tenantKey, householdId } = await params;
    const resolved = await requireTenantAdmin(tenantKey);
    if ("error" in resolved) {
      return resolved.error;
    }
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
    }

    await ensureResolvedTabColumns("Households", ["label", "notes", "wedding_photo_file_id"], resolved.tenant.tenantKey);
    const updated = await updateTableRecordById(
      "Households",
      householdId,
      {
        label: parsed.data.label ?? "",
        notes: parsed.data.notes ?? "",
        wedding_photo_file_id: parsed.data.weddingPhotoFileId ?? "",
      },
      "household_id",
      resolved.tenant.tenantKey,
    );
    if (!updated) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    await appendAuditLog({
      actorEmail: resolved.session.user?.email ?? "",
      actorPersonId: resolved.session.user?.person_id ?? "",
      action: "UPDATE",
      entityType: "HOUSEHOLD",
      entityId: householdId,
      familyGroupKey: resolved.tenant.tenantKey,
      status: "SUCCESS",
      details: "Updated household profile.",
    }).catch(() => undefined);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const classified = classifyOperationalError(error);
    const isQuota = classified.status === 429;
    return NextResponse.json(
      {
        error: isQuota ? "household_save_quota_exceeded" : "household_save_failed",
        message: classified.message,
        hint: isQuota ? "Close the workbook if open, wait 60-90 seconds, and retry." : undefined,
      },
      { status: isQuota ? 429 : 500 },
    );
  }
}
