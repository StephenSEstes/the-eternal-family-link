import { NextResponse } from "next/server";
import { canEditPerson } from "@/lib/auth/permissions";
import {
  createTableRecord,
  getPersonAttributes,
  getPersonById,
  PERSON_ATTRIBUTES_TAB,
  updatePerson,
  updateTableRecordById,
} from "@/lib/google/sheets";
import { requireTenantAccess } from "@/lib/tenant/guard";
import { personUpdateSchema } from "@/lib/validation/person";

type TenantPersonRouteProps = {
  params: Promise<{ tenantKey: string; personId: string }>;
};

export async function GET(_: Request, { params }: TenantPersonRouteProps) {
  const { tenantKey, personId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const person = await getPersonById(personId, resolved.tenant.tenantKey);
  if (!person) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ tenantKey: resolved.tenant.tenantKey, person });
}

export async function POST(request: Request, { params }: TenantPersonRouteProps) {
  const { tenantKey, personId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  if (!canEditPerson(resolved.session, personId, resolved.tenant)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = personUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const person = await updatePerson(personId, parsed.data, resolved.tenant.tenantKey);
  if (!person) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (parsed.data.birth_date.trim()) {
    const attributes = await getPersonAttributes(resolved.tenant.tenantKey, personId);
    const birthday = attributes.find((item) => item.attributeType.toLowerCase() === "birthday");
    if (birthday) {
      await updateTableRecordById(
        PERSON_ATTRIBUTES_TAB,
        birthday.attributeId,
        {
          value_text: parsed.data.birth_date,
          label: birthday.label || "Birthday",
          is_primary: "TRUE",
        },
        "attribute_id",
        resolved.tenant.tenantKey,
      );
    } else {
      await createTableRecord(
        PERSON_ATTRIBUTES_TAB,
        {
          attribute_id: `${resolved.tenant.tenantKey}-${personId}-birthday`,
          tenant_key: resolved.tenant.tenantKey,
          person_id: personId,
          attribute_type: "birthday",
          value_text: parsed.data.birth_date,
          value_json: "",
          label: "Birthday",
          is_primary: "TRUE",
          sort_order: "0",
          start_date: "",
          end_date: "",
          visibility: "family",
          notes: "",
        },
        resolved.tenant.tenantKey,
      );
    }
  }

  return NextResponse.json({ tenantKey: resolved.tenant.tenantKey, person });
}
