# Design Decisions

This file captures product and engineering choices that affect behavior, data shape, and UX.

## Governance Rule

- If a proposed implementation is contrary to any decision in this document, pause and explicitly confirm with Steve before proceeding.
- In that confirmation, state that the change is contrary to the current design decisions and ask whether to update this document.
- If Steve approves the change, update this document in the same commit with:
  - date of change
  - updated decision
  - reason for change

## Decision Record Template

- `Date`:
- `Area`:
- `Decision`:
- `Reason`:
- `Alternatives Considered`:
- `Impact`:
- `Follow-up`:

## 2026-02-27

- `Area`: Relationship modeling
- `Decision`: Use global `Relationships` records across family groups.
- `Reason`: Parent/child and spouse relationships should not vary by selected family group.
- `Alternatives Considered`: Family-scoped relationships keyed by family group.
- `Impact`: `rel_id` is now canonical global format: `from_person_id-to_person_id-rel_type`.
- `Follow-up`: Keep family-specific views filtered by people membership, not by relationship row scope.

- `Area`: Household schema labels
- `Decision`: Standardize on `husband_person_id` and `wife_person_id`.
- `Reason`: Remove legacy label ambiguity and reduce compatibility complexity.
- `Alternatives Considered`: Continuing dual support for `partner1_person_id` and `partner2_person_id`.
- `Impact`: CSV import and runtime reads/writes now use only `husband_person_id` / `wife_person_id`.
- `Follow-up`: Remove legacy partner-column references from remaining historical notes when ready.

- `Area`: Data model documentation
- `Decision`: Maintain `docs/data-schema.md` as the canonical schema reference for tables, columns, IDs, joins, logical indexes, and media link design.
- `Reason`: Prevent drift and ambiguity between implemented schema and expected behavior.
- `Alternatives Considered`: Keep schema details spread across code only.
- `Impact`: Schema changes must be reflected in `docs/data-schema.md` within the same commit.
- `Follow-up`: Keep this document aligned with `src/lib/data/store.ts` and the active access-layer behavior.

## 2026-02-28

- `Area`: Access control
- `Decision`: Add hidden "Steve access" superuser behavior at auth/session layer for the developer account.
- `Reason`: Ensure uninterrupted full administrative access across all family groups without adding a visible role option in UI dropdowns.
- `Alternatives Considered`: Add a new visible role in UserAccess/UserFamilyGroups; manually maintain per-family admin rows.
- `Impact`: `stephensestes@gmail.com` receives global family-group ADMIN scope in session token context; existing ADMIN/USER data model remains unchanged in UI and tables.
- `Follow-up`: Revisit this approach before multi-admin production rollout to replace hardcoded identity with configurable secure policy.

## 2026-03-02

- `Area`: Entity ID format
- `Decision`: Standardize entity IDs to typed opaque format with 8-character tokens:
  - `p-xxxxxxxx` (People)
  - `rel-xxxxxxxx` (Relationships)
  - `h-xxxxxxxx` (Households)
  - `attr-xxxxxxxx` (PersonAttributes)
  - `date-xxxxxxxx` (ImportantDates)
- `Reason`: Remove human-name/date IDs while preserving quick type readability and reducing long, fragile key strings.
- `Alternatives Considered`: Keep legacy readable IDs (`YYYYMMDD-name-slug`, composite relationship IDs, composite household IDs).
- `Impact`: New writes use typed IDs; migration tooling remaps existing IDs and linked references across core tables.
- `Follow-up`: Run migration in dry-run first, then execute live migration with confirmation payload.

## 2026-03-04

- `Area`: Identifier policy
- `Decision`: Do not use mutable/business data values as identifiers anywhere in the system. Use opaque, stable IDs for all entity identity and joins.
- `Reason`: Data-backed identifiers (for example emails, names, dates, or composites derived from those values) are mutable and create coupling, migration risk, and integrity drift.
- `Alternatives Considered`: Continue using data-derived identifiers in selected flows (for example access mapping by email).
- `Impact`: Existing data-as-identifier usage must be replaced with stable ID keys. Where external login attributes are needed (like email), treat them as attributes, not primary identifiers.
- `Follow-up`: Audit all tables/routes/access flows for data-derived keys and migrate to stable IDs with backward-compatible transition steps.

## 2026-03-06

- `Area`: Attribute storage architecture
- `Decision`: Consolidate person attribute persistence on the unified `Attributes` table and remove legacy `PersonAttributes` runtime/storage dependency.
- `Reason`: Dual-write/dual-read behavior created inconsistent results across screens and made attribute/media behavior depend on which endpoint wrote the record.
- `Alternatives Considered`: Keep dual-table compatibility indefinitely with runtime branching and parity tooling.
- `Impact`: `PERSON_ATTRIBUTES_TABLE` resolves to `Attributes`; legacy OCI `person_attributes` table is dropped and remaining legacy-only code references are removed.
- `Follow-up`: Keep `docs/data-schema.md` aligned to single-table attribute model and remove stale legacy mentions.

- `Area`: Attribute schema simplification
- `Decision`: Standardize `Attributes` rows on canonical fields: `attribute_id`, `entity_type`, `entity_id`, `attribute_type`, `attribute_type_category`, `attribute_date`, `date_is_estimated`, `estimated_to`, `attribute_detail`, `attribute_notes`, `end_date`, `created_at`, `updated_at`; reset existing test data and remove legacy columns from active runtime shape.
- `Reason`: Legacy compatibility fields from prior designs were causing UI/data ambiguity and made it hard to support the new event-vs-descriptor flow with dynamic type categories.
- `Alternatives Considered`: Continue dual-shape compatibility indefinitely with old fields (`type_key`, `value_text`, `date_start`, etc.).
- `Impact`: Add/edit attribute UI and API now map to canonical fields; existing attribute test rows were deleted during migration.
- `Follow-up`: If media file pointers must return as attribute rows in future, model that explicitly or through media links without reintroducing legacy attribute columns.

## 2026-03-07

- `Area`: Attribute event metadata management
- `Decision`: Store family-group-specific event category/type UI definitions in `FamilyConfig.attribute_event_definitions_json` and drive Add Attribute event picklists from that metadata.
- `Reason`: Event options and detail labels need admin control without code edits, while preserving existing attribute save contracts.
- `Alternatives Considered`: Hardcoded frontend lists only; separate dedicated definitions tables.
- `Impact`: Admin now has an Attribute Types tab for managing event categories/types (`type`, `type category`, detail label, date mode/end-date prompt). Add Attribute event form resolves options from this config with defaults fallback.
- `Follow-up`: If definitions become large or need audit/version history, migrate from JSON-in-config to dedicated normalized tables.

## 2026-03-10

- `Area`: Runtime persistence backend
- `Decision`: OCI is the only supported persistence backend, and the legacy backend runtime/tooling path is removed from the repo.
- `Reason`: Keeping deleted-backend tooling and naming around was adding diagnosis noise, preserving dead operational paths, and weakening the OCI-only mental model.
- `Alternatives Considered`: Keep legacy backend tooling for migration/debug only.
- `Impact`: Active runtime now uses `src/lib/data/store.ts`, legacy backend env/config/routes/scripts are removed, and only Google Drive support remains under `src/lib/google/`.
- `Follow-up`: Keep new code/docs free of legacy-backend naming and paths.
