# Project TODO

This file tracks development tasks for this project.
I will update this list as we add, complete, or remove work.

## Active
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
