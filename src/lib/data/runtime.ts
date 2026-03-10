import "server-only";

// OCI is the only supported runtime persistence backend. Google Sheets code remains
// available only for historical migration/admin tooling and should not be imported
// by active app routes or pages.
export {
  appendAuditLog,
  createTableRecord,
  createTableRecords,
  deleteTableRecordById,
  deleteTableRows,
  ensurePersonFamilyGroupMembership,
  ensureResolvedTabColumns,
  ensureTenantScaffold,
  getAllFamilyGroupAccesses,
  getEnabledUserAccess,
  getEnabledUserAccessList,
  getEnabledUserAccessListByPersonId,
  getImportantDates,
  getPeople,
  getPersonAttributes,
  getPersonById,
  getPrimaryPhotoFileIdFromAttributes,
  getTableRecordById,
  getTableRecords,
  getTenantConfig,
  getTenantLocalAccessList,
  getTenantUserAccessList,
  listTabs,
  PEOPLE_TAB,
  PERSON_ATTRIBUTES_TAB,
  updatePerson,
  updateTableRecordById,
  upsertTenantAccess,
} from "@/lib/google/sheets";

