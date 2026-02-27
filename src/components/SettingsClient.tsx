"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type AccessItem = {
  userEmail: string;
  role: "ADMIN" | "USER";
  personId: string;
  isEnabled: boolean;
};

type TenantOption = {
  tenantKey: string;
  tenantName: string;
  role: "ADMIN" | "USER";
};

type LocalUserItem = {
  username: string;
  role: "ADMIN" | "USER";
  personId: string;
  isEnabled: boolean;
  failedAttempts: number;
  lockedUntil: string;
  mustChangePassword: boolean;
};

type SecurityPolicy = {
  minLength: number;
  requireNumber: boolean;
  requireUppercase: boolean;
  requireLowercase: boolean;
  lockoutAttempts: number;
};

type IntegrityFinding = {
  severity: "error" | "warn";
  code: string;
  message: string;
  count: number;
  sample: string[];
};

type IntegrityReport = {
  tenantKey: string;
  generatedAt: string;
  summary: {
    status: "ok" | "warn" | "error";
    errorCount: number;
    warnCount: number;
    peopleCount: number;
    userAccessCount: number;
    userFamilyGroupCount: number;
    legacyLocalUsersCount: number;
  };
  findings: IntegrityFinding[];
};

type SettingsClientProps = {
  tenantKey: string;
  tenantName: string;
  tenantOptions: TenantOption[];
  accessItems: AccessItem[];
  people: { personId: string; displayName: string }[];
};

type ExistingPersonOption = {
  personId: string;
  displayName: string;
  sourceTenantKey: string;
  sourceTenantName: string;
};

type HouseholdImportCandidate = {
  personId: string;
  displayName: string;
};

type SettingsTab = "family_groups" | "user_admin" | "integrity" | "import";
type UserAdminSubTab = "directory" | "password_policy";
type FamilyGroupsSubTab = "overview" | "create_group";
type ImportSubTab = "target" | "csv";

const CSV_TEMPLATES: Record<string, string> = {
  people: "display_name,birth_date,phones,address,hobbies,notes,photo_file_id\nJordan Tenant,1950-05-20,555-0104,44 Family Rd,Chess,Imported profile,",
  relationships: "rel_id,from_person_id,to_person_id,rel_type\nrel-tenant-a-10,p-tenant-a-1,p-tenant-a-4,sibling",
  households: "household_id,partner1_person_id,partner2_person_id\nfu-tenant-a-10,p-tenant-a-2,p-tenant-a-4",
  important_dates: "id,date,title,description,person_id\ntenant-a-date-10,2026-12-24,Holiday Dinner,Family gathering,p-tenant-a-1",
  person_attributes:
    "person_id,attribute_type,value_text,label,is_primary,sort_order,visibility,notes\np-tenant-a-1,photo,1A2B3C-photo-file-id,portrait,TRUE,0,family,Main portrait",
};

const DEFAULT_POLICY: SecurityPolicy = {
  minLength: 8,
  requireNumber: true,
  requireUppercase: false,
  requireLowercase: true,
  lockoutAttempts: 5,
};

function buildDirectoryPeople(
  accessItems: AccessItem[],
  localUsers: LocalUserItem[],
  people: { personId: string; displayName: string }[],
) {
  const peopleNameById = new Map(
    people
      .filter((item) => item.personId?.trim())
      .map((item) => [item.personId.trim(), item.displayName?.trim() || item.personId.trim()]),
  );
  const ids = new Set<string>();
  for (const item of accessItems) {
    const personId = item.personId?.trim();
    if (personId) {
      ids.add(personId);
    }
  }
  for (const item of localUsers) {
    const personId = item.personId?.trim();
    if (personId) {
      ids.add(personId);
    }
  }
  return Array.from(ids)
    .map((personId) => ({
      personId,
      displayName: peopleNameById.get(personId) ?? personId,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function normalizeFamilyKeyPart(value: string) {
  return value.trim().replace(/[^a-zA-Z]/g, "").toLowerCase();
}

function extractLastName(fullName: string) {
  const parts = fullName
    .trim()
    .split(/\s+/g)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return "";
  }
  return parts[parts.length - 1] ?? "";
}

function titleCaseWord(value: string) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function SettingsClient({
  tenantKey,
  tenantName,
  tenantOptions,
  accessItems,
  people,
}: SettingsClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SettingsTab>("user_admin");
  const [selectedTenantKey, setSelectedTenantKey] = useState(tenantKey);
  const [visibleAccessItems, setVisibleAccessItems] = useState<AccessItem[]>(accessItems);
  const [userEmail, setUserEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "USER">("USER");
  const [personId, setPersonId] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);
  const [accessStatus, setAccessStatus] = useState("");
  const [target, setTarget] = useState<
    "people" | "relationships" | "households" | "important_dates" | "person_attributes"
  >("people");
  const [csv, setCsv] = useState(CSV_TEMPLATES.people);
  const [importStatus, setImportStatus] = useState("");
  const [newTenantKey, setNewTenantKey] = useState("");
  const [newTenantName, setNewTenantName] = useState("");
  const [newPatriarchFullName, setNewPatriarchFullName] = useState("");
  const [newMatriarchFullName, setNewMatriarchFullName] = useState("");
  const [newMatriarchMaidenName, setNewMatriarchMaidenName] = useState("");
  const [newInitialAdminPersonId, setNewInitialAdminPersonId] = useState("");
  const [newParentsAreInitialAdminParents, setNewParentsAreInitialAdminParents] = useState(false);
  const [newIncludeHouseholdCandidates, setNewIncludeHouseholdCandidates] = useState(true);
  const [postCreateTargetFamilyKey, setPostCreateTargetFamilyKey] = useState("");
  const [postCreateHouseholdCandidates, setPostCreateHouseholdCandidates] = useState<HouseholdImportCandidate[]>([]);
  const [postCreateMemberPersonIds, setPostCreateMemberPersonIds] = useState<string[]>([]);
  const [postCreateImportStatus, setPostCreateImportStatus] = useState("");
  const [importMemberPersonIds, setImportMemberPersonIds] = useState<string[]>([]);
  const [importMembersStatus, setImportMembersStatus] = useState("");
  const [newTenantStatus, setNewTenantStatus] = useState("");
  const [policy, setPolicy] = useState<SecurityPolicy>(DEFAULT_POLICY);
  const [policyStatus, setPolicyStatus] = useState("");
  const [localUsers, setLocalUsers] = useState<LocalUserItem[]>([]);
  const [localUserStatus, setLocalUserStatus] = useState("");
  const [localUsername, setLocalUsername] = useState("");
  const [localPassword, setLocalPassword] = useState("");
  const [localRole, setLocalRole] = useState<"ADMIN" | "USER">("USER");
  const [localPersonId, setLocalPersonId] = useState("");
  const [localEnabled, setLocalEnabled] = useState(true);
  const [selectedLocalUsername, setSelectedLocalUsername] = useState("");
  const [userAdminSubTab, setUserAdminSubTab] = useState<UserAdminSubTab>("directory");
  const [familyGroupsSubTab, setFamilyGroupsSubTab] = useState<FamilyGroupsSubTab>("overview");
  const [importSubTab, setImportSubTab] = useState<ImportSubTab>("target");
  const [selectedDirectoryPersonId, setSelectedDirectoryPersonId] = useState("");
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [integrityStatus, setIntegrityStatus] = useState("");
  const [integrityReport, setIntegrityReport] = useState<IntegrityReport | null>(null);
  const [integrityRepairStatus, setIntegrityRepairStatus] = useState("");
  const adminLoadSeq = useRef(0);
  const adminLoadAbortRef = useRef<AbortController | null>(null);
  const managedPersonSyncRef = useRef("");
  const [adminLoadStatus, setAdminLoadStatus] = useState("");
  const [existingPeopleOptions, setExistingPeopleOptions] = useState<ExistingPersonOption[]>([]);
  const [familyPeople, setFamilyPeople] = useState<{ personId: string; displayName: string }[]>(people);
  const [directoryPeople, setDirectoryPeople] = useState<{ personId: string; displayName: string }[]>(
    buildDirectoryPeople(accessItems, [], people),
  );

  const template = useMemo(() => CSV_TEMPLATES[target], [target]);
  const generatedFamilyGroupKey = useMemo(() => {
    const maiden = normalizeFamilyKeyPart(newMatriarchMaidenName);
    const partner = normalizeFamilyKeyPart(extractLastName(newPatriarchFullName));
    return `${maiden}${partner}`;
  }, [newMatriarchMaidenName, newPatriarchFullName]);
  const generatedFamilyGroupName = useMemo(() => {
    const maiden = normalizeFamilyKeyPart(newMatriarchMaidenName);
    const partner = normalizeFamilyKeyPart(extractLastName(newPatriarchFullName));
    if (!maiden || !partner) {
      return "";
    }
    return `${titleCaseWord(maiden)}${titleCaseWord(partner)} Family`;
  }, [newMatriarchMaidenName, newPatriarchFullName]);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const fetchJsonWithRetry = async (url: string, signal: AbortSignal) => {
    let lastStatus = 0;
    let lastBody: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await fetch(url, { signal, cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        return { ok: true as const, status: res.status, body };
      }
      lastStatus = res.status;
      lastBody = body;
      if (!(res.status === 429 || res.status >= 500) || attempt === 1) {
        break;
      }
      await sleep(300 * (attempt + 1));
    }
    return { ok: false as const, status: lastStatus, body: lastBody };
  };

  const loadTenantAdminData = async (tenantKeyToLoad: string) => {
    const loadSeq = ++adminLoadSeq.current;
    adminLoadAbortRef.current?.abort();
    const controller = new AbortController();
    adminLoadAbortRef.current = controller;
    const signal = controller.signal;

    const [accessRes, policyRes, usersRes, peopleRes] = await Promise.all([
      fetchJsonWithRetry(`/api/t/${encodeURIComponent(tenantKeyToLoad)}/user-access`, signal),
      fetchJsonWithRetry(`/api/t/${encodeURIComponent(tenantKeyToLoad)}/security-policy`, signal),
      fetchJsonWithRetry(`/api/t/${encodeURIComponent(tenantKeyToLoad)}/local-users`, signal),
      fetchJsonWithRetry(`/api/t/${encodeURIComponent(tenantKeyToLoad)}/people`, signal),
    ]);
    if (loadSeq !== adminLoadSeq.current) {
      return;
    }

    const failures: string[] = [];

    const nextAccessItems: AccessItem[] =
      accessRes.ok && Array.isArray(accessRes.body?.items) ? (accessRes.body.items as AccessItem[]) : [];
    if (accessRes.ok) {
      setVisibleAccessItems(nextAccessItems);
    } else {
      failures.push(`User Access (${accessRes.status || "request failed"})`);
    }

    if (policyRes.ok && policyRes.body?.policy) {
      setPolicy({
        minLength: Number(policyRes.body.policy.minLength ?? DEFAULT_POLICY.minLength),
        requireNumber: Boolean(policyRes.body.policy.requireNumber),
        requireUppercase: Boolean(policyRes.body.policy.requireUppercase),
        requireLowercase: Boolean(policyRes.body.policy.requireLowercase),
        lockoutAttempts: Number(policyRes.body.policy.lockoutAttempts ?? DEFAULT_POLICY.lockoutAttempts),
      });
    } else if (!policyRes.ok) {
      failures.push(`Password Policy (${policyRes.status || "request failed"})`);
    }

    const nextLocalUsers: LocalUserItem[] =
      usersRes.ok && Array.isArray(usersRes.body?.users) ? (usersRes.body.users as LocalUserItem[]) : [];
    if (usersRes.ok) {
      setLocalUsers(nextLocalUsers);
    } else {
      failures.push(`Local Users (${usersRes.status || "request failed"})`);
    }

    const nextPeople: { personId: string; displayName: string }[] =
      peopleRes.ok && Array.isArray(peopleRes.body?.items)
        ? peopleRes.body.items
            .filter((item: { personId?: string }) => Boolean(item?.personId))
            .map((item: { personId: string; displayName?: string }) => ({
              personId: item.personId,
              displayName: item.displayName?.trim() || item.personId,
            }))
        : [];
    if (peopleRes.ok) {
      setFamilyPeople(nextPeople);
    } else {
      failures.push(`People (${peopleRes.status || "request failed"})`);
    }

    if (accessRes.ok || usersRes.ok || peopleRes.ok) {
      setDirectoryPeople(
        buildDirectoryPeople(
          accessRes.ok ? nextAccessItems : visibleAccessItems,
          usersRes.ok ? nextLocalUsers : localUsers,
          peopleRes.ok ? nextPeople : familyPeople,
        ),
      );
    }

    if (failures.length > 0) {
      setAdminLoadStatus(`Load warning: ${failures.join(", ")}. Keeping last successful data.`);
      return;
    }
    setAdminLoadStatus("");
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setSelectedDirectoryPersonId("");
      setSelectedLocalUsername("");
      await loadTenantAdminData(selectedTenantKey);
      if (cancelled) {
        return;
      }
    };
    void run();
    return () => {
      cancelled = true;
      adminLoadAbortRef.current?.abort();
    };
  }, [selectedTenantKey]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const responses = await Promise.all(
        tenantOptions.map(async (option) => {
          const res = await fetch(`/api/t/${encodeURIComponent(option.tenantKey)}/people`);
          const body = await res.json().catch(() => null);
          if (!res.ok || !Array.isArray(body?.items)) {
            return [] as ExistingPersonOption[];
          }
          return body.items
            .filter((item: { personId?: string; displayName?: string }) => Boolean(item?.personId))
            .map((item: { personId: string; displayName?: string }) => ({
              personId: item.personId,
              displayName: item.displayName?.trim() || item.personId,
              sourceTenantKey: option.tenantKey,
              sourceTenantName: option.tenantName,
            }));
        }),
      );
      if (cancelled) {
        return;
      }
      const dedupe = new Map<string, ExistingPersonOption>();
      for (const group of responses) {
        for (const row of group) {
          if (!dedupe.has(row.personId)) {
            dedupe.set(row.personId, row);
          }
        }
      }
      setExistingPeopleOptions(Array.from(dedupe.values()).sort((a, b) => a.displayName.localeCompare(b.displayName)));
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [tenantOptions]);

  const upsertAccess = async () => {
    setAccessStatus("Saving...");
    const res = await fetch(`/api/t/${encodeURIComponent(selectedTenantKey)}/user-access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userEmail, role, personId, isEnabled }),
    });
    if (!res.ok) {
      const body = await res.text();
      setAccessStatus(`Failed: ${res.status} ${body.slice(0, 160)}`);
      return;
    }
    setAccessStatus("Saved.");
    await loadTenantAdminData(selectedTenantKey);
    router.refresh();
  };

  const createTenant = async () => {
    setNewTenantStatus("Creating family group...");
    setPostCreateImportStatus("");
    setPostCreateTargetFamilyKey("");
    setPostCreateHouseholdCandidates([]);
    setPostCreateMemberPersonIds([]);
    if (!newInitialAdminPersonId) {
      setNewTenantStatus("Select an existing person to be initial admin.");
      return;
    }
    if (!generatedFamilyGroupKey || !generatedFamilyGroupName) {
      setNewTenantStatus("Enter matriarch maiden name and patriarch full name to generate family key and name.");
      return;
    }
    const res = await fetch("/api/family-groups/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceFamilyGroupKey: selectedTenantKey,
        familyGroupKey: newTenantKey.trim() || generatedFamilyGroupKey,
        familyGroupName: newTenantName.trim() || generatedFamilyGroupName,
        patriarchFullName: newPatriarchFullName,
        matriarchFullName: newMatriarchFullName,
        matriarchMaidenName: newMatriarchMaidenName,
        initialAdminPersonId: newInitialAdminPersonId,
        memberPersonIds: [],
        parentsAreInitialAdminParents: newParentsAreInitialAdminParents,
        includeHouseholdCandidates: newIncludeHouseholdCandidates,
        isEnabled: true,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) {
      const text = typeof body === "object" ? JSON.stringify(body) : "";
      setNewTenantStatus(`Failed: ${res.status} ${text.slice(0, 160)}`);
      return;
    }
    const targetKey = String(body.familyGroupKey ?? "").trim().toLowerCase();
    const candidates = Array.isArray(body.householdImportCandidates)
      ? (body.householdImportCandidates as HouseholdImportCandidate[])
      : [];
    setPostCreateTargetFamilyKey(targetKey);
    setPostCreateHouseholdCandidates(candidates);
    setPostCreateMemberPersonIds(candidates.map((item) => item.personId));
    setNewTenantStatus("Family group created. Review household imports below, then import selected members.");
    setNewTenantKey("");
    setNewTenantName("");
    setNewPatriarchFullName("");
    setNewMatriarchFullName("");
    setNewMatriarchMaidenName("");
    setNewInitialAdminPersonId("");
    setNewParentsAreInitialAdminParents(false);
    setNewIncludeHouseholdCandidates(true);
    router.refresh();
  };

  const toggleImportMemberPersonId = (personIdToToggle: string) => {
    setImportMemberPersonIds((current) => {
      if (current.includes(personIdToToggle)) {
        return current.filter((value) => value !== personIdToToggle);
      }
      return [...current, personIdToToggle];
    });
  };

  const togglePostCreateMemberPersonId = (personIdToToggle: string) => {
    setPostCreateMemberPersonIds((current) => {
      if (current.includes(personIdToToggle)) {
        return current.filter((value) => value !== personIdToToggle);
      }
      return [...current, personIdToToggle];
    });
  };

  const importMembersNow = async () => {
    if (importMemberPersonIds.length === 0) {
      setImportMembersStatus("Select at least one person to import.");
      return;
    }
    setImportMembersStatus("Importing selected members...");
    const res = await fetch(`/api/family-groups/${encodeURIComponent(selectedTenantKey)}/import-members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberPersonIds: importMemberPersonIds }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) {
      const text = typeof body === "object" ? JSON.stringify(body) : "";
      setImportMembersStatus(`Failed: ${res.status} ${text.slice(0, 200)}`);
      return;
    }
    const missingText =
      Array.isArray(body.missingPersonIds) && body.missingPersonIds.length > 0
        ? ` Missing: ${body.missingPersonIds.slice(0, 5).join(", ")}`
        : "";
    setImportMembersStatus(
      `Imported people: ${Number(body.importedPeopleCount ?? 0)}, imported access links: ${Number(body.importedAccessCount ?? 0)}.${missingText}`,
    );
    setImportMemberPersonIds([]);
    await loadTenantAdminData(selectedTenantKey);
    router.refresh();
  };

  const importPostCreateMembers = async () => {
    if (!postCreateTargetFamilyKey) {
      setPostCreateImportStatus("No target family group found from creation step.");
      return;
    }
    if (postCreateMemberPersonIds.length === 0) {
      setPostCreateImportStatus("Select at least one person to import.");
      return;
    }
    setPostCreateImportStatus("Importing selected members...");
    const res = await fetch(`/api/family-groups/${encodeURIComponent(postCreateTargetFamilyKey)}/import-members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberPersonIds: postCreateMemberPersonIds }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) {
      const text = typeof body === "object" ? JSON.stringify(body) : "";
      setPostCreateImportStatus(`Failed: ${res.status} ${text.slice(0, 200)}`);
      return;
    }
    const missingText =
      Array.isArray(body.missingPersonIds) && body.missingPersonIds.length > 0
        ? ` Missing: ${body.missingPersonIds.slice(0, 5).join(", ")}`
        : "";
    setPostCreateImportStatus(
      `Imported people: ${Number(body.importedPeopleCount ?? 0)}, imported access links: ${Number(body.importedAccessCount ?? 0)}.${missingText}`,
    );
    setPostCreateMemberPersonIds([]);
    await loadTenantAdminData(selectedTenantKey);
    router.refresh();
  };

  const savePolicy = async () => {
    setPolicyStatus("Saving policy...");
    const res = await fetch(`/api/t/${encodeURIComponent(selectedTenantKey)}/security-policy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(policy),
    });
    const body = await res.text();
    if (!res.ok) {
      setPolicyStatus(`Failed: ${res.status} ${body.slice(0, 180)}`);
      return;
    }
    setPolicyStatus("Policy saved.");
  };

  const createLocalUser = async () => {
    setLocalUserStatus("Creating local user...");
    const res = await fetch(`/api/t/${encodeURIComponent(selectedTenantKey)}/local-users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: localUsername,
        password: localPassword,
        role: localRole,
        personId: localPersonId,
        isEnabled: localEnabled,
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      setLocalUserStatus(`Failed: ${res.status} ${body.slice(0, 200)}`);
      return;
    }
    setLocalUserStatus("Local user saved.");
    setLocalUsername("");
    setLocalPassword("");
    setLocalRole("USER");
    setLocalPersonId("");
    setLocalEnabled(true);
    await loadTenantAdminData(selectedTenantKey);
  };

  const patchLocalUser = async (username: string, payload: Record<string, unknown>) => {
    setLocalUserStatus(`Updating ${username}...`);
    const res = await fetch(
      `/api/t/${encodeURIComponent(selectedTenantKey)}/local-users/${encodeURIComponent(username)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const body = await res.text();
    if (!res.ok) {
      setLocalUserStatus(`Failed: ${res.status} ${body.slice(0, 200)}`);
      return false;
    }
    await loadTenantAdminData(selectedTenantKey);
    setLocalUserStatus("Local user updated.");
    if (typeof payload.action === "string" && payload.action === "rename_username") {
      const next = typeof payload.nextUsername === "string" ? payload.nextUsername.trim().toLowerCase() : "";
      if (next) {
        setSelectedLocalUsername(next);
      }
    }
    return true;
  };

  const importCsv = async () => {
    setImportStatus("Importing...");
    const res = await fetch(`/api/t/${encodeURIComponent(selectedTenantKey)}/import/csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, csv }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setImportStatus(`Failed: ${res.status} ${JSON.stringify(body)}`);
      return;
    }
    setImportStatus(`Imported. created=${body.created} updated=${body.updated} failed=${body.failed}`);
  };

  const runIntegrityCheck = async () => {
    setIntegrityStatus("Running integrity check...");
    setIntegrityRepairStatus("");
    const res = await fetch(`/api/t/${encodeURIComponent(selectedTenantKey)}/integrity`);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) {
      const text = typeof body === "object" ? JSON.stringify(body) : "";
      setIntegrityStatus(`Failed: ${res.status} ${text.slice(0, 200)}`);
      return;
    }
    setIntegrityReport(body as IntegrityReport);
    const status = body?.summary?.status;
    if (status === "ok") {
      setIntegrityStatus("Integrity check passed.");
      return;
    }
    if (status === "warn") {
      setIntegrityStatus("Integrity check completed with warnings.");
      return;
    }
    setIntegrityStatus("Integrity check found errors.");
  };

  const repairIntegrityIssues = async () => {
    const confirmed = window.confirm(
      "Run automatic repair for duplicate access rows, missing links, and legacy local-users rows?",
    );
    if (!confirmed) {
      return;
    }
    setIntegrityRepairStatus("Repairing integrity issues...");
    const res = await fetch(`/api/t/${encodeURIComponent(selectedTenantKey)}/integrity`, {
      method: "POST",
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) {
      const text = typeof body === "object" ? JSON.stringify(body) : "";
      setIntegrityRepairStatus(`Failed: ${res.status} ${text.slice(0, 200)}`);
      return;
    }
    const repaired = body?.repaired ?? {};
    setIntegrityRepairStatus(
      `Repair complete. Deduped UserAccess: ${Number(repaired.deletedDuplicateUserAccessRows ?? 0)}, created links: ${Number(repaired.createdMissingLinks ?? 0)}, removed legacy LocalUsers: ${Number(repaired.deletedLegacyLocalUsersRows ?? 0)}.`,
    );
    await runIntegrityCheck();
  };

  useEffect(() => {
    if (localUsers.length === 0 && selectedLocalUsername) {
      setSelectedLocalUsername("");
      return;
    }
    if (!selectedLocalUsername) {
      return;
    }
    const selected = localUsers.find((user) => user.username === selectedLocalUsername);
    if (!selected) {
      setSelectedLocalUsername("");
    }
  }, [localUsers, selectedLocalUsername]);
  const googleAccessByPersonId = useMemo(() => {
    const map = new Map<string, AccessItem[]>();
    for (const item of visibleAccessItems) {
      const key = item.personId?.trim();
      if (!key) {
        continue;
      }
      const current = map.get(key) ?? [];
      current.push(item);
      map.set(key, current);
    }
    return map;
  }, [visibleAccessItems]);

  const localAccessByPersonId = useMemo(() => {
    const map = new Map<string, LocalUserItem[]>();
    for (const item of localUsers) {
      const key = item.personId?.trim();
      if (!key) {
        continue;
      }
      const current = map.get(key) ?? [];
      current.push(item);
      map.set(key, current);
    }
    return map;
  }, [localUsers]);

  useEffect(() => {
    if (!selectedDirectoryPersonId) {
      return;
    }
    setPersonId(selectedDirectoryPersonId);
    setLocalPersonId(selectedDirectoryPersonId);
  }, [selectedDirectoryPersonId]);

  const createDirectoryUser = async () => {
    if (!localPersonId) {
      setLocalUserStatus("Select a person before creating a user.");
      return;
    }
    await createLocalUser();
    if (userEmail.trim()) {
      setPersonId(localPersonId);
      await upsertAccess();
    }
  };

  const resetAddUserForm = () => {
    setSelectedDirectoryPersonId("");
    setSelectedLocalUsername("");
    setLocalPersonId("");
    setPersonId("");
    setLocalUsername("");
    setLocalPassword("");
    setLocalRole("USER");
    setLocalEnabled(true);
    setUserEmail("");
    setRole("USER");
    setIsEnabled(false);
  };

  const handleAddUserPersonSelect = (nextPersonId: string) => {
    setLocalPersonId(nextPersonId);
    setPersonId(nextPersonId);
    setLocalRole("USER");
    setRole("USER");
    setIsEnabled(false);
    setLocalEnabled(true);

    const selected = familyPeople.find((person) => person.personId === nextPersonId);
    if (!selected) {
      setLocalUsername("");
      setUserEmail("");
      return;
    }

    setLocalUsername(selected.displayName.trim());
    setUserEmail("");
  };

  const selectDirectoryPerson = (nextPersonId: string) => {
    setSelectedDirectoryPersonId(nextPersonId);
    setLocalPersonId(nextPersonId);
    setPersonId(nextPersonId);
    setLocalPassword("");

    const personGoogle = (googleAccessByPersonId.get(nextPersonId) ?? []).filter((entry) => entry.userEmail.trim());
    const personLocal = localAccessByPersonId.get(nextPersonId) ?? [];

    const firstGoogle = personGoogle[0];
    if (firstGoogle) {
      setUserEmail(firstGoogle.userEmail);
      setRole(firstGoogle.role);
      setIsEnabled(firstGoogle.isEnabled);
    } else {
      setUserEmail("");
      setRole("USER");
      setIsEnabled(false);
    }

    const firstLocal = personLocal[0];
    if (firstLocal) {
      setLocalUsername(firstLocal.username);
      setLocalRole(firstLocal.role);
      setLocalEnabled(firstLocal.isEnabled);
      setSelectedLocalUsername(firstLocal.username);
    } else {
      setLocalUsername("");
      setLocalRole("USER");
      setLocalEnabled(true);
      setSelectedLocalUsername("");
    }
  };

  const selectedPersonGoogleAccess = useMemo(
    () =>
      selectedDirectoryPersonId
        ? visibleAccessItems.filter((item) => item.personId === selectedDirectoryPersonId && item.userEmail.trim())
        : [],
    [selectedDirectoryPersonId, visibleAccessItems],
  );
  const selectedPersonLocalUsers = useMemo(
    () => (selectedDirectoryPersonId ? localUsers.filter((item) => item.personId === selectedDirectoryPersonId) : []),
    [selectedDirectoryPersonId, localUsers],
  );
  useEffect(() => {
    const personId = selectedDirectoryPersonId.trim();
    if (!personId) {
      managedPersonSyncRef.current = "";
      return;
    }
    if (managedPersonSyncRef.current === personId) {
      return;
    }
    managedPersonSyncRef.current = personId;

    const firstLocal = selectedPersonLocalUsers[0];
    if (firstLocal) {
      setLocalUsername(firstLocal.username);
      setLocalRole(firstLocal.role);
      setLocalEnabled(firstLocal.isEnabled);
      setSelectedLocalUsername(firstLocal.username);
    } else {
      setLocalUsername("");
      setLocalRole("USER");
      setLocalEnabled(true);
      setSelectedLocalUsername("");
    }

    const firstGoogle = selectedPersonGoogleAccess[0];
    if (firstGoogle) {
      setUserEmail(firstGoogle.userEmail);
      setRole(firstGoogle.role);
      setIsEnabled(firstGoogle.isEnabled);
    } else {
      setUserEmail("");
      setRole("USER");
      setIsEnabled(false);
    }
  }, [selectedDirectoryPersonId, selectedPersonGoogleAccess, selectedPersonLocalUsers]);
  const selectedTenantOption = tenantOptions.find((option) => option.tenantKey === selectedTenantKey) ?? null;
  const importMemberCandidates = existingPeopleOptions.filter(
    (person) => person.sourceTenantKey.trim().toLowerCase() !== selectedTenantKey.trim().toLowerCase(),
  );
  const addUserCandidatePeople = useMemo(() => {
    const existingUserPersonIds = new Set(visibleAccessItems.map((item) => item.personId.trim()).filter(Boolean));
    return familyPeople
      .filter((person) => !existingUserPersonIds.has(person.personId.trim()))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [familyPeople, visibleAccessItems]);
  const createGroupInitialAdminOptions = useMemo(
    () => [...familyPeople].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [familyPeople],
  );

  return (
    <div className="settings-stack">
      <div className="settings-chip-list">
        <button
          type="button"
          className={`button secondary tap-button ${activeTab === "user_admin" ? "game-option-selected" : ""}`}
          onClick={() => setActiveTab("user_admin")}
        >
          User Administration
        </button>
        <button
          type="button"
          className={`button secondary tap-button ${activeTab === "family_groups" ? "game-option-selected" : ""}`}
          onClick={() => setActiveTab("family_groups")}
        >
          Family Groups
        </button>
        <button
          type="button"
          className={`button secondary tap-button ${activeTab === "import" ? "game-option-selected" : ""}`}
          onClick={() => setActiveTab("import")}
        >
          CSV Import
        </button>
        <button
          type="button"
          className={`button secondary tap-button ${activeTab === "integrity" ? "game-option-selected" : ""}`}
          onClick={() => setActiveTab("integrity")}
        >
          Integrity Checker
        </button>
      </div>

      {activeTab === "family_groups" ? (
        <section className="card">
        <h2 style={{ marginTop: 0 }}>Family Groups</h2>
        <label className="label">Target Family Group</label>
        <select className="input" value={selectedTenantKey} onChange={(e) => setSelectedTenantKey(e.target.value)}>
          {tenantOptions.map((option) => (
            <option key={option.tenantKey} value={option.tenantKey}>
              {option.tenantName} ({option.role})
            </option>
          ))}
        </select>
        <div className="settings-chip-list">
          <button
            type="button"
            className={`button secondary tap-button ${familyGroupsSubTab === "overview" ? "game-option-selected" : ""}`}
            onClick={() => setFamilyGroupsSubTab("overview")}
          >
            Overview
          </button>
          <button
            type="button"
            className={`button secondary tap-button ${familyGroupsSubTab === "create_group" ? "game-option-selected" : ""}`}
            onClick={() => setFamilyGroupsSubTab("create_group")}
          >
            Create Group
          </button>
        </div>
        {familyGroupsSubTab === "overview" ? (
          <>
            <p className="page-subtitle">
              Current family group: {selectedTenantOption?.tenantName ?? tenantName}. Create a new family group and seed first admin.
            </p>
            <h3 style={{ marginBottom: "0.5rem" }}>Import Existing Members Now</h3>
            <p className="page-subtitle" style={{ marginTop: 0 }}>
              Copy selected people from other family groups into this family group, including existing login access links.
            </p>
            <div className="settings-table-wrap" style={{ maxHeight: "220px", overflow: "auto" }}>
              <table className="settings-table">
                <thead>
                  <tr><th>Add</th><th>Person</th><th>Source Family Group</th></tr>
                </thead>
                <tbody>
                  {importMemberCandidates.map((person) => (
                    <tr key={`${person.personId}-${person.sourceTenantKey}-quick-import`}>
                      <td>
                        <input
                          type="checkbox"
                          checked={importMemberPersonIds.includes(person.personId)}
                          onChange={() => toggleImportMemberPersonId(person.personId)}
                        />
                      </td>
                      <td>{person.displayName}</td>
                      <td>{person.sourceTenantName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {importMemberCandidates.length === 0 ? (
              <p className="page-subtitle" style={{ marginTop: "0.5rem" }}>
                No import candidates found from other family groups.
              </p>
            ) : null}
            <button type="button" className="button tap-button" onClick={importMembersNow}>
              Import Selected Members Now
            </button>
            {importMembersStatus ? <p>{importMembersStatus}</p> : null}
          </>
        ) : null}
        {familyGroupsSubTab === "create_group" ? (
          <>
            <p className="page-subtitle" style={{ marginTop: 0 }}>
              Select the initial admin from the active source family group. Family key and name are generated from matriarch maiden name + patriarch last name.
            </p>
            <label className="label">Top-Level Patriarch (full name)</label>
            <input className="input" value={newPatriarchFullName} onChange={(e) => setNewPatriarchFullName(e.target.value)} placeholder="Brenton Dale Estes" />
            <label className="label">Top-Level Matriarch (full name)</label>
            <input className="input" value={newMatriarchFullName} onChange={(e) => setNewMatriarchFullName(e.target.value)} placeholder="Ruth Snow Estes" />
            <label className="label">Matriarch Maiden Name</label>
            <input className="input" value={newMatriarchMaidenName} onChange={(e) => setNewMatriarchMaidenName(e.target.value)} placeholder="Snow" />
            <label className="label">Generated Family Group Key</label>
            <input className="input" value={generatedFamilyGroupKey} readOnly placeholder="snowestes" />
            <label className="label">Generated Family Group Name</label>
            <input className="input" value={generatedFamilyGroupName} readOnly placeholder="SnowEstes Family" />
            <label className="label">Optional Override Key (advanced)</label>
            <input className="input" value={newTenantKey} onChange={(e) => setNewTenantKey(e.target.value)} placeholder={generatedFamilyGroupKey || "snowestes"} />
            <label className="label">Optional Override Name (advanced)</label>
            <input className="input" value={newTenantName} onChange={(e) => setNewTenantName(e.target.value)} placeholder={generatedFamilyGroupName || "SnowEstes Family"} />
            <label className="label">Initial Admin (existing person)</label>
            <select className="input" value={newInitialAdminPersonId} onChange={(e) => setNewInitialAdminPersonId(e.target.value)}>
              <option value="">Select existing person</option>
              {createGroupInitialAdminOptions.map((person) => (
                <option key={person.personId} value={person.personId}>
                  {person.displayName}
                </option>
              ))}
            </select>
            {createGroupInitialAdminOptions.length === 0 ? (
              <p className="page-subtitle" style={{ marginTop: "0.5rem" }}>
                No people found in this source family group. Add people first before creating a new family group.
              </p>
            ) : null}
            <label className="label">
              <input
                type="checkbox"
                checked={newParentsAreInitialAdminParents}
                onChange={(e) => setNewParentsAreInitialAdminParents(e.target.checked)}
              />{" "}
              Patriarch and matriarch are parents of the initial admin
            </label>
            <label className="label">
              <input
                type="checkbox"
                checked={newIncludeHouseholdCandidates}
                onChange={(e) => setNewIncludeHouseholdCandidates(e.target.checked)}
              />{" "}
              Suggest spouse and children of initial admin for import after creation
            </label>
            <button type="button" className="button tap-button" onClick={createTenant}>
              Create Family Group
            </button>
            {postCreateHouseholdCandidates.length > 0 && postCreateTargetFamilyKey ? (
              <div className="card" style={{ marginTop: "0.75rem" }}>
                <h3 style={{ marginTop: 0 }}>Import Household To New Family</h3>
                <p className="page-subtitle" style={{ marginTop: 0 }}>
                  Review suggested spouse/children. Uncheck anyone you do not want to import.
                </p>
                <div className="settings-table-wrap" style={{ maxHeight: "220px", overflow: "auto" }}>
                  <table className="settings-table">
                    <thead>
                      <tr><th>Import</th><th>Person</th></tr>
                    </thead>
                    <tbody>
                      {postCreateHouseholdCandidates.map((person) => (
                        <tr key={`post-create-${person.personId}`}>
                          <td>
                            <input
                              type="checkbox"
                              checked={postCreateMemberPersonIds.includes(person.personId)}
                              onChange={() => togglePostCreateMemberPersonId(person.personId)}
                            />
                          </td>
                          <td>{person.displayName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button type="button" className="button tap-button" onClick={importPostCreateMembers}>
                  Import To New Family
                </button>
                {postCreateImportStatus ? <p>{postCreateImportStatus}</p> : null}
              </div>
            ) : null}
          </>
        ) : null}
        {newTenantStatus ? <p>{newTenantStatus}</p> : null}
        </section>
      ) : null}

      {activeTab === "user_admin" ? (
        <section className="card">
        <h2 style={{ marginTop: 0 }}>User Administration</h2>
        <p className="page-subtitle">Manage users from one directory with local and optional Google access.</p>
        <label className="label">Target Family Group</label>
        <select className="input" value={selectedTenantKey} onChange={(e) => setSelectedTenantKey(e.target.value)}>
          {tenantOptions.map((option) => (
            <option key={option.tenantKey} value={option.tenantKey}>
              {option.tenantName} ({option.role})
            </option>
          ))}
        </select>
        <div className="settings-chip-list">
          <button
            type="button"
            className={`button secondary tap-button ${userAdminSubTab === "directory" ? "game-option-selected" : ""}`}
            onClick={() => {
              setUserAdminSubTab("directory");
              setShowAddUserForm(false);
            }}
          >
            User Directory
          </button>
          <button
            type="button"
            className={`button secondary tap-button ${userAdminSubTab === "password_policy" ? "game-option-selected" : ""}`}
            onClick={() => {
              setUserAdminSubTab("password_policy");
              setShowAddUserForm(false);
            }}
          >
            Password Policy
          </button>
          <button
            type="button"
            className={`button secondary tap-button ${showAddUserForm ? "game-option-selected" : ""}`}
            onClick={() => {
              setUserAdminSubTab("directory");
              const next = !showAddUserForm;
              setShowAddUserForm(next);
              if (next) {
                resetAddUserForm();
              }
            }}
          >
            {showAddUserForm ? "Hide Add User" : "Add User"}
          </button>
        </div>

        {userAdminSubTab === "directory" ? (
          <>
            {showAddUserForm ? (
              <div className="card" style={{ marginTop: "0.75rem" }}>
                <h3 style={{ marginTop: 0 }}>Add User To Directory</h3>
                <label className="label">Person</label>
                <select
                  className="input"
                  value={localPersonId}
                  onChange={(e) => handleAddUserPersonSelect(e.target.value)}
                >
                  <option value="">Select person</option>
                  {addUserCandidatePeople.map((person) => (
                    <option key={person.personId} value={person.personId}>{person.displayName}</option>
                  ))}
                </select>
                {addUserCandidatePeople.length === 0 ? (
                  <p className="page-subtitle" style={{ marginTop: "0.5rem" }}>
                    No available people to add. Everyone in this family already has a user record.
                  </p>
                ) : null}
                <label className="label">Local Username</label>
                <input
                  className="input"
                  autoComplete="off"
                  value={localUsername}
                  onChange={(e) => setLocalUsername(e.target.value)}
                />
                <label className="label">Temporary Password</label>
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={localPassword}
                  onChange={(e) => setLocalPassword(e.target.value)}
                />
                <label className="label">Role</label>
                <select className="input" value={localRole} onChange={(e) => setLocalRole(e.target.value as "ADMIN" | "USER")}>
                  <option value="USER">USER</option><option value="ADMIN">ADMIN</option>
                </select>
                <label className="label"><input type="checkbox" checked={localEnabled} onChange={(e) => setLocalEnabled(e.target.checked)} /> Local Access Enabled</label>
                <label className="label">Google Email (optional)</label>
                <input
                  className="input"
                  type="email"
                  autoComplete="off"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  placeholder="name@gmail.com"
                />
                <label className="label"><input type="checkbox" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} /> Google Access Enabled</label>
                <button type="button" className="button tap-button" onClick={createDirectoryUser}>Create User</button>
                <p className="page-subtitle" style={{ marginTop: "0.5rem" }}>
                  Google access supports Gmail and Google Workspace accounts.
                </p>
              </div>
            ) : null}

            <div className="settings-table-wrap" style={{ marginTop: "0.75rem" }}>
              <table className="settings-table">
                <thead>
                  <tr><th>Person</th><th>Google Access</th><th>Local Access</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {directoryPeople.map((person) => {
                    const personGoogle = googleAccessByPersonId.get(person.personId) ?? [];
                    const personLocal = localAccessByPersonId.get(person.personId) ?? [];
                    const hasGoogle = personGoogle.some((entry) => entry.isEnabled);
                    const hasLocal = personLocal.some((entry) => entry.isEnabled);
                    const isExpanded = selectedDirectoryPersonId === person.personId;
                    const personLocalSelected = isExpanded
                      ? localUsers.find((item) => item.username === selectedLocalUsername && item.personId === person.personId) ?? null
                      : null;
                    return (
                      <Fragment key={person.personId}>
                        <tr key={`${person.personId}-row`}>
                          <td>{person.displayName}</td>
                          <td>{hasGoogle ? "TRUE" : "FALSE"}</td>
                          <td>{hasLocal ? "TRUE" : "FALSE"}</td>
                          <td>
                            <button
                              type="button"
                              className="button secondary tap-button"
                              onClick={() => {
                                if (isExpanded) {
                                  setSelectedDirectoryPersonId("");
                                  return;
                                }
                                selectDirectoryPerson(person.personId);
                              }}
                            >
                              {isExpanded ? "Close" : "Manage User"}
                            </button>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr key={`${person.personId}-detail`}>
                            <td colSpan={4}>
                              <div className="card" style={{ marginTop: "0.5rem" }}>
                                <h4 style={{ marginTop: 0 }}>Manage User: {person.displayName}</h4>

                                <div className="settings-chip-list">
                                  <label className="label">
                                    <input
                                      type="checkbox"
                                      checked={isEnabled}
                                      onChange={(e) => setIsEnabled(e.target.checked)}
                                    />{" "}
                                    Google Access Enabled
                                  </label>
                                  <label className="label">
                                    <input
                                      type="checkbox"
                                      checked={localEnabled}
                                      onChange={(e) => setLocalEnabled(e.target.checked)}
                                    />{" "}
                                    Local Access Enabled
                                  </label>
                                </div>

                                <label className="label">Role</label>
                                <select
                                  className="input"
                                  value={role}
                                  onChange={(e) => {
                                    const nextRole = e.target.value as "ADMIN" | "USER";
                                    setRole(nextRole);
                                    setLocalRole(nextRole);
                                  }}
                                >
                                  <option value="USER">USER</option>
                                  <option value="ADMIN">ADMIN</option>
                                </select>

                                <h5 style={{ marginBottom: "0.5rem" }}>Google Access</h5>
                                <label className="label">Google Email</label>
                                <input
                                  className="input"
                                  value={userEmail}
                                  onChange={(e) => setUserEmail(e.target.value)}
                                  placeholder="name@gmail.com"
                                />

                                <h5 style={{ marginBottom: "0.5rem", marginTop: "1rem" }}>Local Access</h5>
                                <label className="label">Username</label>
                                <input
                                  className="input"
                                  value={localUsername}
                                  onChange={(e) => setLocalUsername(e.target.value)}
                                  placeholder="local username"
                                />
                                <label className="label">Set / Change Password</label>
                                <input
                                  className="input"
                                  type="password"
                                  value={localPassword}
                                  onChange={(e) => setLocalPassword(e.target.value)}
                                  placeholder="new password"
                                />
                                <div className="settings-chip-list">
                                  <button
                                    type="button"
                                    className="button tap-button"
                                    onClick={() =>
                                      void (async () => {
                                        setPersonId(person.personId);
                                        setLocalPersonId(person.personId);

                                        if (isEnabled) {
                                          if (!userEmail.trim()) {
                                            setAccessStatus("Google email is required when Google Access is enabled.");
                                            return;
                                          }
                                          await upsertAccess();
                                        } else if (selectedPersonGoogleAccess.length > 0) {
                                          const existing = selectedPersonGoogleAccess[0];
                                          setUserEmail(existing.userEmail);
                                          await fetch(`/api/t/${encodeURIComponent(selectedTenantKey)}/user-access`, {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({
                                              userEmail: existing.userEmail,
                                              role,
                                              personId: person.personId,
                                              isEnabled: false,
                                            }),
                                          });
                                          await loadTenantAdminData(selectedTenantKey);
                                        }

                                        if (localEnabled) {
                                          if (personLocalSelected) {
                                            if (
                                              localUsername.trim() &&
                                              localUsername.trim().toLowerCase() !== personLocalSelected.username
                                            ) {
                                              const renamed = await patchLocalUser(personLocalSelected.username, {
                                                action: "rename_username",
                                                nextUsername: localUsername.trim(),
                                              });
                                              if (!renamed) return;
                                            }
                                            const activeUsername = (
                                              localUsername.trim().toLowerCase() || personLocalSelected.username
                                            ).trim();
                                            if (activeUsername) {
                                              const roleOk = await patchLocalUser(activeUsername, {
                                                action: "update_role",
                                                role,
                                              });
                                              if (!roleOk) return;
                                              await patchLocalUser(activeUsername, {
                                                action: "set_enabled",
                                                isEnabled: true,
                                              });
                                            }
                                          } else {
                                            if (!localUsername.trim() || !localPassword.trim()) {
                                              setLocalUserStatus(
                                                "Local username and password are required when enabling Local Access for a new user.",
                                              );
                                              return;
                                            }
                                            await createLocalUser();
                                          }
                                        } else if (personLocalSelected) {
                                          await patchLocalUser(personLocalSelected.username, {
                                            action: "set_enabled",
                                            isEnabled: false,
                                          });
                                        }

                                        setLocalUserStatus("User updated.");
                                        await loadTenantAdminData(selectedTenantKey);
                                        router.refresh();
                                      })()
                                    }
                                  >
                                    Update User
                                  </button>
                                  <button
                                    type="button"
                                    className="button tap-button"
                                    onClick={() =>
                                      void (async () => {
                                        if (!personLocalSelected) {
                                          setLocalUserStatus("No local user exists to update password.");
                                          return;
                                        }
                                        if (!localPassword.trim()) {
                                          setLocalUserStatus("Enter a password first.");
                                          return;
                                        }
                                        const ok = await patchLocalUser(personLocalSelected.username, {
                                          action: "reset_password",
                                          password: localPassword,
                                        });
                                        if (!ok) return;
                                        setLocalUserStatus("Password updated.");
                                        setLocalPassword("");
                                      })()
                                    }
                                  >
                                    Update Password
                                  </button>
                                </div>

                                <div className="settings-table-wrap" style={{ marginTop: "0.75rem" }}>
                                  <table className="settings-table">
                                    <thead>
                                      <tr><th>Failed Attempts</th><th>Locked</th><th>Locked Until</th><th>Current Local Username</th></tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td>{personLocalSelected ? personLocalSelected.failedAttempts : 0}</td>
                                        <td>{personLocalSelected?.lockedUntil ? "TRUE" : "FALSE"}</td>
                                        <td>{personLocalSelected?.lockedUntil || "-"}</td>
                                        <td>{personLocalSelected?.username || "-"}</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {directoryPeople.length === 0 ? (
              <p className="page-subtitle" style={{ marginTop: "0.5rem" }}>
                No users found for this family group. Add user access for a person in this family to populate the directory.
              </p>
            ) : null}

          </>
        ) : null}

        {userAdminSubTab === "password_policy" ? (
          <>
            <h3 style={{ marginTop: 0 }}>Local Password Policy</h3>
            <label className="label">Minimum Password Length</label>
            <input
              className="input"
              type="number"
              min={4}
              max={128}
              value={policy.minLength}
              onChange={(e) => setPolicy((p) => ({ ...p, minLength: Number.parseInt(e.target.value || "8", 10) || 8 }))}
            />
            <label className="label"><input type="checkbox" checked={policy.requireNumber} onChange={(e) => setPolicy((p) => ({ ...p, requireNumber: e.target.checked }))} /> Require number</label>
            <label className="label"><input type="checkbox" checked={policy.requireUppercase} onChange={(e) => setPolicy((p) => ({ ...p, requireUppercase: e.target.checked }))} /> Require uppercase</label>
            <label className="label"><input type="checkbox" checked={policy.requireLowercase} onChange={(e) => setPolicy((p) => ({ ...p, requireLowercase: e.target.checked }))} /> Require lowercase</label>
            <label className="label">Lockout After Failed Attempts</label>
            <input
              className="input"
              type="number"
              min={1}
              max={50}
              value={policy.lockoutAttempts}
              onChange={(e) => setPolicy((p) => ({ ...p, lockoutAttempts: Number.parseInt(e.target.value || "5", 10) || 5 }))}
            />
            <button type="button" className="button tap-button" onClick={savePolicy}>Save Security Policy</button>
          </>
        ) : null}
        {accessStatus ? <p>{accessStatus}</p> : null}
        {adminLoadStatus ? <p className="status-warn">{adminLoadStatus}</p> : null}
        {policyStatus ? <p>{policyStatus}</p> : null}
        {localUserStatus ? <p>{localUserStatus}</p> : null}
        </section>
      ) : null}

      {activeTab === "integrity" ? (
        <section className="card">
        <h2 style={{ marginTop: 0 }}>Integrity Checker</h2>
        <p className="page-subtitle">Run diagnostics and repair common worksheet integrity issues.</p>
        <label className="label">Target Family Group</label>
        <select className="input" value={selectedTenantKey} onChange={(e) => setSelectedTenantKey(e.target.value)}>
          {tenantOptions.map((option) => (
            <option key={option.tenantKey} value={option.tenantKey}>
              {option.tenantName} ({option.role})
            </option>
          ))}
        </select>
        <div className="settings-chip-list" style={{ marginTop: "0.75rem" }}>
          <button type="button" className="button tap-button" onClick={runIntegrityCheck}>
            Run Integrity Check
          </button>
          <button type="button" className="button tap-button" onClick={repairIntegrityIssues}>
            Repair Integrity Issues
          </button>
        </div>
        {integrityStatus ? <p>{integrityStatus}</p> : null}
        {integrityRepairStatus ? <p>{integrityRepairStatus}</p> : null}
        {integrityReport ? (
          <div className="settings-table-wrap">
            <table className="settings-table">
              <thead>
                <tr><th>Status</th><th>Errors</th><th>Warnings</th><th>People</th><th>UserAccess</th><th>UserFamilyGroups</th><th>Legacy LocalUsers</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>{integrityReport.summary.status.toUpperCase()}</td>
                  <td>{integrityReport.summary.errorCount}</td>
                  <td>{integrityReport.summary.warnCount}</td>
                  <td>{integrityReport.summary.peopleCount}</td>
                  <td>{integrityReport.summary.userAccessCount}</td>
                  <td>{integrityReport.summary.userFamilyGroupCount}</td>
                  <td>{integrityReport.summary.legacyLocalUsersCount}</td>
                </tr>
              </tbody>
            </table>
            {integrityReport.findings.length > 0 ? (
              <table className="settings-table" style={{ marginTop: "0.75rem" }}>
                <thead>
                  <tr><th>Severity</th><th>Issue</th><th>Count</th><th>Sample</th></tr>
                </thead>
                <tbody>
                  {integrityReport.findings.map((finding) => (
                    <tr key={`${finding.code}-${finding.severity}`}>
                      <td>{finding.severity.toUpperCase()}</td>
                      <td>{finding.message}</td>
                      <td>{finding.count}</td>
                      <td>{finding.sample.join(", ") || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="page-subtitle">No integrity issues found.</p>
            )}
          </div>
        ) : null}
        </section>
      ) : null}

      {activeTab === "import" ? (
        <section className="card">
        <h2 style={{ marginTop: 0 }}>CSV Import (Paste)</h2>
        <p className="page-subtitle">Initial data load into selected family group. CSV header must match exactly.</p>
        <div className="settings-chip-list">
          <button
            type="button"
            className={`button secondary tap-button ${importSubTab === "target" ? "game-option-selected" : ""}`}
            onClick={() => setImportSubTab("target")}
          >
            Target & Format
          </button>
          <button
            type="button"
            className={`button secondary tap-button ${importSubTab === "csv" ? "game-option-selected" : ""}`}
            onClick={() => setImportSubTab("csv")}
          >
            Paste CSV
          </button>
        </div>
        {importSubTab === "target" ? (
          <>
            <label className="label">Target Family Group</label>
            <select className="input" value={selectedTenantKey} onChange={(e) => setSelectedTenantKey(e.target.value)}>
              {tenantOptions.map((option) => (
                <option key={option.tenantKey} value={option.tenantKey}>{option.tenantName}</option>
              ))}
            </select>
            <label className="label">Target Table</label>
            <select
              className="input"
              value={target}
              onChange={(e) => {
                const next = e.target.value as typeof target;
                setTarget(next);
                setCsv(CSV_TEMPLATES[next]);
              }}
            >
              <option value="people">People</option>
              <option value="relationships">Relationships</option>
              <option value="households">Households</option>
              <option value="important_dates">ImportantDates</option>
              <option value="person_attributes">PersonAttributes</option>
            </select>
            <p className="settings-template-title">Required format for `{target}`:</p>
            <pre className="settings-template">{template}</pre>
          </>
        ) : null}
        {importSubTab === "csv" ? (
          <>
            <label className="label">Paste CSV Content</label>
            <textarea className="textarea settings-csv-box" value={csv} onChange={(e) => setCsv(e.target.value)} />
            <button type="button" className="button tap-button" onClick={importCsv}>Import CSV</button>
          </>
        ) : null}
        {importStatus ? <p>{importStatus}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
