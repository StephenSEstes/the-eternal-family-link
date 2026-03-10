import "server-only";

// OCI is the only supported runtime persistence backend.
export {
  appendAuditLog,
  createTableRecord,
  createTableRecords,
  deleteTableRecordById,
  deleteTableRows,
  ensurePersonFamilyGroupMembership,
  ensureTenantScaffold,
  getAuditLogEntries,
  getAllFamilyGroupAccesses,
  getEnabledUserAccess,
  getEnabledUserAccessList,
  getEnabledUserAccessListByPersonId,
  getImportantDates,
  getPeople,
  getPersonById,
  getTableRecordById,
  getTableRecords,
  getTenantConfig,
  getTenantLocalAccessList,
  getTenantUserAccessList,
  listTables,
  PEOPLE_TABLE,
  PERSON_ATTRIBUTES_TABLE,
  setPersonFamilyGroupRelationshipType,
  updatePerson,
  updateTableRecordById,
  upsertTenantAccess,
} from "@/lib/data/store";

export type { AuditLogInput } from "@/lib/data/store";

