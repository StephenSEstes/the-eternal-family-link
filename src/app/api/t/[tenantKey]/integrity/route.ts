import { NextResponse } from "next/server";
import { buildEntityId } from "@/lib/entity-id";
import { buildMediaId, buildMediaLinkId } from "@/lib/media/ids";
import {
  createTableRecord,
  createTableRecords,
  deleteTableRows,
  getPeople,
  PERSON_ATTRIBUTES_TABLE,
  getTableRecords,
  getTenantConfig,
  listTables,
  updateTableRecordById,
} from "@/lib/data/runtime";
import { requireTenantAdmin } from "@/lib/family-group/guard";
import { auditOrRepairFamilyGroupRelationshipTypes } from "@/lib/family-group/relationship-type";

type IntegritySeverity = "error" | "warn";

type IntegrityFinding = {
  severity: IntegritySeverity;
  code: string;
  message: string;
  count: number;
  sample: string[];
};

function readField(record: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function parseBool(value: string) {
  const out = value.trim().toLowerCase();
  return out === "true" || out === "yes" || out === "1";
}

function isEnabledLike(value: string | undefined) {
  const out = (value ?? "").trim().toLowerCase();
  if (!out) return true;
  return out === "true" || out === "yes" || out === "1";
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function normalizeNameKey(value: string) {
  return normalize(value)
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNamePart(value: string) {
  const cleaned = value.trim().replace(/[^a-zA-Z\s'-]/g, " ").replace(/\s+/g, " ");
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function buildHouseholdLabel(wifeLastName: string, husbandLastName: string) {
  const wife = normalizeNamePart(wifeLastName);
  const husband = normalizeNamePart(husbandLastName);
  if (wife && husband) {
    return `${wife}-${husband} Family`;
  }
  if (wife) {
    return `${wife} Family`;
  }
  if (husband) {
    return `${husband} Family`;
  }
  return "Family";
}

function resolveHouseholdRoles(
  personA: string,
  personB: string,
  peopleById: Map<string, { gender: string }>,
): { husband: string; wife: string } {
  const personAGender = (peopleById.get(personA)?.gender ?? "").toLowerCase();
  const personBGender = (peopleById.get(personB)?.gender ?? "").toLowerCase();
  if (personAGender === "female" && personBGender === "male") {
    return { husband: personB, wife: personA };
  }
  if (personAGender === "male" && personBGender === "female") {
    return { husband: personA, wife: personB };
  }
  const sorted = [personA, personB].sort();
  return { husband: sorted[0], wife: sorted[1] };
}

function getHouseholdOccupants(record: Record<string, string>) {
  const husband = normalize(readField(record, "husband_person_id"));
  const wife = normalize(readField(record, "wife_person_id"));
  return {
    husband,
    wife,
    memberIds: [husband, wife].filter(Boolean),
  };
}

function householdOccupancyKey(memberIds: string[]) {
  const normalizedIds = Array.from(new Set(memberIds.map((value) => normalize(value)).filter(Boolean))).sort();
  if (normalizedIds.length === 0 || normalizedIds.length > 2) {
    return "";
  }
  if (normalizedIds.length === 1) {
    return `single|${normalizedIds[0]}`;
  }
  return normalizedIds.join("|");
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

function isTempEmailLike(value: string) {
  return /@temp\.org$/i.test(value.trim());
}

function scoreUserFamilyGroupRow(
  data: Record<string, string>,
  preferredEmail: string,
  personId: string,
) {
  const userEmail = readField(data, "user_email").toLowerCase();
  let score = 0;
  if (userEmail) score += 1;
  if (parseBool(readField(data, "is_enabled"))) score += 2;
  if (readField(data, "family_group_name")) score += 1;
  if (normalize(readField(data, "role")) === "admin") score += 1;
  if (preferredEmail && userEmail === preferredEmail) score += 8;
  if (!preferredEmail && userEmail === `${personId}@local`) score += 8;
  if (userEmail && !isTempEmailLike(userEmail)) score += 2;
  if (isTempEmailLike(userEmail)) score -= 4;
  return score;
}

async function deleteRowsByNumber(tableName: string, rowNumbers: number[]) {
  if (rowNumbers.length === 0) {
    return 0;
  }
  return deleteTableRows(tableName, rowNumbers);
}

function relCanonicalKey(fromPersonId: string, toPersonId: string, relType: string) {
  return `${normalize(fromPersonId)}|${normalize(toPersonId)}|${normalize(relType)}`;
}

function boolLike(value: string) {
  return parseBool(value) ? "TRUE" : "FALSE";
}

type ExpectedMediaLink = {
  source: "people_headshot" | "attribute_media";
  familyGroupKey: string;
  entityType: "person" | "attribute";
  entityId: string;
  usageType: string;
  fileId: string;
  label: string;
  description: string;
  photoDate: string;
  mediaMetadata: string;
};

function mediaLinkKey(input: {
  familyGroupKey: string;
  entityType: string;
  entityId: string;
  usageType: string;
  fileId: string;
}) {
  return [
    normalize(input.familyGroupKey),
    normalize(input.entityType),
    normalize(input.entityId),
    normalize(input.usageType),
    normalize(input.fileId),
  ].join("|");
}

async function auditOrRepairOrphanMediaLinks(tenantKey: string, applyChanges: boolean) {
  const familyGroupKey = normalize(tenantKey);
  const [people, attributeRows, householdRows, mediaAssetRows, mediaLinkRows] = await Promise.all([
    getPeople(tenantKey).catch(() => []),
    getTableRecords(PERSON_ATTRIBUTES_TABLE, tenantKey).catch(() => []),
    getTableRecords("Households", tenantKey).catch(() => []),
    getTableRecords("MediaAssets", tenantKey).catch(() => []),
    getTableRecords("MediaLinks", tenantKey).catch(() => []),
  ]);
  const peopleIds = new Set(people.map((person) => normalize(person.personId)).filter(Boolean));
  const householdIds = new Set(
    householdRows.map((row) => normalize(readField(row.data, "household_id"))).filter(Boolean),
  );

  const mediaIdByFileId = new Map<string, string>();
  const knownAssetByFileId = new Set<string>();
  for (const row of mediaAssetRows) {
    const mediaId = readField(row.data, "media_id");
    const fileId = readField(row.data, "file_id");
    if (!mediaId || !fileId) continue;
    mediaIdByFileId.set(fileId, mediaId);
    knownAssetByFileId.add(fileId);
  }
  for (const row of mediaLinkRows) {
    const mediaId = readField(row.data, "media_id");
    const fileId = readField(row.data, "file_id");
    if (!mediaId || !fileId) continue;
    if (!mediaIdByFileId.has(fileId)) {
      mediaIdByFileId.set(fileId, mediaId);
    }
  }

  const existingLinkKeys = new Set<string>();
  const existingLinkIds = new Set<string>();
  for (const row of mediaLinkRows) {
    const rowFamily = readField(row.data, "family_group_key");
    if (normalize(rowFamily) !== familyGroupKey) continue;
    const linkId = readField(row.data, "link_id");
    if (linkId) existingLinkIds.add(linkId);
    const entityType = readField(row.data, "entity_type");
    const entityId = readField(row.data, "entity_id");
    const usageType = readField(row.data, "usage_type");
    const mediaId = readField(row.data, "media_id");
    const rowFileId = readField(row.data, "file_id") || mediaAssetRows.find((asset) => readField(asset.data, "media_id") === mediaId)?.data.file_id || "";
    if (!entityType || !entityId || !usageType || !rowFileId) continue;
    existingLinkKeys.add(
      mediaLinkKey({
        familyGroupKey: rowFamily,
        entityType,
        entityId,
        usageType,
        fileId: rowFileId,
      }),
    );
  }

  const expectedLinks: ExpectedMediaLink[] = [];
  for (const person of people) {
    const personId = person.personId.trim();
    const fileId = person.photoFileId.trim();
    if (!personId || !fileId) continue;
    expectedLinks.push({
      source: "people_headshot",
      familyGroupKey,
      entityType: "person",
      entityId: personId,
      usageType: "photo",
      fileId,
      label: "Headshot",
      description: "",
      photoDate: "",
      mediaMetadata: "",
    });
  }

  for (const row of attributeRows) {
    const attributeId = readField(row.data, "attribute_id");
    const entityType = normalize(readField(row.data, "entity_type"));
    const entityId = readField(row.data, "entity_id", "person_id", "household_id");
    const attributeType = normalize(readField(row.data, "attribute_type"));
    const fileId = readField(row.data, "attribute_detail", "value_text");
    if (!attributeId || !fileId) continue;
    if (!["photo", "video", "audio", "media"].includes(attributeType)) continue;
    if (entityType === "person" && !peopleIds.has(normalize(entityId))) continue;
    if (entityType === "household" && !householdIds.has(normalize(entityId))) continue;
    if (entityType !== "person" && entityType !== "household") continue;
    expectedLinks.push({
      source: "attribute_media",
      familyGroupKey,
      entityType: "attribute",
      entityId: attributeId,
      usageType: attributeType === "photo" ? "photo" : "media",
      fileId,
      label: readField(row.data, "label", "attribute_type_category", "attribute_type"),
      description: readField(row.data, "attribute_notes", "notes"),
      photoDate: readField(row.data, "attribute_date", "start_date"),
      mediaMetadata: "",
    });
  }

  const missingExpectedLinks = expectedLinks.filter(
    (candidate) =>
      !existingLinkKeys.has(
        mediaLinkKey({
          familyGroupKey: candidate.familyGroupKey,
          entityType: candidate.entityType,
          entityId: candidate.entityId,
          usageType: candidate.usageType,
          fileId: candidate.fileId,
        }),
      ),
  );

  const orphanFileIds = Array.from(
    new Set(missingExpectedLinks.map((entry) => entry.fileId)),
  );
  const missingAssetFileIds = orphanFileIds.filter((fileId) => !knownAssetByFileId.has(fileId));

  let createdMediaAssets = 0;
  let createdMediaLinks = 0;
  if (applyChanges) {
    const nowIso = new Date().toISOString();
    for (const fileId of missingAssetFileIds) {
      const mediaId = mediaIdByFileId.get(fileId) || buildMediaId(fileId);
      if (!mediaIdByFileId.has(fileId)) {
        mediaIdByFileId.set(fileId, mediaId);
      }
      await createTableRecord("MediaAssets", {
        media_id: mediaId,
        file_id: fileId,
        storage_provider: "gdrive",
        mime_type: "",
        file_name: "",
        file_size_bytes: "",
        media_metadata: "",
        created_at: nowIso,
      }, tenantKey);
      knownAssetByFileId.add(fileId);
      createdMediaAssets += 1;
    }

    for (const candidate of missingExpectedLinks) {
      const mediaId = mediaIdByFileId.get(candidate.fileId) || buildMediaId(candidate.fileId);
      if (!mediaIdByFileId.has(candidate.fileId)) {
        mediaIdByFileId.set(candidate.fileId, mediaId);
      }
      const linkId = buildMediaLinkId(
        candidate.familyGroupKey,
        candidate.entityType,
        candidate.entityId,
        candidate.fileId,
        candidate.usageType,
      );
      if (existingLinkIds.has(linkId)) {
        continue;
      }
      await createTableRecord("MediaLinks", {
        family_group_key: candidate.familyGroupKey,
        link_id: linkId,
        media_id: mediaId,
        entity_type: candidate.entityType,
        entity_id: candidate.entityId,
        usage_type: candidate.usageType,
        label: candidate.label,
        description: candidate.description,
        photo_date: candidate.photoDate,
        is_primary: "FALSE",
        sort_order: "0",
        media_metadata: candidate.mediaMetadata,
        created_at: nowIso,
      }, tenantKey);
      existingLinkIds.add(linkId);
      createdMediaLinks += 1;
    }
  }

  return {
    ok: true,
    familyGroupKey: tenantKey,
    mode: applyChanges ? "repair" : "audit",
    counts: {
      expectedLinks: expectedLinks.length,
      missingLinks: missingExpectedLinks.length,
      orphanFileIds: orphanFileIds.length,
      missingAssetFileIds: missingAssetFileIds.length,
      createdMediaAssets,
      createdMediaLinks,
    },
    sampleMissingLinks: missingExpectedLinks.slice(0, 25).map((entry) => ({
      source: entry.source,
      entityType: entry.entityType,
      entityId: entry.entityId,
      usageType: entry.usageType,
      fileId: entry.fileId,
    })),
  } as const;
}

async function runIntegrityAudit(tenantKey: string) {
  const familyGroupKey = normalize(tenantKey);
  const [
    familyGroupRelationshipAudit,
    people,
    peopleRowsGlobal,
    personFamilyRows,
    userAccessRows,
    userGroupRows,
    householdsRows,
    familyConfigRows,
    tables,
    relationshipRows,
    personAttributeRows,
    importantDateRows,
  ] = await Promise.all([
    auditOrRepairFamilyGroupRelationshipTypes(familyGroupKey, false),
    getPeople(tenantKey).catch(() => []),
    getTableRecords("People").catch(() => []),
    getTableRecords("PersonFamilyGroups").catch(() => []),
    getTableRecords("UserAccess").catch(() => []),
    getTableRecords("UserFamilyGroups").catch(() => []),
    getTableRecords("Households").catch(() => []),
    getTableRecords(["FamilyConfig", "TenantConfig"]).catch(() => []),
    listTables().catch(() => []),
    getTableRecords("Relationships").catch(() => []),
    getTableRecords(PERSON_ATTRIBUTES_TABLE).catch(() => []),
    getTableRecords("ImportantDates").catch(() => []),
  ]);

  const peopleIds = new Set(
    people
      .map((row) => row.personId)
      .filter(Boolean)
      .map((id) => normalize(id)),
  );
  const allPeopleIds = new Set(
    peopleRowsGlobal
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
  const personMembershipRefs = new Map<string, number>();
  const personNonMembershipRefs = new Map<string, number>();
  const bump = (map: Map<string, number>, personId: string) => {
    const key = normalize(personId);
    if (!key) return;
    map.set(key, (map.get(key) ?? 0) + 1);
  };
  for (const row of personFamilyRows) {
    bump(personMembershipRefs, readField(row.data, "person_id"));
  }
  for (const row of userAccessRows) {
    bump(personNonMembershipRefs, readField(row.data, "person_id"));
  }
  for (const row of userGroupRows) {
    bump(personNonMembershipRefs, readField(row.data, "person_id"));
  }
  for (const row of householdsRows) {
    bump(personNonMembershipRefs, readField(row.data, "husband_person_id"));
    bump(personNonMembershipRefs, readField(row.data, "wife_person_id"));
  }
  for (const row of relationshipRows) {
    bump(personNonMembershipRefs, readField(row.data, "from_person_id"));
    bump(personNonMembershipRefs, readField(row.data, "to_person_id"));
  }
  for (const row of personAttributeRows) {
    if (normalize(readField(row.data, "entity_type")) === "person") {
      bump(personNonMembershipRefs, readField(row.data, "entity_id", "person_id"));
    }
  }
  for (const row of importantDateRows) {
    bump(personNonMembershipRefs, readField(row.data, "person_id"));
  }

  const byName = new Map<string, string[]>();
  for (const row of peopleRowsGlobal) {
    const personId = normalize(readField(row.data, "person_id"));
    if (!personId || !peopleIds.has(personId)) {
      continue;
    }
    const first = readField(row.data, "first_name");
    const middle = readField(row.data, "middle_name");
    const last = readField(row.data, "last_name");
    const display = readField(row.data, "display_name");
    const composed = [first, middle, last].filter(Boolean).join(" ").trim();
    const key = normalizeNameKey(composed || display);
    if (!key) {
      continue;
    }
    const list = byName.get(key) ?? [];
    list.push(personId);
    byName.set(key, list);
  }
  const duplicatePeopleGroups = Array.from(byName.entries())
    .map(([nameKey, ids]) => ({ nameKey, personIds: Array.from(new Set(ids)) }))
    .filter((group) => group.personIds.length > 1);
  pushFinding(
    findings,
    "warn",
    "duplicate_people_name_ids",
    "Multiple person IDs in this family group share the same normalized name; review for accidental duplicates.",
    duplicatePeopleGroups.map((group) => `${group.nameKey}: ${group.personIds.join(",")}`),
  );

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
    .filter((personId) => !allPeopleIds.has(personId));
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

  const peopleMissingLinks = Array.from(peopleIds).filter((personId) => {
    const hasAccess = (userAccessByPerson.get(personId) ?? []).length > 0;
    const hasLink = linkByPerson.has(personId);
    return hasAccess && !hasLink;
  });
  pushFinding(
    findings,
    "warn",
    "people_missing_userfamilygroups_link",
    "People with UserAccess rows but no UserFamilyGroups link for this family group.",
    peopleMissingLinks,
  );

  const enabledPersonFamilyByPerson = new Map<string, number>();
  for (const row of personFamilyRows) {
    const personId = normalize(readField(row.data, "person_id"));
    if (!personId || !isEnabledLike(readField(row.data, "is_enabled"))) {
      continue;
    }
    enabledPersonFamilyByPerson.set(personId, (enabledPersonFamilyByPerson.get(personId) ?? 0) + 1);
  }
  const orphanPeopleNoFamily = Array.from(allPeopleIds).filter(
    (personId) => (enabledPersonFamilyByPerson.get(personId) ?? 0) === 0,
  );
  pushFinding(
    findings,
    "warn",
    "orphan_people_no_family_groups",
    "People rows with no enabled PersonFamilyGroups association.",
    orphanPeopleNoFamily,
  );

  const validFamilyGroupKeys = new Set(
    familyConfigRows
      .map((row) => normalize(readField(row.data, "family_group_key")))
      .filter(Boolean),
  );
  const orphanHouseholdsNoFamily = householdsRows
    .map((row) => ({
      householdId: readField(row.data, "household_id"),
      familyGroupKey: normalize(readField(row.data, "family_group_key")),
    }))
    .filter((row) => row.householdId)
    .filter((row) => !row.familyGroupKey || !validFamilyGroupKeys.has(row.familyGroupKey))
    .map((row) => row.householdId);
  pushFinding(
    findings,
    "warn",
    "orphan_households_no_family_groups",
    "Households rows with no valid family_group_key association.",
    Array.from(new Set(orphanHouseholdsNoFamily)),
  );

  const enabledUserFamilyByPerson = new Map<string, number>();
  for (const row of userGroupRows) {
    const personId = normalize(readField(row.data, "person_id"));
    if (!personId || !isEnabledLike(readField(row.data, "is_enabled"))) {
      continue;
    }
    enabledUserFamilyByPerson.set(personId, (enabledUserFamilyByPerson.get(personId) ?? 0) + 1);
  }
  const orphanUsersNoFamily = userAccessRows
    .map((row) => ({
      personId: normalize(readField(row.data, "person_id")),
      userEmail: normalize(readField(row.data, "user_email")),
      localAccess: parseBool(readField(row.data, "local_access")),
      googleAccess: parseBool(readField(row.data, "google_access")),
      isEnabled: isEnabledLike(readField(row.data, "is_enabled")),
    }))
    .filter((row) => row.personId && row.isEnabled && (row.localAccess || row.googleAccess))
    .filter((row) => (enabledUserFamilyByPerson.get(row.personId) ?? 0) === 0)
    .map((row) => row.userEmail || row.personId);
  pushFinding(
    findings,
    "warn",
    "orphan_users_no_family_groups",
    "UserAccess login users with no enabled family-group association.",
    Array.from(new Set(orphanUsersNoFamily)),
  );

  const scopedPeopleTables = tables
    .map((table) => table.trim())
    .filter((table) => table.toLowerCase().endsWith("__people"));
  pushFinding(
    findings,
    "warn",
    "legacy_scoped_people_tables_present",
    "Legacy tenant-scoped People tables exist. People data must remain global in the People table only.",
    scopedPeopleTables,
  );

  pushFinding(
    findings,
    "warn",
    "family_group_relationship_type_mismatch",
    "People whose stored family-group relationship type does not match the current founder/direct/in-law/undeclared classification.",
    familyGroupRelationshipAudit.samplePeople.mismatched,
  );
  pushFinding(
    findings,
    "warn",
    "family_group_relationship_type_legacy_in_law_attributes",
    "Legacy in_law attribute rows still exist and should be cleaned up because PersonFamilyGroups.family_group_relationship_type is now canonical.",
    familyGroupRelationshipAudit.samplePeople.legacyAttributes,
  );
  if (familyGroupRelationshipAudit.counts.invalidMembershipRows > 0) {
    findings.push({
      severity: "warn",
      code: "family_group_relationship_type_invalid_membership_rows",
      message: "PersonFamilyGroups family_group_relationship_type values contain invalid or noncanonical state and should be normalized.",
      count: familyGroupRelationshipAudit.counts.invalidMembershipRows,
      sample: familyGroupRelationshipAudit.samplePeople.invalidMembership.slice(0, 10),
    });
  }
  if (familyGroupRelationshipAudit.counts.founderCount === 0) {
    findings.push({
      severity: "warn",
      code: "family_group_relationship_type_missing_founder",
      message: "This family group has no founder assigned, so direct/in-law placement cannot be derived reliably.",
      count: 1,
      sample: [],
    });
  }
  if (familyGroupRelationshipAudit.counts.founderOverflowPeople > 0) {
    findings.push({
      severity: "warn",
      code: "family_group_relationship_type_founder_overflow",
      message: "This family group has more than two founders assigned.",
      count: familyGroupRelationshipAudit.counts.founderOverflowPeople,
      sample: familyGroupRelationshipAudit.samplePeople.founderOverflow.slice(0, 10),
    });
  }

  const errorCount = findings.filter((item) => item.severity === "error").length;
  const warnCount = findings.filter((item) => item.severity === "warn").length;
  const summary = {
    status: errorCount > 0 ? "error" : warnCount > 0 ? "warn" : "ok",
    errorCount,
    warnCount,
    peopleCount: people.length,
    userAccessCount: userAccessRows.length,
    userFamilyGroupCount: filteredLinks.length,
  };

  return {
    familyGroupKey,
    peopleRows: peopleRowsGlobal,
    people,
    userAccessRows,
    userGroupRows,
    personFamilyRows,
    relationshipRows,
    householdsRows,
    personAttributeRows,
    importantDateRows,
    peopleIds,
    filteredLinks,
    userAccessByPerson,
    linkByPerson,
    personMembershipRefs,
    personNonMembershipRefs,
    duplicatePeopleGroups,
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
    duplicatePeopleGroups: report.duplicatePeopleGroups,
  });
}

export async function POST(_: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const familyGroupKey = resolved.tenant.tenantKey;
  const body = await _.json().catch(() => null);
  const action = normalize(typeof body?.action === "string" ? body.action : "");

  if (action === "audit_orphan_media_links" || action === "repair_orphan_media_links") {
    const result = await auditOrRepairOrphanMediaLinks(familyGroupKey, action === "repair_orphan_media_links");
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result);
  }
  if (
    action === "audit_family_group_relationship_types" ||
    action === "repair_family_group_relationship_types"
  ) {
    const result = await auditOrRepairFamilyGroupRelationshipTypes(
      familyGroupKey,
      action === "repair_family_group_relationship_types",
    );
    return NextResponse.json(result);
  }

  if (action === "merge_duplicate_person") {
    const sourcePersonId = normalize(typeof body?.sourcePersonId === "string" ? body.sourcePersonId : "");
    const targetPersonId = normalize(typeof body?.targetPersonId === "string" ? body.targetPersonId : "");
    if (!sourcePersonId || !targetPersonId || sourcePersonId === targetPersonId) {
      return NextResponse.json({ error: "invalid_merge_payload" }, { status: 400 });
    }

    const before = await runIntegrityAudit(familyGroupKey);
    if (!before.peopleIds.has(sourcePersonId) || !before.peopleIds.has(targetPersonId)) {
      return NextResponse.json({ error: "merge_people_not_found_in_family" }, { status: 404 });
    }
    const sameDuplicateGroup = before.duplicatePeopleGroups.some(
      (group) => group.personIds.includes(sourcePersonId) && group.personIds.includes(targetPersonId),
    );
    if (!sameDuplicateGroup) {
      return NextResponse.json({ error: "merge_people_not_in_same_duplicate_group" }, { status: 409 });
    }

    const peopleRows = before.peopleRows;
    const relationshipRows = before.relationshipRows;
    const householdRows = await getTableRecords("Households").catch(() => []);
    const personAttributeRows = before.personAttributeRows;
    const importantDateRows = before.importantDateRows;
    const personFamilyRows = before.personFamilyRows;
    const userFamilyRows = before.userGroupRows;
    const userAccessRows = before.userAccessRows;

    let updatedRelationships = 0;
    let deletedRelationships = 0;
    const existingNonSourceRels = new Set<string>();
    for (const row of relationshipRows) {
      const from = normalize(readField(row.data, "from_person_id"));
      const to = normalize(readField(row.data, "to_person_id"));
      const relType = readField(row.data, "rel_type");
      if (from === sourcePersonId || to === sourcePersonId) continue;
      if (!from || !to || !relType) continue;
      existingNonSourceRels.add(relCanonicalKey(from, to, relType));
    }
    const newRelKeysFromSource = new Set<string>();
    for (const row of relationshipRows) {
      const relId = readField(row.data, "rel_id") || readField(row.data, "relationship_id") || readField(row.data, "id");
      const relType = readField(row.data, "rel_type");
      const from = normalize(readField(row.data, "from_person_id"));
      const to = normalize(readField(row.data, "to_person_id"));
      if (!relId || !relType || (from !== sourcePersonId && to !== sourcePersonId)) {
        continue;
      }
      const nextFrom = from === sourcePersonId ? targetPersonId : from;
      const nextTo = to === sourcePersonId ? targetPersonId : to;
      if (!nextFrom || !nextTo || nextFrom === nextTo) {
        if (await deleteTableRows("Relationships", [row.rowNumber])) deletedRelationships += 1;
        continue;
      }
      const nextKey = relCanonicalKey(nextFrom, nextTo, relType);
      if (existingNonSourceRels.has(nextKey) || newRelKeysFromSource.has(nextKey)) {
        if (await deleteTableRows("Relationships", [row.rowNumber])) deletedRelationships += 1;
        continue;
      }
      newRelKeysFromSource.add(nextKey);
      const nextRelId = buildEntityId("rel", `${nextFrom}|${nextTo}|${relType}`);
      const updated = await updateTableRecordById(
        "Relationships",
        relId,
        {
          from_person_id: nextFrom,
          to_person_id: nextTo,
          rel_id: nextRelId,
          relationship_id: nextRelId,
          id: nextRelId,
        },
        "rel_id",
      );
      if (updated) updatedRelationships += 1;
    }

    let updatedHouseholds = 0;
    let deletedHouseholds = 0;
    const existingNonSourceHouseholds = new Set<string>();
    for (const row of householdRows) {
      const { memberIds } = getHouseholdOccupants(row.data);
      const familyKey = normalize(readField(row.data, "family_group_key"));
      if (memberIds.includes(sourcePersonId)) continue;
      const occupancyKey = householdOccupancyKey(memberIds);
      if (!familyKey || !occupancyKey) continue;
      existingNonSourceHouseholds.add(`${familyKey}|${occupancyKey}`);
    }
    const newHouseholdsFromSource = new Set<string>();
    for (const row of householdRows) {
      const householdId = readField(row.data, "household_id");
      const { husband, wife, memberIds } = getHouseholdOccupants(row.data);
      const familyKey = normalize(readField(row.data, "family_group_key"));
      if (!householdId || !memberIds.includes(sourcePersonId)) {
        continue;
      }
      const nextHusband = husband === sourcePersonId ? targetPersonId : husband;
      const nextWife = wife === sourcePersonId ? targetPersonId : wife;
      const nextMemberIds = [nextHusband, nextWife].filter(Boolean);
      if (nextMemberIds.length === 0 || new Set(nextMemberIds).size !== nextMemberIds.length) {
        if (await deleteTableRows("Households", [row.rowNumber])) deletedHouseholds += 1;
        continue;
      }
      const occupancyKey = householdOccupancyKey(nextMemberIds);
      if (!occupancyKey) {
        if (await deleteTableRows("Households", [row.rowNumber])) deletedHouseholds += 1;
        continue;
      }
      const scopedOccupancyKey = `${familyKey}|${occupancyKey}`;
      if (existingNonSourceHouseholds.has(scopedOccupancyKey) || newHouseholdsFromSource.has(scopedOccupancyKey)) {
        if (await deleteTableRows("Households", [row.rowNumber])) deletedHouseholds += 1;
        continue;
      }
      newHouseholdsFromSource.add(scopedOccupancyKey);
      const updated = await updateTableRecordById(
        "Households",
        householdId,
        {
          husband_person_id: nextHusband,
          wife_person_id: nextWife,
        },
        "household_id",
      );
      if (updated) updatedHouseholds += 1;
    }

    let updatedAttributes = 0;
    for (const row of personAttributeRows) {
      const entityType = normalize(readField(row.data, "entity_type"));
      const personId = normalize(readField(row.data, "entity_id", "person_id"));
      const attributeId = readField(row.data, "attribute_id");
      if (!attributeId || entityType !== "person" || personId !== sourcePersonId) continue;
      const updated = await updateTableRecordById(
        PERSON_ATTRIBUTES_TABLE,
        attributeId,
        { entity_id: targetPersonId },
        "attribute_id",
      );
      if (updated) updatedAttributes += 1;
    }

    let updatedImportantDates = 0;
    for (const row of importantDateRows) {
      const personId = normalize(readField(row.data, "person_id"));
      const importantDateId = readField(row.data, "id");
      if (!importantDateId || personId !== sourcePersonId) continue;
      const updated = await updateTableRecordById(
        "ImportantDates",
        importantDateId,
        { person_id: targetPersonId },
        "id",
      );
      if (updated) updatedImportantDates += 1;
    }

    const personFamilyInScope = personFamilyRows.filter((row) => {
      const personId = normalize(readField(row.data, "person_id"));
      return personId === sourcePersonId || personId === targetPersonId;
    });
    const personFamilyByGroup = new Map<string, { family_group_key: string; is_enabled: string }>();
    for (const row of personFamilyInScope) {
      const groupKey = readField(row.data, "family_group_key");
      if (!groupKey) continue;
      const existing = personFamilyByGroup.get(normalize(groupKey));
      const enabled = boolLike(readField(row.data, "is_enabled"));
      if (!existing) {
        personFamilyByGroup.set(normalize(groupKey), {
          family_group_key: groupKey,
          is_enabled: enabled,
        });
        continue;
      }
      if (enabled === "TRUE") {
        existing.is_enabled = "TRUE";
      }
    }
    const personFamilyRowsToDelete = personFamilyInScope.map((row) => row.rowNumber);
    let deletedPersonFamilyRows = 0;
    if (personFamilyRowsToDelete.length > 0) {
      deletedPersonFamilyRows = await deleteRowsByNumber("PersonFamilyGroups", personFamilyRowsToDelete);
    }
    let createdPersonFamilyRows = 0;
    const personFamilyToCreate = Array.from(personFamilyByGroup.values()).map((item) => ({
      person_id: targetPersonId,
      family_group_key: item.family_group_key,
      is_enabled: item.is_enabled,
    }));
    if (personFamilyToCreate.length > 0) {
      await createTableRecords("PersonFamilyGroups", personFamilyToCreate);
      createdPersonFamilyRows = personFamilyToCreate.length;
    }

    const userFamilyInScope = userFamilyRows.filter((row) => {
      const personId = normalize(readField(row.data, "person_id"));
      return personId === sourcePersonId || personId === targetPersonId;
    });
    const userFamilyByKey = new Map<
      string,
      { user_email: string; family_group_key: string; family_group_name: string; role: string; is_enabled: string }
    >();
    for (const row of userFamilyInScope) {
      const userEmail = readField(row.data, "user_email").toLowerCase();
      const groupKey = readField(row.data, "family_group_key");
      if (!userEmail || !groupKey) continue;
      const key = `${normalize(userEmail)}|${normalize(groupKey)}`;
      const role = normalize(readField(row.data, "role")) === "admin" ? "ADMIN" : "USER";
      const enabled = boolLike(readField(row.data, "is_enabled"));
      const existing = userFamilyByKey.get(key);
      if (!existing) {
        userFamilyByKey.set(key, {
          user_email: userEmail,
          family_group_key: groupKey,
          family_group_name: readField(row.data, "family_group_name"),
          role,
          is_enabled: enabled,
        });
        continue;
      }
      if (role === "ADMIN") existing.role = "ADMIN";
      if (enabled === "TRUE") existing.is_enabled = "TRUE";
      if (!existing.family_group_name) existing.family_group_name = readField(row.data, "family_group_name");
    }
    const userFamilyRowsToDelete = userFamilyInScope.map((row) => row.rowNumber);
    let deletedUserFamilyRows = 0;
    if (userFamilyRowsToDelete.length > 0) {
      deletedUserFamilyRows = await deleteRowsByNumber("UserFamilyGroups", userFamilyRowsToDelete);
    }
    let createdUserFamilyRows = 0;
    const userFamilyToCreate = Array.from(userFamilyByKey.values()).map((item) => ({
      user_email: item.user_email,
      family_group_key: item.family_group_key,
      family_group_name: item.family_group_name,
      role: item.role,
      person_id: targetPersonId,
      is_enabled: item.is_enabled,
    }));
    if (userFamilyToCreate.length > 0) {
      await createTableRecords("UserFamilyGroups", userFamilyToCreate);
      createdUserFamilyRows = userFamilyToCreate.length;
    }

    const userAccessInScope = userAccessRows.filter((row) => {
      const personId = normalize(readField(row.data, "person_id"));
      return personId === sourcePersonId || personId === targetPersonId;
    });
    const userAccessRowsToDelete = userAccessInScope.map((row) => row.rowNumber);
    let deletedUserAccessRows = 0;
    if (userAccessRowsToDelete.length > 0) {
      deletedUserAccessRows = await deleteRowsByNumber("UserAccess", userAccessRowsToDelete);
    }
    let createdUserAccessRows = 0;
    if (userAccessInScope.length > 0) {
      const keep = [...userAccessInScope].sort((a, b) => scoreUserAccessRow(b.data) - scoreUserAccessRow(a.data))[0];
      await createTableRecord("UserAccess", {
        person_id: targetPersonId,
        role: normalize(readField(keep.data, "role")) === "admin" ? "ADMIN" : "USER",
        user_email: readField(keep.data, "user_email").toLowerCase(),
        username: readField(keep.data, "username").toLowerCase(),
        google_access: boolLike(readField(keep.data, "google_access")),
        local_access: boolLike(readField(keep.data, "local_access")),
        is_enabled: boolLike(readField(keep.data, "is_enabled")),
        password_hash: readField(keep.data, "password_hash"),
        failed_attempts: readField(keep.data, "failed_attempts"),
        locked_until: readField(keep.data, "locked_until"),
        must_change_password: boolLike(readField(keep.data, "must_change_password")),
      });
      createdUserAccessRows = 1;
    }

    const sourcePeopleRowNumbers = peopleRows
      .filter((row) => normalize(readField(row.data, "person_id")) === sourcePersonId)
      .map((row) => row.rowNumber);
    let deletedPeopleRows = 0;
    if (sourcePeopleRowNumbers.length > 0) {
      deletedPeopleRows = await deleteRowsByNumber("People", sourcePeopleRowNumbers);
    }

    const after = await runIntegrityAudit(familyGroupKey);
    return NextResponse.json({
      ok: true,
      mergedAt: new Date().toISOString(),
      merge: {
        sourcePersonId,
        targetPersonId,
        deletedPeopleRows,
        updatedRelationships,
        deletedRelationships,
        updatedHouseholds,
        deletedHouseholds,
        updatedAttributes,
        updatedImportantDates,
        deletedPersonFamilyRows,
        createdPersonFamilyRows,
        deletedUserFamilyRows,
        createdUserFamilyRows,
        deletedUserAccessRows,
        createdUserAccessRows,
      },
      before: before.summary,
      after: after.summary,
      findings: after.findings,
      duplicatePeopleGroups: after.duplicatePeopleGroups,
    });
  }

  const before = await runIntegrityAudit(familyGroupKey);
  const config = await getTenantConfig(familyGroupKey);

  let deletedDuplicateUserAccessRows = 0;
  let deletedOrphanUserFamilyGroupRows = 0;
  let deletedDuplicateUserFamilyGroupRows = 0;
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

  const orphanUserFamilyGroupRowNumbers = before.filteredLinks
    .filter((row) => {
      const personId = normalize(readField(row.data, "person_id"));
      return personId && !before.peopleIds.has(personId);
    })
    .map((row) => row.rowNumber);
  if (orphanUserFamilyGroupRowNumbers.length > 0) {
    deletedOrphanUserFamilyGroupRows = await deleteRowsByNumber("UserFamilyGroups", orphanUserFamilyGroupRowNumbers);
  }

  const duplicateUserFamilyGroupRowNumbers: number[] = [];
  for (const [personId, rows] of before.linkByPerson.entries()) {
    if (rows.length <= 1) {
      continue;
    }
    const preferredAccess =
      [...(before.userAccessByPerson.get(personId) ?? [])].sort(
        (a, b) => scoreUserAccessRow(b.data) - scoreUserAccessRow(a.data),
      )[0] ?? null;
    const preferredEmail = readField(preferredAccess?.data ?? {}, "user_email").toLowerCase();
    const ranked = [...rows].sort((a, b) => {
      const scoreA = scoreUserFamilyGroupRow(a.data, preferredEmail, personId);
      const scoreB = scoreUserFamilyGroupRow(b.data, preferredEmail, personId);
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      return a.rowNumber - b.rowNumber;
    });
    const [, ...duplicates] = ranked;
    duplicateUserFamilyGroupRowNumbers.push(...duplicates.map((row) => row.rowNumber));
  }
  if (duplicateUserFamilyGroupRowNumbers.length > 0) {
    deletedDuplicateUserFamilyGroupRows = await deleteRowsByNumber("UserFamilyGroups", duplicateUserFamilyGroupRowNumbers);
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
    const email = readField(preferred.data, "user_email").toLowerCase();
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

  let repairedSpouseFamilyMembershipRows = 0;
  let repairedSpouseHouseholdRows = 0;
  let skippedSpouseHouseholdConflicts = 0;
  const peopleById = new Map<string, { gender: string; lastName: string }>();
  for (const row of before.peopleRows) {
    const personId = normalize(readField(row.data, "person_id"));
    if (!personId) continue;
    peopleById.set(personId, {
      gender: readField(row.data, "gender"),
      lastName: readField(row.data, "last_name"),
    });
  }
  const enabledGroupsByPerson = new Map<string, Set<string>>();
  for (const row of before.personFamilyRows) {
    const personId = normalize(readField(row.data, "person_id"));
    const groupKey = normalize(readField(row.data, "family_group_key"));
    if (!personId || !groupKey || !isEnabledLike(readField(row.data, "is_enabled"))) {
      continue;
    }
    const groups = enabledGroupsByPerson.get(personId) ?? new Set<string>();
    groups.add(groupKey);
    enabledGroupsByPerson.set(personId, groups);
  }
  const parentIdsByChild = new Map<string, Set<string>>();
  const spousePairs = new Map<string, { personA: string; personB: string }>();
  for (const row of before.relationshipRows) {
    const relType = normalize(readField(row.data, "rel_type"));
    const fromPersonId = normalize(readField(row.data, "from_person_id"));
    const toPersonId = normalize(readField(row.data, "to_person_id"));
    if (!fromPersonId || !toPersonId || fromPersonId === toPersonId) {
      continue;
    }
    if (relType === "parent") {
      const parents = parentIdsByChild.get(toPersonId) ?? new Set<string>();
      parents.add(fromPersonId);
      parentIdsByChild.set(toPersonId, parents);
      continue;
    }
    if (relType !== "spouse") {
      continue;
    }
    if (!before.peopleIds.has(fromPersonId) && !before.peopleIds.has(toPersonId)) {
      continue;
    }
    const sorted = [fromPersonId, toPersonId].sort();
    const pairKey = sorted.join("|");
    if (!spousePairs.has(pairKey)) {
      spousePairs.set(pairKey, { personA: sorted[0], personB: sorted[1] });
    }
  }
  const householdPairByGroup = new Map<string, Set<string>>();
  const occupiedPartnersByGroup = new Map<string, Map<string, string>>();
  for (const row of before.householdsRows) {
    const familyKey = normalize(readField(row.data, "family_group_key"));
    const { memberIds } = getHouseholdOccupants(row.data);
    const occupancyKey = householdOccupancyKey(memberIds);
    if (!familyKey || !occupancyKey) continue;
    if (memberIds.length === 2) {
      const pairs = householdPairByGroup.get(familyKey) ?? new Set<string>();
      pairs.add(occupancyKey);
      householdPairByGroup.set(familyKey, pairs);
    }
    const occupants = occupiedPartnersByGroup.get(familyKey) ?? new Map<string, string>();
    memberIds.forEach((personId) => occupants.set(personId, occupancyKey));
    occupiedPartnersByGroup.set(familyKey, occupants);
  }
  for (const pair of spousePairs.values()) {
    const targetGroups = new Set<string>();
    const parentIdsA = parentIdsByChild.get(pair.personA) ?? new Set<string>();
    const parentIdsB = parentIdsByChild.get(pair.personB) ?? new Set<string>();
    [...parentIdsA, ...parentIdsB].forEach((parentId) => {
      const parentGroups = enabledGroupsByPerson.get(parentId);
      if (!parentGroups) return;
      parentGroups.forEach((groupKey) => targetGroups.add(groupKey));
    });
    if (targetGroups.size === 0) {
      continue;
    }
    for (const groupKey of targetGroups) {
      const personAEnabledGroups = enabledGroupsByPerson.get(pair.personA) ?? new Set<string>();
      if (!personAEnabledGroups.has(groupKey)) {
        await createTableRecord("PersonFamilyGroups", {
          person_id: pair.personA,
          family_group_key: groupKey,
          is_enabled: "TRUE",
        });
        personAEnabledGroups.add(groupKey);
        enabledGroupsByPerson.set(pair.personA, personAEnabledGroups);
        repairedSpouseFamilyMembershipRows += 1;
      }
      const personBEnabledGroups = enabledGroupsByPerson.get(pair.personB) ?? new Set<string>();
      if (!personBEnabledGroups.has(groupKey)) {
        await createTableRecord("PersonFamilyGroups", {
          person_id: pair.personB,
          family_group_key: groupKey,
          is_enabled: "TRUE",
        });
        personBEnabledGroups.add(groupKey);
        enabledGroupsByPerson.set(pair.personB, personBEnabledGroups);
        repairedSpouseFamilyMembershipRows += 1;
      }

      const pairKey = [pair.personA, pair.personB].sort().join("|");
      const existingPairs = householdPairByGroup.get(groupKey) ?? new Set<string>();
      if (existingPairs.has(pairKey)) {
        continue;
      }
      const occupants = occupiedPartnersByGroup.get(groupKey) ?? new Map<string, string>();
      const occupiedA = occupants.get(pair.personA);
      const occupiedB = occupants.get(pair.personB);
      if ((occupiedA && occupiedA !== pairKey) || (occupiedB && occupiedB !== pairKey)) {
        skippedSpouseHouseholdConflicts += 1;
        continue;
      }
      const roles = resolveHouseholdRoles(pair.personA, pair.personB, peopleById);
      const wifeLastName = (peopleById.get(roles.wife)?.lastName ?? "").trim();
      const husbandLastName = (peopleById.get(roles.husband)?.lastName ?? "").trim();
      const householdId = buildEntityId("h", `${groupKey}|${pairKey}`);
      await createTableRecord("Households", {
        family_group_key: groupKey,
        household_id: householdId,
        husband_person_id: roles.husband,
        wife_person_id: roles.wife,
        label: buildHouseholdLabel(wifeLastName, husbandLastName),
      });
      existingPairs.add(pairKey);
      householdPairByGroup.set(groupKey, existingPairs);
      occupants.set(pair.personA, pairKey);
      occupants.set(pair.personB, pairKey);
      occupiedPartnersByGroup.set(groupKey, occupants);
      repairedSpouseHouseholdRows += 1;
    }
  }

  const familyGroupRelationshipRepair = await auditOrRepairFamilyGroupRelationshipTypes(familyGroupKey, true);

  let deletedDuplicatePeopleRows = 0;
  let deletedDuplicatePeopleMembershipRows = 0;
  for (const group of before.duplicatePeopleGroups) {
    const ranked = [...group.personIds].sort((a, b) => {
      const nonMemA = before.personNonMembershipRefs.get(a) ?? 0;
      const nonMemB = before.personNonMembershipRefs.get(b) ?? 0;
      if (nonMemA !== nonMemB) return nonMemB - nonMemA;
      const memA = before.personMembershipRefs.get(a) ?? 0;
      const memB = before.personMembershipRefs.get(b) ?? 0;
      if (memA !== memB) return memB - memA;
      return a.localeCompare(b);
    });
    const keep = ranked[0];
    const candidates = ranked.slice(1).filter((personId) => (before.personNonMembershipRefs.get(personId) ?? 0) === 0);
    for (const personId of candidates) {
      const memberRows = before.personFamilyRows
        .filter((row) => normalize(readField(row.data, "person_id")) === personId)
        .map((row) => row.rowNumber);
      if (memberRows.length > 0) {
        deletedDuplicatePeopleMembershipRows += await deleteRowsByNumber("PersonFamilyGroups", memberRows);
      }
      const personRows = before.peopleRows
        .filter((row) => normalize(readField(row.data, "person_id")) === personId)
        .map((row) => row.rowNumber);
      if (personRows.length > 0) {
        deletedDuplicatePeopleRows += await deleteRowsByNumber("People", personRows);
      }
      void keep;
    }
  }

  const after = await runIntegrityAudit(familyGroupKey);
  return NextResponse.json({
    ok: true,
    repairedAt: new Date().toISOString(),
    repaired: {
      deletedDuplicateUserAccessRows,
      deletedOrphanUserFamilyGroupRows,
      deletedDuplicateUserFamilyGroupRows,
      createdMissingLinks,
      repairedSpouseFamilyMembershipRows,
      repairedSpouseHouseholdRows,
      repairedRelationshipTypeCreatedRows: familyGroupRelationshipRepair.counts.createdRows,
      repairedRelationshipTypeUpdatedRows: familyGroupRelationshipRepair.counts.updatedRows,
      repairedRelationshipTypeDeletedRows: familyGroupRelationshipRepair.counts.deletedRows,
      repairedRelationshipTypeCheckedPeople: familyGroupRelationshipRepair.counts.checkedPeople,
      skippedSpouseHouseholdConflicts,
      deletedDuplicatePeopleRows,
      deletedDuplicatePeopleMembershipRows,
    },
    before: before.summary,
    after: after.summary,
    findings: after.findings,
  });
}
