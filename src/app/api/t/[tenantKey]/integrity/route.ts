import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { createSheetsClient, createTableRecord, getTableRecords, getTenantConfig } from "@/lib/google/sheets";
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

function scoreUserAccessRow(data: Record<string, string>) {
  let score = 0;
  if (parseBool(readField(data, "google_access"))) score += 2;
  if (parseBool(readField(data, "local_access"))) score += 2;
  if (parseBool(readField(data, "is_enabled"))) score += 1;
  if (readField(data, "username")) score += 1;
  if (readField(data, "user_email")) score += 1;
  if (readField(data, "password_hash")) score += 1;
  return score;
}

async function resolveTenantScopedTabName(tabName: string, tenantKey: string) {
  const env = getEnv();
  const sheets = await createSheetsClient();
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: env.SHEET_ID,
    fields: "sheets.properties.title",
  });
  const titles =
    metadata.data.sheets
      ?.map((sheet) => sheet.properties?.title ?? "")
      .map((title) => title.trim())
      .filter(Boolean) ?? [];
  const byLower = new Map(titles.map((title) => [title.toLowerCase(), title]));
  const normalizedTenant = normalize(tenantKey);
  const candidates =
    normalizedTenant === "snowestes"
      ? [tabName]
      : [`${normalizedTenant}__${tabName}`, tabName];
  for (const candidate of candidates) {
    const match = byLower.get(candidate.toLowerCase());
    if (match) {
      return match;
    }
  }
  return null;
}

async function deleteRowsByNumber(tabName: string, rowNumbers: number[]) {
  if (rowNumbers.length === 0) {
    return 0;
  }

  const env = getEnv();
  const sheets = await createSheetsClient();
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: env.SHEET_ID,
    fields: "sheets.properties.sheetId,sheets.properties.title",
  });
  const target = metadata.data.sheets?.find(
    (sheet) => (sheet.properties?.title ?? "").trim().toLowerCase() === tabName.trim().toLowerCase(),
  );
  const sheetId = target?.properties?.sheetId;
  if (sheetId === undefined) {
    return 0;
  }

  const uniqueDescending = Array.from(new Set(rowNumbers.filter((rowNumber) => rowNumber >= 2))).sort((a, b) => b - a);
  if (uniqueDescending.length === 0) {
    return 0;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: env.SHEET_ID,
    requestBody: {
      requests: uniqueDescending.map((rowNumber) => ({
        deleteDimension: {
          range: {
            sheetId,
            dimension: "ROWS",
            startIndex: rowNumber - 1,
            endIndex: rowNumber,
          },
        },
      })),
    },
  });

  return uniqueDescending.length;
}

async function runIntegrityAudit(tenantKey: string) {
  const familyGroupKey = normalize(tenantKey);
  const [peopleRows, userAccessRows, userGroupRows, legacyLocalRows] = await Promise.all([
    getTableRecords("People", tenantKey).catch(() => []),
    getTableRecords("UserAccess").catch(() => []),
    getTableRecords("UserFamilyGroups").catch(() => []),
    getTableRecords("LocalUsers", tenantKey).catch(() => []),
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

  return {
    familyGroupKey,
    peopleRows,
    userAccessRows,
    userGroupRows,
    legacyLocalRows,
    peopleIds,
    filteredLinks,
    userAccessByPerson,
    linkByPerson,
    summary,
    findings,
  };
}

export async function GET(_: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }
  const report = await runIntegrityAudit(resolved.tenant.tenantKey);

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    generatedAt: new Date().toISOString(),
    summary: report.summary,
    findings: report.findings,
  });
}

export async function POST(_: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const familyGroupKey = resolved.tenant.tenantKey;
  const before = await runIntegrityAudit(familyGroupKey);
  const config = await getTenantConfig(familyGroupKey);

  let deletedDuplicateUserAccessRows = 0;
  const duplicateUserAccessRowNumbers: number[] = [];
  for (const rows of before.userAccessByPerson.values()) {
    if (rows.length <= 1) {
      continue;
    }
    const ranked = [...rows].sort((a, b) => {
      const scoreA = scoreUserAccessRow(a.data);
      const scoreB = scoreUserAccessRow(b.data);
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      return a.rowNumber - b.rowNumber;
    });
    const [, ...duplicates] = ranked;
    duplicateUserAccessRowNumbers.push(...duplicates.map((row) => row.rowNumber));
  }
  if (duplicateUserAccessRowNumbers.length > 0) {
    deletedDuplicateUserAccessRows = await deleteRowsByNumber("UserAccess", duplicateUserAccessRowNumbers);
  }

  let createdMissingLinks = 0;
  const missingLinksForPeopleWithAccess = Array.from(before.peopleIds).filter((personId) => {
    const hasAccess = (before.userAccessByPerson.get(personId) ?? []).length > 0;
    const hasLink = before.linkByPerson.has(personId);
    return hasAccess && !hasLink;
  });
  for (const personId of missingLinksForPeopleWithAccess) {
    const accessRows = before.userAccessByPerson.get(personId) ?? [];
    if (accessRows.length === 0) {
      continue;
    }
    const preferred = [...accessRows].sort((a, b) => scoreUserAccessRow(b.data) - scoreUserAccessRow(a.data))[0];
    const email =
      readField(preferred.data, "user_email").toLowerCase() ||
      `${readField(preferred.data, "username").toLowerCase() || personId}@local`;
    const role = readField(preferred.data, "role").toUpperCase() === "ADMIN" ? "ADMIN" : "USER";
    const enabled =
      parseBool(readField(preferred.data, "is_enabled")) ||
      parseBool(readField(preferred.data, "google_access")) ||
      parseBool(readField(preferred.data, "local_access"));

    await createTableRecord("UserFamilyGroups", {
      family_group_key: normalize(familyGroupKey),
      family_group_name: config.tenantName,
      user_email: email,
      role,
      person_id: personId,
      is_enabled: enabled ? "TRUE" : "FALSE",
    });
    createdMissingLinks += 1;
  }

  let deletedLegacyLocalUsersRows = 0;
  if (before.legacyLocalRows.length > 0) {
    const localUsersTab = await resolveTenantScopedTabName("LocalUsers", familyGroupKey);
    if (localUsersTab) {
      deletedLegacyLocalUsersRows = await deleteRowsByNumber(
        localUsersTab,
        before.legacyLocalRows.map((row) => row.rowNumber),
      );
    }
  }

  const after = await runIntegrityAudit(familyGroupKey);
  return NextResponse.json({
    ok: true,
    repairedAt: new Date().toISOString(),
    repaired: {
      deletedDuplicateUserAccessRows,
      createdMissingLinks,
      deletedLegacyLocalUsersRows,
    },
    before: before.summary,
    after: after.summary,
    findings: after.findings,
  });
}
