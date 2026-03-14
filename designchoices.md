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
- 2026-03-10: `Attributes.attribute_kind` is now stored canonically (`descriptor` | `event`), and family-group attribute definitions manage both descriptor and event types from one definition document.
- 2026-03-07: Event category/type definitions for Add Attribute are admin-managed per family group via `FamilyConfig.attribute_event_definitions_json` (with defaults fallback).
- 2026-03-10: OCI is the only supported persistence backend; legacy backend runtime/tooling paths have been removed from the repo.
- 2026-03-10: User onboarding uses person-bound invite records with one invite URL, snapshot family-group access, Google pre-provisioning when allowed, and generated local username/temporary-password credentials at invite creation when local sign-in is allowed.
- 2026-03-10: AI Help remains a grounded server-side usage assistant, while AI story import is a separate reviewed workflow that proposes canonical person attributes from story text and requires user approval in the existing attribute modal before each save.
- 2026-03-10: Household gallery media uses only `MediaAssets` + `MediaLinks`; `Households.wedding_photo_file_id` remains the direct household avatar pointer.
- 2026-03-10: Any signed-in family-group user can edit shared family data (people, households, relationships, attributes, media); admin remains limited to invites, access/security/audit/integrity, and family-group administration.
- 2026-03-10: `PersonFamilyGroups.family_group_relationship_type` is the canonical family-group classification field with `founder`, `direct`, `in_law`, and `undeclared`; `founder` is admin-managed and other values are system-reconciled from membership + relationship state.
- 2026-03-12: `Households` now represent one-parent or two-parent family units in the existing `husband_person_id` / `wife_person_id` model; divorce converts or creates a valid one-parent household instead of deleting the direct member household.
- 2026-03-13: Death is modeled as a canonical `Attributes` event (`death`), not a top-level person flag/column; memorial UI derives `From / To` dates and `In Mem` presentation from that event.
