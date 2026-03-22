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

- `Area`: Attribute kind and unified definitions
- `Decision`: Persist `Attributes.attribute_kind` as the canonical stored discriminator (`descriptor` | `event`) and manage both descriptor and event definitions from the same family-level definitions document in `FamilyConfig.attribute_event_definitions_json`.
- `Reason`: Event-vs-descriptor behavior was previously inferred from `attribute_type` plus hardcoded UI lists, which made filtering, validation, and historical consistency weaker. Storing `attribute_kind` removes inference drift, and unified definitions keep descriptor and event options on one admin-managed source of truth.
- `Alternatives Considered`: Continue inferring kind from `attribute_type`; store a generic `category` field instead of a dedicated kind; keep only event definitions admin-managed while leaving descriptor behavior hardcoded.
- `Impact`: Attribute reads/writes now persist and prefer `attribute_kind`, existing rows are backfilled compatibly, the Add Attribute modal uses the same definitions layer for both descriptor and event types, and the Attribute Definitions admin screen now manages both kinds instead of event-only metadata.
- `Follow-up`: If production data later needs stronger guarantees, add explicit integrity audits for missing/invalid `attribute_kind` rows beyond the current compatibility backfill.

- `Area`: Runtime persistence backend
- `Decision`: OCI is the only supported persistence backend, and the legacy backend runtime/tooling path is removed from the repo.
- `Reason`: Keeping deleted-backend tooling and naming around was adding diagnosis noise, preserving dead operational paths, and weakening the OCI-only mental model.
- `Alternatives Considered`: Keep legacy backend tooling for migration/debug only.
- `Impact`: Active runtime now uses `src/lib/data/store.ts`, legacy backend env/config/routes/scripts are removed, and only Google Drive support remains under `src/lib/google/`.
- `Follow-up`: Keep new code/docs free of legacy-backend naming and paths.

- `Area`: User onboarding and invitations
- `Decision`: Use person-bound invite records with a single invite URL as the onboarding path. Invite creation snapshots the person’s enabled family-group memberships, generates manual-share copy, pre-provisions Google access when Google is allowed, and pre-provisions local username/password when local sign-in is allowed.
- `Reason`: The app already treats `People`, `UserAccess`, and `UserFamilyGroups` as the canonical identity/access model. A person-bound invite flow avoids duplicate identity creation, keeps onboarding tied to an existing person, and supports both Google and local sign-in without introducing a second auth system.
- `Alternatives Considered`: Email-only invites not bound to `person_id`; fully manual user provisioning without invite records; custom magic-link authentication.
- `Impact`: Added an `Invites` table, admin invite generation in Settings, a public `/invite/[token]` acceptance path, and invite-time access snapshots for consistent acceptance behavior. Local-capable invites now generate a temporary password at invite creation and include it in the copied share message.
- `Follow-up`: If outbound email is added later, send the existing invite URL/message from the same invite records instead of creating a parallel mail-only workflow. User-facing onboarding/login was simplified to local-only in the 2026-03-16 decision below.

- `Area`: AI product help and reviewed story import
- `Decision`: Keep AI Help as a server-side OpenAI-backed assistant grounded on a curated local product guide and limited to usage questions. Separately, allow a reviewed AI story-import workflow from a person’s Notes panel that proposes canonical attribute drafts, one at a time, in the existing attribute modal. No AI path auto-saves data; the user must approve each proposal before it uses the normal save flow.
- `Reason`: The app needs grounded usage help and also benefits from narrative-to-attribute extraction, but those are different risk levels. Help should stay non-mutating. Story import is acceptable only as a draft-generation workflow that preserves explicit user review and the existing canonical attribute write path.
- `Alternatives Considered`: Static help pages only; client-side OpenAI calls; a broader AI agent that can modify or save family data automatically.
- `Impact`: Keeps `/api/t/[tenantKey]/ai/help` read-only, adds a separate tenant/person-scoped AI story-import API and Notes-panel launch button, reuses `AttributesModal` for sequential proposal review, and adds optional `OPENAI_STORY_IMPORT_MODEL`.
- `Follow-up`: If interview-based data entry or AI email drafting is added later, keep those as separate reviewed workflows too, and continue to require explicit human approval before any data write or outbound send.

- `Area`: Household media modeling
- `Decision`: Use `MediaAssets` + `MediaLinks` as the only household gallery model, while keeping `Households.wedding_photo_file_id` as the direct household avatar pointer.
- `Reason`: The old household-gallery compatibility path duplicated gallery state, complicated delete/search/integrity logic, and no longer matched the active OCI runtime model.
- `Alternatives Considered`: Keep the obsolete household gallery compatibility path as a read/write bridge.
- `Impact`: Runtime search/delete/integrity logic and schema docs now ignore the obsolete household gallery table; household gallery behavior is driven by `MediaLinks`, and the primary household image remains `wedding_photo_file_id`.
- `Follow-up`: If needed later, add a targeted data cleanup script to drop the obsolete household gallery table from live OCI environments after validation.

- `Area`: Family-group data editing permissions
- `Decision`: Any signed-in user with family-group access can edit shared family data in that family group, including people, households, relationships, attributes, and media. Admin remains required only for operational/admin functions such as invites, access management, audit, security policy, integrity tooling, and family-group administration.
- `Reason`: The product now expects regular family members to help curate shared family records, not just maintain their own self-profile. The old self-edit/admin split was blocking core family-building workflows like adding siblings, spouse households, children, and shared media.
- `Alternatives Considered`: Keep `USER` self-edit only; add a separate `EDITOR` role before broadening permissions.
- `Impact`: Family-data routes/pages are now gated by tenant access instead of admin role, while admin screens/routes stay restricted. Relationship-builder in-law sync no longer depends on the removed legacy attribute table.
- `Follow-up`: If a true read-only non-admin role is needed later, add an explicit `VIEWER` or `EDITOR` role instead of overloading `USER`.

- `Area`: Family-group relationship typing
- `Decision`: Store a system-managed `family_group_relationship_type` on `PersonFamilyGroups` with allowed values `founder`, `direct`, `in_law`, and `undeclared`. `founder` is admin-managed (maximum two per family group). `direct`, `in_law`, and `undeclared` are derived from founder state plus parent/spouse relationships in that family group. `undeclared` members stay visible in family-scoped lists/forms but do not appear in the main tree until placed.
- `Reason`: A boolean `in_law` flag was too weak for the actual product rules. The app needs to distinguish founders, direct-line members, spouses who belong through marriage, and members who belong to the family group but have not yet been placed in the tree.
- `Alternatives Considered`: Keep `in_law` as a single boolean flag on membership; store `in_law` on `Attributes`; derive everything only at read time with no persisted family-group relationship type.
- `Impact`: `PersonFamilyGroups.family_group_relationship_type` is now the canonical family-group classification field. Relationship save and integrity repair reconcile non-founder types centrally, generic/person attribute routes continue rejecting legacy `in_law` attribute writes, people UI exposes `Needs Placement` for `undeclared`, and founder assignment/removal is an admin-only operation.
- `Follow-up`: If step-parent or other relationship-role concepts are added later, keep them on relationship edges or household logic rather than expanding `family_group_relationship_type` beyond membership classification.

## 2026-03-12

- `Area`: Household runtime model
- `Decision`: Keep `Households.husband_person_id` / `wife_person_id` as the schema columns, but treat a household as a valid one-parent or two-parent unit at runtime. A one-parent household stores the single parent in the gender-appropriate column and leaves the other parent column blank.
- `Reason`: Divorce and single-parent household flows need to preserve the direct family member's household, children, media, and notes without introducing a second household system or a schema migration.
- `Alternatives Considered`: Keep households couple-only and delete the direct member household on divorce; add a second single-parent-household table; fake a second spouse/person value to satisfy couple-only code paths.
- `Impact`: Tree rendering, household detail/edit, child-add, integrity repair, and relationship-builder flows must all treat one-parent households as first-class valid records. `married_date` remains meaningful only for two-parent households and is cleared when converting a couple household into a one-parent household.
- `Follow-up`: Keep provisioning/import/admin tooling aligned to the one-or-two-parent rule and revisit neutral parent-role labeling only if the product later moves away from the current husband/wife schema column names.

## 2026-03-13

- `Area`: Person memorial and death-date modeling
- `Decision`: Record death as a canonical person event (`Attributes` event type/category `death`) instead of adding a top-level deceased flag or dedicated death column on `People`. UI surfaces may derive memorial state from that event and show quiet `From / To` date presentation when a death date exists.
- `Reason`: The product needs to support deceased individuals without making death a prominent profile field. Modeling death as an event keeps it aligned with the existing attribute/timeline system, supports estimated dates, and avoids a second person-status model.
- `Alternatives Considered`: Add `is_deceased` / `death_date` columns to `People`; add a prominent `Deceased` toggle; hide death only inside freeform notes.
- `Impact`: Attribute Definitions now include a default `Death` event category, memorial UI derives from that event, Home birthday chips show `In Mem`, Calendar can display both birth and death anniversaries, Tree/header date summaries can render lifespan ranges, and the person screen only shows `From / To` after a death event already exists.
- `Follow-up`: If memorial-specific content grows later, keep it attached to the same `death` event model rather than creating a separate memorial entity type.

## 2026-03-14

- `Area`: Family-group access inheritance
- `Decision`: Keep `UserFamilyGroups` as the canonical persisted family-group access model, but when creating user access or provisioning a new family group, derive additional family-group access from the union of enabled parent `UserFamilyGroups` memberships intersected with the child's enabled `PersonFamilyGroups` memberships. This inheritance runs only at create/provision time; it is not a live recursive access engine.
- `Reason`: The existing app only granted access for the currently selected family group or copied already-existing family access rows from a source family. That left children like Cleo without the expected family-group access even when their parents already had enabled access to the relevant grandparent family groups.
- `Alternatives Considered`: Keep access fully manual family-by-family; derive access recursively at session read time; infer access directly from `PersonFamilyGroups` without persisted `UserFamilyGroups` rows.
- `Impact`: Local-user creation, Google access creation, and new-family provisioning can now add inherited family-group access rows for eligible children. Inherited rows default to `USER` role unless an existing explicit family access row is copied by another flow. Auth/session behavior remains unchanged because the runtime still reads persisted `UserFamilyGroups`.
- `Follow-up`: If parent access changes later and inherited child access should be reconciled automatically, add an explicit repair/reconcile workflow rather than shifting auth to live recursive derivation.

## 2026-03-16

- `Area`: Modal and async interaction standard
- `Decision`: Standardize modal/action behavior across the app with one interaction model: async buttons must show immediate pending state, status feedback must remain in the active modal/card, `X` and `Cancel` must always mean close without saving, and the default modal footer action pattern is `Cancel` plus `Save and Close`. Shared UI primitives (`AsyncActionButton`, `ModalStatusBanner`, `ModalActionBar`, `ModalCloseButton`) are the preferred implementation path for new work.
- `Reason`: The app had accumulated multiple one-off modal and action patterns, which caused invisible background status messages, silent waits, inconsistent close/save meanings, and different feedback behavior from screen to screen.
- `Alternatives Considered`: Continue fixing each modal independently; standardize only copy without shared components; leave modal structure flexible and document only button labels.
- `Impact`: New and updated modal flows should keep status in the active surface, disable duplicate clicks while pending, disable close/cancel while saving, and use the shared primitives/documented wording standards. Existing high-friction flows are migrated first, then the remaining modals can be aligned incrementally.
- `Follow-up`: Audit remaining modal/card action flows against `docs/ui-interaction-standards.md` and migrate any remaining legacy status patterns onto the shared primitives.

- `Area`: User onboarding and sign-in
- `Decision`: User-facing onboarding and sign-in are now local username/password only. Invite creation still uses a person-bound invite link and contact email, but the invite flow now suggests a username, asks the recipient to choose their password on the invite page, and includes explicit login/install instructions instead of generating a temporary password. The public login page no longer offers Google, and the public invite flow no longer offers Google acceptance.
- `Reason`: The earlier Google/local/either onboarding model and generated temporary passwords were creating confusion. The live invite-accept screen already worked as a password-creation step, so continuing to generate temporary passwords and show Google alongside local sign-in made the onboarding path more complex than necessary.
- `Alternatives Considered`: Keep the Google/local/either invite model; keep generated temporary passwords; remove all backend Google compatibility immediately.
- `Impact`: New invites are created as local invites, temporary-password generation is removed, invite messages now include login and iPhone/iPad install guidance, and the user-facing login/invite screens are local-only. Existing Google-access data can remain for compatibility, but it is no longer part of the supported onboarding/login UI.
- `Follow-up`: If Google auth compatibility should be removed completely later, clean up the remaining provider/config/runtime branches in a separate auth-hardening pass.

- `Area`: Local password recovery
- `Decision`: Add a family-context self-service password reset flow for local users. The login page exposes `Forgot Password?`, reset requests are matched against exactly one enabled local user in the current family group using existing contact email data, and the app emails a single-use reset link that lets the user choose a new password and then sign in automatically.
- `Reason`: The app now expects user-facing sign-in to be local-only, which makes self-service recovery necessary. Admin-only password resets are not sufficient once invites and login no longer rely on Google.
- `Alternatives Considered`: Keep password resets admin-only; use usernames instead of email for reset lookup; store reset state inside invites instead of a separate token model.
- `Impact`: Adds public forgot-password/reset-password routes, a `PasswordResets` token table, reset emails through the existing Gmail sender, and family-specific reset validation against active local users. The request flow returns a generic success message so it does not reveal whether an email matched a user.
- `Follow-up`: If multiple active users intentionally share the same email in one family group, decide whether to support multi-user reset selection or require unique reset email addresses per active user.

## 2026-03-17

- `Area`: Person profile editing UX
- `Decision`: The person `Profile` tab should open in summary mode by default and expose editing one section at a time (`Identity`, `Name`, `Contact`, `Family`, `Notes`) instead of rendering the whole tab as an always-editable form.
- `Reason`: Most person fields are read far more often than they are edited. The prior always-editable layout used too much space, kept too many inputs on screen at once, and made the person screen feel heavier than the actual editing frequency justified.
- `Alternatives Considered`: Keep the full-form layout; add a single global edit checkbox that reveals all fields; split the person profile into separate pages instead of section editing.
- `Impact`: The Profile tab now shows label/value summaries by default, section-level `Edit` actions reveal fields only for the active section, and the modal footer shows `Cancel` + `Save and Close` only while a section is actively being edited.
- `Follow-up`: Apply the same summary-first pattern to other read-mostly entity screens if those screens show the same “always-edit form” problem.
## 2026-03-19

- `Area`: Media storage and delivery
- `Decision`: Store original uploads as canonical media assets and generate a derived image thumbnail asset at upload time when possible. Persist thumbnail linkage in `media_metadata` (`thumbnailFileId` and related dimensions/mime/size fields), use thumbnail assets for compact/list previews, and keep original assets for detail/open/full-size views.
- `Reason`: Family views and media lists need faster load/render behavior without losing source quality. Storing originals plus derived preview variants preserves quality while reducing bytes in high-frequency list/tile UI paths.
- `Alternatives Considered`: Continue serving originals for every surface; generate thumbnails only at view time; defer all variant work until OCI migration.
- `Impact`: Upload routes now attempt best-effort thumbnail generation for images, media metadata includes variant pointers, and preview UI paths resolve to thumbnail file IDs when present.
- `Follow-up`: Keep storage adapter behavior variant-aware so OCI migration can move originals/thumbnails without UI contract changes.

## 2026-03-22

- `Area`: Person primary-photo ownership
- `Decision`: Person primary photos are now globally person-scoped. `People.photo_file_id` is the only canonical primary headshot field for people, and person media links no longer carry authoritative primary state.
- `Reason`: The prior mixed model stored tenant-scoped `MediaLinks.is_primary` flags while also storing a global `People.photo_file_id`. That split allowed duplicate primaries, stale person avatars, and cross-family inconsistencies for shared people.
- `Alternatives Considered`: Keep family-group-scoped person primaries on `MediaLinks`; add a second family-scoped headshot pointer alongside `People.photo_file_id`.
- `Impact`: Setting or clearing a person primary photo now updates only the canonical `People.photo_file_id` selection logic, person UIs derive `Primary` from that field, and integrity/runtime paths must treat person `MediaLinks.is_primary` as non-authoritative legacy state.
- `Follow-up`: Backfill any existing stale `People.photo_file_id` rows and duplicate historical person-primary link flags in production data as a separate remediation step.

- `Area`: Face-recognition identity scope
- `Decision`: Person face profiles and detected face instances are globally person/file scoped. Runtime writes store canonical face rows under a global sentinel scope, and family-group access is enforced when candidate suggestions are read or returned rather than by duplicating biometric rows per family.
- `Reason`: The prior family-scoped face model duplicated the same person's biometric reference state across family groups, conflicted with the product rule that a person is the same person everywhere, and created the same kind of split-brain risk already seen in person primary-photo behavior.
- `Alternatives Considered`: Keep family-group-scoped face/profile rows; add both global and family-specific face stores side by side.
- `Impact`: `person_face_profiles` now represent one canonical profile per person, `face_instances` represent one canonical analyzed face set per file, reruns replace global face analysis for that file, and suggestion filtering must continue to use accessible people at read time so no unauthorized candidates are returned.
- `Follow-up`: Add explicit confirm/reject review flows, delete/retention cleanup, and a targeted OCI cleanup/backfill for remaining legacy family-scoped face rows after the global model is stable.
