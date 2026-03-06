import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { google, sheets_v4 } from "googleapis";
import { authOptions } from "@/lib/auth/options";
import { getEnv } from "@/lib/env";
import { getServiceAccountAuth } from "@/lib/google/auth";
import { buildUniqueEntityId, isTypedEntityId } from "@/lib/entity-id";
import { getTenantAccesses } from "@/lib/family-group/context";

type Matrix = {
  headers: string[];
  rows: string[][];
};

type IdMap = Map<string, string>;

function normalizeHeader(value: string) {
  return value.trim().toLowerCase();
}

function headerIndex(headers: string[]) {
  const out = new Map<string, number>();
  headers.forEach((header, idx) => out.set(normalizeHeader(header), idx));
  return out;
}

function getCell(row: string[], idx: Map<string, number>, key: string) {
  const col = idx.get(normalizeHeader(key));
  if (col === undefined) return "";
  return (row[col] ?? "").trim();
}

function setCell(row: string[], idx: Map<string, number>, key: string, value: string) {
  const col = idx.get(normalizeHeader(key));
  if (col === undefined) return;
  row[col] = value;
}

function toFullName(row: string[], idx: Map<string, number>) {
  const explicit = getCell(row, idx, "display_name");
  if (explicit) return explicit;
  return [getCell(row, idx, "first_name"), getCell(row, idx, "middle_name"), getCell(row, idx, "last_name")]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function toDateToken(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed.toLowerCase();
  }
  return parsed.toISOString().slice(0, 10);
}

async function readTab(sheets: sheets_v4.Sheets, tabName: string): Promise<Matrix | null> {
  const env = getEnv();
  const values = await sheets.spreadsheets.values
    .get({
      spreadsheetId: env.SHEET_ID,
      range: `${tabName}!A1:ZZ`,
    })
    .catch(() => null);
  if (!values?.data?.values || values.data.values.length === 0) {
    return null;
  }
  const [headers, ...rows] = values.data.values as string[][];
  return { headers, rows };
}

async function writeTab(sheets: sheets_v4.Sheets, tabName: string, matrix: Matrix) {
  const env = getEnv();
  await sheets.spreadsheets.values.update({
    spreadsheetId: env.SHEET_ID,
    range: `${tabName}!A1:ZZ`,
    valueInputOption: "RAW",
    requestBody: {
      values: [matrix.headers, ...matrix.rows],
    },
  });
}

function remapPersonId(value: string, personMap: IdMap) {
  const key = value.trim();
  if (!key) return "";
  return personMap.get(key) ?? key;
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const hasAdmin = (session.user.role ?? "USER") === "ADMIN" || getTenantAccesses(session).some((entry) => entry.role === "ADMIN");
  if (!hasAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") !== "0";
  const payload = (await request.json().catch(() => ({}))) as { confirm?: string };
  if (!dryRun && payload.confirm !== "MIGRATE_ENTITY_IDS") {
    return NextResponse.json(
      { error: "confirmation_required", message: "Pass {\"confirm\":\"MIGRATE_ENTITY_IDS\"} with dryRun=0." },
      { status: 400 },
    );
  }

  const sheets = google.sheets({ version: "v4", auth: getServiceAccountAuth() });
  const tabs = await Promise.all([
    readTab(sheets, "People"),
    readTab(sheets, "Relationships"),
    readTab(sheets, "Households"),
    readTab(sheets, "Attributes"),
    readTab(sheets, "ImportantDates"),
    readTab(sheets, "PersonFamilyGroups"),
    readTab(sheets, "UserAccess"),
    readTab(sheets, "UserFamilyGroups"),
    readTab(sheets, "AuditLog"),
  ]);

  const [people, relationships, households, attributes, dates, personFamilyGroups, userAccess, userFamilyGroups, auditLog] = tabs;
  if (!people) {
    return NextResponse.json({ error: "people_tab_missing" }, { status: 400 });
  }

  const personMap: IdMap = new Map();
  const relationshipMap: IdMap = new Map();
  const householdMap: IdMap = new Map();
  const attributeMap: IdMap = new Map();
  const dateMap: IdMap = new Map();
  const usedPerson = new Set<string>();
  const usedRel = new Set<string>();
  const usedHouse = new Set<string>();
  const usedAttr = new Set<string>();
  const usedDate = new Set<string>();

  const peopleIdx = headerIndex(people.headers);
  people.rows.forEach((row, rowIdx) => {
    const oldPersonId = getCell(row, peopleIdx, "person_id");
    if (!oldPersonId) return;
    const fullName = toFullName(row, peopleIdx);
    const birthDate = toDateToken(getCell(row, peopleIdx, "birth_date"));
    const seed = `${birthDate}|${fullName.toLowerCase()}|${oldPersonId}|${rowIdx + 2}`;
    const nextId = isTypedEntityId(oldPersonId, "p")
      ? oldPersonId.toLowerCase()
      : buildUniqueEntityId("p", seed, usedPerson);
    personMap.set(oldPersonId, nextId);
    setCell(row, peopleIdx, "person_id", nextId);
  });

  if (relationships) {
    const idx = headerIndex(relationships.headers);
    relationships.rows.forEach((row, rowIdx) => {
      const oldId = getCell(row, idx, "rel_id") || getCell(row, idx, "relationship_id") || getCell(row, idx, "id");
      const from = remapPersonId(getCell(row, idx, "from_person_id"), personMap);
      const to = remapPersonId(getCell(row, idx, "to_person_id"), personMap);
      const relType = (getCell(row, idx, "rel_type") || "related").toLowerCase();
      const seed = `${from}|${to}|${relType}|${oldId}|${rowIdx + 2}`;
      const nextId = oldId && isTypedEntityId(oldId, "rel")
        ? oldId.toLowerCase()
        : buildUniqueEntityId("rel", seed, usedRel);
      if (oldId) relationshipMap.set(oldId, nextId);
      setCell(row, idx, "from_person_id", from);
      setCell(row, idx, "to_person_id", to);
      setCell(row, idx, "rel_id", nextId);
      setCell(row, idx, "relationship_id", nextId);
      setCell(row, idx, "id", nextId);
    });
  }

  if (households) {
    const idx = headerIndex(households.headers);
    households.rows.forEach((row, rowIdx) => {
      const oldId = getCell(row, idx, "household_id") || getCell(row, idx, "id");
      const tenantKey = getCell(row, idx, "family_group_key") || "default";
      const husband = remapPersonId(getCell(row, idx, "husband_person_id"), personMap);
      const wife = remapPersonId(getCell(row, idx, "wife_person_id"), personMap);
      const pair = [husband, wife].sort().join("|");
      const seed = `${tenantKey}|${pair}|${oldId}|${rowIdx + 2}`;
      const nextId = oldId && isTypedEntityId(oldId, "h")
        ? oldId.toLowerCase()
        : buildUniqueEntityId("h", seed, usedHouse);
      if (oldId) householdMap.set(oldId, nextId);
      setCell(row, idx, "household_id", nextId);
      setCell(row, idx, "husband_person_id", husband);
      setCell(row, idx, "wife_person_id", wife);
    });
  }

  if (attributes) {
    const idx = headerIndex(attributes.headers);
    attributes.rows.forEach((row, rowIdx) => {
      const oldId = getCell(row, idx, "attribute_id");
      const personId = remapPersonId(getCell(row, idx, "person_id") || getCell(row, idx, "entity_id"), personMap);
      const attributeType = (getCell(row, idx, "attribute_type") || getCell(row, idx, "type_key")).toLowerCase();
      const label = getCell(row, idx, "label").toLowerCase();
      const seed = `${personId}|${attributeType}|${label}|${oldId}|${rowIdx + 2}`;
      const nextId = oldId && isTypedEntityId(oldId, "attr")
        ? oldId.toLowerCase()
        : buildUniqueEntityId("attr", seed, usedAttr);
      if (oldId) attributeMap.set(oldId, nextId);
      setCell(row, idx, "attribute_id", nextId);
      setCell(row, idx, "person_id", personId);
      setCell(row, idx, "entity_type", "person");
      setCell(row, idx, "entity_id", personId);
      setCell(row, idx, "attribute_type", attributeType);
      setCell(row, idx, "type_key", attributeType);
    });
  }

  if (dates) {
    const idx = headerIndex(dates.headers);
    dates.rows.forEach((row, rowIdx) => {
      const oldId = getCell(row, idx, "id");
      const personId = remapPersonId(getCell(row, idx, "person_id"), personMap);
      const date = getCell(row, idx, "date").toLowerCase();
      const title = getCell(row, idx, "title").toLowerCase();
      const seed = `${date}|${title}|${personId}|${oldId}|${rowIdx + 2}`;
      const nextId = oldId && isTypedEntityId(oldId, "date")
        ? oldId.toLowerCase()
        : buildUniqueEntityId("date", seed, usedDate);
      if (oldId) dateMap.set(oldId, nextId);
      setCell(row, idx, "id", nextId);
      setCell(row, idx, "person_id", personId);
    });
  }

  for (const matrix of [personFamilyGroups, userAccess, userFamilyGroups]) {
    if (!matrix) continue;
    const idx = headerIndex(matrix.headers);
    matrix.rows.forEach((row) => {
      const personId = getCell(row, idx, "person_id");
      if (!personId) return;
      setCell(row, idx, "person_id", remapPersonId(personId, personMap));
    });
  }

  if (auditLog) {
    const idx = headerIndex(auditLog.headers);
    auditLog.rows.forEach((row) => {
      const actorPersonId = getCell(row, idx, "actor_person_id");
      if (actorPersonId) {
        setCell(row, idx, "actor_person_id", remapPersonId(actorPersonId, personMap));
      }
      const entityType = getCell(row, idx, "entity_type").toUpperCase();
      const entityId = getCell(row, idx, "entity_id");
      if (!entityId) return;
      if (entityType === "PERSON") setCell(row, idx, "entity_id", personMap.get(entityId) ?? entityId);
      if (entityType === "RELATIONSHIP") setCell(row, idx, "entity_id", relationshipMap.get(entityId) ?? entityId);
      if (entityType === "HOUSEHOLD") setCell(row, idx, "entity_id", householdMap.get(entityId) ?? entityId);
      if (entityType === "PERSON_ATTRIBUTE") setCell(row, idx, "entity_id", attributeMap.get(entityId) ?? entityId);
      if (entityType === "IMPORTANT_DATE") setCell(row, idx, "entity_id", dateMap.get(entityId) ?? entityId);
    });
  }

  const summary = {
    dryRun,
    peopleRemapped: personMap.size,
    relationshipsRemapped: relationshipMap.size,
    householdsRemapped: householdMap.size,
    attributesRemapped: attributeMap.size,
    importantDatesRemapped: dateMap.size,
    sample: {
      people: Array.from(personMap.entries()).slice(0, 8),
      relationships: Array.from(relationshipMap.entries()).slice(0, 8),
      households: Array.from(householdMap.entries()).slice(0, 8),
    },
  };

  if (dryRun) {
    return NextResponse.json({ ok: true, summary });
  }

  await writeTab(sheets, "People", people);
  if (relationships) await writeTab(sheets, "Relationships", relationships);
  if (households) await writeTab(sheets, "Households", households);
  if (attributes) await writeTab(sheets, "Attributes", attributes);
  if (dates) await writeTab(sheets, "ImportantDates", dates);
  if (personFamilyGroups) await writeTab(sheets, "PersonFamilyGroups", personFamilyGroups);
  if (userAccess) await writeTab(sheets, "UserAccess", userAccess);
  if (userFamilyGroups) await writeTab(sheets, "UserFamilyGroups", userFamilyGroups);
  if (auditLog) await writeTab(sheets, "AuditLog", auditLog);

  return NextResponse.json({ ok: true, summary });
}
