# Change History (Alias)

This file is a quick release-log entry point.

- Canonical release notes: `docs/change-summary.md`
- Keep this file updated in each deploy cycle with a short pointer to the newest entry.

## Latest

- 2026-03-07: Person About tab now defaults Stories add flow to `Story` and Timeline now shows sortable attribute chips (ascending/descending). See `docs/change-summary.md`.
- 2026-03-07: Compacted selected category editor row so Category Label, Sort, and Description display on one line. See `docs/change-summary.md`.
- 2026-03-07: Refined Attribute Types action placement (`Add Category` moved under category search; `Add Type` moved next to `Delete Type Category`). See `docs/change-summary.md`.
- 2026-03-07: Updated Attribute Types admin to type-category master/detail editing (list box + focused editor fields) for selected attribute type. See `docs/change-summary.md`.
- 2026-03-07: Polished Attribute Types admin UX into a two-pane editor and moved Next `themeColor` to `viewport` export to remove unsupported metadata warnings. See `docs/change-summary.md`.
- 2026-03-07: Added Admin-managed Attribute Event Definitions (categories/types/detail labels/date behavior) with Add Attribute modal now reading family-specific config from `FamilyConfig.attribute_event_definitions_json`. See `docs/change-summary.md`.
- 2026-03-07: Suppressed dependency-only `DEP0169` (`url.parse`) runtime warning via server instrumentation filter, without changing app business logic. See `docs/change-summary.md`.
- 2026-03-06: Added family-save safety guard (change-gated relationship updates + no spouse auto-clear) and in-law Family section rule that hides parent selectors with guidance text. See `docs/change-summary.md`.
- 2026-03-06: Fixed Things About chip `[object Object]` labels and restored chip click to open Things About add form. See `docs/change-summary.md`.
- 2026-03-06: Removed About-tab chip click path into nested attribute detail/list modals and restyled Things About chips as non-clickable pills with icon and light background. See `docs/change-summary.md`.
- 2026-03-06: Fixed person birthdate off-by-one display (date-only local parsing) and added inline Contact actions (`Call/Text` on phone row, `Email` on email row). See `docs/change-summary.md`.
- 2026-03-06: Replaced Things About placeholder text with clickable descriptor chips and enabled chip click to open attribute detail with existing media/edit/delete actions. See `docs/change-summary.md`.
- 2026-03-06: Adjusted Add Attribute modal row layout (`Date Related` separate; `Type` + `Type of ...` together) and updated About tab labels/data binding so Things About reflects saved descriptor values. See `docs/change-summary.md`.
- 2026-03-06: Reset Attributes schema/data to canonical event/descriptor fields, added dynamic type-category flow, and executed one-time attribute data wipe + legacy column cleanup. See `docs/change-summary.md`.
- 2026-03-06: Removed `Attributes.media_metadata` usage from runtime attribute flows so media is managed via media tables, with no DB drop needed because the column was already absent. See `docs/change-summary.md`.
- 2026-03-06: Removed legacy OCI `person_attributes` table and remaining runtime references; attributes now run on unified `Attributes` only. See `docs/change-summary.md`.
- 2026-03-06: Consolidated legacy person attributes into unified Attributes table with migration and compatibility updates across import/integrity/API paths. See `docs/change-summary.md`.
- 2026-03-06: Increased fixed person modal height by about 15% to show more content while preserving fixed-frame tab behavior. See `docs/change-summary.md`.
- 2026-03-06: Fixed person modal to a constant panel height with internal tab scrolling so Contact/About/Pictures no longer resize the frame. See `docs/change-summary.md`.
- 2026-03-06: Replaced Person About tab with fixed 4-section scaffold plus full-width "What we don't yet know about you" section and section-level "Add (coming soon)" actions. See `docs/change-summary.md`.
- 2026-03-05: Updated Media Library selected-link labels and ordering so selected chips appear above search inputs across upload/filter/edit flows. See `docs/change-summary.md`.

- 2026-03-05: Redesigned Attributes UX into list + detail drawer + add modal and changed Media Library cards to open edit on thumbnail click. See `docs/change-summary.md`.
- 2026-03-05: Removed legacy inline controls from Person Attributes tab; unified on Manage Attributes flow only. See `docs/change-summary.md`.
- 2026-03-05: Removed duplicate Add Attribute CTA and enabled add-modal Add Photo/Video/Audio save+attach flow in Manage Attributes. See `docs/change-summary.md`.
- 2026-03-05: Refined attribute saved-detail card, fixed object-title rendering, and added Add Media chooser (device/camera/library/audio) in Manage Attributes. See `docs/change-summary.md`.
- 2026-03-05: Polished attributes modal UX (no add-modal X, side-by-side type/category, title-cased options, simplified media sources, steadier tab layout). See `docs/change-summary.md`.
- 2026-03-06: Person Attributes labels now read About [FirstName], and person modal tab switching keeps a stable frame height. See `docs/change-summary.md`.
- 2026-03-06: Contact tab updated with Name section, conditional Maiden Name field, and dedicated full-width Notes section. See `docs/change-summary.md`.
- 2026-03-06: Fixed spouse field initialization in Person Family section by falling back to relationship edges when household rows are missing; also included active Attributes modal regression fixes (chip text safety/delete visibility/tab return). See `docs/change-summary.md`.
- 2026-03-06: Fixed attribute edit/load binding to coerce object-like values into text, preventing `[object Object]` in Describe fields and chips. See `docs/change-summary.md`.
- 2026-03-06: Added object-value primitive fallback for attribute display/edit binding so saved details no longer show blank when payload shape is non-standard. See `docs/change-summary.md`.
- 2026-03-06: Added temporary raw JSON debug output under Attribute Save actions to diagnose payload-to-form mapping issues. See `docs/change-summary.md`.
- 2026-03-06: Fixed OCI CLOB fetching to return strings (not Lob objects), addressing `[object Object]` in attribute payload fields. See `docs/change-summary.md`.
- 2026-03-06: Added person-flow in-law reconciliation and polished person/attributes UI (chip sizing, dynamic add-modal, contact action alignment/shading, Save/Close order) with Admin Debug Mode gating for attribute payload debug output. See `docs/change-summary.md`.
- 2026-03-07: Added spouse tiles to Household Info and a family-group switcher row in Person modal header for direct context switching. See `docs/change-summary.md`.
- 2026-03-07: Person modal family-group switch now updates in place without closing the panel. See `docs/change-summary.md`.
- 2026-03-07: Fixed OCI relationship bind mismatch causing family-switch errors and added household header fallback to spouse headshots when wedding photo is missing. See `docs/change-summary.md`.
- 2026-03-07: Fixed person family-switch trim crash and added household->person return flow with clickable child avatar rows. See `docs/change-summary.md`.
