# Project TODO

This file tracks development tasks for this project.
I will update this list as we add, complete, or remove work.

## Active
- [ ] Eliminate data-as-identifier usage across app and schema
  Priority: High
  Est date: 2026-03-08
  Desc: Audit and replace all mutable/data-derived identifiers (email/name/date/composites) with stable opaque IDs, including access/auth joins and migration compatibility steps.
- [ ] Multi-photo uploads in photo flow
  Priority: Med
  Est date: 2026-03-03
  Desc: Allow selecting and uploading multiple photos in one action, with per-file progress, validation, and error handling.
- [ ] Workflow for adding new attributes
  Priority: High
  Est date: 2026-03-05
  Desc: Design a guided admin workflow to add additional attributes quickly, including field type, validation rules, defaults, and visibility options.
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
- [ ] Develop Household as an entity with attributes and pictures
  Priority: High
  Est date: 2026-03-28
  Desc: Add first-class household entity support including profile attributes, photo storage, and household media management UI.
- [ ] Develop Family attributes
  Priority: High
  Est date: 2026-03-29
  Desc: Define and implement family-group-level attributes and editing workflow.
- [ ] Add primary contact attributes (phone, email, address)
  Priority: Med
  Est date: 2026-03-30
  Desc: Implement primary attribute flags and UI behavior for phone, email, and address so one value can be designated as primary per type.
- [ ] Develop delete person workflow
  Priority: High
  Est date: 2026-04-02
  Desc: Implement safe delete flow for a person with dependency checks, confirmations, and relationship cleanup rules.
- [ ] Develop user invitation flow with launch icon support
  Priority: Med
  Est date: 2026-04-05
  Desc: Add invitation workflow (email-based) and support install/launch icon guidance for invited users.
- [ ] Evaluate value/necessity of Viewer PIN function
  Priority: Med
  Est date: 2026-04-06
  Desc: Review whether Viewer PIN unlock is needed for this product phase, including UX complexity, security value, and whether to keep, simplify, or remove.

## Backlog
- [ ] Define current top 3 development priorities
- [ ] List known bugs and reliability issues
- [ ] List highest-impact next features
- [ ] Add test coverage goals by area
- [ ] Add performance and monitoring tasks
- [ ] Add deployment and ops hardening tasks

## Completed
- [x] Create project TODO tracker (`TODO.md`)
- [x] OCI migration readiness + first load milestone (OCI preflight, schema bootstrap, Sheets->OCI migration tooling, initial data load verification)
- [x] Simplify admin screen with sub-tabs under each main admin tab
- [x] Review Viewer tile visibility on family home
- [x] Gender-based fallback headshots for missing profile photos
- [x] Improve multi-family group switching for shared users
- [x] Document data structure (tables, columns, joins, indexes, media links, entity IDs)
- [x] Develop Add Family screen
- [x] Crash diagnosis runbook + requestId/errorCode instrumentation for core APIs
- [x] Develop delete family workflow
- [x] Develop delete household workflow (Untested)
