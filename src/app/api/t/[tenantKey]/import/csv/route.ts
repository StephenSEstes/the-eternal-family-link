import { z } from "zod";
import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { parseCsvContent } from "@/lib/csv/parse";
import { createTableRecord, updateTableRecordById } from "@/lib/google/sheets";
import { getTenantContext, hasTenantAccess, normalizeTenantRouteKey } from "@/lib/tenant/context";

const payloadSchema = z.object({
  target: z.enum(["people", "relationships", "family_units", "important_dates"]),
  csv: z.string().min(1),
});

function resolveTarget(target: z.infer<typeof payloadSchema>["target"]) {
  if (target === "people") {
    return { tabName: "People", idColumn: "person_id", required: ["person_id", "display_name"] };
  }
  if (target === "relationships") {
    return { tabName: "Relationships", idColumn: "rel_id", required: ["rel_id", "from_person_id", "to_person_id"] };
  }
  if (target === "family_units") {
    return { tabName: "FamilyUnits", idColumn: "family_unit_id", required: ["family_unit_id", "partner1_person_id", "partner2_person_id"] };
  }
  return { tabName: "ImportantDates", idColumn: "id", required: ["id", "date", "title"] };
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
    const recordId = sourceRow[target.idColumn]?.trim();
    if (!recordId) {
      errors.push({ row: i + 2, message: `Missing ${target.idColumn}` });
      continue;
    }

    const payload: Record<string, string> = {};
    Object.entries(sourceRow).forEach(([key, value]) => {
      payload[key] = value;
    });
    payload.tenant_key = normalizedTenantKey;

    try {
      const updatedRow = await updateTableRecordById(
        target.tabName,
        recordId,
        payload,
        target.idColumn,
        normalizedTenantKey,
      );
      if (updatedRow) {
        updated += 1;
      } else {
        await createTableRecord(target.tabName, payload, normalizedTenantKey);
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
