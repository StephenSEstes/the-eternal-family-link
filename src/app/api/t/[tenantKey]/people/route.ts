import { NextResponse } from "next/server";
import { z } from "zod";
import {
  appendAuditLog,
  createTableRecord,
  ensurePersonFamilyGroupMembership,
  ensureResolvedTabColumns,
  getPersonById,
  getPeople,
  PERSON_ATTRIBUTES_TAB,
} from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { buildEntityId } from "@/lib/entity-id";
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
  maiden_name: z.string().trim().max(80).optional().default(""),
  nick_name: z.string().trim().max(80).optional().default(""),
  display_name: z.string().trim().max(140).optional().default(""),
  birth_date: z.string().trim().min(1).max(64),
  gender: z.enum(["male", "female", "unspecified"]).optional().default("unspecified"),
  phones: z.string().trim().max(2000).optional().default(""),
  email: z.string().trim().max(320).optional().default(""),
  address: z.string().trim().max(2000).optional().default(""),
  hobbies: z.string().trim().max(2000).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
  allow_duplicate_similar: z.boolean().optional().default(false),
});

function composeDisplayName(firstName: string, middleName: string, lastName: string) {
  return [firstName, middleName, lastName].filter((part) => part.trim()).join(" ").trim();
}

function normalizeDateKey(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed.toLowerCase();
  }
  return parsed.toISOString().slice(0, 10);
}

function normalizeName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toBigrams(value: string) {
  const compact = value.replace(/\s+/g, " ");
  if (compact.length < 2) {
    return compact ? [compact] : [];
  }
  const grams: string[] = [];
  for (let idx = 0; idx < compact.length - 1; idx += 1) {
    grams.push(compact.slice(idx, idx + 2));
  }
  return grams;
}

function diceSimilarity(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const gramsA = toBigrams(a);
  const gramsB = toBigrams(b);
  if (gramsA.length === 0 || gramsB.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const gram of gramsA) {
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  let overlap = 0;
  for (const gram of gramsB) {
    const count = counts.get(gram) ?? 0;
    if (count > 0) {
      overlap += 1;
      counts.set(gram, count - 1);
    }
  }
  return (2 * overlap) / (gramsA.length + gramsB.length);
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

  const birthDateKey = normalizeDateKey(parsed.data.birth_date);
  const inputFullName = normalizeName(fullName);
  const inputFirstLast = normalizeName(`${parsed.data.first_name} ${parsed.data.last_name}`);
  const sameBirthCandidates = existingInFamily.filter(
    (person) => normalizeDateKey(person.birthDate) === birthDateKey,
  );
  const exactNameMatches = sameBirthCandidates.filter((person) => {
    const personFull = normalizeName(
      composeDisplayName(person.firstName ?? "", person.middleName ?? "", person.lastName ?? "") || person.displayName,
    );
    const personFirstLast = normalizeName(`${person.firstName ?? ""} ${person.lastName ?? ""}`.trim());
    return Boolean(
      (personFull && personFull === inputFullName) ||
      (personFirstLast && personFirstLast === inputFirstLast),
    );
  });
  if (exactNameMatches.length > 0) {
    return NextResponse.json(
      {
        error: "duplicate_exact_birthdate_name",
        message: "A person with the same name and birthdate already exists. Please contact your system administrator.",
        matches: exactNameMatches.slice(0, 5).map((person) => ({
          personId: person.personId,
          displayName: person.displayName,
          birthDate: person.birthDate,
        })),
      },
      { status: 409 },
    );
  }
  const similarNameMatches = sameBirthCandidates.filter((person) => {
    const personFull = normalizeName(
      composeDisplayName(person.firstName ?? "", person.middleName ?? "", person.lastName ?? "") || person.displayName,
    );
    const personFirstLast = normalizeName(`${person.firstName ?? ""} ${person.lastName ?? ""}`.trim());
    const fullScore = diceSimilarity(inputFullName, personFull);
    const firstLastScore = diceSimilarity(inputFirstLast, personFirstLast || personFull);
    return fullScore >= 0.76 || firstLastScore >= 0.82;
  });
  if (similarNameMatches.length > 0 && !parsed.data.allow_duplicate_similar) {
    return NextResponse.json(
      {
        error: "duplicate_similar_birthdate_name",
        message:
          "Possible duplicate found (same birthdate, similar name). Use existing if this is the same person, or confirm Add New to continue.",
        matches: similarNameMatches.slice(0, 8).map((person) => ({
          personId: person.personId,
          displayName: person.displayName,
          birthDate: person.birthDate,
        })),
      },
      { status: 409 },
    );
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
        maiden_name: existingGlobal.maidenName,
        nick_name: existingGlobal.nickName,
        birth_date: existingGlobal.birthDate,
        gender: existingGlobal.gender,
        phones: existingGlobal.phones,
        email: existingGlobal.email,
        address: existingGlobal.address,
        hobbies: existingGlobal.hobbies,
        notes: existingGlobal.notes,
        photo_file_id: existingGlobal.photoFileId,
        is_pinned: existingGlobal.isPinned ? "TRUE" : "FALSE",
      },
    };
  } else {
    await ensureResolvedTabColumns("People", ["email", "maiden_name"], resolved.tenant.tenantKey);
    record = await createTableRecord(
      "People",
      {
        person_id: personId,
        display_name: displayName,
        first_name: parsed.data.first_name,
        middle_name: parsed.data.middle_name,
        last_name: parsed.data.last_name,
        maiden_name: parsed.data.maiden_name,
        nick_name: parsed.data.nick_name,
        birth_date: parsed.data.birth_date,
        gender: parsed.data.gender,
        phones: parsed.data.phones,
        email: parsed.data.email,
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
      attribute_id: buildEntityId("attr", `${resolved.tenant.tenantKey}|${personId}|birthday`),
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

  await appendAuditLog({
    actorEmail: resolved.session.user?.email ?? "",
    actorPersonId: resolved.session.user?.person_id ?? "",
    action: "CREATE",
    entityType: "PERSON",
    entityId: personId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `Created person ${displayName}.`,
  }).catch(() => undefined);

  return NextResponse.json({ ok: true, tenantKey: resolved.tenant.tenantKey, person: record.data }, { status: 201 });
}
