import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createTableRecord,
  ensurePersonFamilyGroupMembership,
  getPersonById,
  getPeople,
  PERSON_ATTRIBUTES_TAB,
} from "@/lib/google/sheets";
import { requireTenantAccess } from "@/lib/family-group/guard";
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
  first_name: z.string().trim().min(1).max(80),
  middle_name: z.string().trim().max(80).optional().default(""),
  last_name: z.string().trim().min(1).max(80),
  nick_name: z.string().trim().max(80).optional().default(""),
  display_name: z.string().trim().max(140).optional().default(""),
  birth_date: z.string().trim().min(1).max(64),
  gender: z.enum(["male", "female", "unspecified"]).optional().default("unspecified"),
  phones: z.string().trim().max(2000).optional().default(""),
  address: z.string().trim().max(2000).optional().default(""),
  hobbies: z.string().trim().max(2000).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
});

function composeDisplayName(firstName: string, middleName: string, lastName: string) {
  return [firstName, middleName, lastName].filter((part) => part.trim()).join(" ").trim();
}

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

  const fullName = composeDisplayName(parsed.data.first_name, parsed.data.middle_name, parsed.data.last_name);
  const displayName = parsed.data.display_name.trim() || fullName;
  const personId = buildPersonId(fullName, parsed.data.birth_date);
  if (!personId) {
    return NextResponse.json({ error: "invalid_person_id", message: "birth_date must be parseable" }, { status: 400 });
  }

  const existingInFamily = await getPeople(resolved.tenant.tenantKey);
  if (existingInFamily.some((item) => item.personId === personId)) {
    return NextResponse.json({ error: "conflict", message: "Person already exists in this family group" }, { status: 409 });
  }

  const existingGlobal = await getPersonById(personId);
  let record:
    | {
        data: Record<string, string>;
      }
    | null = null;
  if (existingGlobal) {
    await ensurePersonFamilyGroupMembership(personId, resolved.tenant.tenantKey, true);
    record = {
      data: {
        person_id: existingGlobal.personId,
        display_name: existingGlobal.displayName,
        first_name: existingGlobal.firstName,
        middle_name: existingGlobal.middleName,
        last_name: existingGlobal.lastName,
        nick_name: existingGlobal.nickName,
        birth_date: existingGlobal.birthDate,
        gender: existingGlobal.gender,
        phones: existingGlobal.phones,
        address: existingGlobal.address,
        hobbies: existingGlobal.hobbies,
        notes: existingGlobal.notes,
        photo_file_id: existingGlobal.photoFileId,
        is_pinned: existingGlobal.isPinned ? "TRUE" : "FALSE",
      },
    };
  } else {
    record = await createTableRecord(
      "People",
      {
        person_id: personId,
        display_name: displayName,
        first_name: parsed.data.first_name,
        middle_name: parsed.data.middle_name,
        last_name: parsed.data.last_name,
        nick_name: parsed.data.nick_name,
        birth_date: parsed.data.birth_date,
        gender: parsed.data.gender,
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
    await ensurePersonFamilyGroupMembership(personId, resolved.tenant.tenantKey, true);
  }

  await createTableRecord(
    PERSON_ATTRIBUTES_TAB,
    {
      attribute_id: `${resolved.tenant.tenantKey}-${personId}-birthday`,
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
      share_scope: "both_families",
      share_family_group_key: "",
      notes: "",
    },
    resolved.tenant.tenantKey,
  );

  return NextResponse.json({ ok: true, tenantKey: resolved.tenant.tenantKey, person: record.data }, { status: 201 });
}
