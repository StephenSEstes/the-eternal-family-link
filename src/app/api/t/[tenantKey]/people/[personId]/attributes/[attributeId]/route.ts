import { NextResponse } from "next/server";
import { canEditPerson } from "@/lib/auth/permissions";
import {
  deleteTableRecordById,
  getPersonAttributes,
  getPersonById,
  PERSON_ATTRIBUTES_TAB,
  updateTableRecordById,
} from "@/lib/google/sheets";
import { assertTenantScopedValue, requireTenantAccess } from "@/lib/tenant/guard";
import { personAttributeUpdateSchema } from "@/lib/validation/person-attributes";

type PersonAttributeItemRouteProps = {
  params: Promise<{ tenantKey: string; personId: string; attributeId: string }>;
};

async function clearPrimaryForType(tenantKey: string, personId: string, attributeType: string, keepAttributeId: string) {
  const current = await getPersonAttributes(tenantKey, personId);
  const updates = current.filter(
    (item) => item.attributeId !== keepAttributeId && item.attributeType === attributeType && item.isPrimary,
  );
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

export async function PATCH(request: Request, { params }: PersonAttributeItemRouteProps) {
  const { tenantKey, personId, attributeId } = await params;
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

  const existing = (await getPersonAttributes(resolved.tenant.tenantKey, personId)).find(
    (item) => item.attributeId === attributeId,
  );
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  assertTenantScopedValue(existing.tenantKey, resolved.tenant.tenantKey);

  const parsed = personAttributeUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const nextType = parsed.data.attributeType?.toLowerCase() ?? existing.attributeType;
  const makePrimary = parsed.data.isPrimary ?? false;
  if (makePrimary) {
    await clearPrimaryForType(resolved.tenant.tenantKey, personId, nextType, attributeId);
  }

  const payload: Record<string, string> = {};
  if (parsed.data.attributeType !== undefined) payload.attribute_type = parsed.data.attributeType.toLowerCase();
  if (parsed.data.valueText !== undefined) payload.value_text = parsed.data.valueText;
  if (parsed.data.valueJson !== undefined) payload.value_json = parsed.data.valueJson;
  if (parsed.data.label !== undefined) payload.label = parsed.data.label;
  if (parsed.data.isPrimary !== undefined) payload.is_primary = parsed.data.isPrimary ? "TRUE" : "FALSE";
  if (parsed.data.sortOrder !== undefined) payload.sort_order = String(parsed.data.sortOrder);
  if (parsed.data.startDate !== undefined) payload.start_date = parsed.data.startDate;
  if (parsed.data.endDate !== undefined) payload.end_date = parsed.data.endDate;
  if (parsed.data.visibility !== undefined) payload.visibility = parsed.data.visibility.toLowerCase();
  if (parsed.data.notes !== undefined) payload.notes = parsed.data.notes;

  const updated = await updateTableRecordById(
    PERSON_ATTRIBUTES_TAB,
    attributeId,
    payload,
    "attribute_id",
    resolved.tenant.tenantKey,
  );
  if (!updated) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ tenantKey: resolved.tenant.tenantKey, personId, attribute: updated.data });
}

export async function DELETE(_: Request, { params }: PersonAttributeItemRouteProps) {
  const { tenantKey, personId, attributeId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  if (!canEditPerson(resolved.session, personId, resolved.tenant)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const deleted = await deleteTableRecordById(
    PERSON_ATTRIBUTES_TAB,
    attributeId,
    "attribute_id",
    resolved.tenant.tenantKey,
  );
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, tenantKey: resolved.tenant.tenantKey, personId, attributeId });
}
