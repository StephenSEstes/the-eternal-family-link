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
  updatePerson,
  updateTableRecordById,
  upsertTenantAccess,
} from "@/lib/data/store";

