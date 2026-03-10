import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantAccess, requireTenantAdmin } from "@/lib/family-group/guard";
import { classifyOperationalError } from "@/lib/diagnostics/route";
import { deleteOciMediaLink, getOciMediaLinksForEntity } from "@/lib/oci/tables";
import { createAttribute, deleteAttribute, getAttributesForEntity, updateAttribute } from "@/lib/attributes/store";
import {
  appendAuditLog,
  deleteTableRows,
  getPeople,
  getTableRecords,
  updateTableRecordById,
} from "@/lib/data/runtime";

type RouteProps = {
  params: Promise<{ tenantKey: string; householdId: string }>;
};

type HouseholdPhotoLink = {
  photoId: string;
  fileId: string;
  name: string;
  description: string;
  photoDate: string;
  isPrimary: boolean;
  mediaMetadata: string;
};

type DeleteHouseholdPreview = {
  householdId: string;
  householdLabel: string;
  husbandPersonId: string;
  wifePersonId: string;
  counts: {
    householdRowsToDelete: number;
    spouseRelationshipRowsToDelete: number;
  };
};

const patchSchema = z.object({
  label: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(4000).optional(),
  weddingPhotoFileId: z.string().trim().max(256).optional(),
  marriedDate: z.string().trim().max(32).optional(),
  address: z.string().trim().max(400).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(80).optional(),
  zip: z.string().trim().max(40).optional(),
});

const MARRIAGE_SYNC_NOTE_PREFIX = "[system] household_marriage_sync:";

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
  void tenantKey;
  const rows = await getTableRecords("Households");
  const matches = rows.filter((row) => {
    const rowId = readCell(row.data, "household_id", "id");
    return rowId === householdId;
  });
  if (matches.length === 0) {
    return null;
  }
  const merged = matches.reduce<Record<string, string>>((acc, row) => {
    for (const [key, value] of Object.entries(row.data)) {
      if (!acc[key] && typeof value === "string" && value.trim()) {
        acc[key] = value;
      }
    }
    return acc;
  }, {});
  const husbandPersonId = readCell(merged, "husband_person_id");
  const wifePersonId = readCell(merged, "wife_person_id");

  return {
    row: matches[0],
    dto: {
      householdId,
      husbandPersonId,
      wifePersonId,
      husbandName: peopleById.get(husbandPersonId) || husbandPersonId,
      wifeName: peopleById.get(wifePersonId) || wifePersonId,
      label: readCell(merged, "label", "family_label", "family_name"),
      notes: readCell(merged, "notes", "family_notes"),
      weddingPhotoFileId: readCell(merged, "wedding_photo_file_id"),
      marriedDate: readCell(merged, "married_date", "wedding_date"),
      address: readCell(merged, "address", "household_address"),
      city: readCell(merged, "city", "household_city"),
      state: readCell(merged, "state", "household_state"),
      zip: readCell(merged, "zip", "postal_code", "household_zip"),
    },
  };
}

async function syncMarriageAttributeForPerson(input: {
  tenantKey: string;
  personId: string;
  spouseName: string;
  householdId: string;
  marriedDate: string;
}) {
  const personId = input.personId.trim();
  if (!personId) return;
  const marker = `${MARRIAGE_SYNC_NOTE_PREFIX}${input.householdId}`;
  const attributes = await getAttributesForEntity(input.tenantKey, "person", personId);
  const synced = attributes.filter(
    (item) =>
      item.attributeType === "family_relationship" &&
      item.attributeTypeCategory === "married" &&
      item.attributeNotes.includes(marker),
  );

  if (!input.marriedDate) {
    await Promise.all(synced.map((item) => deleteAttribute(input.tenantKey, item.attributeId)));
    return;
  }

  const detailText = input.spouseName.trim() || "Spouse";
  if (synced.length > 0) {
    const [first, ...duplicates] = synced;
    await updateAttribute(input.tenantKey, first.attributeId, {
      attributeType: "family_relationship",
      attributeTypeCategory: "married",
      attributeDate: input.marriedDate,
      endDate: "",
      attributeDetail: detailText,
      attributeNotes: marker,
      dateIsEstimated: false,
      estimatedTo: "",
    });
    if (duplicates.length > 0) {
      await Promise.all(duplicates.map((item) => deleteAttribute(input.tenantKey, item.attributeId)));
    }
    return;
  }

  await createAttribute(input.tenantKey, {
    entityType: "person",
    entityId: personId,
    category: "event",
    attributeType: "family_relationship",
    attributeTypeCategory: "married",
    attributeDate: input.marriedDate,
    dateIsEstimated: false,
    estimatedTo: "",
    attributeDetail: detailText,
    attributeNotes: marker,
    endDate: "",
    typeKey: "family_relationship",
    valueText: detailText,
    dateStart: input.marriedDate,
    dateEnd: "",
    location: "",
    notes: marker,
  });
}

async function syncHouseholdMarriageAttributes(input: {
  tenantKey: string;
  householdId: string;
  husbandPersonId: string;
  wifePersonId: string;
  husbandName: string;
  wifeName: string;
  marriedDate: string;
}) {
  await Promise.all([
    syncMarriageAttributeForPerson({
      tenantKey: input.tenantKey,
      personId: input.husbandPersonId,
      spouseName: input.wifeName,
      householdId: input.householdId,
      marriedDate: input.marriedDate,
    }),
    syncMarriageAttributeForPerson({
      tenantKey: input.tenantKey,
      personId: input.wifePersonId,
      spouseName: input.husbandName,
      householdId: input.householdId,
      marriedDate: input.marriedDate,
    }),
  ]);
}

async function buildDeleteHouseholdPreview(tenantKey: string, householdId: string): Promise<{
  preview: DeleteHouseholdPreview;
  rowNumbers: {
    households: number[];
    spouseRelationships: number[];
  };
} | null> {
  const targetHouseholdId = householdId.trim();
  if (!targetHouseholdId) {
    return null;
  }
  void tenantKey;
  const [householdRows, relationshipRows] = await Promise.all([
    getTableRecords("Households").catch(() => []),
    getTableRecords("Relationships").catch(() => []),
  ]);
  const householdMatches = householdRows.filter((row) => {
    const rowId = readCell(row.data, "household_id", "id");
    return rowId === targetHouseholdId;
  });
  if (householdMatches.length === 0) {
    return null;
  }

  const firstMatch = householdMatches[0];
  const husbandPersonId = readCell(firstMatch.data, "husband_person_id");
  const wifePersonId = readCell(firstMatch.data, "wife_person_id");
  const spouseRelationshipRows = relationshipRows.filter((row) => {
    const relType = normalize(row.data.rel_type);
    if (relType !== "spouse" && relType !== "family") {
      return false;
    }
    const fromPersonId = String(row.data.from_person_id ?? "").trim();
    const toPersonId = String(row.data.to_person_id ?? "").trim();
    const directMatch = fromPersonId === husbandPersonId && toPersonId === wifePersonId;
    const reverseMatch = fromPersonId === wifePersonId && toPersonId === husbandPersonId;
    return Boolean(husbandPersonId && wifePersonId && (directMatch || reverseMatch));
  });

  return {
    preview: {
      householdId: targetHouseholdId,
      householdLabel: readCell(firstMatch.data, "label", "family_label", "family_name"),
      husbandPersonId,
      wifePersonId,
      counts: {
        householdRowsToDelete: householdMatches.length,
        spouseRelationshipRowsToDelete: spouseRelationshipRows.length,
      },
    },
    rowNumbers: {
      households: householdMatches.map((row) => row.rowNumber),
      spouseRelationships: spouseRelationshipRows.map((row) => row.rowNumber),
    },
  };
}

export async function GET(_: Request, { params }: RouteProps) {
  try {
    const { tenantKey, householdId } = await params;
    const resolved = await requireTenantAccess(tenantKey);
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
    const householdPhotos: HouseholdPhotoLink[] = (await getOciMediaLinksForEntity({
      familyGroupKey: resolved.tenant.tenantKey,
      entityType: "household",
      entityId: householdId,
      usageType: "gallery",
    }))
      .map((item) => ({
        photoId: item.linkId,
        fileId: item.fileId,
        name: item.label,
        description: item.description,
        photoDate: item.photoDate,
        isPrimary: item.isPrimary,
        mediaMetadata: item.mediaMetadata,
      }))
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name));

    return NextResponse.json({
      tenantKey: resolved.tenant.tenantKey,
      household: household.dto,
      children,
      photos: householdPhotos,
    });
  } catch (error) {
    const classified = classifyOperationalError(error);
    const isQuota = classified.status === 429;
    return NextResponse.json(
      {
        error: isQuota ? "household_load_quota_exceeded" : "household_load_failed",
        message: classified.message,
        hint: isQuota ? "Wait 60-90 seconds and retry." : undefined,
      },
      { status: isQuota ? 429 : 500 },
    );
  }
}

export async function PATCH(request: Request, { params }: RouteProps) {
  try {
    const { tenantKey, householdId } = await params;
    const resolved = await requireTenantAccess(tenantKey);
    if ("error" in resolved) {
      return resolved.error;
    }
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
    }

    const updated = await updateTableRecordById(
      "Households",
      householdId,
      {
        label: parsed.data.label ?? "",
        notes: parsed.data.notes ?? "",
        wedding_photo_file_id: parsed.data.weddingPhotoFileId ?? "",
        married_date: parsed.data.marriedDate ?? "",
        address: parsed.data.address ?? "",
        city: parsed.data.city ?? "",
        state: parsed.data.state ?? "",
        zip: parsed.data.zip ?? "",
      },
      "household_id",
      resolved.tenant.tenantKey,
    );
    if (!updated) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const people = await getPeople(resolved.tenant.tenantKey);
    const peopleById = new Map(people.map((person) => [person.personId, person.displayName]));
    const husbandPersonId = readCell(updated.data, "husband_person_id");
    const wifePersonId = readCell(updated.data, "wife_person_id");
    await syncHouseholdMarriageAttributes({
      tenantKey: resolved.tenant.tenantKey,
      householdId,
      husbandPersonId,
      wifePersonId,
      husbandName: peopleById.get(husbandPersonId) || "",
      wifeName: peopleById.get(wifePersonId) || "",
      marriedDate: parsed.data.marriedDate ?? "",
    });

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
        hint: isQuota ? "Wait 60-90 seconds and retry." : undefined,
      },
      { status: isQuota ? 429 : 500 },
    );
  }
}

export async function DELETE(request: Request, { params }: RouteProps) {
  try {
    const { tenantKey, householdId } = await params;
    const resolved = await requireTenantAdmin(tenantKey);
    if ("error" in resolved) {
      return resolved.error;
    }

    const previewOnly = new URL(request.url).searchParams.get("preview") === "1";
    const built = await buildDeleteHouseholdPreview(resolved.tenant.tenantKey, householdId);
    if (!built) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (previewOnly) {
      return NextResponse.json({ ok: true, preview: built.preview });
    }

    const deletedHouseholdRows = await deleteTableRows(
      "Households",
      built.rowNumbers.households,
      resolved.tenant.tenantKey,
    );
    const deletedSpouseRelationshipRows = await deleteTableRows(
      "Relationships",
      built.rowNumbers.spouseRelationships,
    );
    const links = await getOciMediaLinksForEntity({
      familyGroupKey: resolved.tenant.tenantKey,
      entityType: "household",
      entityId: householdId,
      usageType: "gallery",
    });
    const deletedCounts = await Promise.all(links.map((item) => deleteOciMediaLink(item.linkId)));
    const deletedMediaLinks = deletedCounts.reduce((sum, value) => sum + value, 0);

    await appendAuditLog({
      actorEmail: resolved.session.user?.email ?? "",
      actorPersonId: resolved.session.user?.person_id ?? "",
      action: "DELETE",
      entityType: "HOUSEHOLD",
      entityId: householdId,
      familyGroupKey: resolved.tenant.tenantKey,
      status: "SUCCESS",
      details: `Deleted household ${householdId}; households=${deletedHouseholdRows}, spouseRel=${deletedSpouseRelationshipRows}, mediaLinks=${deletedMediaLinks}.`,
    }).catch(() => undefined);

    return NextResponse.json({
      ok: true,
      tenantKey: resolved.tenant.tenantKey,
      deleted: {
        deletedHouseholdRows,
        deletedSpouseRelationshipRows,
        deletedMediaLinks,
      },
      preview: built.preview,
    });
  } catch (error) {
    const classified = classifyOperationalError(error);
    const isQuota = classified.status === 429;
    return NextResponse.json(
      {
        error: isQuota ? "household_delete_quota_exceeded" : "household_delete_failed",
        message: classified.message,
        hint: isQuota ? "Close the workbook if open, wait 60-90 seconds, and retry." : undefined,
      },
      { status: isQuota ? 429 : 500 },
    );
  }
}
