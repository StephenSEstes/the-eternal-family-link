# Design Choices

This is the canonical design decision log for product, data, and UX behavior in this repo.

## Governance Rule

- If a proposed implementation conflicts with any decision here, pause and confirm with Steve before proceeding.
- If Steve approves the change, update this file in the same commit with:
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
- `Impact`: `rel_id` is the canonical global format `<from_person_id>-<to_person_id>-<rel_type>`.
- `Follow-up`: Keep family-specific views filtered by people membership, not by relationship-row scope.

- `Area`: Household schema labels
- `Decision`: Standardize on `husband_person_id` and `wife_person_id`.
- `Reason`: Remove legacy label ambiguity and reduce compatibility complexity.
- `Alternatives Considered`: Continuing dual support for `partner1_person_id` and `partner2_person_id`.
- `Impact`: CSV import and runtime reads/writes use only `husband_person_id` / `wife_person_id`.
- `Follow-up`: Remove remaining legacy partner-column references when ready.

- `Area`: Data model documentation
- `Decision`: Maintain `docs/data-schema.md` as the canonical schema reference for tables, columns, IDs, joins, logical indexes, and media-link design.
- `Reason`: Prevent drift between implemented schema and expected behavior.
- `Alternatives Considered`: Keep schema details spread across code only.
- `Impact`: Schema changes must be reflected in `docs/data-schema.md` in the same change.
- `Follow-up`: Keep the schema doc aligned with the active access-layer behavior.

## 2026-02-28

- `Area`: Access control
- `Decision`: Add hidden Steve-access superuser behavior at the auth/session layer for the developer account.
- `Reason`: Ensure uninterrupted administrative access across all family groups without adding a visible role option in UI dropdowns.
- `Alternatives Considered`: Add a visible role or manually maintain per-family admin rows.
- `Impact`: `stephensestes@gmail.com` receives global family-group `ADMIN` scope in session context.
- `Follow-up`: Revisit before multi-admin production rollout.

## 2026-03-02

- `Area`: Entity ID format
- `Decision`: Standardize entity IDs to typed opaque format with 8-character tokens:
  - `p-xxxxxxxx`
  - `rel-xxxxxxxx`
  - `h-xxxxxxxx`
  - `attr-xxxxxxxx`
  - `date-xxxxxxxx`
- `Reason`: Remove long data-derived IDs while preserving quick type readability.
- `Alternatives Considered`: Keep readable composite IDs.
- `Impact`: New writes use typed opaque IDs and linked references are remapped.
- `Follow-up`: Run migrations with dry-run first.

## 2026-03-04

- `Area`: Identifier policy
- `Decision`: Do not use mutable business data values as identifiers anywhere in the system.
- `Reason`: Data-derived identifiers create coupling, migration risk, and integrity drift.
- `Alternatives Considered`: Continue using names, emails, dates, or other business values as selected IDs.
- `Impact`: Use opaque stable IDs for all identity and joins.
- `Follow-up`: Audit remaining data-as-identifier usage and migrate it.

## 2026-03-06

- `Area`: Attribute storage architecture
- `Decision`: Consolidate person attribute persistence on unified `Attributes` and remove legacy `PersonAttributes` runtime/storage dependency.
- `Reason`: Dual-table behavior created inconsistent results and write-path ambiguity.
- `Alternatives Considered`: Keep dual-table compatibility indefinitely.
- `Impact`: `PERSON_ATTRIBUTES_TABLE` resolves to `Attributes`; legacy OCI `person_attributes` is removed from active runtime shape.
- `Follow-up`: Keep `docs/data-schema.md` aligned to the single-table model.

- `Area`: Attribute schema simplification
- `Decision`: Standardize `Attributes` rows on canonical fields: `attribute_id`, `entity_type`, `entity_id`, `attribute_type`, `attribute_type_category`, `attribute_date`, `date_is_estimated`, `estimated_to`, `attribute_detail`, `attribute_notes`, `end_date`, `created_at`, `updated_at`.
- `Reason`: Legacy compatibility fields were causing UI/data ambiguity.
- `Alternatives Considered`: Continue dual-shape compatibility with old columns.
- `Impact`: Attribute UI and APIs now map to the canonical fields only.
- `Follow-up`: Model future media pointers explicitly instead of reintroducing legacy attribute columns.

## 2026-03-07

- `Area`: Attribute event metadata management
- `Decision`: Store family-group-specific event category/type UI definitions in `FamilyConfig.attribute_event_definitions_json`.
- `Reason`: Event options and detail labels need admin control without code edits.
- `Alternatives Considered`: Hardcoded frontend lists only or dedicated definitions tables.
- `Impact`: Admin manages event definitions and Add Attribute reads from that config with defaults fallback.
- `Follow-up`: Move to normalized tables only if definitions become large or need history.

## 2026-03-10

- `Area`: Attribute kind and unified definitions
- `Decision`: Persist `Attributes.attribute_kind` as the canonical discriminator (`descriptor` | `event`) and manage descriptor/event definitions from the same family-level definitions document.
- `Reason`: Inferred kind behavior was too fragile.
- `Alternatives Considered`: Infer kind from `attribute_type` or use a more generic category field.
- `Impact`: Reads/writes persist `attribute_kind`; the definitions screen manages both descriptor and event types.
- `Follow-up`: Add stronger integrity audits later if production data needs them.

- `Area`: Runtime persistence backend
- `Decision`: OCI is the only supported persistence backend.
- `Reason`: Keeping deleted-backend tooling around added noise and preserved dead paths.
- `Alternatives Considered`: Keep old backend tooling for migration/debug only.
- `Impact`: Active runtime is OCI-only.
- `Follow-up`: Keep new code/docs free of legacy-backend naming.

- `Area`: User onboarding and invitations
- `Decision`: Use person-bound invite records with one invite URL as the onboarding path.
- `Reason`: The app already treats `People`, `UserAccess`, and `UserFamilyGroups` as the canonical identity/access model.
- `Alternatives Considered`: Email-only invites not bound to `person_id`, manual provisioning only, or magic-link auth.
- `Impact`: Added `Invites`, invite-time family snapshots, and local/Google-era provisioning behavior.
- `Follow-up`: Keep future outbound email on the same invite records.

- `Area`: AI product help and reviewed story import
- `Decision`: Keep AI Help as a grounded read-only assistant and story import as a separate reviewed proposal workflow.
- `Reason`: Help and data mutation are different risk levels.
- `Alternatives Considered`: Static help only, client-side AI calls, or a broader autonomous AI agent.
- `Impact`: Help remains read-only; story import requires explicit user approval before normal save flows.
- `Follow-up`: Keep any future AI data-entry tools as explicit reviewed workflows too.

- `Area`: Household media modeling
- `Decision`: Use `MediaAssets` + `MediaLinks` as the household gallery model while keeping `Households.wedding_photo_file_id` as the direct household avatar pointer.
- `Reason`: The obsolete gallery compatibility path duplicated state and no longer matched the OCI runtime model.
- `Alternatives Considered`: Keep the obsolete bridge path.
- `Impact`: Household gallery behavior is driven by `MediaLinks`; the primary household image remains `wedding_photo_file_id`.
- `Follow-up`: Drop obsolete tables from live OCI environments after validation if needed.

- `Area`: Family-group data editing permissions
- `Decision`: Any signed-in user with family-group access can edit shared family data in that family group; admin remains for operational/admin functions.
- `Reason`: The product expects collaborative family curation.
- `Alternatives Considered`: Keep `USER` self-edit only or add a separate editor role first.
- `Impact`: Family-data routes/pages are gated by tenant access instead of admin role.
- `Follow-up`: Add an explicit read-only role later if needed.

- `Area`: Family-group relationship typing
- `Decision`: Store system-managed `family_group_relationship_type` on `PersonFamilyGroups` with `founder`, `direct`, `in_law`, and `undeclared`.
- `Reason`: A boolean in-law flag was too weak for the actual product rules.
- `Alternatives Considered`: Keep `in_law` as a boolean or derive everything only at read time.
- `Impact`: `family_group_relationship_type` is the canonical family-group classification field.
- `Follow-up`: Keep future role concepts on edges/households, not on membership classification.

## 2026-03-12

- `Area`: Household runtime model
- `Decision`: Keep `Households.husband_person_id` / `wife_person_id`, but treat a household as a valid one-parent or two-parent unit at runtime.
- `Reason`: Divorce and single-parent flows must preserve households, children, media, and notes without introducing a second household system.
- `Alternatives Considered`: Keep couple-only households, add a second table, or fake a second spouse.
- `Impact`: Tree, detail, edit, child-add, and integrity flows all treat one-parent households as valid.
- `Follow-up`: Keep tooling aligned to the one-or-two-parent rule.

## 2026-03-13

- `Area`: Person memorial and death-date modeling
- `Decision`: Record death as a canonical `Attributes` event instead of top-level person columns.
- `Reason`: The product needs quiet memorial support without a second person-status model.
- `Alternatives Considered`: Add `is_deceased` / `death_date` on `People`.
- `Impact`: Memorial state and lifespan display derive from the `death` event.
- `Follow-up`: Keep any future memorial features on the same event model.

## 2026-03-14

- `Area`: Family-group access inheritance
- `Decision`: Keep `UserFamilyGroups` as the persisted access model, but derive additional access from enabled parent access intersected with the child’s enabled family memberships at create/provision time only.
- `Reason`: Children were missing expected family access when parents already had it.
- `Alternatives Considered`: Fully manual access, live recursive auth derivation, or access derived only from `PersonFamilyGroups`.
- `Impact`: Provisioning flows can add inherited `UserFamilyGroups` rows; auth/session reads remain unchanged.
- `Follow-up`: If inherited access later needs reconciliation, add a repair workflow instead of moving auth to live recursive derivation.

## 2026-03-16

- `Area`: Modal and async interaction standard
- `Decision`: Standardize modal/action behavior with one interaction model: immediate pending state, status in the active surface, `X` and `Cancel` mean close-without-save, and the default modal footer is `Cancel` plus `Save and Close`.
- `Reason`: The app had accumulated inconsistent modal and async patterns.
- `Alternatives Considered`: Fix each modal independently or standardize only copy without shared patterns.
- `Impact`: New and updated modals use the shared interaction standard and primitives.
- `Follow-up`: Audit remaining modal/card flows against `docs/ui-interaction-standards.md`.

- `Area`: User onboarding and sign-in
- `Decision`: User-facing onboarding and sign-in are local username/password only.
- `Reason`: The mixed Google/local model and generated temporary passwords were too confusing.
- `Alternatives Considered`: Keep the mixed model or generated temporary passwords.
- `Impact`: New invites are local-only from the user-facing perspective; existing Google-era data may remain for compatibility.
- `Follow-up`: Remove remaining Google compatibility branches later if desired.

- `Area`: Local password recovery
- `Decision`: Add family-context self-service password reset for local users.
- `Reason`: Local-only sign-in requires self-service recovery.
- `Alternatives Considered`: Keep resets admin-only or use a different lookup model.
- `Impact`: Added public reset routes and `PasswordResets`.
- `Follow-up`: Decide how to handle multiple active users sharing one email in one family group if that becomes a real case.

## 2026-03-17

- `Area`: Person profile editing UX
- `Decision`: The person `Profile` tab is summary-first and reveals editing one section at a time.
- `Reason`: The screen is read far more often than it is edited.
- `Alternatives Considered`: Keep the full-form layout or a single global edit mode.
- `Impact`: The tab now shows summaries by default with section-level edit actions.
- `Follow-up`: Apply the same pattern to other read-mostly screens if needed.

## 2026-03-19

- `Area`: Media storage and delivery
- `Decision`: Store original uploads as canonical media assets and generate a derived image thumbnail object when possible.
- `Reason`: List/tile surfaces need faster preview loading without losing source quality.
- `Alternatives Considered`: Serve originals everywhere or generate thumbnails only at view time.
- `Impact`: Uploads attempt best-effort thumbnail generation and preview delivery prefers thumbnail object variants.
- `Follow-up`: Keep storage behavior variant-aware.

## 2026-03-22

- `Area`: Face-recognition review workflow
- `Decision`: Manual reviewed face-to-person association is the trusted workflow for building person face profiles.
- `Reason`: Face recognition needs a reliable human-confirmed path.
- `Alternatives Considered`: Headshot-only seeding or broader auto-assignment before explicit review.
- `Impact`: Face UI should expose detected crops plus explicit association actions.
- `Follow-up`: Expand to multi-face reviewed workflows later.

- `Area`: Person primary-photo ownership
- `Decision`: `People.photo_file_id` is the only canonical primary headshot field for people.
- `Reason`: Mixed global and family-scoped primary-photo state created split-brain behavior.
- `Alternatives Considered`: Keep family-scoped person primaries or add two parallel primary-photo models.
- `Impact`: Person UI/runtime derives primary state only from `People.photo_file_id`.
- `Follow-up`: Backfill stale rows and duplicate legacy primary flags separately.

- `Area`: Face-recognition identity scope
- `Decision`: Face profiles and detected face instances are globally person/file scoped.
- `Reason`: Family-scoped biometric duplication conflicted with the product rule that a person is the same person everywhere.
- `Alternatives Considered`: Keep family-scoped face/profile rows or store both global and family-specific copies.
- `Impact`: Runtime writes use global sentinel scope and enforce family access only at read time.
- `Follow-up`: Add confirm/reject flows and cleanup of remaining legacy rows.

- `Area`: Media EXIF persistence
- `Decision`: Persist high-value normalized EXIF fields directly on `MediaAssets` and use `exif_extracted_at` as the canonical “attempted” marker.
- `Reason`: EXIF is file-level metadata and should not require reparsing bytes on later runs.
- `Alternatives Considered`: Keep EXIF transient or store it only in JSON.
- `Impact`: `MediaAssets` now carries query-friendly EXIF fields without new indexes in this phase.
- `Follow-up`: Add indexes only if later workloads justify them.

## 2026-03-23

- `Area`: OCI Vision request transport
- `Decision`: Use direct signed OCI Vision REST requests for `analyzeImage` while keeping the OCI SDK for auth/signing/http transport.
- `Reason`: The generated high-level client wrapper was unreliable on some valid images.
- `Alternatives Considered`: Keep patching the wrapper or replace the full OCI SDK stack.
- `Impact`: The app now owns request/response parsing for that endpoint and surfaces clearer failure details.
- `Follow-up`: Reevaluate only if Oracle later fixes the wrapper behavior.

## 2026-03-25

- `Area`: Media asset recency semantics
- `Decision`: Treat `MediaAssets.created_at` as the immutable database add/upload timestamp for a media asset, not as the photo's capture date or the browser file's `lastModified` value.
- `Reason`: Using file-age timestamps for `created_at` caused newly uploaded older photos to sort incorrectly in the media library and made "recent" behavior misleading.
- `Alternatives Considered`: Keep file-age semantics, or add a second upload-timestamp column while leaving `created_at` ambiguous.
- `Impact`: Upload/write paths must set `created_at` from upload-now, media-library recency must sort on that timestamp, and `photo_date` plus EXIF fields remain the canonical media-date model.
- `Follow-up`: Backfill existing `MediaAssets.created_at` values from upload audit evidence where available so current rows match the corrected rule.

## 2026-03-24

- `Area`: Media modal intelligence behavior
- `Decision`: The media modal is a stored-data surface only for analysis. It must not auto-run intelligence or expose modal actions for generating suggestions, refreshing processing status, refreshing EXIF, applying suggested title/description/date, or associating faces until the workflow is redesigned.
- `Reason`: The modal had become an unstable catch-all workflow.
- `Alternatives Considered`: Keep active intelligence controls or remove the analysis surface entirely.
- `Impact`: Media detail editing remains; intelligence-related behavior is inactive from the modal surface.
- `Follow-up`: Redesign intelligence as a separate narrower workflow before re-enabling any active analysis actions.

- `Area`: Media asset storage metadata normalization
- `Decision`: Store asset-level technical media fields as normalized `MediaAssets` columns. The approved normalized fields are `source_provider`, `source_file_id`, `original_object_key`, `thumbnail_object_key`, `checksum_sha256`, `media_width`, `media_height`, and `media_duration_sec`. `MediaLinks` should not store copied asset technical metadata.
- `Reason`: Technical asset fields were buried in JSON and duplicated into links, which made reads slower and directly caused `ORA-12899` failures on metadata-heavy writes.
- `Alternatives Considered`: Keep a catch-all JSON design, enlarge `media_metadata`, or keep mirroring into `MediaLinks`.
- `Impact`: Upload/resolver/intelligence/duplicate-detection paths should read/write the normalized asset columns directly.
- `Follow-up`: Confirm any future normalized fields with Steve before expanding further.

## 2026-03-25

- `Area`: Design-document consolidation
- `Decision`: `designchoices.md` is the single canonical design document for this repo. `docs/design-decisions.md` is retained only as a compatibility pointer.
- `Reason`: Keeping two parallel design-document entry points created unnecessary drift risk and extra process overhead.
- `Alternatives Considered`: Keep dual documents in sync indefinitely or make `docs/design-decisions.md` canonical instead.
- `Impact`: Repo rules, TODO references, and future design updates should point to `designchoices.md` only.
- `Follow-up`: Keep the alias file short and non-authoritative.

- `Area`: Canonical media asset model
- `Decision`: Canonical media-level fields now live on `MediaAssets`. The approved canonical fields are `media_kind`, `label`, `description`, `photo_date`, and immutable `created_at`, along with the already-normalized technical asset and EXIF fields. `MediaLinks` is association-only in active runtime behavior.
- `Reason`: Photo-level identity and display metadata were split across `MediaAssets`, `MediaLinks`, and attribute compatibility writes, which caused inconsistent ordering, inconsistent edit behavior, and the misleading use of link timestamps as if they were asset timestamps.
- `Alternatives Considered`: Keep photo-level fields on `MediaLinks`, keep `created_at` mutable, or continue treating `MediaLinks.created_at` as the media library ordering source.
- `Impact`: Media library/detail reads and edit/write paths should resolve canonical name, description, user date, media kind, and created timestamp from `MediaAssets`. `MediaLinks` remains responsible for association scope, usage, primary/sort behavior, and family visibility only.
- `Follow-up`: Keep temporary fallback reads only as a migration bridge while old rows are normalized.

- `Area`: Media metadata JSON retirement
- `Decision`: `MediaAssets.media_metadata` and `MediaLinks.media_metadata` are no longer active runtime write surfaces. Do not persist capture source, processing status, photo intelligence, face suggestions, thumbnail detail payloads, or legacy technical asset data into those JSON fields.
- `Reason`: The remaining JSON payload had become a mixed-purpose storage bucket for behavior state, stale compatibility data, and technical metadata that already has better normalized homes.
- `Alternatives Considered`: Keep a lean-but-active JSON write model or widen the metadata field.
- `Impact`: Active runtime writes stop persisting new metadata JSON. Existing rows may still contain historical JSON, but the app should not depend on it for current canonical behavior.
- `Follow-up`: Remove dead metadata readers as the remaining surfaces are cut over.

- `Area`: Storage provider contract
- `Decision`: `storage_provider` is removed from the active media runtime/schema contract. OCI object storage is the only supported storage backend for media assets.
- `Reason`: Provider branching is no longer part of the supported product model and keeping it in the active contract preserves unnecessary ambiguity.
- `Alternatives Considered`: Keep `storage_provider` as an active first-class field for future multi-provider support.
- `Impact`: Media resolution should use normalized object-key presence and OCI configuration instead of provider branching.
- `Follow-up`: Physical column cleanup can be handled separately after active runtime references are gone.

- `Area`: Deferred media identity cleanup
- `Decision`: The `media_id` / `file_id` redundancy is explicitly deferred and must not be mixed into this cutover.
- `Reason`: The repo needs to finish the canonical `MediaAssets` cutover first without expanding scope into a separate identity refactor.
- `Alternatives Considered`: Combine canonical field migration and identity simplification in the same release.
- `Impact`: Current runtime keeps both identifiers for now.
- `Follow-up`: Revisit only after the new canonical asset model is stable.

## 2026-03-29

- `Area`: Media thumbnail delivery performance
- `Decision`: Authorize media visibility at list/search time and deliver OCI-direct thumbnail/original URLs in media API payloads, while keeping proxy fallback for reliability.
- `Reason`: Per-image auth-proxy checks were a major tile-load bottleneck and degraded adoption-critical perceived performance.
- `Alternatives Considered`: Keep session-checked proxy on every image request, or make all media objects globally public.
- `Impact`: Media tile/modal surfaces prefer direct object URLs for keyed assets; proxy routes remain fallback paths.
- `Follow-up`: Continue reducing missing `thumbnail_object_key` rows so preview never falls back to full originals.

- `Area`: Person modal media scope
- `Decision`: Person modal media (`Profile > Media`) should aggregate person-linked media across all family groups the signed-in user can access, not only the currently active family group.
- `Reason`: Active-family-only scoping hid valid person-linked media and caused inconsistent user trust when switching families.
- `Alternatives Considered`: Keep active-family-only scoping in person modal media.
- `Impact`: Tenant-scoped attribute reads now load person media links across accessible family groups for person entities.
- `Follow-up`: Keep non-person entity views scoped to active family unless explicitly changed.
