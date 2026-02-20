import { NextResponse } from "next/server";
import { canEditPerson } from "@/lib/auth/permissions";
import {
  createTableRecord,
  getPersonAttributes,
  getPersonById,
  PERSON_ATTRIBUTES_TAB,
  updateTableRecordById,
} from "@/lib/google/sheets";
import { requireTenantAccess } from "@/lib/tenant/guard";
import { personAttributeCreateSchema } from "@/lib/validation/person-attributes";

type PersonAttributeRouteProps = {
  params: Promise<{ tenantKey: string; personId: string }>;
};

function buildAttributeId(tenantKey: string, personId: string, attributeType: string) {
  const typeKey = attributeType.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return `${tenantKey}-${personId}-${typeKey}-${Date.now()}`;
}

async function clearPrimaryForType(tenantKey: string, personId: string, attributeType: string) {
  const current = await getPersonAttributes(tenantKey, personId);
  const updates = current.filter((item) => item.attributeType === attributeType && item.isPrimary);
  await Promise.all(
    updates.map((item) =>
      updateTableRecordById(
        PERSON_ATTRIBUTES_TAB,
        item.attributeId,
        {
          is_primary: "FALSE",
        },
        "attribute_id",
        tenantKey,
      ),
    ),
  );
}

export async function GET(_: Request, { params }: PersonAttributeRouteProps) {
  const { tenantKey, personId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const person = await getPersonById(personId, resolved.tenant.tenantKey);
  if (!person) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const attributes = await getPersonAttributes(resolved.tenant.tenantKey, personId);
  return NextResponse.json({ tenantKey: resolved.tenant.tenantKey, personId, attributes });
}

export async function POST(request: Request, { params }: PersonAttributeRouteProps) {
  const { tenantKey, personId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  if (!canEditPerson(resolved.session, personId, resolved.tenant)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const person = await getPersonById(personId, resolved.tenant.tenantKey);
  if (!person) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = personAttributeCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.isPrimary) {
    await clearPrimaryForType(resolved.tenant.tenantKey, personId, parsed.data.attributeType);
  }

  const attributeId = buildAttributeId(resolved.tenant.tenantKey, personId, parsed.data.attributeType);
  const record = await createTableRecord(
    PERSON_ATTRIBUTES_TAB,
    {
      attribute_id: attributeId,
      tenant_key: resolved.tenant.tenantKey,
      person_id: personId,
      attribute_type: parsed.data.attributeType.toLowerCase(),
      value_text: parsed.data.valueText,
      value_json: parsed.data.valueJson,
      label: parsed.data.label,
      is_primary: parsed.data.isPrimary ? "TRUE" : "FALSE",
      sort_order: String(parsed.data.sortOrder),
      start_date: parsed.data.startDate,
      end_date: parsed.data.endDate,
      visibility: parsed.data.visibility.toLowerCase(),
      notes: parsed.data.notes,
    },
    resolved.tenant.tenantKey,
  );

  return NextResponse.json({ tenantKey: resolved.tenant.tenantKey, personId, attribute: record.data }, { status: 201 });
}
