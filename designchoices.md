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
