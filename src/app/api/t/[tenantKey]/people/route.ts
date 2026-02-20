import { NextResponse } from "next/server";
import { z } from "zod";
import { createTableRecord, getPeople } from "@/lib/google/sheets";
import { requireTenantAccess } from "@/lib/tenant/guard";
import { buildPersonId } from "@/lib/person/id";

type TenantPeopleRouteProps = {
  params: Promise<{ tenantKey: string }>;
};

export async function GET(_: Request, { params }: TenantPeopleRouteProps) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }
  const tenant = resolved.tenant;
  const people = await getPeople(tenant.tenantKey);
  return NextResponse.json({ tenantKey: tenant.tenantKey, count: people.length, items: people });
}

const createPersonSchema = z.object({
  display_name: z.string().trim().min(1).max(140),
  birth_date: z.string().trim().min(1).max(64),
  phones: z.string().trim().max(2000).optional().default(""),
  address: z.string().trim().max(2000).optional().default(""),
  hobbies: z.string().trim().max(2000).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
});

export async function POST(request: Request, { params }: TenantPeopleRouteProps) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }
  if (resolved.tenant.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = createPersonSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const personId = buildPersonId(parsed.data.display_name, parsed.data.birth_date);
  if (!personId) {
    return NextResponse.json({ error: "invalid_person_id", message: "birth_date must be parseable" }, { status: 400 });
  }

  const existing = await getPeople(resolved.tenant.tenantKey);
  if (existing.some((item) => item.personId === personId)) {
    return NextResponse.json({ error: "conflict", message: "Person already exists" }, { status: 409 });
  }

  const record = await createTableRecord(
    "People",
    {
      tenant_key: resolved.tenant.tenantKey,
      person_id: personId,
      display_name: parsed.data.display_name,
      birth_date: parsed.data.birth_date,
      phones: parsed.data.phones,
      address: parsed.data.address,
      hobbies: parsed.data.hobbies,
      notes: parsed.data.notes,
      photo_file_id: "",
      is_pinned: "FALSE",
      relationships: "",
    },
    resolved.tenant.tenantKey,
  );

  return NextResponse.json({ ok: true, tenantKey: resolved.tenant.tenantKey, person: record.data }, { status: 201 });
}
