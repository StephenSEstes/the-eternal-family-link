import { z } from "zod";
import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { parseCsvContent } from "@/lib/csv/parse";
import { buildEntityId } from "@/lib/entity-id";
import { buildPersonId } from "@/lib/person/id";
import { createTableRecord, updateTableRecordById } from "@/lib/data/runtime";
import { getTenantContext, hasTenantAccess, normalizeTenantRouteKey } from "@/lib/family-group/context";

const payloadSchema = z.object({
  target: z.enum(["people", "relationships", "households", "important_dates", "person_attributes"]),
  csv: z.string().min(1),
});

function resolveTarget(target: z.infer<typeof payloadSchema>["target"]) {
  if (target === "people") {
    return { tableName: "People", idColumn: "person_id", required: ["display_name", "birth_date"] };
  }
  if (target === "relationships") {
    return { tableName: "Relationships", idColumn: "rel_id", required: ["from_person_id", "to_person_id", "rel_type"] };
  }
  if (target === "households") {
    return {
      tableName: "Households",
      idColumn: "household_id",
      required: ["husband_person_id", "wife_person_id"],
    };
  }
  if (target === "person_attributes") {
    return { tableName: "Attributes", idColumn: "attribute_id", required: ["person_id", "attribute_type", "value_text"] };
  }
  return { tableName: "ImportantDates", idColumn: "id", required: ["date", "title"] };
}

function buildAttributeId(tenantKey: string, sourceRow: Record<string, string>) {
  const personId = (sourceRow.person_id ?? "").trim();
  const attributeType = (sourceRow.attribute_type ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const valueText = (sourceRow.value_text ?? "").trim();
  const valueKey = valueText.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 40);
  if (!personId || !attributeType || !valueKey) {
    return "";
  }
  return buildEntityId("attr", `${tenantKey}|${personId}|${attributeType}|${valueKey}`);
}

function buildRelationshipId(sourceRow: Record<string, string>) {
  const fromPersonId = (sourceRow.from_person_id ?? "").trim();
  const toPersonId = (sourceRow.to_person_id ?? "").trim();
  const relType = (sourceRow.rel_type ?? "").trim().toLowerCase();
  if (!fromPersonId || !toPersonId || !relType) return "";
  return buildEntityId("rel", `${fromPersonId}|${toPersonId}|${relType}`);
}

function buildHouseholdId(tenantKey: string, sourceRow: Record<string, string>) {
  const husbandPersonId = (sourceRow.husband_person_id ?? "").trim();
  const wifePersonId = (sourceRow.wife_person_id ?? "").trim();
  const memberIds = [husbandPersonId, wifePersonId].filter(Boolean);
  if (memberIds.length === 0) return "";
  if (memberIds.length === 1) {
    return buildEntityId("h", `${tenantKey}|single|${memberIds[0]}`);
  }
  const pair = memberIds.sort().join("|");
  return buildEntityId("h", `${tenantKey}|${pair}`);
}

function buildImportantDateId(tenantKey: string, sourceRow: Record<string, string>, rowNumber: number) {
  const date = (sourceRow.date ?? "").trim();
  const title = (sourceRow.title ?? "").trim();
  const personId = (sourceRow.person_id ?? "").trim();
  if (!date || !title) return "";
  return buildEntityId("date", `${tenantKey}|${date}|${title}|${personId}|${rowNumber}`);
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

  const parsedPayload = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsedPayload.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsedPayload.error.flatten() }, { status: 400 });
  }

  const target = resolveTarget(parsedPayload.data.target);
  const parsedCsv = parseCsvContent(parsedPayload.data.csv);
  if (parsedCsv.headers.length === 0) {
    return NextResponse.json({ error: "empty_csv" }, { status: 400 });
  }

  for (const key of target.required) {
    if (!parsedCsv.headers.includes(key)) {
      return NextResponse.json({ error: "invalid_csv_headers", missing: key }, { status: 400 });
    }
  }

  let created = 0;
  let updated = 0;
  const errors: { row: number; message: string }[] = [];

  for (let i = 0; i < parsedCsv.rows.length; i += 1) {
    const sourceRow = parsedCsv.rows[i];
    const recordId = (() => {
      if (target.tableName === "People") {
        return sourceRow[target.idColumn]?.trim() || buildPersonId(sourceRow.display_name ?? "", sourceRow.birth_date ?? "");
      }
      if (target.tableName === "Attributes") {
        return sourceRow[target.idColumn]?.trim() || buildAttributeId(normalizedTenantKey, sourceRow);
      }
      if (target.tableName === "Relationships") {
        return sourceRow[target.idColumn]?.trim() || buildRelationshipId(sourceRow);
      }
      if (target.tableName === "Households") {
        return sourceRow[target.idColumn]?.trim() || buildHouseholdId(normalizedTenantKey, sourceRow);
      }
      if (target.tableName === "ImportantDates") {
        return sourceRow[target.idColumn]?.trim() || buildImportantDateId(normalizedTenantKey, sourceRow, i + 2);
      }
      return sourceRow[target.idColumn]?.trim();
    })();
    if (!recordId) {
      errors.push({
        row: i + 2,
        message:
          target.tableName === "People"
            ? "Missing person_id and could not generate from display_name + birth_date"
            : `Missing ${target.idColumn}`,
      });
      continue;
    }

    const payload: Record<string, string> = {};
    Object.entries(sourceRow).forEach(([key, value]) => {
      payload[key] = value;
    });
    if (target.tableName === "People" && !payload.person_id) {
      payload.person_id = recordId;
    }
    if (target.tableName === "Attributes" && !payload.attribute_id) {
      payload.attribute_id = recordId;
    }
    if (target.tableName === "Relationships" && !payload.rel_id) {
      payload.rel_id = recordId;
    }
    if (target.tableName === "Households" && !payload.household_id) {
      payload.household_id = recordId;
    }
    if (target.tableName === "ImportantDates" && !payload.id) {
      payload.id = recordId;
    }
    if (
      target.tableName !== "People" &&
      target.tableName !== "Attributes" &&
      target.tableName !== "ImportantDates" &&
      target.tableName !== "Relationships"
    ) {
      payload.tenant_key = normalizedTenantKey;
    }
    if (target.tableName === "Attributes") {
      payload.share_scope = payload.share_scope?.trim().toLowerCase() || "both_families";
      if (payload.share_scope === "one_family" && !payload.share_family_group_key?.trim()) {
        payload.share_family_group_key = normalizedTenantKey;
      }
      if (payload.share_scope !== "one_family") {
        payload.share_family_group_key = "";
      }
      const typeKey = (payload.type_key ?? payload.attribute_type ?? "").trim().toLowerCase();
      payload.type_key = typeKey;
      payload.attribute_type = typeKey;
      payload.entity_type = "person";
      payload.entity_id = (payload.entity_id ?? payload.person_id ?? "").trim();
      if (!payload.category) {
        payload.category = ["graduation", "missions", "religious_event", "injuries", "accomplishments", "stories", "lived_in", "jobs"].includes(typeKey)
          ? "event"
          : "descriptor";
      }
      payload.date_start = payload.date_start ?? payload.start_date ?? "";
      payload.date_end = payload.date_end ?? payload.end_date ?? "";
      payload.value_json = payload.value_json ?? "";
      payload.visibility = payload.visibility ?? "family";
      payload.sort_order = payload.sort_order ?? "0";
      payload.is_primary = payload.is_primary ?? "FALSE";
    }
    if (target.tableName === "ImportantDates") {
      payload.share_scope = payload.share_scope?.trim().toLowerCase() || "both_families";
      if (payload.share_scope === "one_family" && !payload.share_family_group_key?.trim()) {
        payload.share_family_group_key = normalizedTenantKey;
      }
      if (payload.share_scope !== "one_family") {
        payload.share_family_group_key = "";
      }
    }

    try {
      const targetTenantKey = target.tableName === "Relationships" ? undefined : normalizedTenantKey;
      const updatedRow = await updateTableRecordById(
        target.tableName,
        recordId,
        payload,
        target.idColumn,
        targetTenantKey,
      );
      if (updatedRow) {
        updated += 1;
      } else {
        await createTableRecord(target.tableName, payload, targetTenantKey);
        created += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "import_failed";
      errors.push({ row: i + 2, message });
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    target: parsedPayload.data.target,
    created,
    updated,
    failed: errors.length,
    errors,
  });
}
