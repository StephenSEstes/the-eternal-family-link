import { z } from "zod";
import { NextResponse } from "next/server";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { createAttribute, getAttributesForEntity } from "@/lib/attributes/store";
import { getAttributeEventDefinitions } from "@/lib/attributes/event-definitions";
import {
  inferAttributeKindFromTypeKey,
  normalizeAttributeKind,
  normalizeAttributeTypeKey,
} from "@/lib/attributes/definition-defaults";
import { getPersonById } from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { parseCsvContent } from "@/lib/csv/parse";
import { attributeCreateSchema } from "@/lib/validation/attributes";

type PersonAttributeImportRouteProps = {
  params: Promise<{ tenantKey: string; personId: string }>;
};

const payloadSchema = z.object({
  csv: z.string().trim().min(1).max(2_000_000),
});

type GuideField = {
  field: string;
  required: boolean | string;
  dataType: string;
  maxLength: number | string;
  description: string;
};

type GuideTypeOption = {
  typeKey: string;
  typeLabel: string;
  kind: "descriptor" | "event";
  categoryKey: string;
  categoryLabel: string;
  dateMode: "none" | "single" | "range";
  detailLabel: string;
};

const GUIDE_HEADERS = [
  "attribute_type",
  "attribute_type_category",
  "attribute_kind",
  "attribute_detail",
  "attribute_notes",
  "attribute_date",
  "end_date",
  "date_is_estimated",
  "estimated_to",
  "label",
] as const;

const GUIDE_FIELDS: GuideField[] = [
  {
    field: "attribute_type",
    required: true,
    dataType: "string",
    maxLength: 120,
    description: "Canonical attribute type key. Use one of the allowed type keys from this guide.",
  },
  {
    field: "attribute_type_category",
    required: false,
    dataType: "string",
    maxLength: 120,
    description: "Optional subtype/category value used by some attribute types.",
  },
  {
    field: "attribute_kind",
    required: false,
    dataType: "enum(descriptor|event)",
    maxLength: 10,
    description: "Optional. If omitted, kind is inferred from the selected type key.",
  },
  {
    field: "attribute_detail",
    required: "descriptor-only",
    dataType: "string",
    maxLength: 2000,
    description: "Main attribute value/detail. Required for descriptor rows.",
  },
  {
    field: "attribute_notes",
    required: false,
    dataType: "string",
    maxLength: 4000,
    description: "Optional notes/context.",
  },
  {
    field: "attribute_date",
    required: "event-only",
    dataType: "string(YYYY-MM-DD preferred)",
    maxLength: 32,
    description: "Primary date for the attribute. Required for event rows.",
  },
  {
    field: "end_date",
    required: false,
    dataType: "string(YYYY-MM-DD preferred)",
    maxLength: 32,
    description: "Optional end date for range events.",
  },
  {
    field: "date_is_estimated",
    required: false,
    dataType: "boolean(TRUE|FALSE)",
    maxLength: 5,
    description: "Set TRUE when date precision is estimated.",
  },
  {
    field: "estimated_to",
    required: "if date_is_estimated=TRUE",
    dataType: "enum(month|year)",
    maxLength: 5,
    description: "Required only when date_is_estimated is TRUE.",
  },
  {
    field: "label",
    required: false,
    dataType: "string",
    maxLength: 120,
    description: "Optional short display label.",
  },
];

function toBool(value: string | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["true", "1", "yes", "y"].includes(normalized);
}

function normalizeEstimatedTo(value: string | undefined): "" | "month" | "year" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "month" || normalized === "year") return normalized;
  return "";
}

function csvEscape(value: string) {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function buildFingerprint(input: {
  kind: string;
  typeKey: string;
  detail: string;
  date: string;
  endDate: string;
  notes: string;
}) {
  return [
    input.kind.trim().toLowerCase(),
    input.typeKey.trim().toLowerCase(),
    input.detail.trim().toLowerCase(),
    input.date.trim(),
    input.endDate.trim(),
    input.notes.trim().toLowerCase(),
  ].join("|");
}

function buildGuide(typeOptions: GuideTypeOption[]) {
  const descriptorSample = typeOptions.find((item) => item.kind === "descriptor") ?? typeOptions[0];
  const eventSample = typeOptions.find((item) => item.kind === "event") ?? typeOptions[0];
  const sampleRows: string[][] = [];
  if (descriptorSample) {
    sampleRows.push([
      descriptorSample.typeKey,
      descriptorSample.categoryKey,
      descriptorSample.kind,
      "Example detail value",
      "Imported descriptor sample",
      "",
      "",
      "FALSE",
      "",
      descriptorSample.typeLabel,
    ]);
  }
  if (eventSample) {
    sampleRows.push([
      eventSample.typeKey,
      eventSample.categoryKey,
      eventSample.kind,
      "Example event detail",
      "Imported event sample",
      "1998-06-12",
      "",
      "FALSE",
      "",
      eventSample.typeLabel,
    ]);
  }
  const sampleCsv = [
    GUIDE_HEADERS.join(","),
    ...sampleRows.map((row) => row.map((value) => csvEscape(value)).join(",")),
  ].join("\n");

  return {
    headers: GUIDE_HEADERS,
    fields: GUIDE_FIELDS,
    typeOptions,
    sampleCsv,
  };
}

export async function GET(_: Request, { params }: PersonAttributeImportRouteProps) {
  const { tenantKey, personId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const person = await getPersonById(personId, resolved.tenant.tenantKey);
  if (!person) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const defs = await getAttributeEventDefinitions(resolved.tenant.tenantKey);
  const categoryLabelById = new Map<string, string>();
  for (const category of defs.categories) {
    if (!category.isEnabled) continue;
    const key = `${category.kind}:${normalizeAttributeTypeKey(category.categoryKey)}`;
    categoryLabelById.set(key, category.categoryLabel.trim() || category.categoryKey);
  }
  const typeOptions: GuideTypeOption[] = defs.types
    .filter((type) => type.isEnabled)
    .map((type) => {
      const categoryKey = normalizeAttributeTypeKey(type.categoryKey);
      const categoryId = `${type.kind}:${categoryKey}`;
      return {
        typeKey: normalizeAttributeTypeKey(type.typeKey),
        typeLabel: type.typeLabel.trim() || type.typeKey,
        kind: type.kind,
        categoryKey,
        categoryLabel: categoryLabelById.get(categoryId) || categoryKey,
        dateMode: type.dateMode,
        detailLabel: type.detailLabel.trim() || "Attribute Detail",
      };
    })
    .filter((type) => Boolean(type.typeKey))
    .sort((a, b) =>
      a.kind.localeCompare(b.kind) ||
      a.categoryLabel.localeCompare(b.categoryLabel) ||
      a.typeLabel.localeCompare(b.typeLabel),
    );

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    personId,
    guide: buildGuide(typeOptions),
  });
}

export async function POST(request: Request, { params }: PersonAttributeImportRouteProps) {
  const { tenantKey, personId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const person = await getPersonById(personId, resolved.tenant.tenantKey);
  if (!person) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const payload = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) {
    return NextResponse.json({ error: "invalid_payload", issues: payload.error.flatten() }, { status: 400 });
  }

  const parsed = parseCsvContent(payload.data.csv);
  if (parsed.headers.length === 0 || parsed.rows.length === 0) {
    return NextResponse.json({ error: "empty_csv", message: "CSV has no data rows." }, { status: 400 });
  }
  if (!parsed.headers.includes("attribute_type")) {
    return NextResponse.json(
      { error: "invalid_csv_headers", message: "CSV must include attribute_type header." },
      { status: 400 },
    );
  }

  const defs = await getAttributeEventDefinitions(resolved.tenant.tenantKey);
  const typeKindMap = new Map<string, "descriptor" | "event">();
  for (const type of defs.types) {
    if (!type.isEnabled) continue;
    const typeKey = normalizeAttributeTypeKey(type.typeKey);
    if (!typeKey) continue;
    typeKindMap.set(typeKey, type.kind);
  }

  const existingAttributes = await getAttributesForEntity(resolved.tenant.tenantKey, "person", personId).catch(() => []);
  const seenFingerprints = new Set<string>(
    existingAttributes.map((item) =>
      buildFingerprint({
        kind: item.attributeKind,
        typeKey: item.typeKey,
        detail: item.attributeDetail || item.valueText || "",
        date: item.attributeDate || item.dateStart || "",
        endDate: item.endDate || item.dateEnd || "",
        notes: item.attributeNotes || item.notes || "",
      }),
    ),
  );

  let created = 0;
  let skipped = 0;
  const errors: Array<{ row: number; message: string }> = [];

  for (let i = 0; i < parsed.rows.length; i += 1) {
    const sourceRow = parsed.rows[i];
    const rowNumber = i + 2;
    const typeKey = normalizeAttributeTypeKey(sourceRow.attribute_type || sourceRow.type_key);
    if (!typeKey) {
      errors.push({ row: rowNumber, message: "attribute_type is required." });
      continue;
    }
    const attributeDate = String(sourceRow.attribute_date || sourceRow.date_start || "").trim();
    const endDate = String(sourceRow.end_date || sourceRow.date_end || "").trim();
    const attributeDetail = String(sourceRow.attribute_detail || sourceRow.value_text || "").trim();
    const attributeNotes = String(sourceRow.attribute_notes || sourceRow.notes || "").trim();
    const attributeTypeCategory = normalizeAttributeTypeKey(
      sourceRow.attribute_type_category || sourceRow.type_category || "",
    );
    const explicitKind = normalizeAttributeKind(sourceRow.attribute_kind || "");
    const inferredKind = typeKindMap.get(typeKey) ?? inferAttributeKindFromTypeKey(typeKey, attributeDate);
    const attributeKind = explicitKind ?? inferredKind;
    const dateIsEstimated = toBool(sourceRow.date_is_estimated);
    const estimatedTo = normalizeEstimatedTo(sourceRow.estimated_to);

    const canonical = attributeCreateSchema.safeParse({
      entityType: "person",
      entityId: personId,
      category: attributeKind,
      attributeKind,
      attributeType: typeKey,
      typeKey,
      attributeTypeCategory,
      attributeDetail,
      valueText: attributeDetail,
      attributeNotes,
      notes: attributeNotes,
      attributeDate,
      dateStart: attributeDate,
      endDate,
      dateEnd: endDate,
      dateIsEstimated,
      estimatedTo: dateIsEstimated ? estimatedTo || undefined : undefined,
      label: String(sourceRow.label || "").trim(),
    });
    if (!canonical.success) {
      const firstIssue = canonical.error.issues[0];
      errors.push({ row: rowNumber, message: firstIssue?.message || "Invalid row." });
      continue;
    }

    const fingerprint = buildFingerprint({
      kind: canonical.data.attributeKind ?? canonical.data.category,
      typeKey: canonical.data.typeKey,
      detail: canonical.data.attributeDetail || canonical.data.valueText || "",
      date: canonical.data.attributeDate || canonical.data.dateStart || "",
      endDate: canonical.data.endDate || canonical.data.dateEnd || "",
      notes: canonical.data.attributeNotes || canonical.data.notes || "",
    });
    if (seenFingerprints.has(fingerprint)) {
      skipped += 1;
      continue;
    }

    try {
      await createAttribute(resolved.tenant.tenantKey, {
        entityType: "person",
        entityId: personId,
        category: canonical.data.category,
        attributeKind: canonical.data.attributeKind ?? canonical.data.category,
        attributeType: canonical.data.attributeType || canonical.data.typeKey,
        attributeTypeCategory: canonical.data.attributeTypeCategory,
        attributeDate: canonical.data.attributeDate || canonical.data.dateStart,
        dateIsEstimated: canonical.data.dateIsEstimated,
        estimatedTo: canonical.data.estimatedTo ?? "",
        attributeDetail: canonical.data.attributeDetail || canonical.data.valueText,
        attributeNotes: canonical.data.attributeNotes || canonical.data.notes,
        endDate: canonical.data.endDate || canonical.data.dateEnd,
        typeKey: canonical.data.typeKey,
        label: canonical.data.label,
        valueText: canonical.data.valueText,
        dateStart: canonical.data.dateStart,
        dateEnd: canonical.data.dateEnd,
        location: canonical.data.location,
        notes: canonical.data.notes,
      });
      created += 1;
      seenFingerprints.add(fingerprint);
    } catch (error) {
      const message = error instanceof Error ? error.message : "create_failed";
      errors.push({ row: rowNumber, message });
    }
  }

  await appendSessionAuditLog(resolved.session, {
    action: "UPDATE",
    entityType: "PERSON",
    entityId: personId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: errors.length > 0 ? "FAILURE" : "SUCCESS",
    details: `Attribute import for person=${personId}. created=${created}, skipped=${skipped}, failed=${errors.length}.`,
  });

  return NextResponse.json({
    ok: errors.length === 0,
    tenantKey: resolved.tenant.tenantKey,
    personId,
    created,
    skipped,
    failed: errors.length,
    errors,
  });
}
