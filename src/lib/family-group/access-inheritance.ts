import "server-only";

import { getTableRecords } from "@/lib/data/runtime";

export type FamilyGroupAccessGrant = {
  tenantKey: string;
  tenantName: string;
};

export type ProvisionableUserIdentity = {
  kind: "google" | "local";
  userEmail: string;
};

export type FamilyGroupAccessInheritanceSnapshot = {
  parentIdsByChild: Map<string, Set<string>>;
  enabledMembershipsByPerson: Map<string, Set<string>>;
  enabledAccessKeysByPerson: Map<string, Set<string>>;
  tenantNamesByKey: Map<string, string>;
  googleEmailByPerson: Map<string, string>;
  localAliasByPerson: Map<string, string>;
};

function normalize(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function parseBool(value?: string) {
  const normalized = normalize(value);
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

function isLocalAliasEmail(value: string) {
  return normalize(value).endsWith("@local");
}

function readValue(record: Record<string, string>, ...keys: string[]) {
  const lowered = new Map(Object.entries(record).map(([key, value]) => [normalize(key), value]));
  for (const key of keys) {
    const out = lowered.get(normalize(key));
    if (out !== undefined) {
      return out.trim();
    }
  }
  return "";
}

function addSetValue(map: Map<string, Set<string>>, key: string, value: string) {
  if (!key || !value) {
    return;
  }
  const existing = map.get(key);
  if (existing) {
    existing.add(value);
    return;
  }
  map.set(key, new Set([value]));
}

export async function loadFamilyGroupAccessInheritanceSnapshot(): Promise<FamilyGroupAccessInheritanceSnapshot> {
  const [relationshipRows, membershipRows, accessRows, familyConfigRows, userAccessRows] = await Promise.all([
    getTableRecords("Relationships").catch(() => []),
    getTableRecords("PersonFamilyGroups").catch(() => []),
    getTableRecords("UserFamilyGroups").catch(() => []),
    getTableRecords(["FamilyConfig", "TenantConfig"]).catch(() => []),
    getTableRecords("UserAccess").catch(() => []),
  ]);

  const parentIdsByChild = new Map<string, Set<string>>();
  for (const row of relationshipRows) {
    const relType = normalize(readValue(row.data, "rel_type"));
    if (relType !== "parent") {
      continue;
    }
    const parentId = readValue(row.data, "from_person_id");
    const childId = readValue(row.data, "to_person_id");
    addSetValue(parentIdsByChild, childId, parentId);
  }

  const enabledMembershipsByPerson = new Map<string, Set<string>>();
  for (const row of membershipRows) {
    const personId = readValue(row.data, "person_id");
    const tenantKey = normalize(readValue(row.data, "family_group_key", "tenant_key"));
    if (!personId || !tenantKey || !parseBool(row.data.is_enabled)) {
      continue;
    }
    addSetValue(enabledMembershipsByPerson, personId, tenantKey);
  }

  const enabledAccessKeysByPerson = new Map<string, Set<string>>();
  const localAliasByPerson = new Map<string, string>();
  for (const row of accessRows) {
    const personId = readValue(row.data, "person_id");
    const tenantKey = normalize(readValue(row.data, "family_group_key", "tenant_key"));
    const userEmail = normalize(readValue(row.data, "user_email"));
    if (!personId || !tenantKey || !parseBool(row.data.is_enabled)) {
      continue;
    }
    addSetValue(enabledAccessKeysByPerson, personId, tenantKey);
    if (userEmail && isLocalAliasEmail(userEmail) && !localAliasByPerson.has(personId)) {
      localAliasByPerson.set(personId, userEmail);
    }
  }

  const tenantNamesByKey = new Map<string, string>();
  for (const row of familyConfigRows) {
    const tenantKey = normalize(readValue(row.data, "family_group_key", "tenant_key"));
    const tenantName = readValue(row.data, "family_group_name", "tenant_name");
    if (!tenantKey || tenantNamesByKey.has(tenantKey)) {
      continue;
    }
    tenantNamesByKey.set(tenantKey, tenantName || tenantKey);
  }

  const googleEmailByPerson = new Map<string, string>();
  for (const row of userAccessRows) {
    const personId = readValue(row.data, "person_id");
    if (!personId) {
      continue;
    }
    const googleEnabled = parseBool(row.data.google_access);
    const localEnabled = parseBool(row.data.local_access);
    const userEmail = normalize(readValue(row.data, "user_email"));
    const username = normalize(readValue(row.data, "username"));
    if (googleEnabled && userEmail && !googleEmailByPerson.has(personId)) {
      googleEmailByPerson.set(personId, userEmail);
    }
    if (localEnabled && !localAliasByPerson.has(personId) && username) {
      localAliasByPerson.set(personId, `${username}@local`);
    }
  }

  return {
    parentIdsByChild,
    enabledMembershipsByPerson,
    enabledAccessKeysByPerson,
    tenantNamesByKey,
    googleEmailByPerson,
    localAliasByPerson,
  };
}

export function deriveInheritedFamilyGroupAccessGrants(
  personId: string,
  snapshot: FamilyGroupAccessInheritanceSnapshot,
  options?: { excludeTenantKeys?: Iterable<string> },
): FamilyGroupAccessGrant[] {
  const normalizedPersonId = personId.trim();
  if (!normalizedPersonId) {
    return [];
  }

  const excluded = new Set(Array.from(options?.excludeTenantKeys ?? []).map((value) => normalize(value)));
  const memberOf = snapshot.enabledMembershipsByPerson.get(normalizedPersonId) ?? new Set<string>();
  const parentIds = snapshot.parentIdsByChild.get(normalizedPersonId) ?? new Set<string>();
  const inheritedKeys = new Set<string>();

  for (const parentId of parentIds) {
    const parentAccessKeys = snapshot.enabledAccessKeysByPerson.get(parentId) ?? new Set<string>();
    for (const tenantKey of parentAccessKeys) {
      if (!memberOf.has(tenantKey) || excluded.has(tenantKey)) {
        continue;
      }
      inheritedKeys.add(tenantKey);
    }
  }

  return Array.from(inheritedKeys)
    .map((tenantKey) => ({
      tenantKey,
      tenantName: snapshot.tenantNamesByKey.get(tenantKey) ?? tenantKey,
    }))
    .sort((a, b) => a.tenantName.localeCompare(b.tenantName));
}

export async function getInheritedFamilyGroupAccessGrants(
  personId: string,
  options?: { excludeTenantKeys?: Iterable<string> },
) {
  const snapshot = await loadFamilyGroupAccessInheritanceSnapshot();
  return deriveInheritedFamilyGroupAccessGrants(personId, snapshot, options);
}

export function getProvisionableUserIdentities(
  personId: string,
  snapshot: FamilyGroupAccessInheritanceSnapshot,
): ProvisionableUserIdentity[] {
  const normalizedPersonId = personId.trim();
  if (!normalizedPersonId) {
    return [];
  }
  const identities: ProvisionableUserIdentity[] = [];
  const googleEmail = snapshot.googleEmailByPerson.get(normalizedPersonId);
  if (googleEmail) {
    identities.push({ kind: "google", userEmail: googleEmail });
  }
  const localAlias = snapshot.localAliasByPerson.get(normalizedPersonId);
  if (localAlias) {
    identities.push({ kind: "local", userEmail: localAlias });
  }
  return identities;
}
