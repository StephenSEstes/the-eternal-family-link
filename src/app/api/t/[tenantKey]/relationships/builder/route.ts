import { z } from "zod";
import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { buildEntityId } from "@/lib/entity-id";
import {
  createTableRecord,
  createTableRecords,
  deleteTableRecordById,
  deleteTableRows,
  getTableRecords,
} from "@/lib/google/sheets";
import { getTenantContext, hasTenantAccess, normalizeTenantRouteKey } from "@/lib/family-group/context";

const payloadSchema = z.object({
  personId: z.string().trim().min(1),
  parentIds: z.array(z.string().trim().min(1)).default([]),
  childIds: z.array(z.string().trim().min(1)).default([]),
  spouseId: z.string().trim().optional().default(""),
});

function makeRelId(fromPersonId: string, toPersonId: string, relType: string) {
  return buildEntityId("rel", `${fromPersonId}|${toPersonId}|${relType}`);
}

function makeParentEdgeKey(fromPersonId: string, toPersonId: string) {
  return `${fromPersonId}=>${toPersonId}=>parent`.toLowerCase();
}

function makeRelationEdgeKey(fromPersonId: string, toPersonId: string, relType: string) {
  return `${fromPersonId}=>${toPersonId}=>${relType}`.toLowerCase();
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

function relationPayload(
  tenantKey: string,
  fromPersonId: string,
  toPersonId: string,
  relType: string,
): Record<string, string> {
  const relId = makeRelId(fromPersonId, toPersonId, relType);
  return {
    family_group_key: tenantKey,
    rel_id: relId,
    relationship_id: relId,
    id: relId,
    from_person_id: fromPersonId,
    to_person_id: toPersonId,
    rel_type: relType,
  };
}

function makeFamilyUnitId(tenantKey: string, personA: string, personB: string) {
  const pair = [personA, personB].sort().join("|").toLowerCase();
  return buildEntityId("h", `${tenantKey}|${pair}`);
}

function normalizeNamePart(value: string) {
  const cleaned = value.trim().replace(/[^a-zA-Z\s'-]/g, " ").replace(/\s+/g, " ");
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function buildHouseholdLabel(wifeLastName: string, husbandLastName: string) {
  const wife = normalizeNamePart(wifeLastName);
  const husband = normalizeNamePart(husbandLastName);
  if (wife && husband) {
    return `${wife}-${husband} Family`;
  }
  if (wife) {
    return `${wife} Family`;
  }
  if (husband) {
    return `${husband} Family`;
  }
  return "Family";
}

async function createFamilyUnit(
  tenantKey: string,
  personA: string,
  personB: string,
  peopleById: Map<string, { gender: string; lastName: string }>,
) {
  const familyUnitId = makeFamilyUnitId(tenantKey, personA, personB);
  const personAData = peopleById.get(personA) ?? { gender: "", lastName: "" };
  const personBData = peopleById.get(personB) ?? { gender: "", lastName: "" };
  const personAGender = personAData.gender.toLowerCase();
  const personBGender = personBData.gender.toLowerCase();

  let husband = personA;
  let wife = personB;
  if (personAGender === "female" && personBGender === "male") {
    husband = personB;
    wife = personA;
  } else if (personAGender === "male" && personBGender === "female") {
    husband = personA;
    wife = personB;
  } else {
    // Deterministic fallback when genders are missing/unspecified.
    const sorted = [personA, personB].sort();
    husband = sorted[0];
    wife = sorted[1];
  }

  const wifeLastName = (peopleById.get(wife)?.lastName ?? "").trim();
  const husbandLastName = (peopleById.get(husband)?.lastName ?? "").trim();
  const payload: Record<string, string> = {
    household_id: familyUnitId,
    husband_person_id: husband,
    wife_person_id: wife,
    label: buildHouseholdLabel(wifeLastName, husbandLastName),
    family_group_key: tenantKey,
  };
  await createTableRecord("Households", payload, tenantKey);
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
  const debugContext = {
    phase: "start",
    personId: parsed.data.personId,
    parentCount: parsed.data.parentIds.length,
    childCount: parsed.data.childIds.length,
    spouseId: parsed.data.spouseId ?? "",
  };
  try {
    debugContext.phase = "prepare";
    const parentIds = Array.from(new Set(parsed.data.parentIds.filter((id) => id !== parsed.data.personId)));
    const childIds = Array.from(new Set(parsed.data.childIds.filter((id) => id !== parsed.data.personId)));
    const spouseId = parsed.data.spouseId && parsed.data.spouseId !== parsed.data.personId ? parsed.data.spouseId : "";

    debugContext.phase = "load_relationships";
    const existing = await getTableRecords("Relationships", normalizedTenantKey);
    const people = await getTableRecords("People", normalizedTenantKey);
    const peopleById = new Map<string, { gender: string; lastName: string }>();
    for (const row of people) {
      const personId = readField(row.data, "person_id", "id");
      if (!personId) continue;
      peopleById.set(personId, {
        gender: readField(row.data, "gender"),
        lastName: readField(row.data, "last_name"),
      });
    }
    const desiredParentEdgeKeys = new Set<string>();
    parentIds.forEach((parentId) =>
      desiredParentEdgeKeys.add(makeParentEdgeKey(parentId, parsed.data.personId)),
    );
    childIds.forEach((childId) =>
      desiredParentEdgeKeys.add(makeParentEdgeKey(parsed.data.personId, childId)),
    );

    const existingParentEdgeKeys = new Set<string>();
    const relationshipRowNumbersToDelete: number[] = [];
    for (const row of existing) {
      const relId = readField(row.data, "rel_id", "relationship_id", "id");
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
      existingParentEdgeKeys.add(makeParentEdgeKey(fromPersonId, toPersonId));
    }

    debugContext.phase = "prune_existing_relationships";
    for (const row of existing) {
      const relId = readField(row.data, "rel_id", "relationship_id", "id");
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
      if (desiredParentEdgeKeys.has(makeParentEdgeKey(fromPersonId, toPersonId))) {
        continue;
      }
      relationshipRowNumbersToDelete.push(row.rowNumber);
    }
    if (relationshipRowNumbersToDelete.length > 0) {
      await deleteTableRows("Relationships", relationshipRowNumbersToDelete, normalizedTenantKey);
    }

    debugContext.phase = "upsert_parent_edges";
    const relationsToCreate: Record<string, string>[] = [];
    for (const parentId of parentIds) {
      const edgeKey = makeParentEdgeKey(parentId, parsed.data.personId);
      if (!existingParentEdgeKeys.has(edgeKey)) {
        relationsToCreate.push(relationPayload(normalizedTenantKey, parentId, parsed.data.personId, "parent"));
      }
    }
    debugContext.phase = "upsert_child_edges";
    for (const childId of childIds) {
      const edgeKey = makeParentEdgeKey(parsed.data.personId, childId);
      if (!existingParentEdgeKeys.has(edgeKey)) {
        relationsToCreate.push(relationPayload(normalizedTenantKey, parsed.data.personId, childId, "parent"));
      }
    }
    if (relationsToCreate.length > 0) {
      await createTableRecords("Relationships", relationsToCreate, normalizedTenantKey);
    }

    debugContext.phase = "upsert_spouse_edges";
    const allRelationships = await getTableRecords("Relationships", normalizedTenantKey);
    const spouseRelationshipRowNumbersToDelete: number[] = [];
    const existingSpouseEdgeKeys = new Set<string>();
    for (const row of allRelationships) {
      const relId = readField(row.data, "rel_id", "relationship_id", "id");
      const relType = readField(row.data, "rel_type").toLowerCase();
      const fromPersonId = readField(row.data, "from_person_id");
      const toPersonId = readField(row.data, "to_person_id");
      if (!relId || (relType !== "spouse" && relType !== "family")) {
        continue;
      }
      if (fromPersonId !== parsed.data.personId && toPersonId !== parsed.data.personId) {
        continue;
      }
      const isDesired =
        spouseId &&
        ((fromPersonId === parsed.data.personId && toPersonId === spouseId) ||
          (toPersonId === parsed.data.personId && fromPersonId === spouseId));
      if (!isDesired) {
        spouseRelationshipRowNumbersToDelete.push(row.rowNumber);
        continue;
      }
      existingSpouseEdgeKeys.add(makeRelationEdgeKey(fromPersonId, toPersonId, relType));
    }
    if (spouseRelationshipRowNumbersToDelete.length > 0) {
      await deleteTableRows("Relationships", spouseRelationshipRowNumbersToDelete, normalizedTenantKey);
    }
    if (spouseId) {
      const desiredSpouseEdges = [
        relationPayload(normalizedTenantKey, parsed.data.personId, spouseId, "spouse"),
        relationPayload(normalizedTenantKey, spouseId, parsed.data.personId, "spouse"),
        relationPayload(normalizedTenantKey, parsed.data.personId, spouseId, "family"),
        relationPayload(normalizedTenantKey, spouseId, parsed.data.personId, "family"),
      ].filter((payload) => {
        const fromPersonId = payload.from_person_id;
        const toPersonId = payload.to_person_id;
        const relType = payload.rel_type;
        return !existingSpouseEdgeKeys.has(makeRelationEdgeKey(fromPersonId, toPersonId, relType));
      });
      if (desiredSpouseEdges.length > 0) {
        await createTableRecords("Relationships", desiredSpouseEdges, normalizedTenantKey);
      }
    }

    debugContext.phase = "load_households";
    const households = await getTableRecords("Households", normalizedTenantKey);
    const spouseConflict = spouseId
      ? households.find((row) => {
          const partner1 = readField(row.data, "husband_person_id");
          const partner2 = readField(row.data, "wife_person_id");
          const rowTenantKey = readField(row.data, "family_group_key", "tenant_key") || normalizedTenantKey;
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

    debugContext.phase = "prune_households";
    for (const row of households) {
      const unitId = readField(row.data, "household_id");
      const partner1 = readField(row.data, "husband_person_id");
      const partner2 = readField(row.data, "wife_person_id");
      const rowTenantKey = readField(row.data, "family_group_key", "tenant_key") || normalizedTenantKey;
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

    debugContext.phase = "upsert_household";
    if (spouseId) {
      const hasDesiredUnit = households.some((row) => {
        const unitId = readField(row.data, "household_id");
        const partner1 = readField(row.data, "husband_person_id");
        const partner2 = readField(row.data, "wife_person_id");
        const rowTenantKey = readField(row.data, "family_group_key", "tenant_key") || normalizedTenantKey;
        return (
          Boolean(unitId) &&
          rowTenantKey === normalizedTenantKey &&
          ((partner1 === parsed.data.personId && partner2 === spouseId) ||
            (partner2 === parsed.data.personId && partner1 === spouseId))
        );
      });
      if (!hasDesiredUnit) {
        await createFamilyUnit(normalizedTenantKey, parsed.data.personId, spouseId, peopleById);
      }
    }

    debugContext.phase = "done";
    return NextResponse.json({
      ok: true,
      personId: parsed.data.personId,
      parentCount: parentIds.length,
      childCount: childIds.length,
      spouseId: spouseId || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    const lower = message.toLowerCase();
    const isQuota = lower.includes("quota") || lower.includes("rate limit") || lower.includes("read requests per minute");
    return NextResponse.json(
      {
        error: isQuota ? "relationship_save_quota_exceeded" : "relationship_save_failed",
        message,
        debug: debugContext,
        hint: isQuota ? "Close the workbook if open, wait 60-90 seconds, and retry." : undefined,
      },
      { status: isQuota ? 429 : 500 },
    );
  }
}
