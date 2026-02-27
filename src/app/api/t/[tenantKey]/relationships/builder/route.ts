import { z } from "zod";
import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import {
  createTableRecord,
  deleteTableRecordById,
  getTableRecords,
  updateTableRecordById,
} from "@/lib/google/sheets";
import { getTenantContext, hasTenantAccess, normalizeTenantRouteKey } from "@/lib/family-group/context";

const payloadSchema = z.object({
  personId: z.string().trim().min(1),
  parentIds: z.array(z.string().trim().min(1)).default([]),
  childIds: z.array(z.string().trim().min(1)).default([]),
  spouseId: z.string().trim().optional().default(""),
});

function makeRelId(fromPersonId: string, toPersonId: string, relType: string) {
  const clean = `${fromPersonId}-${toPersonId}-${relType}`.toLowerCase();
  return clean.replace(/[^a-z0-9_-]+/g, "-");
}

function readField(record: Record<string, string>, ...keys: string[]) {
  const lowered = new Map(Object.entries(record).map(([k, v]) => [k.trim().toLowerCase(), v]));
  for (const key of keys) {
    const value = lowered.get(key.toLowerCase());
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

async function upsertRelation(
  fromPersonId: string,
  toPersonId: string,
  relType: string,
) {
  const relId = makeRelId(fromPersonId, toPersonId, relType);
  const payload: Record<string, string> = {
    rel_id: relId,
    from_person_id: fromPersonId,
    to_person_id: toPersonId,
    rel_type: relType,
  };

  const updated = await updateTableRecordById("Relationships", relId, payload, "rel_id");
  if (!updated) {
    await createTableRecord("Relationships", payload);
  }
}

function makeFamilyUnitId(tenantKey: string, personA: string, personB: string) {
  const pair = [personA, personB].sort().join("-");
  const clean = `${tenantKey}-fu-${pair}`.toLowerCase();
  return clean.replace(/[^a-z0-9_-]+/g, "-");
}

async function upsertFamilyUnit(tenantKey: string, personA: string, personB: string) {
  const familyUnitId = makeFamilyUnitId(tenantKey, personA, personB);
  const [husband, wife] = [personA, personB].sort();
  const payload: Record<string, string> = {
    household_id: familyUnitId,
    husband_person_id: husband,
    wife_person_id: wife,
    tenant_key: tenantKey,
  };

  const updated = await updateTableRecordById("Households", familyUnitId, payload, "household_id", tenantKey);
  if (!updated) {
    await createTableRecord("Households", payload, tenantKey);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const session = await getAppSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { tenantKey } = await params;
  const normalizedTenantKey = normalizeTenantRouteKey(tenantKey);
  if (!hasTenantAccess(session, normalizedTenantKey)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const tenant = getTenantContext(session, normalizedTenantKey);
  if (tenant.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const parentIds = Array.from(new Set(parsed.data.parentIds.filter((id) => id !== parsed.data.personId)));
    const childIds = Array.from(new Set(parsed.data.childIds.filter((id) => id !== parsed.data.personId)));
    const spouseId = parsed.data.spouseId && parsed.data.spouseId !== parsed.data.personId ? parsed.data.spouseId : "";

    const existing = await getTableRecords("Relationships");
    const desiredIds = new Set<string>();
    parentIds.forEach((parentId) =>
      desiredIds.add(makeRelId(parentId, parsed.data.personId, "parent")),
    );
    childIds.forEach((childId) =>
      desiredIds.add(makeRelId(parsed.data.personId, childId, "parent")),
    );

    for (const row of existing) {
      const relId = readField(row.data, "rel_id");
      const relType = readField(row.data, "rel_type");
      const fromPersonId = readField(row.data, "from_person_id");
      const toPersonId = readField(row.data, "to_person_id");
      if (relType.toLowerCase() !== "parent" || !relId) {
        continue;
      }

      const isParentEdge = toPersonId === parsed.data.personId;
      const isChildEdge = fromPersonId === parsed.data.personId;
      if (!isParentEdge && !isChildEdge) {
        continue;
      }
      if (desiredIds.has(relId)) {
        continue;
      }

      await deleteTableRecordById("Relationships", relId, "rel_id");
    }

    for (const parentId of parentIds) {
      await upsertRelation(parentId, parsed.data.personId, "parent");
    }
    for (const childId of childIds) {
      await upsertRelation(parsed.data.personId, childId, "parent");
    }

    const households = await getTableRecords("Households", normalizedTenantKey);
    const spouseConflict = spouseId
      ? households.find((row) => {
          const partner1 = readField(row.data, "husband_person_id");
          const partner2 = readField(row.data, "wife_person_id");
          const rowTenantKey = readField(row.data, "tenant_key") || normalizedTenantKey;
          if (rowTenantKey !== normalizedTenantKey) {
            return false;
          }
          if (partner1 !== spouseId && partner2 !== spouseId) {
            return false;
          }
          return partner1 !== parsed.data.personId && partner2 !== parsed.data.personId;
        })
      : null;

    if (spouseConflict) {
      const partner1 = readField(spouseConflict.data, "husband_person_id");
      const partner2 = readField(spouseConflict.data, "wife_person_id");
      const otherPartner = partner1 === spouseId ? partner2 : partner1;
      return NextResponse.json(
        {
          error: "spouse_unavailable",
          spouseId,
          currentSpouseId: otherPartner || null,
        },
        { status: 409 },
      );
    }

    for (const row of households) {
      const unitId = readField(row.data, "household_id");
      const partner1 = readField(row.data, "husband_person_id");
      const partner2 = readField(row.data, "wife_person_id");
      const rowTenantKey = readField(row.data, "tenant_key") || normalizedTenantKey;
      if (!unitId || rowTenantKey !== normalizedTenantKey) {
        continue;
      }
      if (partner1 !== parsed.data.personId && partner2 !== parsed.data.personId) {
        continue;
      }
      if (
        spouseId &&
        ((partner1 === parsed.data.personId && partner2 === spouseId) ||
          (partner2 === parsed.data.personId && partner1 === spouseId))
      ) {
        continue;
      }
      await deleteTableRecordById("Households", unitId, "household_id", normalizedTenantKey);
    }

    if (spouseId) {
      await upsertFamilyUnit(normalizedTenantKey, parsed.data.personId, spouseId);
    }

    return NextResponse.json({
      ok: true,
      personId: parsed.data.personId,
      parentCount: parentIds.length,
      childCount: childIds.length,
      spouseId: spouseId || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    return NextResponse.json({ error: "relationship_save_failed", message }, { status: 500 });
  }
}
