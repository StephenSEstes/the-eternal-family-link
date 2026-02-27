import { NextResponse } from "next/server";
import { createSheetsClient, readTabWithClient } from "@/lib/google/sheets";
import { requireTenantAdmin } from "@/lib/family-group/guard";

type AppRole = "ADMIN" | "USER";

type AccessItem = {
  userEmail: string;
  role: AppRole;
  personId: string;
  isEnabled: boolean;
};

type LocalUserItem = {
  username: string;
  role: AppRole;
  personId: string;
  isEnabled: boolean;
  failedAttempts: number;
  lockedUntil: string;
  mustChangePassword: boolean;
};

type PersonItem = {
  personId: string;
  displayName: string;
};

type SecurityPolicy = {
  minLength: number;
  requireNumber: boolean;
  requireUppercase: boolean;
  requireLowercase: boolean;
  lockoutAttempts: number;
};

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function parseBool(value: string | undefined) {
  const out = normalize(value);
  return out === "true" || out === "yes" || out === "1";
}

function parseIntSafe(value: string | undefined, fallback: number) {
  const out = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(out) ? out : fallback;
}

function toRole(value: string | undefined): AppRole {
  return normalize(value) === "admin" ? "ADMIN" : "USER";
}

function buildIndex(headers: string[]) {
  const map = new Map<string, number>();
  headers.forEach((header, index) => {
    const key = normalize(header);
    if (!map.has(key)) {
      map.set(key, index);
    }
  });
  return map;
}

function readCell(row: string[], index: Map<string, number>, key: string) {
  const idx = index.get(normalize(key));
  if (idx === undefined) {
    return "";
  }
  return String(row[idx] ?? "");
}

const DEFAULT_POLICY: SecurityPolicy = {
  minLength: 8,
  requireNumber: true,
  requireUppercase: false,
  requireLowercase: true,
  lockoutAttempts: 5,
};

export async function GET(_: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }
  const selectedFamilyKey = normalize(resolved.tenant.tenantKey);

  try {
    const sheets = await createSheetsClient();
    const [userAccessMatrix, userFamilyGroupsMatrix, peopleMatrix, personFamilyGroupsMatrix, policyMatrix] =
      await Promise.all([
        readTabWithClient(sheets, "UserAccess"),
        readTabWithClient(sheets, "UserFamilyGroups"),
        readTabWithClient(sheets, "People"),
        readTabWithClient(sheets, "PersonFamilyGroups"),
        readTabWithClient(sheets, "FamilySecurityPolicy"),
      ]);

    const peopleIdx = buildIndex(peopleMatrix.headers);
    const peopleById = new Map<string, PersonItem>();
    for (const row of peopleMatrix.rows) {
      const personId = readCell(row, peopleIdx, "person_id").trim();
      if (!personId || peopleById.has(personId)) {
        continue;
      }
      peopleById.set(personId, {
        personId,
        displayName: readCell(row, peopleIdx, "display_name").trim() || personId,
      });
    }

    const personFamilyIdx = buildIndex(personFamilyGroupsMatrix.headers);
    const enabledPersonIds = new Set<string>();
    for (const row of personFamilyGroupsMatrix.rows) {
      const familyKey = normalize(readCell(row, personFamilyIdx, "family_group_key"));
      if (familyKey !== selectedFamilyKey) {
        continue;
      }
      const personId = readCell(row, personFamilyIdx, "person_id").trim();
      if (!personId) {
        continue;
      }
      const enabledRaw = readCell(row, personFamilyIdx, "is_enabled").trim();
      if (!enabledRaw || parseBool(enabledRaw)) {
        enabledPersonIds.add(personId);
      }
    }
    const people = Array.from(enabledPersonIds)
      .map((personId) => peopleById.get(personId) ?? { personId, displayName: personId })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    const userAccessIdx = buildIndex(userAccessMatrix.headers);
    const userAccessByPerson = new Map<string, string[]>();
    for (const row of userAccessMatrix.rows) {
      const personId = readCell(row, userAccessIdx, "person_id").trim();
      if (!personId || userAccessByPerson.has(personId)) {
        continue;
      }
      userAccessByPerson.set(personId, row);
    }

    const userFamilyIdx = buildIndex(userFamilyGroupsMatrix.headers);
    const accessItems: AccessItem[] = [];
    const allowedForLocal = new Set<string>();
    const seenAccessPeople = new Set<string>();
    for (const row of userFamilyGroupsMatrix.rows) {
      const familyKey = normalize(readCell(row, userFamilyIdx, "family_group_key"));
      if (familyKey !== selectedFamilyKey) {
        continue;
      }
      const personId = readCell(row, userFamilyIdx, "person_id").trim();
      if (!personId) {
        continue;
      }
      const linkEnabled = parseBool(readCell(row, userFamilyIdx, "is_enabled"));
      if (linkEnabled) {
        allowedForLocal.add(personId);
      }
      if (seenAccessPeople.has(personId)) {
        continue;
      }
      seenAccessPeople.add(personId);
      const userRow = userAccessByPerson.get(personId);
      const userEmail = (
        (userRow ? readCell(userRow, userAccessIdx, "user_email") : "") || readCell(row, userFamilyIdx, "user_email")
      )
        .trim()
        .toLowerCase();
      const googleEnabled = userRow ? parseBool(readCell(userRow, userAccessIdx, "google_access")) : false;
      accessItems.push({
        userEmail,
        role: userRow ? toRole(readCell(userRow, userAccessIdx, "role")) : toRole(readCell(row, userFamilyIdx, "role")),
        personId,
        isEnabled: googleEnabled,
      });
    }
    accessItems.sort((a, b) => {
      if (a.userEmail && b.userEmail) {
        return a.userEmail.localeCompare(b.userEmail);
      }
      if (a.userEmail) return -1;
      if (b.userEmail) return 1;
      return a.personId.localeCompare(b.personId);
    });

    const localUsers: LocalUserItem[] = [];
    for (const row of userAccessMatrix.rows) {
      const personId = readCell(row, userAccessIdx, "person_id").trim();
      if (!personId || !allowedForLocal.has(personId)) {
        continue;
      }
      if (!parseBool(readCell(row, userAccessIdx, "local_access"))) {
        continue;
      }
      const username = readCell(row, userAccessIdx, "username").trim().toLowerCase();
      if (!username) {
        continue;
      }
      localUsers.push({
        username,
        role: toRole(readCell(row, userAccessIdx, "role")),
        personId,
        isEnabled: parseBool(readCell(row, userAccessIdx, "is_enabled")),
        failedAttempts: parseIntSafe(readCell(row, userAccessIdx, "failed_attempts"), 0),
        lockedUntil: readCell(row, userAccessIdx, "locked_until"),
        mustChangePassword: parseBool(readCell(row, userAccessIdx, "must_change_password")),
      });
    }
    localUsers.sort((a, b) => a.username.localeCompare(b.username));

    const policyIdx = buildIndex(policyMatrix.headers);
    const policyRow =
      policyMatrix.rows.find((row) => normalize(readCell(row, policyIdx, "family_group_key")) === selectedFamilyKey) ??
      policyMatrix.rows[0] ??
      [];
    const policy: SecurityPolicy = {
      minLength: parseIntSafe(readCell(policyRow, policyIdx, "min_length"), DEFAULT_POLICY.minLength),
      requireNumber: parseBool(readCell(policyRow, policyIdx, "require_number")),
      requireUppercase: parseBool(readCell(policyRow, policyIdx, "require_uppercase")),
      requireLowercase: parseBool(readCell(policyRow, policyIdx, "require_lowercase")),
      lockoutAttempts: parseIntSafe(readCell(policyRow, policyIdx, "lockout_attempts"), DEFAULT_POLICY.lockoutAttempts),
    };

    return NextResponse.json({
      tenantKey: resolved.tenant.tenantKey,
      accessItems,
      localUsers,
      people,
      policy,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "admin_snapshot_failed";
    return NextResponse.json({ error: "admin_snapshot_failed", message }, { status: 503 });
  }
}

