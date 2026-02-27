# Project TODO

This file tracks development tasks for this project.
I will update this list as we add, complete, or remove work.

## Active
- [ ] Define current top 3 development priorities
- [ ] List known bugs and reliability issues
- [ ] List highest-impact next features
- [ ] Multi-photo uploads in photo flow
  Est date: 2026-03-03
  Desc: Allow selecting and uploading multiple photos in one action, with per-file progress, validation, and error handling.
- [ ] Workflow for adding new attributes
  Est date: 2026-03-05
  Desc: Design a guided admin workflow to add additional attributes quickly, including field type, validation rules, defaults, and visibility options.
- [ ] AI summary of person profile
  Est date: 2026-03-10
  Desc: Generate an AI-written summary for each person using profile fields, relationships, notes, and key dates with admin review before publish.
- [ ] AI game generation with point system
  Est date: 2026-03-14
  Desc: Generate replayable AI-driven family games and score rules, including points, streaks, and leaderboard tracking.
- [ ] Improve multi-family group switching for shared users
  Est date: 2026-03-17
  Desc: Make switching between family groups seamless for users who belong to multiple groups, with clear active-group context and quick switching controls.
- [ ] Import related contacts when creating/migrating a family group
  Est date: 2026-03-21
  Desc: Add relationship-aware import rules so selected members bring related contacts into the target group automatically; 3rd gen child import includes parents, and 2nd gen import includes spouse plus in-law children.
- [ ] Review Viewer tile visibility on family home
  Est date: 2026-03-02
  Desc: Decide whether to remove the Viewer tile from `/t/[tenantKey]` home or gate it by role/setting so the landing screen stays focused.
- [ ] Gender-based fallback headshots for missing profile photos
  Est date: 2026-03-07
  Desc: Use `/public/placeholders/avatar-male.png` and `/public/placeholders/avatar-female.png` when no profile photo exists, and add profile gender tracking so fallback selection is automatic.

## Backlog
- [ ] Add test coverage goals by area
- [ ] Add performance and monitoring tasks
- [ ] Add deployment and ops hardening tasks

## Completed
- [x] Create project TODO tracker (`TODO.md`)
- [x] Simplify admin screen with sub-tabs under each main admin tab
