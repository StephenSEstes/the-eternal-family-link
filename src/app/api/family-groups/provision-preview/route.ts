import { z } from "zod";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getPeople, getTableRecords } from "@/lib/data/runtime";
import { getRequestFamilyGroupContext } from "@/lib/family-group/context";

const payloadSchema = z.object({
  sourceFamilyGroupKey: z.string().trim().min(1).max(80).optional(),
  initialAdminPersonId: z.string().trim().min(1).max(120),
});

function readValue(record: Record<string, string>, ...keys: string[]) {
  const lowered = new Map(Object.entries(record).map(([key, value]) => [key.trim().toLowerCase(), value]));
  for (const key of keys) {
    const out = lowered.get(key.trim().toLowerCase());
    if (out !== undefined) {
      return out.trim();
    }
  }
  return "";
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const context = await getRequestFamilyGroupContext(session);
  if (context.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const sourceFamilyGroupKey = (parsed.data.sourceFamilyGroupKey ?? context.tenantKey).trim().toLowerCase();
  const sourceAccess = context.tenants.find((entry) => entry.tenantKey.trim().toLowerCase() === sourceFamilyGroupKey);
  if (!sourceAccess || sourceAccess.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden_source_family" }, { status: 403 });
  }

  const sourcePeopleRows = await getPeople(sourceFamilyGroupKey).catch(() => []);
  const sourcePeopleById = new Map(sourcePeopleRows.map((row) => [row.personId.trim(), row.displayName.trim() || row.personId.trim()]));

  const households = await getTableRecords("Households", sourceFamilyGroupKey).catch(() => []);
  const relationships = await getTableRecords("Relationships").catch(() => []);
  const candidateIds = new Set<string>();
  const spouseIds = new Set<string>();

  for (const row of households) {
    const partner1 = readValue(row.data, "husband_person_id");
    const partner2 = readValue(row.data, "wife_person_id");
    if (partner1 === parsed.data.initialAdminPersonId && partner2) {
      candidateIds.add(partner2);
      spouseIds.add(partner2);
    }
    if (partner2 === parsed.data.initialAdminPersonId && partner1) {
      candidateIds.add(partner1);
      spouseIds.add(partner1);
    }
  }

  for (const row of relationships) {
    const relType = readValue(row.data, "rel_type").toLowerCase();
    const fromPersonId = readValue(row.data, "from_person_id");
    const toPersonId = readValue(row.data, "to_person_id");
    if (
      relType === "parent" &&
      toPersonId &&
      (fromPersonId === parsed.data.initialAdminPersonId || spouseIds.has(fromPersonId))
    ) {
      candidateIds.add(toPersonId);
    }
  }

  candidateIds.delete(parsed.data.initialAdminPersonId);

  const householdImportCandidates = Array.from(candidateIds)
    .map((personId) => ({
      personId,
      displayName: sourcePeopleById.get(personId) ?? personId,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return NextResponse.json({
    ok: true,
    sourceFamilyGroupKey,
    initialAdminPersonId: parsed.data.initialAdminPersonId,
    householdImportCandidates,
  });
}
