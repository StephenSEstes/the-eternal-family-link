# Design Choices (Alias)

This file is a naming-compatible entry point for design rules.

- Canonical source: `docs/design-decisions.md`
- If a change conflicts with current design choices, confirm with Steve before implementation.
- If approved, update `docs/design-decisions.md` (and this file if needed) in the same commit with date and reason.

See: `docs/design-decisions.md`

Latest alignment note:
- 2026-03-04: Identifier policy updated to prohibit data-as-identifier usage; use stable opaque IDs for identity and joins.
- 2026-03-06: Attribute persistence consolidated onto unified `Attributes` table; legacy `PersonAttributes` retained only as migration source.
- 2026-03-06: Legacy OCI `person_attributes` table removed after cutover; runtime now uses unified `Attributes` only.
- 2026-03-06: Attributes schema simplified to canonical event/descriptor fields (`attribute_type`, `attribute_type_category`, `attribute_date`, `date_is_estimated`, `estimated_to`, `attribute_detail`, `attribute_notes`, `end_date`) and legacy columns removed from active runtime shape.
- 2026-03-07: Event category/type definitions for Add Attribute are admin-managed per family group via `FamilyConfig.attribute_event_definitions_json` (with defaults fallback).
- 2026-03-10: OCI is the only supported persistence backend; legacy backend runtime/tooling paths have been removed from the repo.
- 2026-03-10: User onboarding uses person-bound invite records with one invite URL, snapshot family-group access, Google pre-provisioning only when allowed, and local credential setup on the invite page.
- 2026-03-10: AI Help is a server-side OpenAI-backed assistant grounded on a curated local product guide; it answers usage questions only and does not write data or send messages.
