# Project TODO

This file tracks development tasks for this project.
I will update this list as we add, complete, or remove work.

## Active
- [ ] Face recognition architecture and phased implementation for media upload
  Priority: High
  Est date: 2026-04-20
  Desc: Add reviewed face-recognition suggestions in media flows so uploads can propose likely people matches across accessible family groups, with strict permission filtering and no silent auto-assignment.
  Scope:
  - Detect faces from uploaded images and create per-face records.
  - Generate embeddings and query nearest candidates from a face index.
  - Return ranked match suggestions with confidence for user review.
  - Allow confirm/reject actions to improve matching quality over time.
  - Enforce access controls so suggestions only include people the current user can access.
  - Add biometric/privacy controls (retention, delete cascade, audit).
  Architecture:
  - Services
    - `FaceDetector`: extracts face bounding boxes from image bytes.
    - `FaceEmbedder`: generates embedding vectors for each detected face crop.
    - `FaceMatchEngine`: similarity search + score normalization + thresholding.
    - `FaceReviewService`: confirm/reject lifecycle and profile update logic.
  - Processing model
    - Upload is write-fast and enqueues async face processing job.
    - Worker pipeline: load image -> detect faces -> embed -> match -> persist suggestions.
    - Existing media backfill runs as resumable batch jobs.
  - Suggested data model
    - `face_instances`
      - `face_id` (PK), `media_id`, `family_group_key`, `bbox_x`, `bbox_y`, `bbox_w`, `bbox_h`,
      - `embedding_vector` (or `embedding_ref`), `quality_score`, `created_at`, `updated_at`.
    - `face_matches`
      - `match_id` (PK), `face_id`, `candidate_person_id`, `confidence_score`,
      - `match_status` (`suggested|confirmed|rejected`), `reviewed_by`, `reviewed_at`, `created_at`.
    - `person_face_profiles`
      - `profile_id` (PK), `person_id`, `embedding_centroid` (or references), `sample_count`, `updated_at`.
    - `face_review_audit`
      - `audit_id` (PK), `face_id`, `person_id`, `action`, `actor_user_id/email`, `family_group_key`, `created_at`.
  - Access model
    - Candidate search scope is all people in family groups user can access.
    - Response filter enforces user access before returning candidates.
    - No cross-tenant leakage; hard partition by tenant/family-group access rules.
  - UX model
    - Upload card shows `Face analysis in progress`.
    - Suggestions panel per photo: face chips + top candidates + confidence bands.
    - Actions: `Confirm`, `Reject`, `Not sure`, `Create person`.
    - Never auto-link without explicit confirmation.
  Phase 1 (MVP suggest-only):
  - Add schema tables + migration.
  - Add worker scaffold + queue trigger from upload routes.
  - Persist face instances and raw candidate suggestions.
  - Add read-only suggestion UI.
  Validation:
  - Uploading an image with faces produces `face_instances` and `face_matches`.
  - Only accessible people appear in suggestions.
  Phase 2 (review + learning loop):
  - Add confirm/reject APIs and UI actions.
  - Persist review actions + audit rows.
  - Update `person_face_profiles` from confirmed samples.
  Validation:
  - Confirmed suggestions create durable person links and improve future ranking.
  - Rejected suggestions are suppressed for the same face/profile pair.
  Phase 3 (backfill + quality controls):
  - Backfill existing media in batches with resumable checkpoints.
  - Add confidence thresholds and false-positive guardrails.
  - Add admin settings for enable/disable and confidence tuning.
  Validation:
  - Backfill completes without blocking normal uploads.
  - Precision/recall metrics are captured for tuning.
  Phase 4 (privacy + lifecycle hardening):
  - Add delete cascade for person/media removal.
  - Add retention rules and optional reprocessing controls.
  - Document biometric handling in help/admin policy surfaces.
  Validation:
  - Deleting person/media removes or invalidates associated face artifacts.
  - Audit shows who confirmed/rejected each suggestion.
- [ ] Photo intelligence pipeline: people tagging + AI description + date inference
  Priority: High
  Est date: 2026-04-24
  Desc: Enrich uploaded photos with reviewed people tags, AI-generated human-friendly descriptions (for example "Fun with cousins at the beach"), and best-available photo date (explicit or estimated), then persist all outputs in existing media entities and audit trails.
  Scope:
  - Add caption generation for photos after upload.
  - Add date extraction/inference with confidence and estimated flag behavior.
  - Integrate face-tag suggestions with person-link confirmation UI.
  - Persist outputs in existing app storage shape (`MediaAssets`, `MediaLinks`, media detail fields) without schema drift from current model.
  Data mapping (current app model):
  - `MediaLinks.label`: short title/caption (editable, user-facing).
  - `MediaLinks.description`: richer AI photo description (editable).
  - `MediaLinks.photo_date`: resolved date (explicit or inferred).
  - `MediaLinks.media_metadata`: inference details (caption confidence, date source, date confidence, OCR clues, face candidate metadata).
  - `MediaAssets.media_metadata`: technical extraction payload (model/version, EXIF read result, processing hashes/checkpoints).
  - `Audit`: log AI suggestion generation and user confirm/reject/edit actions.
  Date resolution policy:
  - Priority order:
    1. User-entered date (always wins)
    2. EXIF capture timestamp (when valid)
    3. OCR/date text found in image
    4. Contextual inference (linked people/events/location hints)
  - Store inferred dates with:
    - `photo_date` set to inferred value
    - metadata flags: `dateIsEstimated=true`, `estimatedTo=year|month` as applicable
    - `dateInferenceSource` and `dateConfidence`
  Caption policy:
  - Generate short, human-friendly caption for `label` (about 3-10 words).
  - Generate optional fuller sentence/phrase for `description`.
  - Never overwrite user-edited caption/description without explicit user action.
  UX behavior:
  - Upload response state: `Processing photo intelligence...`.
  - Suggestions panel:
    - Suggested people tags with confidence
    - Suggested caption + description
    - Suggested date with source and confidence
  - User actions:
    - Confirm/reject each person suggestion
    - Accept/edit caption
    - Accept/edit/clear date suggestion
    - Save all
  Phase 1:
  - 2026-03-21 progress: Added deterministic image suggestion generation endpoint (`/photos/[fileId]/intelligence`), persisted `photoIntelligence` metadata, and media-editor apply controls (`Use Title/Description/Date`).
  - 2026-03-21 progress: Switched generation to OCI Vision-first analysis (labels/objects/faces) with deterministic fallback when Vision is unavailable.
  - Remaining for full Phase 1: add EXIF parser-backed date extraction and optional OpenAI caption refinement using Vision outputs.
  - Implement caption + EXIF date extraction and persist suggestions.
  - Render suggestions in media detail panel with accept/edit controls.
  Validation:
  - New uploads show suggested caption/date.
  - Accepted values save to `MediaLinks` and display in media search/detail.
  Phase 2:
  - Integrate face candidate suggestions from face pipeline and confirmation actions.
  - Persist confirmed people tags as canonical media links.
  Validation:
  - Confirmed people appear immediately in linked entities.
  - Rejected candidates are recorded and suppressed.
  Phase 3:
  - Add OCR/context date inference fallback and confidence display.
  - Add admin controls for enabling/disabling auto-suggestion categories.
  Validation:
  - Date source is visible and auditable.
  - Low-confidence suggestions are clearly marked and not auto-accepted.
- [ ] AI story extraction redesign as expert personal history documentarian
  Priority: High
  Est date: 2026-03-22
  Desc: Replace the current single-primary-story-oriented importer with an expert documentarian workflow that can identify one vignette vs multiple vignettes, produce story attributes plus high-signal supporting attributes, and iteratively refine proposals through user/AI interaction before save.
  Scope:
  - Remove extraction-mode controls and mode-based prompt branches.
  - Make proposal adjustment loop driven by ongoing AI interaction and user feedback.
  - Ensure prompt output supports both single-story and multi-vignette decomposition.
  - Keep user-reviewed save flow (`add/replace/skip`) as final authority.
  Phase 1 (completed/in progress in this cycle):
  - Remove extraction mode from UI and request payload.
  - Route all rebuild guidance through Ask AI interaction context.
  - Keep story workspace 2-step flow and in-panel review.
  Phase 2:
  - Upgrade story-import prompt to explicitly classify `single_story` vs `multi_vignette`.
  - Require one story attribute per vignette and optional supporting facts (moves, descriptors, key relationships, milestones).
  - Add evidence grounding per proposal (`sourceExcerpt` + rationale quality threshold).
  - Relax single-primary-story enforcement in post-processing while guaranteeing at least one story proposal.
  Phase 3:
  - Add duplicate-awareness input context from existing person attributes into prompt payload.
  - Surface potential duplicates and decisions (`add/replace/skip`) per proposal in the workspace.
  - Add iterative refinement cycle controls: ask AI, regenerate drafts, preserve chat context across cycles.
  Validation:
  - `npx tsc --noEmit` passes.
  - Story containing one coherent narrative returns one story + optional supporting attributes.
  - Story containing multiple distinct vignettes returns multiple story attributes.
  - Repeated Ask AI + rebuild cycles materially update proposals without extraction modes.
  Completion criteria:
  - User can iterate with AI until satisfied, then finalize proposals in step 2 without leaving the workspace.
  - No forced single-story behavior remains in instructions or post-processing.
- [ ] Migrate existing media assets to OCI Object Storage with generated thumbnails
  Priority: High
  Est date: 2026-03-23
  Desc: Backfill all existing media files to OCI Object Storage by uploading full originals and generating thumbnail variants for images during migration, then persist OCI object pointers/metadata on media assets without breaking existing file associations.
  Scope:
  - Add migration tooling with dry-run + apply modes.
  - Read legacy media bytes from current storage and upload originals to OCI bucket.
  - Generate/store thumbnail objects for image media in OCI.
  - Update `MediaAssets` metadata to include OCI original/thumbnail object keys and mark provider state for migrated assets.
  - Keep migration idempotent and resumable across reruns.
  Phase 1:
  - Build script scaffolding and safety flags (`--apply`, `--limit`, optional tenant filtering).
  - Add environment and auth validation for DB, Drive source access, and OCI bucket access.
  Phase 2:
  - Implement per-asset migration pipeline (read source, upload original, create/upload thumbnail, update metadata).
  - Add robust per-item error capture and continue behavior.
  - Add summary reporting (processed, migrated, skipped, failed, thumbnails created).
  Phase 3:
  - Verify parity counts and sample retrieval after migration.
  - Add follow-up task for runtime cutover to serve OCI object storage content directly.
  Validation:
  - Dry-run reports candidate count and planned actions without DB writes.
  - Apply run uploads originals + thumbnails and updates metadata pointers.
  - Rerun does not duplicate work for already migrated assets.
  Completion criteria:
  - Existing media library items have OCI object metadata for original and thumbnail where applicable.
  - Migration can be resumed safely after interruption.
- [ ] Replace in-law flag with family-group relationship types
  Priority: High
  Est date: 2026-03-07
  Desc: Use `PersonFamilyGroups.family_group_relationship_type` (`founder`, `direct`, `in_law`, `undeclared`) as the canonical family-group classification. Relationship save and integrity repair should reconcile direct/in-law/undeclared from founders plus parent/spouse structure, keep `founder` admin-managed with max two per family group, hide `undeclared` from the main tree, and keep legacy `Attributes.in_law` rows deleted.
- [ ] AI summary of person profile
  Priority: Med
  Est date: 2026-03-10
  Desc: Generate an AI-written summary for each person using profile fields, relationships, notes, and key dates with admin review before publish.
- [ ] AI game generation with point system
  Priority: Med
  Est date: 2026-03-14
  Desc: Generate replayable AI-driven family games and score rules, including points, streaks, and leaderboard tracking.
- [ ] Import related contacts when creating/migrating a family group
  Priority: Med
  Est date: 2026-03-21
  Desc: Add relationship-aware import rules so selected members bring related contacts into the target group automatically; 3rd gen child import includes parents, and 2nd gen import includes spouse plus in-law children.
- [ ] Develop Add Contact screen
  Priority: Med
  Est date: 2026-03-24
  Desc: Build a dedicated Add Contact flow with required fields, validation, and family-group association.
- [ ] Develop Contact attributes
  Priority: Med
  Est date: 2026-03-26
  Desc: Define and implement contact-level attributes and editing workflow.
- [ ] Develop Household attributes
  Priority: Med
  Est date: 2026-03-27
  Desc: Define and implement household-level attributes and editing workflow.
- [ ] Add primary contact attributes (phone, email, address)
  Priority: Med
  Est date: 2026-03-30
  Desc: Implement primary attribute flags and UI behavior for phone, email, and address so one value can be designated as primary per type.
- [ ] Evaluate value/necessity of Viewer PIN function
  Priority: Med
  Est date: 2026-04-06
  Desc: Review whether Viewer PIN unlock is needed for this product phase, including UX complexity, security value, and whether to keep, simplify, or remove.
- [ ] Add Android share-to-app media import flow
  Priority: Med
  Est date: 2026-04-08
  Desc: Add Android PWA share-target support so images/videos shared from phone apps can open the app and route into the shared media attach flow. Keep iPhone on the in-app camera/upload path because iOS web apps do not support share-target onboarding the same way.
- [ ] Optimize media search and library performance
  Priority: Med
  Est date: 2026-04-10
  Desc: Rebuild media search/library loading to stop full-table scans and large in-memory joins across media-related tables. Query canonical media rows directly, preserve current person/household/attribute link behavior, and keep Drive listing optional and bounded.
- [ ] Develop story/memory workflow with attached media
  Priority: Med
  Est date: 2026-04-12
  Desc: Make story/event attributes first-class for people and households, including attaching photos, video, and audio to a story/memory without turning media assets into standalone attribute-owning entities.
- [ ] Expand AI Help guide coverage and permission accuracy
  Priority: Med
  Est date: 2026-04-14
  Desc: Broaden `src/lib/ai/help-guide.ts` with more screen-specific workflows, role-aware permission details, and sharper guidance for edge cases so Help answers match the current app behavior more exactly.

## Backlog
- [ ] Define current top 3 development priorities
- [ ] List known bugs and reliability issues
- [ ] List highest-impact next features
- [ ] Add test coverage goals by area
- [ ] Add performance and monitoring tasks
- [ ] Add deployment and ops hardening tasks

## Completed
- [x] Eliminate data-as-identifier usage across app and schema
- [x] Remove tenant/tenancy terminology from codebase (phased migration)
- [x] Workflow for adding new attributes
- [x] Develop Household as an entity with attributes and pictures
- [x] Develop Family attributes
- [x] Develop delete person workflow
- [x] Create project TODO tracker (`TODO.md`)
- [x] OCI migration readiness + first load milestone (OCI preflight, schema bootstrap, initial data load verification)
- [x] Simplify admin screen with sub-tabs under each main admin tab
- [x] Review Viewer tile visibility on family home
- [x] Gender-based fallback headshots for missing profile photos
- [x] Improve multi-family group switching for shared users
- [x] Document data structure (tables, columns, joins, indexes, media links, entity IDs)
- [x] Develop Add Family screen
- [x] Crash diagnosis runbook + requestId/errorCode instrumentation for core APIs
- [x] Develop delete family workflow
- [x] Develop delete household workflow (Untested)
- [x] Multi-photo uploads in photo flow
- [x] Develop user invitation flow with launch icon support
