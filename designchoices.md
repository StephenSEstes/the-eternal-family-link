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

## 2026-03-29

- `Area`: Person media access scope
- `Decision`: For the person modal media load path (`/api/t/[tenantKey]/attributes?entity_type=person`), temporarily bypass tenant-family membership gating and load media links across all family groups for the signed-in session.
- `Reason`: Requested to prioritize complete person-linked media visibility over tenant-scoped filtering in this phase.
- `Alternatives Considered`: Keep tenant-scoped access list gating; add a new opt-in global media mode.
- `Impact`: Person media tab can surface all images linked to the person even when links exist outside the active tenant scope.
- `Follow-up`: Revisit and formalize long-term cross-family access policy after reliability/performance stabilization.

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

## 2026-03-30

- `Area`: Media conversation threads
- `Decision`: Persist media comments in a dedicated `MediaComments` table keyed by `comment_id`, scoped by `family_group_key`, linked to media by `file_id`, and threaded by `parent_comment_id` with soft-delete (`comment_status=deleted`) to preserve thread continuity.
- `Reason`: Robust family conversations on media need explicit threaded storage, author metadata, and edit/delete lifecycle behavior that should not be mixed into media metadata JSON or link rows.
- `Alternatives Considered`: Store comments in media metadata JSON, keep flat non-threaded comments only, or hard-delete comment rows.
- `Impact`: Media modal can render conversational threads with replies, author/admin mutation rules, and stable history on deleted comments.
- `Follow-up`: Add notifications/mentions and unread state after baseline thread behavior is stable.

## 2026-04-04

- `Area`: Family Shares threads + notification pipeline
- `Decision`: Add a dedicated family-sharing model using audience-scoped threads (`share_threads`, `share_thread_members`) with posts/comments (`share_posts`, `share_post_comments`) and asynchronous notification plumbing (`push_subscriptions`, `notification_outbox`). Writes must stay non-blocking for end users: post/comment creation enqueues outbox events instead of waiting for delivery.
- `Reason`: Home-level WhatsApp-style family sharing requires persistent audience threads, media-aware posts, and conversational comments without overloading existing media-link tables or coupling user actions to push delivery latency.
- `Alternatives Considered`: Reuse `MediaComments` only, store sharing threads in media metadata JSON, or send push synchronously in request paths.
- `Impact`: New `/api/t/[tenantKey]/shares/...` endpoints become the canonical sharing API surface; Home/Nav can surface a `Shares` destination while existing Media/People flows remain unchanged.
- `Follow-up`: Add production push dispatcher transport and retry/backoff tuning, then expand Shares UX with richer thread grouping and unread indicators.

- `Area`: Family Shares group creation + thread-open UX
- `Decision`: Support custom member-based share groups (`audience_type=custom_group`) keyed by canonical member-set signature, prevent duplicate groups with the same exact members, show current thread members at the top of the thread view, and treat audience/group selection as the open action (no separate Open button for standard audiences).
- `Reason`: Opening and understanding a thread should be immediate, and duplicate groups with identical membership create unnecessary clutter/confusion.
- `Alternatives Considered`: Keep Open button workflow, allow duplicate custom groups, or hide thread members until a secondary details view.
- `Impact`: Shares thread create path now accepts custom member sets and reuses existing group thread if membership signature already exists; posts payload includes thread-member display data for header rendering.
- `Follow-up`: Add optional group rename/member-edit workflow if group management becomes a recurring user need.

- `Area`: Family Shares normalized custom-group model
- `Decision`: Promote custom groups to first-class normalized entities (`share_groups`, `share_group_members`) and link threads via `share_threads.group_id`, while retaining audience-key thread uniqueness for compatibility.
- `Reason`: Signature-only custom groups tied directly to thread rows were not flexible enough for durable group lifecycle management and created coupling between membership identity and thread records.
- `Alternatives Considered`: Keep signature-only thread model or store custom-group metadata in thread JSON.
- `Impact`: Custom-group create/reuse path now resolves a normalized group row first, then resolves/creates its thread; duplicate-member-set prevention is enforced at normalized group signature scope.
- `Follow-up`: Add explicit group-rename and member-edit APIs/UX on top of normalized group identity.

- `Area`: Family Shares audience semantics (`household` => Immediate Family)
- `Decision`: Keep internal audience key `household` for compatibility, but present it as `Immediate Family` and resolve recipients as: actor + spouse + user-children when user-children exist; otherwise actor + parents + siblings + spouse.
- `Reason`: The previous household label/logic did not match the requested family-sharing intent and produced recipient sets that were too narrow or ambiguous.
- `Alternatives Considered`: Rename API enum immediately (breaking change) or keep old household member expansion rules.
- `Impact`: UI now shows `Immediate Family`; server audience resolver applies deterministic immediate-family recipient rules using relationships, household spouse linkage, and enabled-user detection.
- `Follow-up`: Revisit enum naming migration (`household` -> `immediate_family`) only when all clients can migrate together.

- `Area`: Legacy media/share support retirement (test-data environment)
- `Decision`: Remove runtime compatibility fallbacks for legacy media-link/metadata behavior and allow full purge of legacy test-only media/share content.
- `Reason`: The current environment contains only test data, so preserving old compatibility paths creates ambiguity and operational drag without product value.
- `Alternatives Considered`: Keep dual read paths and slowly migrate data in place.
- `Impact`: Media reads depend on canonical `MediaAssets` columns; `usage_type='share'` compatibility links are excluded from canonical media reads; reset tooling can clear share/media/face/comment test content safely.
- `Follow-up`: If production historical data is introduced later, define explicit migration scripts before reintroducing any compatibility mode.

- `Area`: Family Shares conversation topics + per-topic read-state
- `Decision`: Model each share group (`share_threads`) as a continuous communication container with distinct titled conversation topics (`share_conversations`) and per-conversation membership/read-state (`share_conversation_members`). All new share posts must write a `conversation_id`.
- `Reason`: A single post stream per share group did not support durable topic separation or accurate read/unread behavior for uploads and comments by topic.
- `Alternatives Considered`: Keep one flat thread stream; infer topics from caption hashtags only; store topic state in JSON fields.
- `Impact`: Shares UI opens a share group, then shows a conversation list ordered by activity. Unread badges are computed and cleared per conversation. New conversation creation requires a title and supports optional initial text/media.
- `Follow-up`: Add conversation rename/archive/member-edit controls when needed.

- `Area`: Header action placement
- `Decision`: Move Help to a question-mark action beside user initials, move Admin into the user-initials popout, and remove duplicate top-nav Sign out.
- `Reason`: Keep top navigation focused on destinations and move account/actions into one consistent user-menu surface.
- `Alternatives Considered`: Keep Help/Admin/Sign out as top-level nav pills.
- `Impact`: Header nav now contains only section destinations; Help/Admin/Sign out are available from the user-initials area.
- `Follow-up`: Keep future account-scoped actions in the same user popout to avoid duplicate controls.

## 2026-04-05

- `Area`: Family Shares access model (people-first kickoff)
- `Decision`: Shift Shares runtime read/access semantics to membership-first. Thread list and thread resolution are based on `share_thread_members(person_id)` membership, not active family-group route context. Family-group audience concepts remain creation templates and metadata in this phase.
- `Reason`: Users think in recipient/member conversations, not family-group containers. Active-family-gated reads caused avoidable context switches and inconsistent visibility for multi-family users.
- `Alternatives Considered`: Keep family-group-gated reads and rely on more UI hints/training.
- `Impact`: Shares inbox and thread access become stable across family-group switching for valid members; existing thread/post/comment payload contracts stay compatible.
- `Follow-up`: Complete people-first creation identity (member-signature-first threads) and then retire legacy family-group-centric share gating logic.

## 2026-04-08

- `Area`: Unit 1 redesign execution model
- `Decision`: Implement Unit 1 as an isolated greenfield app under `efl2/` on a dedicated branch/deploy track, and migrate functionality in small units. Do not ship Unit 1 by extending the legacy EFL app surfaces on `main`.
- `Reason`: Prior additive rollout carried legacy scope and conflicted with the agreed goal of rebuilding access/visibility behavior from a clean baseline.
- `Alternatives Considered`: Continue additive `/u1` inside the existing app; pause implementation until a future full rewrite branch.
- `Impact`: Unit 1 development is constrained to login/session + preference administration first, with explicit module boundaries and separate deployment targeting.
- `Follow-up`: Keep each new unit explicitly scoped and approved before importing any legacy module or extending to new domains (media, people, calendars, stories).

## 2026-04-11

- `Area`: Unit 1/Famailink relationship visibility, subscriptions, and sharing
- `Decision`: Split the model into three separate concepts:
  - family-tree visibility: supported family members are always visible in the tree at least by name and relationship
  - subscriptions: notification/update preferences only
  - sharing: content visibility rules for `vitals`, `stories`, `media`, and `conversations`
- `Reason`: Treating subscription as an access gate made the model harder to understand and did not match the intended product behavior.
- `Alternatives Considered`: Keep subscription as the main visibility/access gate; hide unsubscribed relatives entirely from the tree.
- `Impact`: Unit 1/Famailink must show supported relatives in the tree regardless of subscription state, allow subscribe/unsubscribe from that tree surface, and evaluate sharing separately from notification preferences.
- `Follow-up`: Keep derived visibility/share results separate from derived subscription results in the Unit 1 implementation.

- `Area`: Unit 1/Famailink relationship storage
- `Decision`: Store only direct structural relationships in the relationship layer and derive extended family categories from those direct rows.
- `Reason`: Direct-only relationship rows are easier to maintain and avoid drift from storing both direct and derived family links.
- `Alternatives Considered`: Store sibling/cousin/aunt/uncle style derived relationships directly; move father/mother/spouse IDs onto `People` as the only family-structure model.
- `Impact`: Direct relationship rows should cover the core structural links (`parent`, `step_parent`, `spouse`, `ex_spouse`, with `adoptive_parent` / `guardian` available if needed). Extended categories used by Unit 1 (`siblings`, `cousins`, `cousins_children`, etc.) are derived in code or derived-map tables.
- `Follow-up`: Keep schema additions additive and validate the derivation logic through the Unit 1 family tree MVP.

- `Area`: Unit 1/Famailink MVP test surface
- `Decision`: The MVP must prove the model through a family tree view, not only through admin/rule-edit screens.
- `Reason`: The easiest way to validate whether the model works is to let the signed-in user change rules and immediately see family members in the tree reflect the expected visibility, sharing, and subscription state.
- `Alternatives Considered`: Build preferences-only administration first and defer the tree test surface.
- `Impact`: The isolated Unit 1 app should include login, rule editors, recompute/status, preview, and a family tree test view where every supported family member appears at least by name.
- `Follow-up`: Keep the first MVP scope narrow and use the tree to validate the principle before porting the model back into broader EFL surfaces.

## 2026-04-12

- `Area`: Famailink preferences default-rule modeling
- `Decision`: Default preferences must be expressed as one logical row per relationship category. For side-specific categories, the saved default is a single lineage selection (`none`, `both`, `maternal`, or `paternal`) rather than overlapping side rows.
- `Reason`: Rendering and evaluating separate `both`, `maternal`, and `paternal` rows for the same relationship category exposed storage mechanics directly in the UI, allowed contradictory states, and created ambiguous rule resolution.
- `Alternatives Considered`: Keep one row per side with overlap rules; add more precedence logic on top of the existing row model.
- `Impact`: Preferences UI/runtime should no longer repeat the same relationship category across multiple side rows. Subscription and sharing defaults should read and save one logical default per relationship category.
- `Follow-up`: If future product needs truly independent side overrides again, reintroduce them only with explicit fallback/override semantics rather than overlapping peer rows.

## 2026-04-13

- `Area`: Famailink in-law relationship modeling
- `Decision`: Represent in-laws as explicit one-hop relationship categories in Famailink instead of implying them through blood-line category selectors. The supported in-law categories are `parents_in_law`, `grandparents_in_law`, `siblings_in_law`, `children_in_law`, `aunts_uncles_in_law`, `nieces_nephews_in_law`, and `cousins_in_law`.
- `Reason`: Users expect by-marriage relatives to be visible and configurable explicitly. Using blood-line controls such as `Both Sides` to imply in-laws would make those controls ambiguous and unstable. `Grandparents-In-Law` was later added for symmetry and generational completeness in the rules tree and defaults model.
- `Alternatives Considered`: Keep the blood-line-only model; silently fold in-laws into existing blood categories; recursively expand in-laws of in-laws.
- `Impact`: Famailink tree/catalog/preview/defaults now need to surface explicit in-law categories. These categories are non-side-specific in v1 and remain limited to one marriage hop.
- `Follow-up`: Revisit whether spouse-side extended relatives should become separate categories in a later pass, but do not add recursive in-law expansion without explicit approval.

- `Area`: Famailink default posture
- `Decision`: Famailink defaults should be liberally inclusive in the MVP. Missing default rows are treated as broad system defaults rather than deny-by-absence, and person exceptions are the primary way to narrow behavior for specific people.
- `Reason`: The product intent is to encourage closer family relationships, and the previous exclusive-by-absence behavior made the MVP feel like a rule engine users had to opt into category by category.
- `Alternatives Considered`: Keep deny-by-absence runtime behavior; add presets instead of changing the default posture; hide rows to simplify the screen.
- `Impact`: Subscription defaults synthesize broad coverage by relationship, sharing defaults synthesize broad baseline scope visibility, and the preferences UI should present exceptions as the normal way to exclude one person without narrowing a whole category.
- `Follow-up`: Revisit whether some sharing scopes should become less broad by default only if real usage shows the current MVP default is too open.

- `Area`: Famailink preference administration surface
- `Decision`: The Famailink tree is the primary person-first preference surface for one-relative-at-a-time changes. Clicking a relative on the tree opens a modal for relationship-default context plus person-level subscription/sharing overrides, while `/preferences` remains the full-table editor for broader management.
- `Reason`: Users think in terms of real relatives and family structure more naturally than raw rule rows. A tree-driven modal keeps the existing rules model intact while making the most common edits more intuitive.
- `Alternatives Considered`: Keep preferences table-first only; replace the full preferences screen entirely with a tree-only editor in the MVP.
- `Impact`: `/tree` is no longer readback-only. It now supports direct preference editing for a selected relative without changing the underlying defaults/exceptions storage model.
- `Follow-up`: If the tree-driven flow proves out, revisit how much of the table-heavy preferences screen still needs to remain first-class.

- `Area`: Famailink defaults administration surface
- `Decision`: Broad Famailink defaults should be administered in a generic relationship rules tree, while person-specific overrides stay on the real person tree. `/rules-tree` is the relationship-first defaults surface; `/tree` is the person-first override surface; `/preferences` remains the table fallback.
- `Reason`: Defaults are about relationship buckets, not one specific relative. A generic relationship tree matches how users think about broad family groups better than a spreadsheet-style table.
- `Alternatives Considered`: Keep defaults table-first only; move all editing onto the real person tree; remove the table screen immediately.
- `Impact`: Famailink now has separate conceptual surfaces for defaults and exceptions without changing the underlying defaults/exceptions storage model.
- `Follow-up`: Revisit whether the table-based defaults editor still needs to remain visible once the rules tree has been tested in practice.

## 2026-04-14

- `Area`: Famailink in-law default scope
- `Decision`: Narrow the Famailink broad-default in-law categories to `parents_in_law`, `grandparents_in_law`, `siblings_in_law`, `children_in_law`, and `nieces_nephews_in_law`. Remove `aunts_uncles_in_law` and `cousins_in_law` from the supported defaults/tree model. Keep edge cases and unusual relative handling at the person-exception level rather than continuing to expand low-value default categories.
- `Reason`: The broader in-law set made the rules tree denser without enough product value. The desired MVP posture is broad, simple defaults with exceptions for unusual cases, not an ever-expanding relationship grid.
- `Alternatives Considered`: Keep all one-hop in-law categories in the defaults tree; hide the extra categories visually but keep them active in the model.
- `Impact`: Famailink relationship constants, derived buckets, rules-tree layout, and tree grouping exclude `aunts_uncles_in_law` and `cousins_in_law` as supported broad-default categories. Remaining in-law defaults stay limited to one marriage hop.
- `Follow-up`: Reintroduce removed in-law categories only with explicit product approval and a clear user value case.

- `Area`: Famailink rules-tree summary density
- `Decision`: Keep `/rules-tree` compact and summary-first. Relationship nodes should not use decorative icon circles. Broad defaults are summarized with a two-column shorthand row: `Subs` shows `B` / `M` / `P` / `-`, and `Share` shows active content scope letters `V` / `S` / `M` / `C` or `-`. Editing remains in a small modal popout instead of inline on the tree.
- `Reason`: The earlier rules-tree cards spent too much space on decoration and verbose labels, which reduced mobile scanability and made the surface feel more like settings cards than a compact family-structure editor.
- `Alternatives Considered`: Keep verbose node summaries; keep inline editing on the tree; rely on responsive CSS only without changing the summary model.
- `Impact`: `/rules-tree` is now a compact navigation-and-summary surface. Users can scan broad defaults quickly, while detailed or exceptional handling remains in the modal or on the person tree.
- `Follow-up`: Keep testing whether the compact tree removes enough need for the table-based defaults screen before reducing that screen further.

- `Area`: Famailink navigation and person detail administration
- `Decision`: Famailink should present `Family Tree` as the main user surface and `Administration` as the home for broad defaults and diagnostics. The Rules Tree remains the graphical default-rule editor under Administration, while the real person tree owns person selection, person detail, and person-specific inclusion/exclusion controls through a person detail modal tab.
- `Reason`: `/rules-tree` and `/preferences` were becoming redundant peer destinations even though both administer defaults. Users should primarily think in terms of people on the tree, while defaults and diagnostics belong under an explicit administration surface.
- `Alternatives Considered`: Keep Tree, Rules Tree, and Preferences as top-level peers; remove `/preferences` immediately; import the legacy EFL tree/modal components directly into Famailink.
- `Impact`: Famailink now has an app header with `Family Tree` and `Administration`, a management landing page, a more EFL-like tree presentation, and inclusion/exclusion controls moved into a person detail tab. The isolated Famailink implementation still does not import legacy EFL runtime components.
- `Follow-up`: Continue tightening the Famailink tree toward the full EFL tree behavior only after validating this isolated implementation against live Famailink data.

## 2026-04-15

- `Area`: Famailink household tree behavior
- `Decision`: Famailink `/tree` should render from direct household/parent/spouse structure rather than derived relationship buckets. The isolated Famailink tree should expose household units, household-to-child connector lines, centered child rows, person focus, search, zoom/reset controls, and relationship navigation chips while continuing to use the existing person detail modal for inclusion/exclusion rules.
- `Reason`: The derived-bucket tree did not match the EFL mental model. Users expect a family tree to show households and children under parents, not rows of relationship categories.
- `Alternatives Considered`: Keep the bucket tree and improve styling only; import the legacy EFL `TreeGraph` component directly; defer household rendering until the full app port.
- `Impact`: `buildTreeLabSnapshot()` now exposes direct people, relationships, and lightweight household rows to the Famailink client. `/tree` builds an isolated household graph from those inputs and keeps existing defaults/exceptions save APIs unchanged.
- `Follow-up`: Validate against live family data and decide whether to add true pan/drag canvas behavior or deeper legacy EFL parity after the household prototype is tested.

## 2026-04-18

- `Area`: Famailink selected-person tree navigation
- `Decision`: Famailink `/tree` should not expose a separate in-law display switch. The selected person and focus navigation should dictate the displayed tree context, while supported one-hop in-law categories remain available to the client graph by default.
- `Reason`: The selected-person-centered tree requires spouse, parent-in-law, and sibling-in-law context to remain available when those people are selected. A separate hide/show switch can remove required graph members and make the tree disagree with the navigation panel.
- `Alternatives Considered`: Keep the In-laws switch as an advanced view filter; replace it with a separate in-law mode; expand in-laws recursively.
- `Impact`: The `/tree` toolbar stays focused on search and navigation controls. `TreeClient` always loads supported relationship buckets into the graph, while relationship derivation remains limited to the approved one-hop in-law categories.
- `Follow-up`: Continue validating spouse, parent-in-law, and sibling-in-law selected views against live data before deciding whether any additional in-law category expansion is needed.

- `Area`: Famailink EFL-style focused tree behavior
- `Decision`: Famailink `/tree` should resemble the EFL tree's focused navigation and motion while remaining independent from EFL family-group routing. The active focused tree should animate the positioned map layer to the selected person, show adjacent spouse household tiles, draw SVG parent-to-child connectors, center children under parents, and stop at the selected person's children/child households rather than rendering grandchildren.
- `Reason`: The prior selected-person tree used static flex rows and grandchild branches, which did not match EFL's navigational feel and created visual gaps below child households. Famailink can match the interaction model by reusing the same client-side layout concepts against its existing graph snapshot.
- `Alternatives Considered`: Keep the static selected-person layout; import the legacy EFL tree component directly; preserve grandchild rows in the focused view.
- `Impact`: The tree pane is now motion/focus oriented. It does not add family-group support to Famailink and does not change relationship derivation, data storage, or preference APIs.
- `Follow-up`: Validate the focused map against live spouse, parent-in-law, sibling-in-law, and child-household cases before deciding whether broader EFL map behaviors such as full pinch zoom parity are needed.

- `Area`: Famailink person-specific subscription and sharing controls
- `Decision`: The real person tree modal should use checkbox-first controls for person-specific exceptions: one default checkbox plus one updates checkbox for subscriptions, and one default checkbox plus Vitals/Stories/Media/Conversations checkboxes for what the signed-in user shares with that person. Broad relationship defaults remain under Administration/Rules Tree.
- `Reason`: Users need to make simple per-person choices without seeing storage terms such as allow/deny exceptions or broad relationship-default selectors. Scope checkboxes match the actual sharing model better than dropdown modes.
- `Alternatives Considered`: Keep dropdown override modes; expose all relationship defaults in the person modal; require the full preferences table for scope-level person exceptions.
- `Impact`: Scoped sharing exception booleans are treated as exact per-scope outcomes for that person: checked scopes are allowed, unchecked scopes are hidden, and no person exception means the relationship default applies.
- `Follow-up`: Carry the same checkbox-first model into the fuller person view when Vitals, Stories, Media, and Conversations tabs are added.
