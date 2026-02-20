import { NextResponse } from "next/server";
import { canEditPerson } from "@/lib/auth/permissions";
import { getPersonById, updatePerson } from "@/lib/google/sheets";
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

  return NextResponse.json({ tenantKey: resolved.tenant.tenantKey, person });
}
