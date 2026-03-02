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

type DeleteFamilyPreview = {
  familyGroupKey: string;
  orphanPeople: { personId: string; displayName: string }[];
  orphanHouseholds: { householdId: string; husbandPersonId: string; wifePersonId: string }[];
  familyAttributesToDelete: { source: string; rowNumber: number; data: Record<string, string> }[];
  usersToDisable: { personId: string; userEmail: string; username: string; reason: string }[];
  counts: {
    personFamilyRowsToDelete: number;
    userFamilyRowsToDelete: number;
    familyConfigRowsToDelete: number;
    familyPolicyRowsToDelete: number;
    orphanPeople: number;
    orphanHouseholds: number;
    usersToDisable: number;
  };
};

type DeletePersonPreview = {
  personId: string;
  displayName: string;
  counts: {
    peopleRowsToDelete: number;
    personFamilyRowsToDelete: number;
    userFamilyRowsToDelete: number;
    userAccessRowsToDelete: number;
    relationshipRowsToDelete: number;
    householdRowsToDelete: number;
    attributeRowsToDelete: number;
    importantDateRowsToDelete: number;
    enabledMembershipsInOtherFamilies: number;
  };
  householdIds: string[];
};

type DeleteHouseholdPreview = {
  householdId: string;
  householdLabel: string;
  husbandPersonId: string;
  wifePersonId: string;
  counts: {
    householdRowsToDelete: number;
    spouseRelationshipRowsToDelete: number;
  };
};

type HouseholdDeleteOption = {
  householdId: string;
  label: string;
  husbandPersonId: string;
  wifePersonId: string;
  husbandName: string;
  wifeName: string;
};

type SettingsClientProps = {
  tenantKey: string;
  tenantName: string;
  tenantOptions: TenantOption[];
  accessItems: AccessItem[];
  people: { personId: string; displayName: string }[];
  allPeople: { personId: string; displayName: string; middleName: string; gender: "male" | "female" | "unspecified" }[];
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

type CreateFamilyResponse = {
  familyGroupKey?: string;
  householdImportCandidates?: HouseholdImportCandidate[];
  autoImportedHouseholdCandidates?: boolean;
  autoImportedPeopleCount?: number;
  autoImportedAccessCount?: number;
  debug?: {
    getPeopleCalls: number;
    getTableRecordsCalls: number;
    createTableRecordCalls: number;
    upsertTenantAccessCalls: number;
    ensureTenantPhotosFolderCalls: number;
    ensureTenantScaffoldCalls: number;
    upsertParentRelationCalls: number;
    upsertFamilyUnitCalls: number;
  };
};

type SettingsTab = "family_groups" | "user_admin" | "integrity" | "import";
type UserAdminSubTab = "directory" | "family_access" | "password_policy";
type FamilyGroupsSubTab = "overview" | "create_group";
type ImportSubTab = "target" | "csv";

type FamilyAccessRow = {
  personId: string;
  displayName: string;
  isEnabled: boolean;
};

const CSV_TEMPLATES: Record<string, string> = {
  people: "display_name,birth_date,phones,address,hobbies,notes,photo_file_id\nJordan Tenant,1950-05-20,555-0104,44 Family Rd,Chess,Imported profile,",
  relationships: "rel_id,from_person_id,to_person_id,rel_type\np-tenant-a-1-p-tenant-a-4-sibling,p-tenant-a-1,p-tenant-a-4,sibling",
  households: "household_id,husband_person_id,wife_person_id\nfu-tenant-a-10,p-tenant-a-2,p-tenant-a-4",
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

function buildFullName(firstName: string, middleName: string, lastName: string) {
  return [firstName, middleName, lastName]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
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
  allPeople,
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
  const [newPatriarchFirstName, setNewPatriarchFirstName] = useState("");
  const [newPatriarchMiddleName, setNewPatriarchMiddleName] = useState("");
  const [newPatriarchLastName, setNewPatriarchLastName] = useState("");
  const [newPatriarchNickName, setNewPatriarchNickName] = useState("");
  const [newPatriarchBirthDate, setNewPatriarchBirthDate] = useState("");
  const [useExistingPatriarch, setUseExistingPatriarch] = useState(false);
  const [existingPatriarchPersonId, setExistingPatriarchPersonId] = useState("");
  const [patriarchLookupQuery, setPatriarchLookupQuery] = useState("");
  const [newMatriarchFirstName, setNewMatriarchFirstName] = useState("");
  const [newMatriarchMiddleName, setNewMatriarchMiddleName] = useState("");
  const [newMatriarchLastName, setNewMatriarchLastName] = useState("");
  const [newMatriarchNickName, setNewMatriarchNickName] = useState("");
  const [newMatriarchBirthDate, setNewMatriarchBirthDate] = useState("");
  const [useExistingMatriarch, setUseExistingMatriarch] = useState(false);
  const [existingMatriarchPersonId, setExistingMatriarchPersonId] = useState("");
  const [matriarchLookupQuery, setMatriarchLookupQuery] = useState("");
  const [newMatriarchMaidenName, setNewMatriarchMaidenName] = useState("");
  const [newInitialAdminPersonId, setNewInitialAdminPersonId] = useState("");
  const [newParentsAreInitialAdminParents, setNewParentsAreInitialAdminParents] = useState(false);
  const [newIncludeHouseholdCandidates, setNewIncludeHouseholdCandidates] = useState(true);
  const [createFamilyStep, setCreateFamilyStep] = useState<1 | 2 | 3 | 4>(1);
  const [createFamilyDebugNotes, setCreateFamilyDebugNotes] = useState("");
  const [preCreateHouseholdCandidates, setPreCreateHouseholdCandidates] = useState<HouseholdImportCandidate[]>([]);
  const [preCreateMemberPersonIds, setPreCreateMemberPersonIds] = useState<string[]>([]);
  const [preCreatePreviewStatus, setPreCreatePreviewStatus] = useState("");
  const [postCreateTargetFamilyKey, setPostCreateTargetFamilyKey] = useState("");
  const [postCreateHouseholdCandidates, setPostCreateHouseholdCandidates] = useState<HouseholdImportCandidate[]>([]);
  const [postCreateMemberPersonIds, setPostCreateMemberPersonIds] = useState<string[]>([]);
  const [postCreateAutoImported, setPostCreateAutoImported] = useState(false);
  const [postCreateImportStatus, setPostCreateImportStatus] = useState("");
  const [importMemberPersonIds, setImportMemberPersonIds] = useState<string[]>([]);
  const [importMembersStatus, setImportMembersStatus] = useState("");
  const [newTenantStatus, setNewTenantStatus] = useState("");
  const [showCreateFamilyModal, setShowCreateFamilyModal] = useState(false);
  const [showDeleteFamilyModal, setShowDeleteFamilyModal] = useState(false);
  const [deleteFamilyKey, setDeleteFamilyKey] = useState("");
  const [deleteFamilyStatus, setDeleteFamilyStatus] = useState("");
  const [deleteFamilyBusy, setDeleteFamilyBusy] = useState(false);
  const [disableOrphanedUsers, setDisableOrphanedUsers] = useState(true);
  const [deleteFamilyPreview, setDeleteFamilyPreview] = useState<DeleteFamilyPreview | null>(null);
  const [deletePersonId, setDeletePersonId] = useState("");
  const [deletePersonPreview, setDeletePersonPreview] = useState<DeletePersonPreview | null>(null);
  const [deletePersonStatus, setDeletePersonStatus] = useState("");
  const [deletePersonBusy, setDeletePersonBusy] = useState(false);
  const [deleteHouseholdId, setDeleteHouseholdId] = useState("");
  const [deleteHouseholdPreview, setDeleteHouseholdPreview] = useState<DeleteHouseholdPreview | null>(null);
  const [deleteHouseholdStatus, setDeleteHouseholdStatus] = useState("");
  const [deleteHouseholdBusy, setDeleteHouseholdBusy] = useState(false);
  const [deleteHouseholdOptions, setDeleteHouseholdOptions] = useState<HouseholdDeleteOption[]>([]);
  const [deleteHouseholdOptionsStatus, setDeleteHouseholdOptionsStatus] = useState("");
  const [deleteHouseholdOptionsBusy, setDeleteHouseholdOptionsBusy] = useState(false);
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
  const [familyAccessRows, setFamilyAccessRows] = useState<FamilyAccessRow[]>([]);
  const [familyAccessStatus, setFamilyAccessStatus] = useState("");
  const [directoryPeople, setDirectoryPeople] = useState<{ personId: string; displayName: string }[]>(
    buildDirectoryPeople(accessItems, [], people),
  );
  const existingPeopleOptionsLoadedKeyRef = useRef("");
  const deleteHouseholdOptionsLoadedTenantRef = useRef("");

  const template = useMemo(() => CSV_TEMPLATES[target], [target]);
  const allPeopleById = useMemo(
    () => new Map(allPeople.map((person) => [person.personId, person])),
    [allPeople],
  );
  const newPatriarchFullName = useMemo(() => {
    if (useExistingPatriarch && existingPatriarchPersonId) {
      return (allPeopleById.get(existingPatriarchPersonId)?.displayName ?? "").trim();
    }
    return buildFullName(newPatriarchFirstName, newPatriarchMiddleName, newPatriarchLastName);
  }, [
    useExistingPatriarch,
    existingPatriarchPersonId,
    allPeopleById,
    newPatriarchFirstName,
    newPatriarchMiddleName,
    newPatriarchLastName,
  ]);
  const newMatriarchFullName = useMemo(() => {
    if (useExistingMatriarch && existingMatriarchPersonId) {
      return (allPeopleById.get(existingMatriarchPersonId)?.displayName ?? "").trim();
    }
    return buildFullName(newMatriarchFirstName, newMatriarchMiddleName, newMatriarchLastName);
  }, [
    useExistingMatriarch,
    existingMatriarchPersonId,
    allPeopleById,
    newMatriarchFirstName,
    newMatriarchMiddleName,
    newMatriarchLastName,
  ]);
  useEffect(() => {
    if (!useExistingMatriarch) {
      return;
    }
    if (!existingMatriarchPersonId.trim()) {
      return;
    }
    if (newMatriarchMaidenName.trim()) {
      return;
    }
    const middleName = allPeopleById.get(existingMatriarchPersonId)?.middleName?.trim() ?? "";
    if (middleName) {
      setNewMatriarchMaidenName(middleName);
    }
  }, [
    useExistingMatriarch,
    existingMatriarchPersonId,
    newMatriarchMaidenName,
    allPeopleById,
  ]);
  const generatedFamilyGroupKey = useMemo(() => {
    const maiden = normalizeFamilyKeyPart(newMatriarchMaidenName);
    const partner = normalizeFamilyKeyPart(newPatriarchLastName || extractLastName(newPatriarchFullName));
    return `${maiden}${partner}`;
  }, [newMatriarchMaidenName, newPatriarchLastName, newPatriarchFullName]);
  const generatedFamilyGroupName = useMemo(() => {
    const maiden = normalizeFamilyKeyPart(newMatriarchMaidenName);
    const partner = normalizeFamilyKeyPart(newPatriarchLastName || extractLastName(newPatriarchFullName));
    if (!maiden || !partner) {
      return "";
    }
    return `${titleCaseWord(maiden)}-${titleCaseWord(partner)} Family`;
  }, [newMatriarchMaidenName, newPatriarchLastName, newPatriarchFullName]);

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

    const snapshotRes = await fetchJsonWithRetry(
      `/api/t/${encodeURIComponent(tenantKeyToLoad)}/admin-snapshot`,
      signal,
    );
    if (loadSeq !== adminLoadSeq.current) {
      return;
    }

    if (!snapshotRes.ok) {
      setAdminLoadStatus(
        `Load warning: User Administration snapshot (${snapshotRes.status || "request failed"}). Keeping last successful data.`,
      );
      return;
    }

    const nextAccessItems: AccessItem[] = Array.isArray(snapshotRes.body?.accessItems)
      ? (snapshotRes.body.accessItems as AccessItem[])
      : [];
    const nextLocalUsers: LocalUserItem[] = Array.isArray(snapshotRes.body?.localUsers)
      ? (snapshotRes.body.localUsers as LocalUserItem[])
      : [];
    const nextPeople: { personId: string; displayName: string }[] = Array.isArray(snapshotRes.body?.people)
      ? (snapshotRes.body.people as { personId: string; displayName: string }[])
      : [];
    const nextPolicy =
      snapshotRes.body?.policy && typeof snapshotRes.body.policy === "object"
        ? (snapshotRes.body.policy as SecurityPolicy)
        : DEFAULT_POLICY;

    setVisibleAccessItems(nextAccessItems);
    setLocalUsers(nextLocalUsers);
    setFamilyPeople(nextPeople);
    setPolicy({
      minLength: Number(nextPolicy.minLength ?? DEFAULT_POLICY.minLength),
      requireNumber: Boolean(nextPolicy.requireNumber),
      requireUppercase: Boolean(nextPolicy.requireUppercase),
      requireLowercase: Boolean(nextPolicy.requireLowercase),
      lockoutAttempts: Number(nextPolicy.lockoutAttempts ?? DEFAULT_POLICY.lockoutAttempts),
    });
    setDirectoryPeople(buildDirectoryPeople(nextAccessItems, nextLocalUsers, nextPeople));
    setAdminLoadStatus("");
  };

  const loadFamilyAccessRows = async (tenantKeyToLoad: string) => {
    const res = await fetch(`/api/t/${encodeURIComponent(tenantKeyToLoad)}/family-access`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setFamilyAccessStatus(`Load failed: ${res.status}`);
      return;
    }
    const rows = Array.isArray(body?.rows) ? (body.rows as FamilyAccessRow[]) : [];
    setFamilyAccessRows(rows);
    setFamilyAccessStatus("");
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setSelectedDirectoryPersonId("");
      setSelectedLocalUsername("");
      setDeletePersonId("");
      setDeletePersonPreview(null);
      setDeletePersonStatus("");
      setDeleteHouseholdId("");
      setDeleteHouseholdPreview(null);
      setDeleteHouseholdStatus("");
      setDeleteHouseholdOptions([]);
      setDeleteHouseholdOptionsStatus("");
      deleteHouseholdOptionsLoadedTenantRef.current = "";
      await loadTenantAdminData(selectedTenantKey);
      await loadFamilyAccessRows(selectedTenantKey);
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
    const shouldLoadExistingPeople = activeTab === "family_groups" || showCreateFamilyModal;
    if (!shouldLoadExistingPeople) {
      return;
    }
    const tenantOptionsKey = tenantOptions
      .map((option) => option.tenantKey.trim().toLowerCase())
      .sort()
      .join("|");
    if (existingPeopleOptionsLoadedKeyRef.current === tenantOptionsKey) {
      return;
    }
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
      existingPeopleOptionsLoadedKeyRef.current = tenantOptionsKey;
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [tenantOptions, activeTab, showCreateFamilyModal]);

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

  const toggleFamilyAccess = async (personIdToToggle: string, nextEnabled: boolean) => {
    setFamilyAccessStatus("Saving...");
    const res = await fetch(`/api/t/${encodeURIComponent(selectedTenantKey)}/family-access`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId: personIdToToggle, isEnabled: nextEnabled }),
    });
    if (!res.ok) {
      const body = await res.text();
      setFamilyAccessStatus(`Save failed: ${res.status} ${body.slice(0, 120)}`);
      return;
    }
    setFamilyAccessRows((current) =>
      current.map((row) => (row.personId === personIdToToggle ? { ...row, isEnabled: nextEnabled } : row)),
    );
    setFamilyAccessStatus("Saved.");
    await loadTenantAdminData(selectedTenantKey);
  };

  const createTenant = async () => {
    setNewTenantStatus("Creating family group...");
    setCreateFamilyDebugNotes("");
    setPostCreateImportStatus("");
    setPostCreateTargetFamilyKey("");
    setPostCreateHouseholdCandidates([]);
    setPostCreateMemberPersonIds([]);
    setPostCreateAutoImported(false);
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
        patriarchFirstName: newPatriarchFirstName,
        patriarchMiddleName: newPatriarchMiddleName,
        patriarchLastName: newPatriarchLastName,
        patriarchNickName: newPatriarchNickName,
        patriarchBirthDate: newPatriarchBirthDate,
        existingPatriarchPersonId: useExistingPatriarch ? existingPatriarchPersonId : undefined,
        matriarchFullName: newMatriarchFullName,
        matriarchFirstName: newMatriarchFirstName,
        matriarchMiddleName: newMatriarchMiddleName,
        matriarchLastName: newMatriarchLastName,
        matriarchNickName: newMatriarchNickName,
        matriarchBirthDate: newMatriarchBirthDate,
        existingMatriarchPersonId: useExistingMatriarch ? existingMatriarchPersonId : undefined,
        matriarchMaidenName: newMatriarchMaidenName,
        initialAdminPersonId: newInitialAdminPersonId,
        memberPersonIds: [],
        householdCandidatePersonIds: preCreateMemberPersonIds,
        parentsAreInitialAdminParents: newParentsAreInitialAdminParents,
        includeHouseholdCandidates: newIncludeHouseholdCandidates,
        isEnabled: true,
      }),
    });
    let body: CreateFamilyResponse | null = null;
    let rawText = "";
    try {
      const parsedJson: unknown = await res.json();
      if (parsedJson && typeof parsedJson === "object" && !Array.isArray(parsedJson)) {
        body = parsedJson as CreateFamilyResponse;
      }
    } catch {
      rawText = await res.text().catch(() => "");
    }
    if (!res.ok || !body) {
      const text = typeof body === "object" ? JSON.stringify(body) : rawText;
      const errorBody = body as Record<string, unknown> | null;
      const debugCounters = errorBody && typeof errorBody.debug === "object"
        ? JSON.stringify(errorBody.debug)
        : "";
      const message = errorBody && typeof errorBody.message === "string" ? errorBody.message : "";
      const hint = errorBody && typeof errorBody.hint === "string" ? errorBody.hint : "";
      const summary = errorBody && typeof errorBody.debug_summary === "string" ? errorBody.debug_summary : "";
      setNewTenantStatus(`Failed: ${res.status} ${(message || text || "No error body").slice(0, 220)}`);
      const debugText = [
        summary ? `Summary: ${summary}` : "",
        debugCounters ? `Counters: ${debugCounters}` : "",
        hint ? `Hint: ${hint}` : "",
        `Raw: ${(text || "No error body").slice(0, 800)}`,
      ]
        .filter(Boolean)
        .join("\n");
      setCreateFamilyDebugNotes(debugText);
      return;
    }
    const targetKey = String(body.familyGroupKey ?? "").trim().toLowerCase();
    const candidates = Array.isArray(body.householdImportCandidates)
      ? body.householdImportCandidates
      : [];
    const autoImported = Boolean(body.autoImportedHouseholdCandidates);
    const autoImportedPeopleCount = Number(body.autoImportedPeopleCount ?? 0);
    const autoImportedAccessCount = Number(body.autoImportedAccessCount ?? 0);
    setPostCreateTargetFamilyKey(targetKey);
    setPostCreateHouseholdCandidates(candidates);
    setPostCreateMemberPersonIds(candidates.map((item) => item.personId));
    setPostCreateAutoImported(autoImported);
    const successStatus = autoImported
      ? `Family group created. Household candidates were imported now. Imported people: ${autoImportedPeopleCount}, imported access links: ${autoImportedAccessCount}.`
      : "Family group created. Review household imports below, then import selected members.";
    setNewTenantStatus(
      autoImported
        ? `Family group created. Household candidates were imported now. Imported people: ${autoImportedPeopleCount}, imported access links: ${autoImportedAccessCount}.`
        : "Family group created. Review household imports below, then import selected members.",
    );
    const debugText = body.debug ? `, calls=${JSON.stringify(body.debug)}` : "";
    setCreateFamilyDebugNotes(
      `Create success: key=${targetKey}, autoImported=${autoImported}, importedPeople=${autoImportedPeopleCount}, importedAccess=${autoImportedAccessCount}${debugText}`,
    );
    if (targetKey) {
      await fetch("/api/family-groups/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyGroupKey: targetKey }),
      }).catch(() => null);
      setSelectedTenantKey(targetKey);
      await loadTenantAdminData(targetKey);
      setNewTenantStatus(`${successStatus} Active family group switched to ${targetKey}.`);
    }
    setCreateFamilyStep(4);
    router.refresh();
  };

  const previewCreateFamilyCandidates = async () => {
    if (!newInitialAdminPersonId) {
      setPreCreatePreviewStatus("Select initial admin first.");
      return;
    }
    setPreCreatePreviewStatus("Loading suggested spouse/children...");
    const res = await fetch("/api/family-groups/provision-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceFamilyGroupKey: selectedTenantKey,
        initialAdminPersonId: newInitialAdminPersonId,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) {
      const text = typeof body === "object" ? JSON.stringify(body) : "";
      setPreCreatePreviewStatus(`Failed: ${res.status} ${text.slice(0, 180)}`);
      setPreCreateHouseholdCandidates([]);
      setPreCreateMemberPersonIds([]);
      return;
    }
    const candidates = Array.isArray(body.householdImportCandidates)
      ? (body.householdImportCandidates as HouseholdImportCandidate[])
      : [];
    setPreCreateHouseholdCandidates(candidates);
    setPreCreateMemberPersonIds(candidates.map((item) => item.personId));
    setPreCreatePreviewStatus(
      candidates.length > 0
        ? `Found ${candidates.length} suggested spouse/children.`
        : "No suggested spouse/children found for selected initial admin.",
    );
  };

  const togglePreCreateMemberPersonId = (personIdToToggle: string) => {
    setPreCreateMemberPersonIds((current) => {
      if (current.includes(personIdToToggle)) {
        return current.filter((value) => value !== personIdToToggle);
      }
      return [...current, personIdToToggle];
    });
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

  const openDeleteFamilyModal = () => {
    setDeleteFamilyKey(selectedTenantKey);
    setDeleteFamilyPreview(null);
    setDisableOrphanedUsers(true);
    setDeleteFamilyStatus("");
    setShowDeleteFamilyModal(true);
  };

  const openCreateFamilyModal = () => {
    setCreateFamilyStep(1);
    setNewTenantStatus("");
    setCreateFamilyDebugNotes("");
    setPostCreateImportStatus("");
    setPreCreatePreviewStatus("");
    setPreCreateHouseholdCandidates([]);
    setPreCreateMemberPersonIds([]);
    setUseExistingPatriarch(false);
    setExistingPatriarchPersonId("");
    setPatriarchLookupQuery("");
    setUseExistingMatriarch(false);
    setExistingMatriarchPersonId("");
    setMatriarchLookupQuery("");
    setShowCreateFamilyModal(true);
  };

  const loadDeleteFamilyPreview = async (familyKey: string) => {
    if (!familyKey.trim()) {
      setDeleteFamilyStatus("Select a family group first.");
      setDeleteFamilyPreview(null);
      return;
    }
    setDeleteFamilyBusy(true);
    setDeleteFamilyStatus("Loading delete preview...");
    const res = await fetch(`/api/family-groups/delete?familyGroupKey=${encodeURIComponent(familyKey)}`);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.preview) {
      const text = typeof body === "object" ? JSON.stringify(body) : "";
      setDeleteFamilyStatus(`Failed: ${res.status} ${text.slice(0, 220)}`);
      setDeleteFamilyPreview(null);
      setDeleteFamilyBusy(false);
      return;
    }
    setDeleteFamilyPreview(body.preview as DeleteFamilyPreview);
    setDeleteFamilyStatus("Preview loaded.");
    setDeleteFamilyBusy(false);
  };

  const executeDeleteFamily = async () => {
    if (!deleteFamilyKey.trim()) {
      setDeleteFamilyStatus("Select a family group first.");
      return;
    }
    const confirmed = window.confirm(
      "Delete this family group? People and households will NOT be deleted. Family links/config will be removed.",
    );
    if (!confirmed) {
      return;
    }
    setDeleteFamilyBusy(true);
    setDeleteFamilyStatus("Deleting family group...");
    const res = await fetch("/api/family-groups/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        familyGroupKey: deleteFamilyKey,
        disableOrphanedUsers,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      const text = typeof body === "object" ? JSON.stringify(body) : "";
      setDeleteFamilyStatus(`Failed: ${res.status} ${text.slice(0, 220)}`);
      setDeleteFamilyBusy(false);
      return;
    }
    const deleted = body?.deleted ?? {};
    const deletedKey = deleteFamilyKey.trim().toLowerCase();
    const wasActiveFamilyDeleted = selectedTenantKey.trim().toLowerCase() === deletedKey;
    setDeleteFamilyStatus(
      `Deleted links/config. PersonFamilyGroups: ${Number(deleted.deletedPersonFamilyRows ?? 0)}, UserFamilyGroups: ${Number(deleted.deletedUserFamilyRows ?? 0)}, FamilyConfig: ${Number(deleted.deletedFamilyConfigRows ?? 0)}, FamilyPolicy: ${Number(deleted.deletedFamilyPolicyRows ?? 0)}, Disabled users: ${Number(deleted.disabledUsers ?? 0)}.`,
    );
    setDeleteFamilyBusy(false);

    if (wasActiveFamilyDeleted) {
      const fallback = tenantOptions.find(
        (option) => option.tenantKey.trim().toLowerCase() !== deletedKey,
      );
      if (!fallback) {
        setShowDeleteFamilyModal(false);
        setDeleteFamilyStatus("Deleted active family group. No remaining accessible family groups; redirecting to login.");
        router.push("/login");
        return;
      }

      await fetch("/api/family-groups/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyGroupKey: fallback.tenantKey }),
      });

      setSelectedTenantKey(fallback.tenantKey);
      setShowDeleteFamilyModal(false);
      const fallbackKey = fallback.tenantKey.trim().toLowerCase();
      const fallbackSettingsPath = fallbackKey === "snowestes"
        ? "/settings"
        : `/t/${encodeURIComponent(fallbackKey)}/settings`;
      router.push(fallbackSettingsPath);
      router.refresh();
      return;
    }

    setShowDeleteFamilyModal(false);
    await loadTenantAdminData(selectedTenantKey);
    await runIntegrityCheck();
    router.refresh();
  };

  const previewDeletePerson = async () => {
    if (!deletePersonId.trim()) {
      setDeletePersonStatus("Select a person first.");
      setDeletePersonPreview(null);
      return;
    }
    setDeletePersonBusy(true);
    setDeletePersonStatus("Loading delete preview...");
    const res = await fetch(
      `/api/t/${encodeURIComponent(selectedTenantKey)}/people/${encodeURIComponent(deletePersonId)}?preview=1`,
      { method: "DELETE" },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.preview) {
      const text = typeof body === "object" ? JSON.stringify(body) : "";
      setDeletePersonStatus(`Failed: ${res.status} ${text.slice(0, 220)}`);
      setDeletePersonPreview(null);
      setDeletePersonBusy(false);
      return;
    }
    setDeletePersonPreview(body.preview as DeletePersonPreview);
    setDeletePersonStatus("Preview loaded.");
    setDeletePersonBusy(false);
  };

  const executeDeletePerson = async () => {
    if (!deletePersonId.trim()) {
      setDeletePersonStatus("Select a person first.");
      return;
    }
    const confirmed = window.confirm(
      "Delete this person and all dependent rows (relationships, households, attributes, memberships, access rows)?",
    );
    if (!confirmed) {
      return;
    }
    setDeletePersonBusy(true);
    setDeletePersonStatus("Deleting person...");
    const res = await fetch(
      `/api/t/${encodeURIComponent(selectedTenantKey)}/people/${encodeURIComponent(deletePersonId)}`,
      { method: "DELETE" },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      const text = typeof body === "object" ? JSON.stringify(body) : "";
      setDeletePersonStatus(`Failed: ${res.status} ${text.slice(0, 220)}`);
      setDeletePersonBusy(false);
      return;
    }
    const deleted = body?.deleted ?? {};
    setDeletePersonStatus(
      `Deleted. People: ${Number(deleted.deletedPeopleRows ?? 0)}, relationships: ${Number(deleted.deletedRelationshipRows ?? 0)}, households: ${Number(deleted.deletedHouseholdRows ?? 0)}, attributes: ${Number(deleted.deletedAttributeRows ?? 0)}.`,
    );
    setDeletePersonBusy(false);
    setDeletePersonPreview(null);
    setDeletePersonId("");
    router.refresh();
  };

  const previewDeleteHousehold = async () => {
    if (!deleteHouseholdId.trim()) {
      setDeleteHouseholdStatus("Enter a household ID first.");
      setDeleteHouseholdPreview(null);
      return;
    }
    setDeleteHouseholdBusy(true);
    setDeleteHouseholdStatus("Loading delete preview...");
    const res = await fetch(
      `/api/t/${encodeURIComponent(selectedTenantKey)}/households/${encodeURIComponent(deleteHouseholdId)}?preview=1`,
      { method: "DELETE" },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.preview) {
      const text = typeof body === "object" ? JSON.stringify(body) : "";
      setDeleteHouseholdStatus(`Failed: ${res.status} ${text.slice(0, 220)}`);
      setDeleteHouseholdPreview(null);
      setDeleteHouseholdBusy(false);
      return;
    }
    setDeleteHouseholdPreview(body.preview as DeleteHouseholdPreview);
    setDeleteHouseholdStatus("Preview loaded.");
    setDeleteHouseholdBusy(false);
  };

  const loadDeleteHouseholdOptions = async () => {
    const tenantKey = selectedTenantKey.trim().toLowerCase();
    if (!tenantKey) {
      setDeleteHouseholdOptionsStatus("Select a family group first.");
      return;
    }
    if (
      deleteHouseholdOptionsLoadedTenantRef.current === tenantKey &&
      deleteHouseholdOptions.length > 0
    ) {
      setDeleteHouseholdOptionsStatus("Households already loaded.");
      return;
    }
    setDeleteHouseholdOptionsBusy(true);
    setDeleteHouseholdOptionsStatus("Loading households...");
    const res = await fetch(`/api/t/${encodeURIComponent(selectedTenantKey)}/households`, {
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(body?.households)) {
      const text = typeof body === "object" ? JSON.stringify(body) : "";
      setDeleteHouseholdOptionsStatus(`Failed: ${res.status} ${text.slice(0, 220)}`);
      setDeleteHouseholdOptionsBusy(false);
      return;
    }
    setDeleteHouseholdOptions(body.households as HouseholdDeleteOption[]);
    deleteHouseholdOptionsLoadedTenantRef.current = tenantKey;
    setDeleteHouseholdOptionsStatus(`Loaded ${body.households.length} household(s).`);
    setDeleteHouseholdOptionsBusy(false);
  };

  const executeDeleteHousehold = async () => {
    if (!deleteHouseholdId.trim()) {
      setDeleteHouseholdStatus("Enter a household ID first.");
      return;
    }
    const confirmed = window.confirm(
      "Delete this household and matching spouse/family relationship rows between the two partners?",
    );
    if (!confirmed) {
      return;
    }
    setDeleteHouseholdBusy(true);
    setDeleteHouseholdStatus("Deleting household...");
    const res = await fetch(
      `/api/t/${encodeURIComponent(selectedTenantKey)}/households/${encodeURIComponent(deleteHouseholdId)}`,
      { method: "DELETE" },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      const text = typeof body === "object" ? JSON.stringify(body) : "";
      setDeleteHouseholdStatus(`Failed: ${res.status} ${text.slice(0, 220)}`);
      setDeleteHouseholdBusy(false);
      return;
    }
    const deleted = body?.deleted ?? {};
    setDeleteHouseholdStatus(
      `Deleted. Households: ${Number(deleted.deletedHouseholdRows ?? 0)}, spouse/family links: ${Number(deleted.deletedSpouseRelationshipRows ?? 0)}.`,
    );
    setDeleteHouseholdBusy(false);
    setDeleteHouseholdPreview(null);
    setDeleteHouseholdId("");
    router.refresh();
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
  const existingParentLookupOptions = useMemo(() => {
    const dedupe = new Map<string, { personId: string; displayName: string; gender: "male" | "female" | "unspecified" }>();
    for (const person of allPeople) {
      const personId = person.personId.trim();
      if (!personId || dedupe.has(personId)) {
        continue;
      }
      dedupe.set(personId, {
        personId,
        displayName: person.displayName?.trim() || personId,
        gender: person.gender,
      });
    }
    return Array.from(dedupe.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [allPeople]);
  const filteredPatriarchOptions = useMemo(() => {
    const query = patriarchLookupQuery.trim().toLowerCase();
    const maleOptions = existingParentLookupOptions.filter((person) => person.gender === "male");
    if (!query) return maleOptions;
    return maleOptions.filter(
      (person) =>
        person.displayName.toLowerCase().includes(query) || person.personId.toLowerCase().includes(query),
    );
  }, [existingParentLookupOptions, patriarchLookupQuery]);
  const filteredMatriarchOptions = useMemo(() => {
    const query = matriarchLookupQuery.trim().toLowerCase();
    const femaleOptions = existingParentLookupOptions.filter((person) => person.gender === "female");
    if (!query) return femaleOptions;
    return femaleOptions.filter(
      (person) =>
        person.displayName.toLowerCase().includes(query) || person.personId.toLowerCase().includes(query),
    );
  }, [existingParentLookupOptions, matriarchLookupQuery]);

  return (
    <div className="settings-stack">
      <div className="settings-top-tabs" role="tablist" aria-label="Settings sections">
        <button
          type="button"
          className={`settings-top-tab ${activeTab === "user_admin" ? "active" : ""}`}
          onClick={() => setActiveTab("user_admin")}
        >
          Users &amp; Access
        </button>
        <button
          type="button"
          className={`settings-top-tab ${activeTab === "family_groups" ? "active" : ""}`}
          onClick={() => setActiveTab("family_groups")}
        >
          Family Groups
        </button>
        <button
          type="button"
          className={`settings-top-tab ${activeTab === "integrity" ? "active" : ""}`}
          onClick={() => setActiveTab("integrity")}
        >
          Data &amp; System
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
            className={`button secondary tap-button ${showCreateFamilyModal ? "game-option-selected" : ""}`}
            onClick={openCreateFamilyModal}
          >
            Create Group
          </button>
          <button
            type="button"
            className="button secondary tap-button"
            onClick={openDeleteFamilyModal}
          >
            Delete Family Group
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
        {newTenantStatus ? <p>{newTenantStatus}</p> : null}
        </section>
      ) : null}

      {activeTab === "user_admin" ? (
        <section className="card settings-panel">
        <h2 style={{ marginTop: 0, marginBottom: "0.35rem" }}>Users &amp; Access</h2>
        <p className="page-subtitle" style={{ marginTop: 0 }}>Manage users, family access, and password policy.</p>
        <div className="settings-toolbar-row">
          <div className="settings-toolbar-field">
            <label className="label">Family Group</label>
            <select className="input" value={selectedTenantKey} onChange={(e) => setSelectedTenantKey(e.target.value)}>
              {tenantOptions.map((option) => (
                <option key={option.tenantKey} value={option.tenantKey}>
                  {option.tenantName} ({option.role})
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="button tap-button settings-toolbar-action"
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
        <div className="settings-subtabs">
          <button
            type="button"
            className={`settings-subtab ${userAdminSubTab === "directory" ? "active" : ""}`}
            onClick={() => {
              setUserAdminSubTab("directory");
              setShowAddUserForm(false);
            }}
          >
            User Directory
          </button>
          <button
            type="button"
            className={`settings-subtab ${userAdminSubTab === "family_access" ? "active" : ""}`}
            onClick={() => {
              setUserAdminSubTab("family_access");
              setShowAddUserForm(false);
            }}
          >
            Family Access
          </button>
          <button
            type="button"
            className={`settings-subtab ${userAdminSubTab === "password_policy" ? "active" : ""}`}
            onClick={() => {
              setUserAdminSubTab("password_policy");
              setShowAddUserForm(false);
            }}
          >
            Password Policy
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

            <div className="card settings-users-card" style={{ marginTop: "0.75rem" }}>
              <h3 style={{ marginTop: 0, marginBottom: "0.75rem" }}>Users</h3>
              <div className="settings-table-wrap">
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
                          <td>
                            <span className={`settings-status-chip ${hasGoogle ? "is-on" : "is-off"}`}>
                              {hasGoogle ? "Connected" : "Disabled"}
                            </span>
                          </td>
                          <td>
                            <span className={`settings-status-chip ${hasLocal ? "is-on" : "is-off"}`}>
                              {hasLocal ? "Enabled" : "Disabled"}
                            </span>
                          </td>
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
            </div>
            {directoryPeople.length === 0 ? (
              <p className="page-subtitle" style={{ marginTop: "0.5rem" }}>
                No users found for this family group. Add user access for a person in this family to populate the directory.
              </p>
            ) : null}

          </>
        ) : null}

        {userAdminSubTab === "family_access" ? (
          <>
            <h3 style={{ marginTop: 0 }}>Family Group Access</h3>
            <p className="page-subtitle">
              People in this family group can be switched on/off for family visibility and access.
            </p>
            <div className="settings-table-wrap">
              <table className="settings-table">
                <thead>
                  <tr><th>Person</th><th>Family Access Enabled</th></tr>
                </thead>
                <tbody>
                  {familyAccessRows.length > 0 ? familyAccessRows.map((row) => (
                    <tr key={`fam-access-${row.personId}`}>
                      <td>{row.displayName}</td>
                      <td>
                        <label className="label" style={{ margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={row.isEnabled}
                            onChange={(e) => void toggleFamilyAccess(row.personId, e.target.checked)}
                          />{" "}
                          {row.isEnabled ? "On" : "Off"}
                        </label>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={2}>No family membership links found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {familyAccessStatus ? <p>{familyAccessStatus}</p> : null}
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
        <section className="card settings-panel">
        <h2 style={{ marginTop: 0, marginBottom: "0.35rem" }}>Data &amp; System</h2>
        <p className="page-subtitle" style={{ marginTop: 0 }}>Import worksheet data and run system integrity diagnostics.</p>
        <div className="settings-toolbar-row">
          <div className="settings-toolbar-field">
            <label className="label">Family Group</label>
            <select className="input" value={selectedTenantKey} onChange={(e) => setSelectedTenantKey(e.target.value)}>
              {tenantOptions.map((option) => (
                <option key={option.tenantKey} value={option.tenantKey}>
                  {option.tenantName} ({option.role})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="card" style={{ marginTop: "0.75rem" }}>
        <h3 style={{ marginTop: 0 }}>Integrity Checker</h3>
        <div className="settings-chip-list" style={{ marginTop: "0.5rem" }}>
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
        </div>

        <div className="card" style={{ marginTop: "0.75rem" }}>
        <h3 style={{ marginTop: 0 }}>CSV Import (Paste)</h3>
        <p className="page-subtitle">Initial data load into selected family group. CSV header must match exactly.</p>
        <div className="settings-subtabs">
          <button
            type="button"
            className={`settings-subtab ${importSubTab === "target" ? "active" : ""}`}
            onClick={() => setImportSubTab("target")}
          >
            Target &amp; Format
          </button>
          <button
            type="button"
            className={`settings-subtab ${importSubTab === "csv" ? "active" : ""}`}
            onClick={() => setImportSubTab("csv")}
          >
            Paste CSV
          </button>
        </div>
        {importSubTab === "target" ? (
          <>
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
        </div>

        <div className="card" style={{ marginTop: "0.75rem" }}>
        <h3 style={{ marginTop: 0 }}>Delete Person / Household</h3>
        <p className="page-subtitle" style={{ marginTop: 0 }}>
          Admin-only destructive actions. Always preview first.
        </p>
        <div className="settings-delete-grid">
          <div className="settings-delete-card">
            <h4 style={{ marginTop: 0 }}>Delete Person</h4>
            <label className="label">Person</label>
            <select
              className="input"
              value={deletePersonId}
              onChange={(e) => {
                setDeletePersonId(e.target.value);
                setDeletePersonPreview(null);
                setDeletePersonStatus("");
              }}
            >
              <option value="">Select person</option>
              {familyPeople.map((person) => (
                <option key={`delete-person-${person.personId}`} value={person.personId}>
                  {person.displayName}
                </option>
              ))}
            </select>
            <div className="settings-chip-list">
              <button
                type="button"
                className="button secondary tap-button"
                onClick={previewDeletePerson}
                disabled={deletePersonBusy}
              >
                Preview Delete
              </button>
              <button
                type="button"
                className="button tap-button"
                onClick={executeDeletePerson}
                disabled={deletePersonBusy || !deletePersonPreview}
              >
                Confirm Delete Person
              </button>
            </div>
            {deletePersonPreview ? (
              <div className="settings-table-wrap" style={{ marginTop: "0.75rem" }}>
                <table className="settings-table settings-table-compact">
                  <thead>
                    <tr><th>Impact</th><th>Count</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>People rows</td><td>{deletePersonPreview.counts.peopleRowsToDelete}</td></tr>
                    <tr><td>PersonFamilyGroups rows</td><td>{deletePersonPreview.counts.personFamilyRowsToDelete}</td></tr>
                    <tr><td>UserFamilyGroups rows</td><td>{deletePersonPreview.counts.userFamilyRowsToDelete}</td></tr>
                    <tr><td>UserAccess rows</td><td>{deletePersonPreview.counts.userAccessRowsToDelete}</td></tr>
                    <tr><td>Relationships rows</td><td>{deletePersonPreview.counts.relationshipRowsToDelete}</td></tr>
                    <tr><td>Households rows</td><td>{deletePersonPreview.counts.householdRowsToDelete}</td></tr>
                    <tr><td>PersonAttributes rows</td><td>{deletePersonPreview.counts.attributeRowsToDelete}</td></tr>
                    <tr><td>ImportantDates rows</td><td>{deletePersonPreview.counts.importantDateRowsToDelete}</td></tr>
                    <tr><td>Other family memberships (enabled)</td><td>{deletePersonPreview.counts.enabledMembershipsInOtherFamilies}</td></tr>
                  </tbody>
                </table>
                {deletePersonPreview.householdIds.length > 0 ? (
                  <p className="page-subtitle" style={{ marginTop: "0.5rem" }}>
                    Household IDs impacted: {deletePersonPreview.householdIds.join(", ")}
                  </p>
                ) : null}
              </div>
            ) : null}
            {deletePersonStatus ? <p style={{ marginTop: "0.5rem" }}>{deletePersonStatus}</p> : null}
          </div>

          <div className="settings-delete-card">
            <h4 style={{ marginTop: 0 }}>Delete Household</h4>
            <div className="settings-chip-list">
              <button
                type="button"
                className="button secondary tap-button"
                onClick={loadDeleteHouseholdOptions}
                disabled={deleteHouseholdOptionsBusy}
              >
                Load Households
              </button>
            </div>
            <label className="label">Select Household</label>
            <select
              className="input"
              value={deleteHouseholdId}
              onChange={(e) => {
                setDeleteHouseholdId(e.target.value);
                setDeleteHouseholdPreview(null);
                setDeleteHouseholdStatus("");
              }}
            >
              <option value="">Select household</option>
              {deleteHouseholdOptions.map((option) => {
                const labelBits = [
                  option.label || option.householdId,
                  [option.husbandName || option.husbandPersonId, option.wifeName || option.wifePersonId]
                    .filter(Boolean)
                    .join(" / "),
                ].filter(Boolean);
                return (
                  <option key={`delete-household-option-${option.householdId}`} value={option.householdId}>
                    {`${labelBits.join(" - ")} (${option.householdId})`}
                  </option>
                );
              })}
            </select>
            <label className="label">Or Enter Household ID</label>
            <input
              className="input"
              value={deleteHouseholdId}
              onChange={(e) => {
                setDeleteHouseholdId(e.target.value);
                setDeleteHouseholdPreview(null);
                setDeleteHouseholdStatus("");
              }}
              placeholder="fu-..."
            />
            <div className="settings-chip-list">
              <button
                type="button"
                className="button secondary tap-button"
                onClick={previewDeleteHousehold}
                disabled={deleteHouseholdBusy}
              >
                Preview Delete
              </button>
              <button
                type="button"
                className="button tap-button"
                onClick={executeDeleteHousehold}
                disabled={deleteHouseholdBusy || !deleteHouseholdPreview}
              >
                Confirm Delete Household
              </button>
            </div>
            {deleteHouseholdOptionsStatus ? <p style={{ marginTop: "0.5rem" }}>{deleteHouseholdOptionsStatus}</p> : null}
            {deleteHouseholdPreview ? (
              <div className="settings-table-wrap" style={{ marginTop: "0.75rem" }}>
                <table className="settings-table">
                  <thead>
                    <tr><th>Impact</th><th>Value</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>Household ID</td><td>{deleteHouseholdPreview.householdId}</td></tr>
                    <tr><td>Label</td><td>{deleteHouseholdPreview.householdLabel || "-"}</td></tr>
                    <tr><td>Husband</td><td>{deleteHouseholdPreview.husbandPersonId || "-"}</td></tr>
                    <tr><td>Wife</td><td>{deleteHouseholdPreview.wifePersonId || "-"}</td></tr>
                    <tr><td>Household rows</td><td>{deleteHouseholdPreview.counts.householdRowsToDelete}</td></tr>
                    <tr><td>Spouse/family relationship rows</td><td>{deleteHouseholdPreview.counts.spouseRelationshipRowsToDelete}</td></tr>
                  </tbody>
                </table>
              </div>
            ) : null}
            {deleteHouseholdStatus ? <p style={{ marginTop: "0.5rem" }}>{deleteHouseholdStatus}</p> : null}
          </div>
        </div>
        </div>
        </section>
      ) : null}

      {showDeleteFamilyModal ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
            zIndex: 60,
          }}
        >
          <section className="card" style={{ width: "min(960px, 100%)", maxHeight: "85vh", overflow: "auto" }}>
            <h3 style={{ marginTop: 0 }}>Delete Family Group</h3>
            <p className="page-subtitle" style={{ marginTop: 0 }}>
              This removes family-group links/config only. People and households are NOT deleted.
            </p>
            <label className="label">Family Group</label>
            <select className="input" value={deleteFamilyKey} onChange={(e) => setDeleteFamilyKey(e.target.value)}>
              <option value="">Select family group</option>
              {tenantOptions.map((option) => (
                <option key={`delete-family-${option.tenantKey}`} value={option.tenantKey}>
                  {option.tenantName} ({option.role})
                </option>
              ))}
            </select>
            <div className="settings-chip-list" style={{ marginTop: "0.75rem" }}>
              <button
                type="button"
                className="button tap-button"
                onClick={() => loadDeleteFamilyPreview(deleteFamilyKey)}
                disabled={deleteFamilyBusy}
              >
                Preview Deletion Impact
              </button>
              <button
                type="button"
                className="button tap-button"
                onClick={executeDeleteFamily}
                disabled={deleteFamilyBusy || !deleteFamilyPreview}
              >
                Confirm Delete Family Group
              </button>
              <button
                type="button"
                className="button secondary tap-button"
                onClick={() => setShowDeleteFamilyModal(false)}
                disabled={deleteFamilyBusy}
              >
                Close
              </button>
            </div>
            <label className="label" style={{ marginTop: "0.75rem" }}>
              <input
                type="checkbox"
                checked={disableOrphanedUsers}
                onChange={(e) => setDisableOrphanedUsers(e.target.checked)}
              />{" "}
              Disable users with logins who would have no access to any remaining family group (default: yes)
            </label>

            {deleteFamilyPreview ? (
              <div className="settings-table-wrap" style={{ marginTop: "0.75rem" }}>
                <table className="settings-table">
                  <thead>
                    <tr><th>Impact</th><th>Count</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>PersonFamilyGroups rows to delete</td><td>{deleteFamilyPreview.counts.personFamilyRowsToDelete}</td></tr>
                    <tr><td>UserFamilyGroups rows to delete</td><td>{deleteFamilyPreview.counts.userFamilyRowsToDelete}</td></tr>
                    <tr><td>Family config/policy rows to delete</td><td>{deleteFamilyPreview.counts.familyConfigRowsToDelete + deleteFamilyPreview.counts.familyPolicyRowsToDelete}</td></tr>
                    <tr><td>People that would become orphaned (no family groups)</td><td>{deleteFamilyPreview.counts.orphanPeople}</td></tr>
                    <tr><td>Households that would become orphaned (no family groups)</td><td>{deleteFamilyPreview.counts.orphanHouseholds}</td></tr>
                    <tr><td>Users eligible for disable</td><td>{deleteFamilyPreview.counts.usersToDisable}</td></tr>
                  </tbody>
                </table>
                <table className="settings-table" style={{ marginTop: "0.75rem" }}>
                  <thead>
                    <tr><th>Orphaned People</th></tr>
                  </thead>
                  <tbody>
                    {deleteFamilyPreview.orphanPeople.length > 0 ? deleteFamilyPreview.orphanPeople.map((person) => (
                      <tr key={`orphan-person-${person.personId}`}>
                        <td>{person.displayName} ({person.personId})</td>
                      </tr>
                    )) : (
                      <tr><td>-</td></tr>
                    )}
                  </tbody>
                </table>
                <table className="settings-table" style={{ marginTop: "0.75rem" }}>
                  <thead>
                    <tr><th>Orphaned Households</th><th>Husband</th><th>Wife</th></tr>
                  </thead>
                  <tbody>
                    {deleteFamilyPreview.orphanHouseholds.length > 0 ? deleteFamilyPreview.orphanHouseholds.map((unit) => (
                      <tr key={`orphan-household-${unit.householdId}`}>
                        <td>{unit.householdId}</td>
                        <td>{unit.husbandPersonId || "-"}</td>
                        <td>{unit.wifePersonId || "-"}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={3}>-</td></tr>
                    )}
                  </tbody>
                </table>
                <table className="settings-table" style={{ marginTop: "0.75rem" }}>
                  <thead>
                    <tr><th>Users To Disable</th><th>Email</th><th>Username</th><th>Reason</th></tr>
                  </thead>
                  <tbody>
                    {deleteFamilyPreview.usersToDisable.length > 0 ? deleteFamilyPreview.usersToDisable.map((user) => (
                      <tr key={`disable-user-${user.personId}-${user.userEmail}`}>
                        <td>{user.personId}</td>
                        <td>{user.userEmail || "-"}</td>
                        <td>{user.username || "-"}</td>
                        <td>{user.reason}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={4}>-</td></tr>
                    )}
                  </tbody>
                </table>
                <table className="settings-table" style={{ marginTop: "0.75rem" }}>
                  <thead>
                    <tr><th>Family Attributes To Delete</th><th>Source</th><th>Sample</th></tr>
                  </thead>
                  <tbody>
                    {deleteFamilyPreview.familyAttributesToDelete.length > 0 ? deleteFamilyPreview.familyAttributesToDelete.map((row) => (
                      <tr key={`delete-attr-${row.source}-${row.rowNumber}`}>
                        <td>{row.data.family_group_name || row.data.family_group_key || "-"}</td>
                        <td>{row.source}</td>
                        <td>{JSON.stringify(row.data).slice(0, 140)}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={3}>-</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : null}
            {deleteFamilyStatus ? <p style={{ marginTop: "0.75rem" }}>{deleteFamilyStatus}</p> : null}
          </section>
        </div>
      ) : null}

      {showCreateFamilyModal ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
            zIndex: 60,
          }}
        >
          <section className="card" style={{ width: "min(960px, 100%)", maxHeight: "85vh", overflow: "auto" }}>
            <h3 style={{ marginTop: 0 }}>Create Family Group</h3>
            <p className="page-subtitle" style={{ marginTop: 0 }}>
              Step {createFamilyStep} of 4. Enter parents first, then select initial admin and optional spouse/children import.
            </p>
            {createFamilyStep === 1 ? (
              <div>
                <h4 style={{ marginTop: 0 }}>Matriarch</h4>
                <label className="label">Initial Admin (existing person)</label>
                <select
                  className="input"
                  value={newInitialAdminPersonId}
                  onChange={(e) => {
                    setNewInitialAdminPersonId(e.target.value);
                    setPreCreateHouseholdCandidates([]);
                    setPreCreateMemberPersonIds([]);
                    setPreCreatePreviewStatus("");
                  }}
                >
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
                    checked={useExistingMatriarch}
                    onChange={(e) => setUseExistingMatriarch(e.target.checked)}
                  />{" "}
                  Use existing matriarch from people list
                </label>
                {useExistingMatriarch ? (
                  <>
                    <label className="label">Search Existing People</label>
                    <input
                      className="input"
                      value={matriarchLookupQuery}
                      onChange={(e) => setMatriarchLookupQuery(e.target.value)}
                      placeholder="Search name or person ID"
                    />
                    <label className="label">Select Matriarch</label>
                    <select className="input" value={existingMatriarchPersonId} onChange={(e) => setExistingMatriarchPersonId(e.target.value)}>
                      <option value="">Select existing person</option>
                      {filteredMatriarchOptions.map((person) => (
                        <option key={`matriarch-${person.personId}`} value={person.personId}>
                          {person.displayName}
                        </option>
                      ))}
                    </select>
                    {existingMatriarchPersonId ? (
                      <p className="page-subtitle" style={{ marginTop: "0.5rem" }}>
                        Using existing matriarch: {newMatriarchFullName || existingMatriarchPersonId}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <label className="label">First Name</label>
                    <input className="input" value={newMatriarchFirstName} onChange={(e) => setNewMatriarchFirstName(e.target.value)} />
                    <label className="label">Middle Name</label>
                    <input className="input" value={newMatriarchMiddleName} onChange={(e) => setNewMatriarchMiddleName(e.target.value)} />
                    <label className="label">Last Name</label>
                    <input className="input" value={newMatriarchLastName} onChange={(e) => setNewMatriarchLastName(e.target.value)} />
                    <label className="label">Nickname</label>
                    <input className="input" value={newMatriarchNickName} onChange={(e) => setNewMatriarchNickName(e.target.value)} />
                    <label className="label">Birthdate</label>
                    <input className="input" type="date" value={newMatriarchBirthDate} onChange={(e) => setNewMatriarchBirthDate(e.target.value)} />
                  </>
                )}
                <label className="label">Maiden Name</label>
                <input className="input" value={newMatriarchMaidenName} onChange={(e) => setNewMatriarchMaidenName(e.target.value)} />
              </div>
            ) : null}

            {createFamilyStep === 2 ? (
              <div>
                <h4 style={{ marginTop: 0 }}>Patriarch</h4>
                <label className="label">
                  <input
                    type="checkbox"
                    checked={useExistingPatriarch}
                    onChange={(e) => setUseExistingPatriarch(e.target.checked)}
                  />{" "}
                  Use existing patriarch from people list
                </label>
                {useExistingPatriarch ? (
                  <>
                    <label className="label">Search Existing People</label>
                    <input
                      className="input"
                      value={patriarchLookupQuery}
                      onChange={(e) => setPatriarchLookupQuery(e.target.value)}
                      placeholder="Search name or person ID"
                    />
                    <label className="label">Select Patriarch</label>
                    <select className="input" value={existingPatriarchPersonId} onChange={(e) => setExistingPatriarchPersonId(e.target.value)}>
                      <option value="">Select existing person</option>
                      {filteredPatriarchOptions.map((person) => (
                        <option key={`patriarch-${person.personId}`} value={person.personId}>
                          {person.displayName}
                        </option>
                      ))}
                    </select>
                    {existingPatriarchPersonId ? (
                      <p className="page-subtitle" style={{ marginTop: "0.5rem" }}>
                        Using existing patriarch: {newPatriarchFullName || existingPatriarchPersonId}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <label className="label">First Name</label>
                    <input className="input" value={newPatriarchFirstName} onChange={(e) => setNewPatriarchFirstName(e.target.value)} />
                    <label className="label">Middle Name</label>
                    <input className="input" value={newPatriarchMiddleName} onChange={(e) => setNewPatriarchMiddleName(e.target.value)} />
                    <label className="label">Last Name</label>
                    <input className="input" value={newPatriarchLastName} onChange={(e) => setNewPatriarchLastName(e.target.value)} />
                    <label className="label">Nickname</label>
                    <input className="input" value={newPatriarchNickName} onChange={(e) => setNewPatriarchNickName(e.target.value)} />
                    <label className="label">Birthdate</label>
                    <input className="input" type="date" value={newPatriarchBirthDate} onChange={(e) => setNewPatriarchBirthDate(e.target.value)} />
                  </>
                )}
                <label className="label">Suggested Family Group Key</label>
                <input className="input" value={generatedFamilyGroupKey} readOnly />
                <label className="label">Suggested Family Group Name</label>
                <input className="input" value={generatedFamilyGroupName} readOnly />
              </div>
            ) : null}

            {createFamilyStep === 3 ? (
              <div>
                <h4 style={{ marginTop: 0 }}>Import Preview (Optional)</h4>
                <p className="page-subtitle" style={{ marginTop: 0 }}>
                  Spouse and children import is enabled by default. Load preview only if you want to review or uncheck specific people.
                </p>
                <label className="label">
                  <input
                    type="checkbox"
                    checked={newParentsAreInitialAdminParents}
                    onChange={(e) => setNewParentsAreInitialAdminParents(e.target.checked)}
                  />{" "}
                  Matriarch and patriarch are the parents of the initial admin
                </label>
                <label className="label">
                  <input
                    type="checkbox"
                    checked={newIncludeHouseholdCandidates}
                    onChange={(e) => setNewIncludeHouseholdCandidates(e.target.checked)}
                  />{" "}
                  Import spouse and children of initial admin
                </label>
                {newIncludeHouseholdCandidates ? (
                  <div className="settings-chip-list">
                    <button type="button" className="button secondary tap-button" onClick={previewCreateFamilyCandidates}>
                      Load Suggested Spouse/Children
                    </button>
                  </div>
                ) : null}
                {preCreatePreviewStatus ? <p>{preCreatePreviewStatus}</p> : null}
                {preCreateHouseholdCandidates.length > 0 ? (
                  <div className="settings-table-wrap" style={{ maxHeight: "220px", overflow: "auto" }}>
                    <table className="settings-table">
                      <thead>
                        <tr><th>Import</th><th>Person</th></tr>
                      </thead>
                      <tbody>
                        {preCreateHouseholdCandidates.map((person) => (
                          <tr key={`pre-create-${person.personId}`}>
                            <td>
                              <input
                                type="checkbox"
                                checked={preCreateMemberPersonIds.includes(person.personId)}
                                onChange={() => togglePreCreateMemberPersonId(person.personId)}
                              />
                            </td>
                            <td>{person.displayName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : null}

            {createFamilyStep === 4 ? (
              <div>
                <h4 style={{ marginTop: 0 }}>Review and Create</h4>
                <label className="label">Family Group Key</label>
                <input className="input" value={newTenantKey} onChange={(e) => setNewTenantKey(e.target.value)} placeholder={generatedFamilyGroupKey || "snowestes"} />
                <label className="label">Family Group Name (editable)</label>
                <input className="input" value={newTenantName} onChange={(e) => setNewTenantName(e.target.value)} placeholder={generatedFamilyGroupName || "Snow-Estes Family"} />
                <table className="settings-table" style={{ marginTop: "0.75rem" }}>
                  <thead>
                    <tr><th>Item</th><th>Value</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>Source Family</td><td>{selectedTenantOption?.tenantName ?? selectedTenantKey}</td></tr>
                    <tr><td>Matriarch</td><td>{newMatriarchFullName || "-"}</td></tr>
                    <tr><td>Patriarch</td><td>{newPatriarchFullName || "-"}</td></tr>
                    <tr><td>Initial Admin</td><td>{createGroupInitialAdminOptions.find((person) => person.personId === newInitialAdminPersonId)?.displayName ?? "-"}</td></tr>
                    <tr><td>Parents of Initial Admin</td><td>{newParentsAreInitialAdminParents ? "Yes" : "No"}</td></tr>
                    <tr><td>Import spouse/children</td><td>{newIncludeHouseholdCandidates ? "Yes" : "No"}</td></tr>
                    <tr><td>Selected import people</td><td>{preCreateMemberPersonIds.length}</td></tr>
                  </tbody>
                </table>
                {!newTenantStatus || newTenantStatus.startsWith("Failed:") ? (
                  <div className="settings-chip-list" style={{ marginTop: "0.75rem" }}>
                    <button type="button" className="button tap-button" onClick={createTenant}>
                      Create Family Group
                    </button>
                  </div>
                ) : null}
                {postCreateHouseholdCandidates.length > 0 && postCreateTargetFamilyKey && !postCreateAutoImported ? (
                  <div className="card" style={{ marginTop: "0.75rem" }}>
                    <h4 style={{ marginTop: 0 }}>Optional Additional Import</h4>
                    <p className="page-subtitle" style={{ marginTop: 0 }}>
                      Review suggested spouse/children. Uncheck anyone you do not want to import.
                    </p>
                    <div className="settings-table-wrap" style={{ maxHeight: "180px", overflow: "auto" }}>
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
                    <div className="settings-chip-list">
                      <button type="button" className="button secondary tap-button" onClick={importPostCreateMembers}>
                        Import To New Family
                      </button>
                    </div>
                    {postCreateImportStatus ? <p>{postCreateImportStatus}</p> : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="settings-chip-list" style={{ marginTop: "0.75rem" }}>
              {createFamilyStep > 1 ? (
                <button
                  type="button"
                  className="button secondary tap-button"
                  onClick={() => {
                    setNewTenantStatus("");
                    setCreateFamilyDebugNotes("");
                    setCreateFamilyStep((current) => (current > 1 ? ((current - 1) as 1 | 2 | 3 | 4) : 1));
                  }}
                >
                  Back
                </button>
              ) : null}
              {createFamilyStep < 4 ? (
                <button
                  type="button"
                  className="button tap-button"
                  onClick={async () => {
                    if (createFamilyStep === 1) {
                      if (!newInitialAdminPersonId.trim()) {
                        setNewTenantStatus("Select an initial admin before continuing.");
                        return;
                      }
                      if (!newMatriarchMaidenName.trim()) {
                        setNewTenantStatus("Matriarch maiden name is required.");
                        return;
                      }
                      if (useExistingMatriarch && !existingMatriarchPersonId.trim()) {
                        setNewTenantStatus("Select an existing matriarch.");
                        return;
                      }
                      if (!useExistingMatriarch && (!newMatriarchFirstName.trim() || !newMatriarchLastName.trim() || !newMatriarchBirthDate.trim())) {
                        setNewTenantStatus("Matriarch first name, last name, and birthdate are required.");
                        return;
                      }
                    }
                    if (createFamilyStep === 2) {
                      if (useExistingPatriarch && !existingPatriarchPersonId.trim()) {
                        setNewTenantStatus("Select an existing patriarch.");
                        return;
                      }
                      if (!useExistingPatriarch && (!newPatriarchFirstName.trim() || !newPatriarchLastName.trim() || !newPatriarchBirthDate.trim())) {
                        setNewTenantStatus("Patriarch first name, last name, and birthdate are required.");
                        return;
                      }
                    }
                    if (createFamilyStep === 3) {
                      // Preview is optional. Create flow can continue without preloading candidates.
                    }
                    setNewTenantStatus("");
                    setCreateFamilyDebugNotes("");
                    setCreateFamilyStep((current) => (current < 4 ? ((current + 1) as 1 | 2 | 3 | 4) : 4));
                  }}
                >
                  Next
                </button>
              ) : null}
              <button type="button" className="button secondary tap-button" onClick={() => setShowCreateFamilyModal(false)}>
                Close
              </button>
            </div>
            {newTenantStatus ? <p>{newTenantStatus}</p> : null}
            {createFamilyDebugNotes ? (
              <p className="page-subtitle" style={{ whiteSpace: "pre-wrap" }}>
                Debug: {createFamilyDebugNotes}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
