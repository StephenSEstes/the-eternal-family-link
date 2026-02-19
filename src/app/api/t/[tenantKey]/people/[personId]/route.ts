import { NextResponse } from "next/server";
import { canEditPerson } from "@/lib/auth/permissions";
import { getAppSession } from "@/lib/auth/session";
import { getPersonById, updatePerson } from "@/lib/google/sheets";
import {
  getTenantContext,
  hasTenantAccess,
  normalizeTenantRouteKey,
} from "@/lib/tenant/context";
import { personUpdateSchema } from "@/lib/validation/person";

type TenantPersonRouteProps = {
  params: Promise<{ tenantKey: string; personId: string }>;
};

async function resolveTenantSession(tenantKey: string) {
  const session = await getAppSession();
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  }

  const normalized = normalizeTenantRouteKey(tenantKey);
  if (!hasTenantAccess(session, normalized)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) } as const;
  }

  return { session, tenant: getTenantContext(session, normalized) } as const;
}

export async function GET(_: Request, { params }: TenantPersonRouteProps) {
  const { tenantKey, personId } = await params;
  const resolved = await resolveTenantSession(tenantKey);
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
  const resolved = await resolveTenantSession(tenantKey);
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
