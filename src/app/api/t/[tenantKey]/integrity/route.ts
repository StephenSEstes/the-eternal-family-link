import { NextResponse } from "next/server";
import { getTableRecords } from "@/lib/google/sheets";
import { requireTenantAdmin } from "@/lib/family-group/guard";

type IntegritySeverity = "error" | "warn";

type IntegrityFinding = {
  severity: IntegritySeverity;
  code: string;
  message: string;
  count: number;
  sample: string[];
};

function readField(record: Record<string, string>, key: string) {
  return (record[key] ?? "").trim();
}

function parseBool(value: string) {
  const out = value.trim().toLowerCase();
  return out === "true" || out === "yes" || out === "1";
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function pushFinding(
  findings: IntegrityFinding[],
  severity: IntegritySeverity,
  code: string,
  message: string,
  keys: string[],
) {
  if (keys.length === 0) {
    return;
  }
  findings.push({
    severity,
    code,
    message,
    count: keys.length,
    sample: keys.slice(0, 10),
  });
}

export async function GET(_: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const familyGroupKey = normalize(resolved.tenant.tenantKey);
  const [peopleRows, userAccessRows, userGroupRows, legacyLocalRows] = await Promise.all([
    getTableRecords("People", resolved.tenant.tenantKey).catch(() => []),
    getTableRecords("UserAccess").catch(() => []),
    getTableRecords("UserFamilyGroups").catch(() => []),
    getTableRecords("LocalUsers", resolved.tenant.tenantKey).catch(() => []),
  ]);

  const peopleIds = new Set(
    peopleRows
      .map((row) => readField(row.data, "person_id"))
      .filter(Boolean)
      .map((id) => normalize(id)),
  );

  const filteredLinks = userGroupRows.filter(
    (row) => normalize(readField(row.data, "family_group_key")) === familyGroupKey,
  );
  const userAccessByPerson = new Map<string, { rowNumber: number; data: Record<string, string> }[]>();
  const localAccessByUsername = new Map<string, { rowNumber: number; data: Record<string, string> }[]>();
  for (const row of userAccessRows) {
    const personId = normalize(readField(row.data, "person_id"));
    if (personId) {
      const list = userAccessByPerson.get(personId) ?? [];
      list.push(row);
      userAccessByPerson.set(personId, list);
    }
    const username = normalize(readField(row.data, "username"));
    const hasLocal = parseBool(readField(row.data, "local_access"));
    if (username && hasLocal) {
      const list = localAccessByUsername.get(username) ?? [];
      list.push(row);
      localAccessByUsername.set(username, list);
    }
  }

  const findings: IntegrityFinding[] = [];

  const dupUserAccessPerson = Array.from(userAccessByPerson.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([personId]) => personId);
  pushFinding(
    findings,
    "error",
    "duplicate_useraccess_person",
    "Duplicate UserAccess rows for same person_id.",
    dupUserAccessPerson,
  );

  const dupLocalUsername = Array.from(localAccessByUsername.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([username]) => username);
  pushFinding(
    findings,
    "error",
    "duplicate_local_username",
    "Duplicate local-access usernames in UserAccess.",
    dupLocalUsername,
  );

  const linkByPerson = new Map<string, { rowNumber: number; data: Record<string, string> }[]>();
  for (const row of filteredLinks) {
    const personId = normalize(readField(row.data, "person_id"));
    if (!personId) {
      continue;
    }
    const list = linkByPerson.get(personId) ?? [];
    list.push(row);
    linkByPerson.set(personId, list);
  }
  const dupLinks = Array.from(linkByPerson.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([personId]) => personId);
  pushFinding(
    findings,
    "error",
    "duplicate_userfamilygroups_person",
    "Duplicate UserFamilyGroups links for same person_id within this family group.",
    dupLinks,
  );

  const orphanLinks = filteredLinks
    .map((row) => normalize(readField(row.data, "person_id")))
    .filter(Boolean)
    .filter((personId) => !peopleIds.has(personId));
  pushFinding(
    findings,
    "warn",
    "orphan_userfamilygroups_person",
    "UserFamilyGroups links with person_id not found in People for this family group.",
    Array.from(new Set(orphanLinks)),
  );

  const linksMissingAccess = filteredLinks
    .map((row) => normalize(readField(row.data, "person_id")))
    .filter(Boolean)
    .filter((personId) => (userAccessByPerson.get(personId) ?? []).length === 0);
  pushFinding(
    findings,
    "warn",
    "missing_useraccess_for_link",
    "UserFamilyGroups links where matching person has no UserAccess row.",
    Array.from(new Set(linksMissingAccess)),
  );

  const peopleMissingLinks = Array.from(peopleIds).filter((personId) => !linkByPerson.has(personId));
  pushFinding(
    findings,
    "warn",
    "people_missing_userfamilygroups_link",
    "People rows with no UserFamilyGroups link for this family group.",
    peopleMissingLinks,
  );

  if (legacyLocalRows.length > 0) {
    findings.push({
      severity: "warn",
      code: "legacy_localusers_rows_present",
      message: "Legacy LocalUsers rows still exist and should be retired.",
      count: legacyLocalRows.length,
      sample: legacyLocalRows.slice(0, 10).map((row) => `${row.rowNumber}`),
    });
  }

  const errorCount = findings.filter((item) => item.severity === "error").length;
  const warnCount = findings.filter((item) => item.severity === "warn").length;
  const summary = {
    status: errorCount > 0 ? "error" : warnCount > 0 ? "warn" : "ok",
    errorCount,
    warnCount,
    peopleCount: peopleRows.length,
    userAccessCount: userAccessRows.length,
    userFamilyGroupCount: filteredLinks.length,
    legacyLocalUsersCount: legacyLocalRows.length,
  };

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    generatedAt: new Date().toISOString(),
    summary,
    findings,
  });
}
