# Change Summary

Concise release notes for what changed, why it changed, and what to verify.

## Entry Template

- `Date`:
- `Change`:
- `Type`: UI | API | Data | Schema | Infra
- `Why`:
- `Files`:
- `Data Changes`:
- `Verify`:
- `Rollback Notes`:

## 2026-03-27 (fix partial person-link failures from the media modal)

- `Date`: 2026-03-27
- `Change`: Fixed media-modal person linking so `MediaAssets` upserts no longer fail with Oracle `ORA-00932` on null numeric binds, and the person attribute POST route now cleans up a newly created attribute if the follow-up media sync fails. Repaired the broken `Brent Testing5` media row by creating the missing person and attribute `media_links`.
- `Type`: API | Data
- `Why`: Root cause was a `mixed code/data issue`. For existing media like `media-bedfb9c3`, the person-link route created the person attribute first and then called `syncPersonMediaAssociations(...)`. The asset upsert inside that sync used untyped null numeric binds, which reproduced an `ORA-00932` failure before any `media_links` were written. That left a partial attribute row behind, and the modal later showed the person chip from the attribute fallback even though the link request had failed.
- `Files`:
  - `src/lib/oci/tables.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/route.ts`
- `Data Changes`: Inserted the missing `attribute` and `person` `media_links` rows for `media_id = media-bedfb9c3`, `file_id = 1cZC4cg467s6XWRaZ8piKWtwAYVTpnfDi`, `attribute_id = attr-e48f29be`, and `person_id = p-c0efc168`.
- `Verify`:
  - Linking an existing image to a person from the media modal returns success instead of `Failed to link person`.
  - The modal shows the new person chip immediately after a successful link without requiring `Save` + reopen.
  - Brent’s file now has `household`, `attribute`, and `person` `media_links`.
  - A rollback-only dry run of the `media_assets` upsert for `media-bedfb9c3` succeeds without `ORA-00932`.
- `Rollback Notes`: Revert the route cleanup and typed numeric binds if they cause unintended write behavior, and delete the repaired Brent `media_links` rows if you need to restore the pre-fix partial state.
- `Design Decision Change`: No design decision change.

## 2026-03-27 (multi-tenant session guard refresh)

- `Date`: 2026-03-27
- `Change`: Added a feature-flagged multi-tenant guard refresh so API requests can authorize against all accessible family groups without re-auth when switching tenants. The guard now optionally refreshes tenant accesses on 401/403 scenarios and supports an env flag `ENABLE_MULTI_TENANT_SESSION`.
- `Type`: API
- `Why`: Root cause was a `session/tenant mismatch`. Users switching family groups could hit 401/403 because the session carried a primary tenant while `active_tenant` pointed to another; the guard did not re-evaluate access for the requested tenant.
- `Files`:
  - `src/lib/tenant/guard.ts`
  - `src/lib/tenant/context.ts`
  - `src/lib/env.ts`
- `Data Changes`: None.
- `Verify`:
  - With `ENABLE_MULTI_TENANT_SESSION=true`, a user with multiple family memberships can access `/api/t/{tenant}/...` for each membership without re-auth.
  - Access to a tenant the user is not a member of still returns 403.
- `Rollback Notes`: Set `ENABLE_MULTI_TENANT_SESSION` unset/false to revert to the prior single-tenant guard behavior.
- `Design Decision Change`: No design decision change.

## 2026-03-26 (add empty AI tab to media modal)

- `Date`: 2026-03-26
- `Change`: Added a third `AI` tab to the media modal tab strip and left its body intentionally empty for now.
- `Type`: UI
- `Why`: Root cause was a `UI structure gap`. The modal tab model only supported `Details` and `Metadata`, so there was no reserved place to introduce an `AI` surface later without changing the tab structure again.
- `Files`:
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - The media modal shows `Details`, `Metadata`, and `AI` tabs.
  - Clicking `AI` switches the active tab without rendering any additional content yet.
  - `Details` and `Metadata` continue to render normally.
- `Rollback Notes`: Revert if the modal should not expose an empty placeholder tab.
- `Design Decision Change`: No design decision change.

## 2026-03-26 (extend metadata tab with asset identifiers)

- `Date`: 2026-03-26
- `Change`: Added `Media ID`, `Source Provider`, and `Thumbnail Key` to the media modal Metadata tab by extending the detail API payload with those asset-level fields.
- `Type`: UI
- `Why`: Root cause was a `code wiring issue`. The Metadata tab could only display fields that the media detail route returned, and the route was not exposing these asset identifiers even though they exist on the `MediaAssets` lookup.
- `Files`:
  - `src/lib/oci/tables.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/route.ts`
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - Opening the media modal `Metadata` tab shows `Media ID`, `Source Provider`, and `Thumbnail Key` as read-only fields when present.
  - Existing metadata tab fields still render normally.
  - The modal still opens and the metadata detail API returns successfully.
- `Rollback Notes`: Revert if these asset identifiers should remain hidden from the modal.
- `Design Decision Change`: No design decision change.

## 2026-03-26 (switch media paging to full rows and split modal metadata)

- `Date`: 2026-03-26
- `Change`: Replaced the fixed 12-item media page size with a measured three-row page size based on the current grid columns, moved the media date field onto the same row as the name field in the modal, and split the modal into `Details` and `Metadata` tabs while keeping `Linked To` on the first tab.
- `Type`: UI
- `Why`: Root cause was a `UI code issue`. The media library was still paging by a hard-coded 12 even though the grid is responsive, so pages could not represent three full rows consistently, and the modal was forcing editable fields and stored metadata into one uninterrupted layout.
- `Files`:
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - Media paging now advances by three full visible rows instead of a fixed 12 items.
  - The modal `Name` and `Date` fields render on the same row when there is enough width.
  - The modal shows `Details` and `Metadata` tabs.
  - `Linked To` remains on the `Details` tab.
  - The `Metadata` tab shows read-only labeled stored metadata values.
- `Rollback Notes`: Revert if the media grid should return to fixed-size paging and single-pane modal metadata display.
- `Design Decision Change`: No design decision change.

## 2026-03-26 (unify media search and linked-filter entry)

- `Date`: 2026-03-26
- `Change`: Replaced the separate media-text search bar and linked-filter search bar on the media page with one omnibox that can either commit a media text query or add person/household filter chips from the same input.
- `Type`: UI
- `Why`: Root cause was a `UI consistency and interaction issue`. The media tab exposed two different search boxes that looked redundant but actually drove different query paths, which made combining a text term like `wedding` with a linked person like `Dale Estes` harder to understand than it should be.
- `Files`:
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - Typing a term and pressing `Enter` adds a removable text-search chip and refreshes the media results.
  - Typing a person or household name shows suggestion rows under the same input and selecting one adds the corresponding filter chip.
  - Combined filtering works for a text query plus one or more linked people/households.
  - `Include unlinked Drive files` remains beside the unified search control.
- `Rollback Notes`: Revert if separate dedicated search inputs are preferred over the combined omnibox model.
- `Design Decision Change`: No design decision change.

## 2026-03-26 (align media page with people-tab layout)

- `Date`: 2026-03-26
- `Change`: Restyled the top of the media page to follow the People tab pattern with an unboxed `Media Library` hero, a black `Add Media` button with a plus icon, unboxed filter/search controls, and added icons to the `People` and `Households` buttons on the People page.
- `Type`: UI
- `Why`: Root cause was a `UI consistency issue`. The top-level tabs were using different header and control treatments, which made the media page feel like a separate design system instead of following the established People-page pattern.
- `Files`:
  - `src/components/MediaLibraryClient.tsx`
  - `src/components/PeopleDirectory.tsx`
- `Data Changes`: None.
- `Verify`:
  - Build not run in this pass.
  - The media page header is no longer wrapped in a card.
  - `Add Media` uses the same compact black plus-button treatment as `Add Person`.
  - The media filter/search rows are unboxed and visually aligned with the People page.
  - The `People` and `Households` buttons on the People page show left-side icons.
- `Rollback Notes`: Revert if the media page should keep its separate card-style header treatment.
- `Design Decision Change`: No design decision change.

## 2026-03-26 (restructure media header and search controls)

- `Date`: 2026-03-26
- `Change`: Moved `Add Media` back into the top `Media Library` header row, added left-side icons to the media-type filters, changed the filter/search stack so the search row sits below the buttons with a magnifying-glass input and right-aligned range/paging block, and kept the people/household filter controls below that row.
- `Type`: UI
- `Why`: Root cause was a `UI layout issue`. The control hierarchy still did not match the intended visual order, `Add Media` was competing with the linked-filter controls, the filter buttons had no visual icon anchor, and the search/status/paging information was not grouped the way you specified.
- `Files`:
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - Build not run in this pass.
  - `Add Media` sits on the top header row at the far right.
  - Media-type filters render with left-side icons.
  - The search row sits directly below the filter buttons with a search icon in the input.
  - `Showing x-y of z` is right-aligned with narrow side-by-side paging buttons.
  - People/household linked filters remain below the search row.
- `Rollback Notes`: Revert only if the previous header/control placement is preferred.
- `Design Decision Change`: No design decision change.

## 2026-03-26 (compact media filter row and linked-filter controls)

- `Date`: 2026-03-26
- `Change`: Tightened the five media-type filter buttons to fit in one row, changed `Last 12` to `Prev 12`, hid paging buttons unless they can actually page, and moved `Add Media` into the linked-filter controls as a smaller button.
- `Type`: UI
- `Why`: Root cause was a `UI layout issue`. The filter row still consumed too much width, the paging controls were visible even when inactive, and the top-card `Add Media` action was taking space away from the more relevant linked-filter controls.
- `Files`:
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - Build not run in this pass per user instruction.
  - `All`, `Images`, `Videos`, `Audio`, and `Documents` fit on one row within the media card.
  - `Prev 12` only appears when there is a previous page.
  - `Next 12` only appears when there is another page.
  - `Add Media` appears as a compact button on the linked-filter row.
- `Rollback Notes`: Revert only if the wider filter buttons, always-visible paging controls, and top-card `Add Media` placement are preferred.
- `Design Decision Change`: No design decision change.

## 2026-03-26 (shrink media type filter buttons to fit the row)

- `Date`: 2026-03-26
- `Change`: Tightened the media-type filter row so the buttons share the available width and fit within the screen instead of sizing only to their content.
- `Type`: UI
- `Why`: Root cause was a `UI layout issue`. The filter buttons were set to fixed content width, which could overflow the available row width on smaller screens even after the controls were moved into a single top row.
- `Files`:
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - The four media-type buttons fit in one row within the card width.
  - The buttons remain readable and clickable on smaller screens.
- `Rollback Notes`: Revert only if content-width filter buttons are preferred over fixed shared-width buttons.
- `Design Decision Change`: No design decision change.

## 2026-03-26 (reflow media library controls)

- `Date`: 2026-03-26
- `Change`: Reflowed the media library controls so the media-type filter buttons render in a single top row above the `Library` search row, and the `Last 12` / `Next 12` buttons sit next to the visible-range label.
- `Type`: UI
- `Why`: Root cause was a `UI layout issue`. The filter buttons and paging controls were split across separate rows, which made the control hierarchy harder to scan and separated the paging actions from the visible-range status they affect.
- `Files`:
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - Media-type filters render in one row above the search row.
  - `Last 12` and `Next 12` render next to `Showing x-y of z`.
- `Rollback Notes`: Revert only if the older split-row control layout is preferred.
- `Design Decision Change`: No design decision change.

## 2026-03-26 (reset media library paging after media-tab attach save)

- `Date`: 2026-03-26
- `Change`: Reset the media library back to the first 12-item page after a successful media-tab attach save, then reload the library with cache bypass.
- `Type`: UI
- `Why`: Root cause was a `code issue`. The media tab already reloaded after the attach wizard completed, but it preserved the current `pageOffset`. Because the library sorts newest-first and only slices the visible page after sorting, uploads made while viewing page 2 or later landed correctly at the top of page 1 while the UI stayed on the old later slice, making the new uploads look missing.
- `Files`:
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - Upload and save from the media tab while viewing page 2 or later returns the library to page 1.
  - The newly uploaded items are visible immediately after save without manually paging back.
- `Rollback Notes`: Revert only if the media tab should intentionally preserve the current later page even when new uploads are inserted at the top of the sorted library.
- `Design Decision Change`: No design decision change.

## 2026-03-26 (prevent ghost media references when person upload fails mid-route)

- `Date`: 2026-03-26
- `Change`: Hardened the person media upload route so it no longer leaves a new attribute pointing at a generated `mfile-...` when media asset/link sync fails after the attribute row is created. The route now cleans up the just-created attribute and any partial links before surfacing the upload failure.
- `Type`: API
- `Why`: Root cause was a `mixed issue`. The route created the person attribute before writing `MediaAssets` and `MediaLinks`, so a mid-route failure could leave a ghost file reference visible in the media library with no asset row, no link row, no thumbnail data, and blank recency. That exact failure happened for `mfile-aeced75a55a6d530` (`test2`), where OCI objects existed but the DB writes did not complete.
- `Files`:
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
- `Data Changes`: Live OCI repair recreated the missing `MediaAssets` and `MediaLinks` rows for `mfile-aeced75a55a6d530` from the existing attribute row and OCI original/thumbnail objects.
- `Verify`:
  - `npm run build` passes.
  - A failed person-media upload no longer leaves a ghost `attribute_detail = mfile-...` reference with no `MediaAssets` row.
  - Repaired file `mfile-aeced75a55a6d530` now has populated asset/link rows, valid thumbnail object key, and ranks first by recency in the `snowestes` linked image set.
- `Rollback Notes`: Revert commit only if you intentionally want failed person-media uploads to leave orphaned attribute references behind.
- `Design Decision Change`: No design decision change.

## 2026-03-25 (harden auth-gated photo preview delivery against stale cache state)

- `Date`: 2026-03-25
- `Change`: Hardened the viewer photo routes and OCI object-key resolver so media previews no longer rely on public cache headers or sticky null object-key cache entries. Auth-gated photo responses now return private non-stored responses, and the resolver no longer caches null object-key lookups after a missing-row state.
- `Type`: API
- `Why`: Root cause was a `code issue`. The thumbnail routes were auth/cookie-gated but still returned `Cache-Control: public, max-age=3600`, which is not safe for protected media delivery and could preserve stale bad preview responses. Separately, the OCI resolver cached null object-key lookups for five minutes, which let repaired media rows stay invisible on a server instance even after the data was fixed. Removing those two sticky-cache behaviors addresses the actual preview-delivery fault path instead of masking it in the UI.
- `Files`:
  - `src/app/t/[tenantKey]/viewer/photo/[fileId]/route.ts`
  - `src/app/viewer/photo/[fileId]/route.ts`
  - `src/lib/google/photo-resolver.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - Auth-gated viewer/photo responses no longer advertise `public` caching.
  - Repaired media rows are visible to the OCI resolver on the next request instead of after a five-minute null-cache TTL.
- `Rollback Notes`: Restore cacheable viewer/photo responses and null object-key caching only if you intentionally want auth-dependent photo bytes to be cache-sticky again.
- `Design Decision Change`: No design decision change.

## 2026-03-25 (replace implicit top-10 media library behavior with explicit filters and 12-item paging)

- `Date`: 2026-03-25
- `Change`: Reworked the media library so it no longer behaves like a hidden newest-10 image view. The library now carries explicit media kind in the search/detail payloads, applies user-visible media-type filters, and pages the canonical created-at-ordered result set in `Last 12` / `Next 12` batches.
- `Type`: UI
- `Why`: Root cause was a `code/display issue`. The media screen was mixing API limiting, client-side image-only filtering, and an extra top-10 slice, which made the default view look arbitrary and hid the real ordering model from the user. Making filtering and paging explicit fixes the actual behavior mismatch instead of only changing the number of items returned.
- `Files`:
  - `TODO.md`
  - `src/app/api/t/[tenantKey]/photos/search/route.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/route.ts`
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - The library shows explicit media-type filter buttons instead of silently forcing images-only.
  - The visible media range is paged in `12`-item batches through `Last 12` / `Next 12`.
  - Default ordering continues to follow canonical `createdAt`.
- `Rollback Notes`: Restore the old default-limit/image-only slice only if the library should intentionally return to an implicit newest-images preview instead of an explicit filtered catalog.
- `Design Decision Change`: No design decision change.

## 2026-03-25 (consolidate design docs and canonicalize media asset fields)

- `Date`: 2026-03-25
- `Change`: Consolidated the repo onto `designchoices.md` as the single canonical design document, updated the schema/docs contract to make `MediaAssets` the canonical home for media-level fields, and cut the active media runtime over to canonical `MediaAssets` fields (`media_kind`, `label`, `description`, `photo_date`, immutable `created_at`) instead of treating link rows and metadata JSON as canonical asset state.
- `Type`: Schema
- `Why`: Root cause was a `mixed design/code issue`. The repo was maintaining two design-document entry points and the media model had canonical photo-level fields split across `MediaAssets`, `MediaLinks`, and `media_metadata`, which caused drift in implementation rules, inconsistent edit behavior, and ordering based on link timestamps instead of stable asset timestamps.
- `Files`:
  - `AGENTS.md`
  - `TODO.md`
  - `designchoices.md`
  - `docs/design-decisions.md`
  - `docs/data-schema.md`
  - `oci-schema.sql`
  - `src/lib/oci/tables.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/link/route.ts`
  - `src/lib/attributes/person-media.ts`
  - `src/lib/google/photo-resolver.ts`
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: Active runtime now writes canonical media-level values to `MediaAssets` and stops writing new runtime payloads into `MediaAssets.media_metadata`. Existing rows still rely on temporary fallback reads until a separate backfill normalizes older asset rows.
- `Verify`:
  - `npm run build` passes when run from the canonical Windows repo path (`C:\Users\steph\the-eternal-family-link`).
  - Upload/link/edit flows write canonical media fields to `MediaAssets`.
  - Media detail reads prefer `MediaAssets.label`, `MediaAssets.description`, `MediaAssets.photo_date`, and `MediaAssets.created_at`.
  - Active media resolution no longer branches on `storage_provider`.
- `Rollback Notes`: Revert the `MediaAssets` canonical-field writes, doc consolidation, and asset-first read paths together if the app must temporarily return to link-level canonical media fields and metadata-driven fallback behavior.
- `Design Decision Change`: Yes. `designchoices.md` is now the canonical design document, and the canonical media asset model is now explicitly `MediaAssets`-first.

## 2026-03-25 (limit default media library display to newest 10 images)

- `Date`: 2026-03-25
- `Change`: Changed the default media-library view to show only the most recent 10 image items, sorted newest-first by `createdAt`, while leaving explicit search behavior broad.
- `Type`: UI
- `Why`: Root cause was a `code/performance issue`. The media library was loading up to 100 items by default and ordering them by name, which increased thumbnail pressure on the preview path and did not match the need to focus the screen on the newest image items first.
- `Files`:
  - `src/app/api/t/[tenantKey]/photos/search/route.ts`
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - Opening the media library with no search term shows at most 10 image items.
  - Those default items are ordered newest-first by stored `createdAt`.
  - Entering a search term still returns the broader matching media set.
- `Rollback Notes`: Restore the old default limit and name-based ordering if the library should again load a larger default catalog.
- `Design Decision Change`: No design decision change.

## 2026-03-25 (remove image-delivery metadata fallback)

- `Date`: 2026-03-25
- `Change`: Removed `media_metadata` dependency from the active image-delivery path so preview URLs always request the preview variant directly and the server-side OCI image resolver now uses normalized `MediaAssets` object-key columns only.
- `Type`: API
- `Why`: Root cause was a `code issue`. The viewer/photo path was still parsing legacy `media_metadata` JSON to recover `originalObjectKey` and `thumbnailObjectKey`, and the preview URL helper also consulted metadata before requesting `?variant=preview`. That contradicted the normalized-media design and kept thumbnail/image delivery dependent on a JSON fallback that should no longer be part of the active path.
- `Files`:
  - `src/lib/google/photo-path.ts`
  - `src/lib/google/photo-resolver.ts`
  - `src/lib/oci/tables.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - Preview image URLs always target the preview variant without parsing `media_metadata`.
  - OCI-backed image delivery resolves object keys from normalized `MediaAssets.original_object_key` and `MediaAssets.thumbnail_object_key` only.
- `Rollback Notes`: Restore legacy metadata fallback in the resolver and preview helper if older rows without normalized object keys must be supported again.
- `Design Decision Change`: No design decision change.

## 2026-03-24 (reset media modal to stored-detail and stored-snapshot mode)

- `Date`: 2026-03-24
- `Change`: Removed active intelligence behavior from the media modal so the modal now shows stored media detail, linked entities, and stored analysis/process snapshots only.
- `Type`: UI
- `Why`: Root cause was a `code/design issue`. The media modal had become an unstable catch-all workflow that mixed ordinary media-detail editing with slow and unreliable live intelligence, EXIF loading, processing-status recompute, and face-association actions. Disabling those modal-triggered paths reduces coupling and restores the modal to a predictable stored-data view while the intelligence workflow is redesigned.
- `Files`:
  - `TODO.md`
  - `docs/design-decisions.md`
  - `designchoices.md`
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - Opening the media modal no longer auto-runs intelligence.
  - The modal header no longer exposes `Generate Suggestions`.
  - The `Analysis` tab shows stored snapshots/status only, and the modal no longer exposes processing-status refresh, EXIF load, title/description/date apply, or face-association actions.
- `Rollback Notes`: Re-enable modal intelligence actions only after a narrower redesigned intelligence workflow is documented and implemented.
- `Design Decision Change`: Yes. The media modal is now explicitly a stored-detail and stored-snapshot surface only until intelligence is redesigned.

## 2026-03-24 (add intelligence metadata overflow diagnostics)

- `Date`: 2026-03-24
- `Change`: Added targeted overflow diagnostics around the two `/intelligence` media-metadata writes so failing requests log the exact attempted payload length and top-level key sizes.
- `Type`: API
- `Why`: Root cause was still unresolved for `Steve's Mission to Guatemala` after the earlier metadata compaction changes. Oracle only reported that `MEDIA_ASSETS.MEDIA_METADATA` exceeded `4000`, which was not enough to identify whether the overflow happened on the first or second write or which top-level key was responsible. Logging the exact write step and per-key sizes is the minimal way to turn the next failure into a decisive root-cause record.
- `Files`:
  - `src/app/api/t/[tenantKey]/photos/[fileId]/intelligence/route.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - A failing `/api/t/[tenantKey]/photos/[fileId]/intelligence` request now logs `step=initial` or `step=response`, plus total metadata length and per-key lengths for the attempted payload.
- `Rollback Notes`: Remove the temporary `console.error` payload summaries from the intelligence route once the remaining overflow cause is identified and fixed.
- `Design Decision Change`: No design decision change.

## 2026-03-24 (stop persisting photo intelligence debug payload)

- `Date`: 2026-03-24
- `Change`: Stopped persisting `photoIntelligenceDebug` inside `media_metadata` while keeping the full live debug object in the `/intelligence` response.
- `Type`: API
- `Why`: Root cause was a `code issue`. After normalizing asset technical fields out of JSON, some files still overflowed `MEDIA_ASSETS.MEDIA_METADATA` because the successful intelligence path was persisting `photoIntelligenceDebug`, especially the large raw Vision payload, inside the metadata blob. That pushed known files like `Steve's Mission to Guatemala` just over Oracle's `VARCHAR2(4000)` limit even though the Vision call itself succeeded. Removing persisted debug entirely addresses the confirmed remaining overflow while keeping current-run diagnostics available in the immediate route response.
- `Files`:
  - `src/lib/media/photo-intelligence.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - `POST /api/t/[tenantKey]/photos/[fileId]/intelligence` succeeds for previously failing files that were only overflowing on persisted debug size.
  - The live route response still includes the full debug object for immediate troubleshooting, but reopened media reads no longer depend on storing any photo-intelligence debug payload in `media_metadata`.
- `Rollback Notes`: Revert the persisted-debug removal only if debug storage is moved to a more appropriate log table or `media_metadata` is widened beyond the current `VARCHAR2(4000)` constraint.
- `Design Decision Change`: No design decision change.

## 2026-03-24 (normalize asset technical media fields out of JSON)

- `Date`: 2026-03-24
- `Change`: Normalized asset-level storage and duplicate-support fields onto `MediaAssets`, stopped copying asset metadata into `MediaLinks`, and compacted newly written `media_metadata` so the media routes no longer rely on a large catch-all JSON blob for object keys, source pointers, checksum, dimensions, or duration.
- `Type`: Schema | API | Data
- `Why`: Root cause was a `mixed issue`. Critical asset fields were buried in `media_metadata` and mirrored into `MediaLinks`, which made reads depend on JSON parsing, allowed partial link/upsert paths to overwrite asset state incorrectly, and pushed `/intelligence` metadata writes over the `VARCHAR2(4000)` Oracle limit. Moving the approved fields to normalized `MediaAssets` columns and keeping asset JSON lean addresses the actual storage-model problem instead of only enlarging the column.
- `Files`:
  - `AGENTS.md`
  - `TODO.md`
  - `oci-schema.sql`
  - `docs/design-decisions.md`
  - `designchoices.md`
  - `docs/data-schema.md`
  - `src/lib/media/upload.ts`
  - `src/lib/media/upload.test.ts`
  - `src/lib/oci/tables.ts`
  - `src/lib/attributes/person-media.ts`
  - `src/lib/google/photo-resolver.ts`
  - `src/lib/google/photo-path.ts`
  - `src/lib/media/processing-status.ts`
  - `src/lib/media/processing-status.server.ts`
  - `src/lib/media/photo-intelligence.ts`
  - `src/lib/media/attach-orchestrator.ts`
  - `src/components/media/MediaAttachWizard.tsx`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/link/route.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/intelligence/route.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/route.ts`
  - `src/app/api/t/[tenantKey]/photos/search/route.ts`
- `Data Changes`: `MediaAssets` now has normalized columns for `source_provider`, `source_file_id`, `original_object_key`, `thumbnail_object_key`, `checksum_sha256`, `media_width`, `media_height`, and `media_duration_sec`. New writes stop persisting those fields into `media_metadata`, and `MediaLinks.media_metadata` is no longer used as a copy of asset technical metadata.
- `Verify`:
  - `npm run build` passes.
  - New uploads persist the approved technical fields directly on `MediaAssets`.
  - Resolver, face-recognition source-byte reads, and duplicate checks use normalized asset columns first, with JSON fallback only for legacy rows.
  - The previously failing `/intelligence` metadata writes for known files now fit within the existing `VARCHAR2(4000)` `media_metadata` limit.
- `Rollback Notes`: Revert the `MediaAssets` column additions and the lean-metadata/write-path changes together; do not restore link-level metadata mirroring without also accepting the prior JSON duplication and overflow risk.
- `Design Decision Change`: Updated `docs/design-decisions.md` / `designchoices.md` to record that asset technical metadata belongs on normalized `MediaAssets` columns, not in duplicated link JSON.

## 2026-03-23 (replace Vision analyzeImage wrapper with direct signed REST transport)

- `Date`: 2026-03-23
- `Change`: Replaced the runtime OCI Vision `analyzeImage` wrapper calls with direct signed REST requests that keep the existing SDK auth/signing/http transport but parse the Vision response and HTTP error payloads inside the app.
- `Type`: API | Infra
- `Why`: Root cause was a `code issue`. The same image and request shape succeeded through a direct signed OCI Vision REST call and failed only through `AIServiceVisionClient.analyzeImage(...)`, which made valid images fail unpredictably and obscured the real HTTP status/body when Vision returned a non-OK response. Moving only the `analyzeImage` transport to a direct signed request removes the unreliable generated wrapper while preserving the existing request shapes, image-preparation logic, and app-level Vision output contract.
- `Files`:
  - `TODO.md`
  - `docs/design-decisions.md`
  - `designchoices.md`
  - `src/lib/oci/vision.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - A known failing image like `Steve's Mission to Guatemala` now uses the same direct signed Vision transport that already returned `200 OK` in the diagnostic test.
  - A known working image like `Brent Headshot - Working` still returns normal labels/objects/faces through the app path.
  - Future non-OK Vision responses surface explicit `status`, `serviceCode`, raw body, and `opc-request-id` instead of only a wrapper-level formatter failure.
- `Rollback Notes`: Revert the direct transport helper and restore `AIServiceVisionClient.analyzeImage(...)` only if Oracle fixes the generated wrapper behavior and you want to return to the higher-level SDK method.
- `Design Decision Change`: Updated `docs/design-decisions.md` / `designchoices.md` to record the runtime Vision transport choice.

## 2026-03-24 (fix Oracle media metadata update type mismatch)

- `Date`: 2026-03-24
- `Change`: Fixed the shared media-metadata update helper so routes that only need to write `mediaMetadata` no longer bind null EXIF numeric values into the Oracle `media_assets` update statement.
- `Type`: API
- `Why`: Root cause was a `code issue`. `POST /photos/[fileId]/intelligence` and `POST /photos/[fileId]/processing-status` were both failing with `ORA-00932` because [tables.ts](C:/Users/steph/the-eternal-family-link/src/lib/oci/tables.ts) always sent `COALESCE(:exifOrientation, exif_orientation)` style expressions, even when callers did not provide EXIF values. Oracle treated the null bind for `exif_orientation` as a character expression, which is incompatible with the `NUMBER` column type. The helper now builds the asset update dynamically and only includes EXIF columns when the caller actually provided values.
- `Files`:
  - `src/lib/oci/tables.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - `POST /api/t/[tenantKey]/photos/[fileId]/processing-status` no longer returns `500` with `ORA-00932`.
  - `POST /api/t/[tenantKey]/photos/[fileId]/intelligence` can persist refreshed `photoIntelligence` / `photoIntelligenceDebug` metadata again.
- `Rollback Notes`: Revert the dynamic `media_assets` update clause construction and restore the old `COALESCE` update only if you also change the bind typing approach for nullable numeric EXIF columns.
- `Design Decision Change`: No design decision change.

## 2026-03-23 (make media analysis status and EXIF loading on-demand)

- `Date`: 2026-03-23
- `Change`: Stopped the media-detail route from auto-computing processing status on open, added explicit `Load/Refresh Processing Status` and `Load EXIF` actions in the media modal `Analysis` tab, and expanded the status tiles to show upload/thumbnail filenames while keeping face vector and face identity behavior unchanged.
- `Type`: UI | API
- `Why`: Root cause was a `code issue`. Opening a media item was still triggering processing-status work on the detail read path, so the modal paid for extra queries even when the user did not need that status immediately, and the UI could fall back to `Processing status will appear after the media details finish loading.` Older files that never collected EXIF at upload also had no recovery path. Moving status generation and EXIF extraction behind explicit actions removes unnecessary read-time work and gives legacy files a manual EXIF backfill path.
- `Files`:
  - `TODO.md`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/route.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/processing-status/route.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/exif/route.ts`
  - `src/components/MediaLibraryClient.tsx`
  - `src/lib/media/processing-status.server.ts`
  - `src/lib/media/processing-status.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/intelligence/route.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/faces/[faceId]/associate/route.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - Opening a media item no longer needs to auto-compute processing status just to render the Analysis tab.
  - `Load Processing Status` / `Refresh Processing Status` writes a cached status snapshot back into media metadata.
  - `Load EXIF` is available only when EXIF has not been collected for an image and persists EXIF plus refreshed status on demand.
  - The `Upload` and `Thumbnail` tiles show filenames, and the `Face Coordinates` tile continues to show the detected-face count.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-25 (fix media recency to use database add time)

- `Change`: Corrected media upload recency so `MediaAssets.created_at` now represents the immutable database add/upload timestamp instead of the browser file's old `lastModified` value, while `photo_date` remains the media-date field.
- `Type`: Media Ordering, Data Semantics, OCI Data Repair
- `Why`: Root cause was the upload write path seeding `created_at` from `fileCreatedAt`, which caused newly uploaded older photos to sort behind much newer uploads even though the library was already ordering by `created_at`.
- `Files`:
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/upload/route.ts`
  - `designchoices.md`
  - `docs/data-schema.md`
  - `TODO.md`
- `Data Changes`: Live OCI backfill updated `MediaAssets.created_at` for 26 assets using authoritative upload timestamps from `AuditLog` where `AuditLog.entity_id = MediaAssets.file_id`.
- `Verify`:
  - `npm run build` passes.
  - New upload `mfile-67ee722e3211e846` now has `created_at = 2026-03-23T19:48:54.947Z` and remains normalized with OCI object keys populated.
  - Post-backfill verification showed `0` remaining mismatches between audit-backed upload timestamps and `MediaAssets.created_at`.
  - In the linked `snowestes` image set, `mfile-67ee722e3211e846` now ranks `1` by recency.
- `Rollback Notes`: Revert commit and restore the previous `created_at` semantics only if you intentionally want file-age ordering back.
- `Design Decision Change`: Yes. `MediaAssets.created_at` is now explicitly defined as the immutable database add/upload timestamp, with `photo_date` and EXIF remaining separate media-date fields.

## 2026-03-23 (move EXIF collection to upload and add media processing status tab)

- `Date`: 2026-03-23
- `Change`: Moved EXIF collection onto the image upload paths, stopped the photo-intelligence route from reparsing EXIF, and added a dedicated `Analysis` tab in the media modal that shows persisted processing status for upload, EXIF, thumbnail generation, stored face coordinates, stored face vectors, and confirmed face identities.
- `Type`: UI | API
- `Why`: Root cause was a `mixed issue`. EXIF extraction was coupled to the `Generate Suggestions` route even though EXIF is file-level metadata that should be collected once when image bytes are first written. The media modal also had no single durable processing-status view, so users could not tell whether a photo had only uploaded, already had EXIF, had a thumbnail, had stored face regions, had any stored vectors, or had confirmed identities. Moving EXIF to upload fixes the file-metadata ownership boundary, and the new processing-status contract reads from persisted media, EXIF, face-instance, profile, and match records instead of transient UI state.
- `Files`:
  - `TODO.md`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/route.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/intelligence/route.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/faces/[faceId]/associate/route.ts`
  - `src/components/MediaLibraryClient.tsx`
  - `src/lib/attributes/person-media.ts`
  - `src/lib/media/exif.ts`
  - `src/lib/media/face-recognition.ts`
  - `src/lib/media/processing-status.server.ts`
  - `src/lib/media/processing-status.ts`
  - `src/lib/oci/tables.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - New image uploads persist EXIF fields during upload without waiting for `Generate Suggestions`.
  - Opening a media item now exposes an `Analysis` tab with step-state cards for upload, EXIF, thumbnail, face coordinates, face vectors, and confirmed identities.
  - `Generate Suggestions` reuses only persisted EXIF values and no longer reparses EXIF from source bytes.
- `Rollback Notes`: Re-enable the intelligence-route EXIF fallback if legacy pre-change images need EXIF backfilled without being re-uploaded, and remove the processing-status tab if you decide not to expose the pipeline state in the media modal.
- `Design Decision Change`: No design decision change.

## 2026-03-23 (add direct OCI Vision REST diagnostic script)

- `Date`: 2026-03-23
- `Change`: Added a standalone signed OCI Vision diagnostic script and package command that bypass the Oracle SDK error formatter and print the raw HTTP status, response body, and `opc-request-id` for local test images.
- `Type`: API | Infra
- `Why`: Root cause was a `code issue` in the OCI Vision diagnostics path. Failing Vision requests were still being masked by the Oracle TypeScript SDK before the app could inspect a readable status code, service code, request ID, or raw response body. That left repeated runtime experiments partly guess-driven. A direct signed REST test gives the exact OCI rejection for the same image and request shape without depending on the broken SDK formatter.
- `Files`:
  - `TODO.md`
  - `package.json`
  - `scripts/oci-vision-direct-test.cjs`
- `Data Changes`: None.
- `Verify`:
  - `node scripts/oci-vision-direct-test.cjs --help` prints usage.
  - `npm run build` passes.
  - `npm run vision:direct:test -- --image <path> --feature mixed|detect|embed` prints the raw HTTP status, `opc-request-id`, and response body from OCI Vision.
- `Rollback Notes`: Revert the script and package command if you decide to keep all OCI Vision diagnostics inside the application runtime only.
- `Design Decision Change`: No design decision change.

## 2026-03-22 (preserve raw OCI Vision error bodies when SDK formatting fails)

- `Date`: 2026-03-22
- `Change`: Patched the OCI helper error formatter at runtime so Vision failures now preserve raw OCI response bodies, service codes, status codes, and request IDs even when the Oracle TypeScript SDK crashes while constructing `OciError`.
- `Type`: API
- `Why`: Root cause was a `code issue` in the Oracle TypeScript SDK integration path. OCI Vision was returning an actual service error, but `oci-common` attempted to call `serviceCode.toLowerCase()` while formatting the error and masked the real rejection with an internal SDK crash. That left photo-intelligence debugging stuck on a generic `toLowerCase` message and forced repeated hypothesis-driven request-shape changes without the real OCI response body.
- `Files`:
  - `TODO.md`
  - `src/lib/oci/vision.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - A failing Vision request now reports the raw OCI error body/service code/request ID in Vision Debug instead of only the SDK formatter crash.
  - Existing successful Vision calls still use the normal SDK response path.
- `Rollback Notes`: Revert the runtime OCI helper patch if the upstream SDK is upgraded to a version that no longer masks Vision service errors, or if you decide to replace the SDK call path entirely.
- `Design Decision Change`: No design decision change.

## 2026-03-22 (restore stable OCI analyze request for suggestion-time face detection)

- `Date`: 2026-03-22
- `Change`: Restored `Generate Suggestions` to the last known-good OCI analyze request (`IMAGE_CLASSIFICATION` + `OBJECT_DETECTION` + `FACE_DETECTION`) for suggestion-time face detection, while keeping cropped-face embedding for manual association/headshot profile seeding and fixing persisted timing/debug fields so reopened media no longer show zeroed route timings.
- `Type`: API | UI
- `Why`: Root cause was a `mixed issue`. Production debug proved the detect-first experiment build was live (`embeddingAttempted=false`), but `FACE_DETECTION` by itself was still failing on some images before the Oracle TypeScript SDK could surface a readable OCI error. The older mixed analyze request was the last confirmed working Vision shape for those same photos. Separately, the route was building `photoIntelligenceDebug` into media metadata before `metadataUpdateMs` and `routeTotalMs` were populated, so reopened media could show stale zero timing values even after a real run completed.
- `Files`:
  - `TODO.md`
  - `src/lib/oci/vision.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/intelligence/route.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - `Generate Suggestions` on the previously failing image no longer fails on the standalone `FACE_DETECTION` request shape.
  - Manual `Associate Face` still uses cropped-face embedding rather than whole-image embedding.
  - Reopening the same media item shows non-zero persisted timing fields for `metadataUpdateMs` and `routeTotalMs`.
- `Rollback Notes`: Revert this entry if you want to resume experimenting with standalone `FACE_DETECTION`; keep the cropped-face embedding path unless you are also intentionally reverting the manual-association/headshot-profile improvements.
- `Design Decision Change`: No design decision change.

## 2026-03-22 (detect-first face recognition and crop-time embedding)

- `Date`: 2026-03-22
- `Change`: Replaced whole-image OCI `FACE_EMBEDDING` requests on `Generate Suggestions` with `FACE_DETECTION` only, then moved face-vector generation to cropped-face embedding during manual face association and canonical headshot profile seeding.
- `Type`: API | UI
- `Why`: Root cause was a `mixed issue`. Production debug showed source-byte load and EXIF were fast, but whole-image `FACE_EMBEDDING` requests were failing before the Oracle TypeScript SDK could surface a readable OCI error. That left `Generate Suggestions` unable to persist detected faces on some photos even though the app only needed face boxes at that stage. Detecting faces first and embedding only the selected face crop removes the unstable whole-image embedding path from the suggestion flow while still letting confirmed associations store vectors against `person_id`.
- `Files`:
  - `TODO.md`
  - `src/lib/oci/vision.ts`
  - `src/lib/media/face-recognition.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/intelligence/route.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/faces/[faceId]/associate/route.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - `Generate Suggestions` on previously failing photos now completes with detected face boxes and without the whole-image `FACE_EMBEDDING` crash.
  - `Associate Face` still stores a reviewed embedding on the selected `person_id` by embedding the cropped face region from the source image.
  - Vision debug still shows timing fields for source load, EXIF, Vision request, face persistence, metadata update, and total route time.
- `Rollback Notes`: Revert this entry's code changes together if you want to restore the whole-image embedding experiment and stop generating vectors from cropped face association/headshot flows.
- `Design Decision Change`: No design decision change.

## 2026-03-22 (single-call OCI face recognition experiment + latency debug)

- `Date`: 2026-03-22
- `Change`: Switched the photo-intelligence recognition path to a single OCI `FACE_EMBEDDING` request, removed the generic OCI label/object analysis pass from that route, and added step-level latency metrics to the persisted Vision debug payload.
- `Type`: API | UI
- `Why`: Root cause was a `code issue`. The recognition flow was paying for two sequential OCI Vision requests on every face-analysis photo: a first generic label/object/face-detection call and then a second `FACE_EMBEDDING` call before any face suggestions could be produced. OCI's generic labels were low-value for the current recognition goal, and the route had no timing breakdown to show whether source loading, image preparation, Vision, or persistence was the bottleneck on slow photos.
- `Files`:
  - `TODO.md`
  - `src/lib/oci/vision.ts`
  - `src/lib/media/photo-intelligence.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/intelligence/route.ts`
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - `Vision Debug` now shows `sourceLoadMs`, `visionPrepareMs`, `visionRequestMs`, `visionTotalMs`, `facePersistMs`, `metadataUpdateMs`, and `routeTotalMs`.
  - Photos with detected faces can still produce face suggestions from a single `FACE_EMBEDDING` OCI call.
  - Generic OCI label/object text no longer appears unless another captioning path supplies it.
- `Rollback Notes`: Revert the single-call embedding experiment and latency debug additions together if the app needs the prior OCI label/object analysis path restored.
- `Design Decision Change`: No design decision change.

## 2026-03-22 (use shared photo resolver for intelligence source bytes)

- `Date`: 2026-03-22
- `Change`: Switched the photo-intelligence route from OCI-object-only byte loading to the shared photo resolver so it now uses the same OCI-first with Drive-fallback source path as the photo viewer.
- `Type`: API
- `Why`: Root cause was a `code issue`. Some legacy images still lack `objectStorage.originalObjectKey` in `media_metadata`, but the rest of the app can display them because normal photo reads already use `resolvePhotoContentAcrossFamilies()` with Drive fallback. The intelligence route bypassed that shared resolver and tried OCI object bytes only, so Vision never got image bytes for those legacy photos. That left `attempted=false` with `Missing originalObjectKey in media metadata`, which also prevented detected faces and the manual association selector from appearing.
- `Files`:
  - `src/app/api/t/[tenantKey]/photos/[fileId]/intelligence/route.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - Running `Generate Suggestions` on a legacy image without `originalObjectKey` now attempts Vision instead of stopping at the missing-object-key debug message.
  - The same images continue to work for already-migrated OCI-backed rows.
- `Rollback Notes`: Revert the resolver switch in the intelligence route if you intentionally want photo intelligence limited to OCI-migrated media only.
- `Design Decision Change`: No design decision change.

## 2026-03-22 (remove redundant photo-detail reload after intelligence and face association)

- `Date`: 2026-03-22
- `Change`: Reused updated `mediaMetadata` returned by the `Generate Suggestions` and manual face-association POST routes so the media modal no longer waits on a second full photo-detail reload before clearing the busy state.
- `Type`: UI | API
- `Why`: Root cause was a `code issue`. Both `runPhotoIntelligence()` and `associateFaceToPerson()` already waited on an expensive POST that performed Vision analysis or face-profile writes and then persisted updated media metadata. After that POST completed, the client still made a second `loadSelectedPhotoDetail()` request and kept the modal in its loading state until that extra fetch returned. That redundant round-trip made successful operations feel hung or disproportionately slow, especially on larger images and manual face association.
- `Files`:
  - `src/components/MediaLibraryClient.tsx`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/intelligence/route.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/faces/[faceId]/associate/route.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - After `Generate Suggestions` finishes, the modal exits `Generating suggestions for this photo...` without waiting on a second detail fetch.
  - After `Associate Face` finishes, the face confirmation appears promptly without a full media-detail refresh.
- `Rollback Notes`: Revert the route response `mediaMetadata` additions and the client-side metadata-apply path together so the modal does not expect inline metadata snapshots from POST responses.
- `Design Decision Change`: No design decision change.

## 2026-03-22 (media photo-intelligence first-run AI card)

- `Date`: 2026-03-22
- `Change`: Kept the photo-intelligence panel visible for eligible images even before the first suggestion exists, added explicit loading/empty states for first-run photos, and prevented duplicate auto-start requests for the same open photo.
- `Type`: UI
- `Why`: Root cause was a `code issue`. In `MediaLibraryClient`, the modal auto-started photo intelligence for eligible images with no saved suggestion, but the AI card only rendered when `selectedPhotoIntelligenceSuggestion` already existed. That hid the entire AI section while the request was running, making the `Generate Suggestions` button look stuck on `Generating...`. The same modal could also issue redundant auto-start calls as detail state refreshed because there was no in-flight guard for the current file.
- `Files`:
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - Opening an eligible photo with no prior AI metadata still shows the `Photo Suggestions` card immediately.
  - While the first request is running, the card shows `Generating suggestions for this photo...` instead of appearing absent.
  - Reopening the same photo does not trigger overlapping auto-start intelligence calls for the same file.
- `Rollback Notes`: Revert the `MediaLibraryClient` photo-intelligence in-flight guard and AI card conditional together so the request flow and modal states stay aligned.
- `Design Decision Change`: No design decision change.

## 2026-03-22 (normalize Vision image formats before OCI analysis)

- `Date`: 2026-03-22
- `Change`: Normalized unsupported image formats to JPEG before OCI Vision analysis and expanded the opaque SDK crash message to include original/prepared image format details when Oracle still rejects the request.
- `Type`: API
- `Why`: Root cause was a `code issue`. The app accepts any `image/*` upload, but OCI Vision pretrained image analysis supports only JPG/PNG inputs. The existing prep path only re-encoded images when they exceeded the inline byte target, so smaller HEIC/WebP-style images could still be sent raw to OCI Vision. When Oracle rejected those inputs, the TypeScript SDK’s error builder crashed on `serviceCode.toLowerCase()`, masking the real rejection as `b.toLowerCase is not a function`.
- `Files`:
  - `src/lib/oci/vision.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - Running `Generate Suggestions` on a previously failing non-JPG/PNG image no longer returns the opaque `b.toLowerCase is not a function` error.
  - OCI Vision requests continue to work for previously successful JPG/PNG photos.
- `Rollback Notes`: Revert the Vision image preparation normalization and the related error-context expansion together so format handling and diagnostics stay aligned.
- `Design Decision Change`: No design decision change.

## 2026-03-22 (remove synchronous face-profile bootstrap from Generate Suggestions)

- `Date`: 2026-03-22
- `Change`: Stopped the interactive `Generate Suggestions` request from bootstrapping missing person face profiles inline and skipped candidate-profile loading entirely when the current photo has no matchable face embeddings.
- `Type`: API
- `Why`: Root cause was a `code issue`. The photo-intelligence route called `buildAndPersistFaceSuggestions()` synchronously inside the button request, and that helper could read missing primary headshots and make extra Vision calls for up to 12 people before returning. It did that even when the current photo had no matchable face embeddings, which could leave the modal sitting on `Generating suggestions for this photo...` for an excessive time. The upload flow already seeds primary headshot face profiles asynchronously, so doing the same bootstrap inline on the interactive route was redundant and unbounded.
- `Files`:
  - `src/lib/media/face-recognition.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - `Generate Suggestions` returns promptly on photos that previously sat on the loading state for an excessive time.
  - Photos with existing person face profiles still return candidate matches normally.
- `Rollback Notes`: Revert the interactive face-suggestion candidate loading change together so the request path does not resume synchronous profile bootstrap unexpectedly.
- `Design Decision Change`: No design decision change.

## 2026-03-22 (cap optional OpenAI photo-caption refinement time)

- `Date`: 2026-03-22
- `Change`: Added a hard timeout to the optional OpenAI photo-caption refinement step so slow upstream caption calls cannot block saving the deterministic OCI Vision suggestion.
- `Type`: API
- `Why`: Root cause was a `code issue`. After Vision succeeded, the photo-intelligence route still called `refinePhotoCaptionWithOpenAi()` before persisting metadata. That refinement used the OpenAI SDK default timeout of 10 minutes, so a slow or stalled upstream caption request could leave the UI on `Generating suggestions for this photo...` for minutes and then fail before saving any suggestion, especially on family-group-only photos where no face-matching work remained.
- `Files`:
  - `src/lib/ai/photo-caption.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - Family-group-only photos no longer sit in `Generating suggestions for this photo...` for minutes because of the optional caption-refinement step.
  - If OpenAI is slow, the route still saves the deterministic Vision-based suggestion instead of returning with no AI suggestion.
- `Rollback Notes`: Revert the photo-caption request timeout if you intentionally want long-running caption refinement to block the full intelligence response again.
- `Design Decision Change`: No design decision change.

## 2026-03-22 (manual face-to-person association MVP)

- `Date`: 2026-03-22
- `Change`: Added a manual reviewed face-association flow in the media modal: detected faces now show a cropped face preview plus explicit person selection, and the app can confirm one `face_id` to one `person_id` without relying on automatic recommendations.
- `Type`: UI | API
- `Why`: Root cause was a `product/design gap`. The app could detect faces and persist face embeddings, but it did not yet provide a reviewed manual path for saying “this exact face crop belongs to this person” and then using that confirmed embedding to build the person’s face profile. That manual-first training path is the safest way to bootstrap trustworthy person face profiles before broader automatic match loops.
- `Files`:
  - `TODO.md`
  - `docs/design-decisions.md`
  - `designchoices.md`
  - `src/lib/oci/tables.ts`
  - `src/lib/media/face-recognition.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/faces/[faceId]/associate/route.ts`
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - In the media modal, each detected face shows a face crop preview derived from the stored bounding box.
  - Selecting a person and clicking `Associate Face` creates a reviewed face association for that `face_id`.
  - The associated face embedding is stored onto that person’s canonical `person_face_profiles` row, and the modal refresh shows the confirmed match.
- `Rollback Notes`: Revert the manual face-association API, UI controls, and reviewed face-match/profile update helpers together so the product does not expose a partial manual-review flow.
- `Design Decision Change`: Updated `docs/design-decisions.md` and `designchoices.md` to record manual reviewed face-to-person association as the primary training workflow for person face profiles.

## 2026-03-22 (person-global primary photo model + person attach name fix)

- `Date`: 2026-03-22
- `Change`: Normalized person primary-photo behavior around `People.photo_file_id` as the only canonical headshot field, stopped persisting authoritative person-primary state on media links, aligned person/photo read paths and integrity expectations to that model, and fixed the person media-attach wizard so the current person shows by display name instead of raw `personId`.
- `Type`: UI | API | Schema
- `Why`: Root cause was a `mixed issue`. The app stored tenant-scoped person-photo primary flags on `MediaLinks.is_primary` while also storing a global `People.photo_file_id`. That split allowed duplicate primaries and stale avatar rows, and it made shared people inconsistent across family groups. Separately, the person media-attach wizard preselected the current person by ID but excluded that person from its `peopleOptions`, so the wizard could only render the raw `personId`.
- `Files`:
  - `TODO.md`
  - `src/lib/person/display-name.ts`
  - `src/lib/attributes/store.ts`
  - `src/lib/attributes/person-media.ts`
  - `src/lib/attributes/media-response.ts`
  - `src/app/api/t/[tenantKey]/attributes/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/[attributeId]/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/[photoId]/route.ts`
  - `src/app/api/t/[tenantKey]/photos/search/route.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/route.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/intelligence/route.ts`
  - `src/app/api/t/[tenantKey]/integrity/route.ts`
  - `src/components/PersonEditModal.tsx`
  - `docs/design-decisions.md`
  - `designchoices.md`
  - `docs/data-schema.md`
- `Data Changes`: Applied live OCI remediation to normalize existing person-primary data: updated `People.photo_file_id` for Brent Estes (`1QrWBGGbSW1reWyNhWjvI4uGc8bQuzpLK` -> `17YoxRiKr_EKi2d-fop-aQO9O4Xkl95ns`) and Eliza Estes (blank -> `1f2qhnRu5F_Blq-sysKPnlfKZzqmsLnKj`), converted 29 legacy person `usage_type='profile'` links to normalized `usage_type='photo'` links, and cleared 11 stale person-link `is_primary` flags.
- `Verify`:
  - `npm run build` passes.
  - In person photo edit flows, exactly one linked photo renders as `Primary`, and that state follows `People.photo_file_id`.
  - Uploading/attaching a new photo to a person shows the person's display name in the attach flow instead of the raw `personId`.
  - Integrity audit no longer expects person headshot links to use `usage_type=profile`.
- `Rollback Notes`: Revert the canonical person-photo selection helpers, person media-link write/read changes, wizard people-option fix, and the matching design/schema docs together so runtime behavior and docs stay aligned.
- `Design Decision Change`: Updated `docs/design-decisions.md` and `designchoices.md` to make person primary photos globally person-scoped via `People.photo_file_id`.

## 2026-03-22 (global face-recognition identity model)

- `Date`: 2026-03-22
- `Change`: Switched the persisted face-recognition model from family-scoped duplication to one global person/file identity model. New face-profile rows and analyzed face/match rows now write to a global sentinel scope, face/profile IDs no longer include family-group scope, and read paths prefer canonical global rows while still tolerating older legacy family-scoped rows during transition.
- `Type`: API | Schema
- `Why`: Root cause was a `design/code issue`. The first face-suggestion MVP stored `person_face_profiles`, `face_instances`, and `face_matches` by `family_group_key`, which duplicated the same person identity across families and conflicted with the intended product rule that the person is the same person everywhere. That also risked stale split-brain face state similar to the earlier person-primary-photo issue.
- `Files`:
  - `TODO.md`
  - `src/lib/oci/tables.ts`
  - `src/lib/media/face-recognition.ts`
  - `docs/design-decisions.md`
  - `designchoices.md`
  - `docs/data-schema.md`
- `Data Changes`: No separate data-repair script in this change. New runtime writes store canonical face/profile rows with `family_group_key="__global__"`, replace face analysis globally by `file_id`, and remove legacy per-person face-profile rows when a person profile is refreshed. Read paths prefer those new global rows over any older family-scoped rows.
- `Verify`:
  - `npm run build` passes.
  - Re-running photo intelligence for the same shared file from different family contexts reuses one canonical face-analysis set instead of creating duplicate family-scoped face rows.
  - Refreshing a person headshot seeds or updates one canonical face profile for that `person_id`.
  - Candidate suggestions remain limited to accessible people in the active family context even though profile storage is global.
- `Rollback Notes`: Revert the face-table read/write changes, face-id/profile-id generation changes, and the matching design/schema docs together so runtime behavior and documented storage scope stay aligned.
- `Design Decision Change`: Updated `docs/design-decisions.md` and `designchoices.md` to make face-recognition identity global by `person_id` and `file_id`.

## 2026-03-22 (persisted MediaAssets EXIF fields + skip repeat EXIF parsing)

- `Date`: 2026-03-22
- `Change`: Added normalized EXIF columns to `MediaAssets`, taught the OCI access layer to read/write those fields, and updated the photo-intelligence route to reuse stored EXIF when `exif_extracted_at` is already populated instead of reparsing EXIF on each forced suggestion run.
- `Type`: API | Schema
- `Why`: Root cause was a `schema/code issue`. EXIF extraction only existed as a transient step inside the intelligence route, so every forced `Generate Suggestions` run had to parse EXIF again from image bytes, and the runtime had no durable marker distinguishing `not attempted yet` from `attempted, but no EXIF found`.
- `Files`:
  - `TODO.md`
  - `src/lib/oci/tables.ts`
  - `src/lib/media/exif.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/intelligence/route.ts`
  - `docs/design-decisions.md`
  - `designchoices.md`
  - `docs/data-schema.md`
- `Data Changes`: `MediaAssets` compatibility now adds `exif_extracted_at`, `exif_source_tag`, `exif_capture_date`, `exif_capture_timestamp_raw`, `exif_make`, `exif_model`, `exif_software`, `exif_width`, `exif_height`, `exif_orientation`, and `exif_fingerprint`. No new indexes are added in this phase.
- `Verify`:
  - `npm run build` passes.
  - The first intelligence run on an image populates EXIF columns on `MediaAssets` even when no capture date is found.
  - A later forced intelligence run on the same image reuses stored EXIF and does not need to parse EXIF again.
  - Photo date suggestion still prefers persisted EXIF capture date over filename/created-at fallback when EXIF date exists.
- `Rollback Notes`: Revert the `MediaAssets` EXIF compatibility/access-layer changes, the EXIF helper rewrite, the intelligence-route reuse logic, and the matching design/schema docs together.
- `Design Decision Change`: Updated `docs/design-decisions.md` and `designchoices.md` to make normalized EXIF a first-class `MediaAssets` concern.

## 2026-03-22 (face embedding request fallback hardening)

- `Date`: 2026-03-22
- `Change`: Split OCI Vision face embeddings into a separate best-effort request while keeping the stable label/object/face-detection request as the primary photo-intelligence path. If the embedding request fails, photo intelligence now continues with normal Vision labels/objects/faces instead of failing the whole suggestion run.
- `Type`: API | Infra
- `Why`: Root cause was a `code/runtime issue`. The new face-suggestion MVP moved the primary Vision request onto `FACE_EMBEDDING`, and production started failing with `b.toLowerCase is not a function` before any Vision result could be returned. That broke photo-intelligence generation on clear headshots. The failure appears in the OCI TypeScript SDK request path for the embedding feature shape, not in the downstream face-match logic.
- `Files`:
  - `src/lib/oci/vision.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - In production, `Generate Suggestions` on a clear headshot no longer fails the whole Vision run with `b.toLowerCase is not a function`.
  - Photo intelligence still returns labels/objects/face detections even if the embedding-specific request is skipped.
  - When the embedding call succeeds, face-suggestion matching still has access to embeddings and can populate candidate people.
- `Rollback Notes`: Revert the split-request logic in `src/lib/oci/vision.ts` and restore the prior single-request face-embedding path.
- `Design Decision Change`: No design decision change.

## 2026-03-22 (OCI Vision inline image size hardening)

- `Date`: 2026-03-22
- `Change`: Bound oversized images before OCI Vision analysis and replace the opaque OCI TypeScript SDK `toLowerCase` crash with a clear Vision-specific error when Oracle still rejects the request. All inline Vision calls now re-encode large images to a smaller JPEG variant before the API request.
- `Type`: API | Infra
- `Why`: Root cause was a `mixed issue`. The photo-intelligence and face-profile paths always sent full original image bytes to OCI Vision, while Oracle's synchronous `analyzeImage` path only accepts single-image inline requests up to 5 MB. High-resolution originals could trigger a service-side rejection, and the Oracle TypeScript SDK then masked that rejection with its own secondary `toLowerCase is not a function` error when formatting the service error code.
- `Files`:
  - `src/lib/oci/vision.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - In production, `Generate Suggestions` on large or high-resolution photos no longer fails with `b.toLowerCase is not a function`.
  - Headshot profile seeding and photo-intelligence runs still reach OCI Vision and return labels/objects/faces for the same image set.
- `Rollback Notes`: Revert the image-preparation and error-normalization additions in `src/lib/oci/vision.ts`.
- `Design Decision Change`: No design decision change.

## 2026-03-22 (face embedding debug visibility)

- `Date`: 2026-03-22
- `Change`: Added explicit face-embedding subrequest status to the persisted Vision debug payload and switched the embedding request to Oracle's documented example shape (`shouldReturnLandmarks: true`) so empty-vector results can be diagnosed directly from the media debug block.
- `Type`: API | Infra
- `Why`: Root cause was a `code/diagnostics gap`. After the inline-size fix, OCI Vision labels/objects/face detection worked again, but candidate people still did not appear because the embedding subrequest was producing `embeddingLength: 0` with no persisted indication of whether the subrequest failed outright or returned faces without vectors.
- `Files`:
  - `src/lib/oci/vision.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/intelligence/route.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - Production Vision debug now includes `embeddingAttempted`, `embeddingSucceeded`, `embeddingErrorMessage`, `embeddingFacesReturned`, and `embeddingFacesWithVectors`.
  - A headshot re-run makes it clear whether the remaining no-candidate state is due to missing vectors, a failed embedding subrequest, or lack of cached candidate profiles.
- `Rollback Notes`: Revert the embedding-debug additions in `vision.ts` and the extra raw debug fields in the photo-intelligence route.
- `Design Decision Change`: No design decision change.

## 2026-03-22 (photo-intelligence debug contract alignment)

- `Date`: 2026-03-22
- `Change`: Extended the persisted `PhotoIntelligenceDebug` contract to include face-embedding status fields and updated the media modal to prefer the fresh route response debug over stale parsed metadata. The Vision debug section now surfaces embedding status directly instead of relying only on the raw JSON blob.
- `Type`: UI | API
- `Why`: Root cause was a `code/diagnostics issue`. The backend had started returning face-embedding diagnostics, but the client debug parser only knew the older debug shape and the modal preferred parsed `media_metadata` over the fresh POST response. That let the UI continue showing the older raw payload shape even after a successful redeploy, which blocked diagnosis of why face suggestions still had no candidate people.
- `Files`:
  - `src/lib/media/photo-intelligence.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/intelligence/route.ts`
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - Running `Generate Suggestions` now shows `embeddingAttempted`, `embeddingSucceeded`, `embeddingFacesReturned`, and `embeddingFacesWithVectors` in the Vision debug panel.
  - The modal reflects the latest POST response debug immediately after generation instead of preferring an older stored debug payload.
- `Rollback Notes`: Revert the debug-type/parser additions, the route debug fields, and the media-modal debug rendering changes together.
- `Design Decision Change`: No design decision change.

## 2026-03-22 (person primary photo deselect reconciliation)

- `Date`: 2026-03-22
- `Change`: Fixed the person photo attribute update path so clearing `Set as primary` on a photo no longer leaves `People.photo_file_id` pointed at the deselected file. The route now only pins the edited file when it remains primary after the save; otherwise it recomputes the current primary from the remaining person photo links.
- `Type`: API
- `Why`: Root cause was a `code issue`. The person photo edit route treated `existingMedia.isPrimary === true` as enough reason to keep the edited file as the person-level headshot even when the user had just unchecked `isPrimary`. That left the media link flags and `People.photo_file_id` out of sync, so the person header/avatar could still show the deselected image.
- `Files`:
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/[attributeId]/route.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - If two person photos were previously primary, unchecking one and saving causes the person header/avatar to switch to the remaining primary photo instead of the deselected one.
  - If no photo remains primary, the person header/avatar falls back to the first remaining photo as defined by `getPrimaryPhotoFileIdForPerson`.
- `Rollback Notes`: Revert the `nextIsPrimary`-based `photo_file_id` reconciliation in the person attribute PATCH route.
- `Design Decision Change`: No design decision change.

## 2026-03-22 (face suggestion MVP: persisted detections + read-only matches)

- `Date`: 2026-03-22
- `Change`: Added the first persisted face-suggestion slice for media. OCI Vision photo intelligence now requests face embeddings, persists detected faces plus ranked candidate matches in OCI tables, seeds cached person face profiles from primary headshots, and writes a compact face-suggestion read model into media metadata for the existing media editor to display read-only.
- `Type`: API | Schema | UI
- `Why`: Root cause was a `code/schema gap`. The project’s next blocked phase required reviewed face suggestions, but the runtime only surfaced a face count inside photo intelligence. There was no persisted face-analysis schema, no reusable person-profile embedding cache, and no UI surface for candidate people on detected faces.
- `Files`:
  - `TODO.md`
  - `docs/data-schema.md`
  - `src/lib/oci/tables.ts`
  - `src/lib/oci/vision.ts`
  - `src/lib/media/face-recognition.ts`
  - `src/lib/media/photo-intelligence.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/intelligence/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: New OCI tables auto-create on first use: `face_instances`, `face_matches`, and `person_face_profiles`.
- `Verify`:
  - `npm run build` passes.
  - Running `Generate Suggestions` on an image with faces now persists face detections/matches and shows a `Face Suggestions` section in the media editor.
  - Candidate people are limited to accessible people in the current family group and come from cached primary-headshot profiles.
  - Uploading or replacing a primary person photo can seed or refresh that person’s cached face profile without breaking the upload flow.
- `Rollback Notes`: Revert the face table/bootstrap additions, the face-recognition helper, the Vision face-embedding request change, the intelligence/upload route hooks, and the media editor face-suggestions UI together.
- `Design Decision Change`: No design decision change.

## 2026-03-22 (photo intelligence phase 1: EXIF dates + optional AI caption refinement)

- `Date`: 2026-03-22
- `Change`: Added EXIF-backed photo date extraction and optional OpenAI caption refinement on top of OCI Vision signals for photo-intelligence suggestions. The intelligence route now loads OCI image bytes once, reuses them for EXIF and Vision analysis, and persists richer suggestion metadata while keeping the existing editor apply workflow unchanged.
- `Type`: API | Infra
- `Why`: Root cause was a `code/workflow issue`. Phase 1 photo intelligence still depended only on filename and `createdAt` heuristics for dates, and title/description suggestions were fully deterministic even when OCI Vision signals were available. That left the feature short of the remaining Phase 1 requirements in `TODO.md`.
- `Files`:
  - `package.json`
  - `package-lock.json`
  - `src/lib/media/exif.ts`
  - `src/lib/ai/photo-caption.ts`
  - `src/lib/ai/openai.ts`
  - `src/lib/media/photo-intelligence.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/intelligence/route.ts`
  - `TODO.md`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - In production, `Generate Suggestions` can now return `dateSource=exif` when EXIF capture metadata exists.
  - When `OPENAI_API_KEY` is configured and OCI Vision returns usable labels/objects/faces, title/description suggestions can be refined by OpenAI; otherwise the deterministic fallback still produces suggestions.
  - Existing editor controls (`Use Title`, `Use Description`, `Use Date`) continue to work with the richer suggestion payload.
- `Rollback Notes`: Revert the EXIF helper, OpenAI caption helper/model getter, and the photo-intelligence route/suggestion-builder changes together.
- `Design Decision Change`: No design decision change.

## 2026-03-21 (deploy-safe OCI Vision/Object Storage auth)

- `Date`: 2026-03-21
- `Change`: Replaced the OCI Vision/Object Storage runtime auth path with a shared deploy-safe auth helper that prefers API-key env configuration in production and only falls back to OCI config-file auth when an actual config file exists.
- `Type`: API | Infra
- `Why`: Root cause was a `mixed issue`. The photo-intelligence route was reaching OCI Vision, but both `vision.ts` and `object-storage.ts` still constructed `ConfigFileAuthenticationDetailsProvider`, which assumes `~/.oci/config`. Vercel does not provide that file, so OCI client initialization failed before any Vision result could be returned. Production also needs the OCI API-signing env values (`OCI_USER_OCID`, `OCI_FINGERPRINT`, `OCI_PRIVATE_KEY_PEM` or `OCI_PRIVATE_KEY_PATH`) for env-based auth.
- `Files`:
  - `src/lib/oci/auth.ts`
  - `src/lib/oci/vision.ts`
  - `src/lib/oci/object-storage.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - In production, after setting `OCI_USER_OCID`, `OCI_FINGERPRINT`, and `OCI_PRIVATE_KEY_PEM` (or `OCI_PRIVATE_KEY_PATH`) with the existing region/tenancy/object-storage vars, `Generate Suggestions` should no longer fail with the missing `~/.oci/config` error.
  - OCI Vision debug should advance past auth initialization and either succeed or return a real OCI service error/status payload.
- `Rollback Notes`: Revert the shared auth helper and restore direct `ConfigFileAuthenticationDetailsProvider` usage in `vision.ts` and `object-storage.ts`.
- `Design Decision Change`: No design decision change.

## 2026-03-21 (OCI object read handles web ReadableStream)

- `Date`: 2026-03-21
- `Change`: Hardened OCI object-storage runtime reads to consume multiple streamed body shapes, including cross-realm web `ReadableStream` objects and nested streamed chunks, in addition to Node `Readable`, `Buffer`, and `arrayBuffer()` response shapes.
- `Type`: API | Infra
- `Why`: Root cause was a `code/runtime issue`. After the deploy-safe OCI auth fix, production advanced into the object read path, but the OCI SDK returned a streamed body shape that did not satisfy the original `instanceof ReadableStream` check in Vercel. `getOciObjectContentByKey()` therefore still fell through to `Buffer.from(...)` and threw `ERR_INVALID_ARG_TYPE` before Vision could analyze the image.
- `Files`:
  - `src/lib/oci/object-storage.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - In production, `Generate Suggestions` no longer fails with `ERR_INVALID_ARG_TYPE ... Received an instance of ReadableStream`.
  - Photo intelligence proceeds to Vision analysis or returns the next real OCI service/runtime error if one remains.
- `Rollback Notes`: Revert the `ReadableStream` handling helper in `src/lib/oci/object-storage.ts`.
- `Design Decision Change`: No design decision change.

## 2026-03-19 (modal backdrop-close disabled for key edit/manage flows)

- `Date`: 2026-03-19
- `Change`: Disabled backdrop click-to-close on core edit/import/manage modals so closing now requires explicit user intent via `Cancel`, `Close`, `X`, or save actions.
- `Type`: UI
- `Why`: Root cause was a `code issue`. Several modal backdrops were still wired to close on outside click, causing accidental dismissal and loss of in-progress context.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/components/HouseholdEditModal.tsx`
  - `src/components/AttributesModal.tsx`
  - `src/components/SettingsClient.tsx`
  - `src/components/MediaLibraryClient.tsx`
  - `src/components/media/MediaAttachWizard.tsx`
- `Data Changes`: None.
- `Verify`:
  - Open each updated modal and click outside the modal panel; confirm it stays open.
  - Confirm `Cancel`, `Close`, and `X` still close when enabled.
  - Confirm save flows still close when configured to do so.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the backdrop onClick handlers in the listed modal components.
- `Design Decision Change`: No design decision change.

## 2026-03-19 (attribute form photo attach support)

- `Date`: 2026-03-19
- `Change`: Added `Add Photo` directly inside the attribute add/edit form so users can attach photos without leaving the form. For new attributes, the form now saves first and then opens photo attach automatically.
- `Type`: UI
- `Why`: Root cause was a `code/UX issue`. The attribute form explicitly blocked media attach and forced users to leave the form and reopen the attribute detail drawer to add photos.
- `Files`:
  - `src/components/AttributesModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Open add attribute form and click `Add Photo`; confirm it saves (if new) and opens media attach wizard.
  - In edit attribute form, click `Add Photo`; confirm wizard opens immediately for that attribute.
  - Complete attach flow and confirm media appears on the attribute detail.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert `src/components/AttributesModal.tsx` add-form media wizard state/actions.
- `Design Decision Change`: No design decision change.

## 2026-03-19 (AI story import malformed JSON fallback hardening)

- `Date`: 2026-03-19
- `Change`: Hardened AI story-import model payload parsing so malformed/truncated JSON responses no longer throw a hard error; the flow now falls back to a primary story draft and continues. Also tightened prompt guidance to keep model notes concise and avoid echoing full source narrative in output JSON.
- `Type`: API
- `Why`: Root cause was a `code/prompt issue`. `JSON.parse` was unguarded, so model output truncation (for long narratives) produced errors like `Unterminated string in JSON`, and prior prompt guidance encouraged oversized output by asking for full narrative text in model notes.
- `Files`:
  - `src/lib/ai/story-import.ts`
- `Data Changes`: None.
- `Verify`:
  - Import long narrative text that previously produced `Unterminated string in JSON` and confirm the API returns proposals instead of 500 parse failure.
  - Confirm primary story draft still preserves full original narrative in notes (applied by server-side normalization) while model output remains compact.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert JSON parse fallback helper and prompt note-size guidance changes in `story-import.ts`.
- `Design Decision Change`: No design decision change.

## 2026-03-19 (AI story import title/date quality + draft skip action)

- `Date`: 2026-03-19
- `Change`: Added `Skip` support during AI draft review so users can move to the next story proposal without saving the current one. Improved primary-story title/date normalization to prefer meaningful story titles and operation-date ranges from narrative text (for example `from ... until ...`) instead of unrelated article/publication dates.
- `Type`: UI | API
- `Why`: Root cause was a `mixed issue`. Review flow lacked a skip path (only save-or-cancel), and story-date normalization defaulted to first-matched date patterns, which could select publication dates rather than the actual event/operation range described in the narrative.
- `Files`:
  - `src/components/AttributesModal.tsx`
  - `src/components/PersonEditModal.tsx`
  - `src/lib/ai/story-import.ts`
- `Data Changes`: None.
- `Verify`:
  - Start AI story import review and confirm `Skip` advances to the next proposal without saving the current one.
  - For narratives that include `from ... until ...` operation periods, confirm primary story dates prefer that range over article publication dates.
  - Confirm primary story label is a concise summary title and avoids weak/generic labels when source context supports a stronger title.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the draft-skip callback wiring in `AttributesModal`/`PersonEditModal` and the title/date normalization helpers in `story-import.ts`.
- `Design Decision Change`: No design decision change.

## 2026-03-20 (AI story detail field now title-oriented)

- `Date`: 2026-03-20
- `Change`: Updated AI story-import instructions and normalization so primary-story `attributeDetail` is treated as a descriptive title phrase rather than a sentence summary.
- `Type`: API
- `Why`: Root cause was a `code/prompt issue`. The story importer still normalized detail toward first-sentence text, which produced sentence-like output instead of the intended title-style detail.
- `Files`:
  - `src/lib/ai/story-import.ts`
- `Data Changes`: None.
- `Verify`:
  - Run AI story import and confirm `attributeDetail` is a concise descriptive title phrase (not sentence body text).
  - Confirm primary-story `label` and `attributeDetail` remain aligned and readable when source narratives are long.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert `story-import.ts` detail-title normalization and prompt wording changes together.
- `Design Decision Change`: No design decision change.

## 2026-03-20 (strip top-level descriptor preface from story source)

- `Date`: 2026-03-20
- `Change`: Story import now strips a leading metadata-style descriptor line (for example `Top-level matriarch ...`) before AI parsing and note/title shaping.
- `Type`: API
- `Why`: Root cause was a `code/input-normalization issue`. Some source narratives include graph/profile descriptor prefixes that are not part of the story body, and those prefixes were being preserved into imported notes/titles.
- `Files`:
  - `src/lib/ai/story-import.ts`
- `Data Changes`: None.
- `Verify`:
  - Import a story beginning with `Top-level matriarch ...` and confirm the imported narrative no longer starts with that descriptor text.
  - Confirm regular narratives without that prefix are unchanged.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert leading-descriptor strip helper and source normalization call in `story-import.ts`.
- `Design Decision Change`: No design decision change.

## 2026-03-20 (AI story title-quality guardrails)

- `Date`: 2026-03-20
- `Change`: Tightened primary-story title normalization to reject repeated/truncated sentence fragments and prefer clean descriptive title phrases for `attributeDetail`.
- `Type`: API
- `Why`: Root cause was a `code-normalization issue`. Even with AI output, fallback/post-processing could still pass through repeated lead text (for example duplicated place names + opening sentence fragment), making titles look like raw truncation instead of summaries.
- `Files`:
  - `src/lib/ai/story-import.ts`
- `Data Changes`: None.
- `Verify`:
  - Import a story with repeated lead text and confirm `attributeDetail` no longer duplicates opening phrases.
  - Confirm `attributeDetail` is title-like (short phrase) and avoids sentence-like comma fragments.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert title guardrail helpers in `story-import.ts` (`collapseRepeatedLead`, sentence-like gating, clause-start fallback).
- `Design Decision Change`: No design decision change.

## 2026-03-20 (story import passthrough AI chat + apply-to-draft hints)

- `Date`: 2026-03-20
- `Change`: Added a new in-modal Story AI Chat passthrough experience so users can discuss title/date/type choices against the current story text before generating drafts. Chat now returns structured suggestions and users can apply those suggestions as generation hints for the next story-import run.
- `Type`: UI | API
- `Why`: Root cause was a `workflow gap`. Story import previously had one-shot generation with no conversational refinement loop, so users could not guide AI output quality before draft creation.
- `Files`:
  - `src/lib/ai/story-chat.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/story-chat/route.ts`
  - `src/components/PersonEditModal.tsx`
  - `src/app/api/t/[tenantKey]/people/[personId]/story-import/route.ts`
  - `src/lib/ai/story-import.ts`
- `Data Changes`: None.
- `Verify`:
  - Open `Import Story with AI` and confirm Story AI Chat appears under story text.
  - Ask AI a question and confirm assistant response plus structured suggestion fields return.
  - Click `Apply Suggestion` and confirm hints are shown and included in subsequent `Generate Drafts` request.
  - Confirm existing draft review/save flow remains unchanged after generation.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert story-chat API + UI chat panel + story-import hint plumbing as one unit.
- `Design Decision Change`: No design decision change.

## 2026-03-20 (story workspace desktop-first layout scaffold)

- `Date`: 2026-03-20
- `Change`: Reworked the `Import Story with AI` modal into a desktop-first full-screen Story Workspace scaffold with side-by-side story input and AI review panels, extraction mode selector UI (`Story`, `Balanced`, `Resume`), and a reserved duplicate-review section.
- `Type`: UI
- `Why`: Root cause was a `workflow/UX issue`. The prior compact modal made it hard to evaluate extraction quality, prompts, and refinement controls together while reviewing long narratives.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - Open `Import Story with AI` on desktop and confirm full-screen workspace layout with two columns.
  - Confirm story text/editor, chat panel, suggestion panel, and duplicate placeholder are visible together.
  - Confirm mobile widths collapse back to one-column layout.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert `PersonEditModal` story modal structure and the new `.story-workspace-*` styles in `globals.css`.
- `Design Decision Change`: No design decision change.

## 2026-03-20 (story workspace layout refinements: one-row mode + inline proposal preview)

- `Date`: 2026-03-20
- `Change`: Refined the Story Workspace so extraction mode chips stay on one row, increased workspace height, and added inline “Potential Attributes / Stories” preview cards in the same screen after generation.
- `Type`: UI
- `Why`: Root cause was a `workflow/UX issue`. The extraction-mode selector wrapped inconsistently and generated proposals immediately left the workspace, making it hard to evaluate results in-context.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - Extraction mode chips (`Story`, `Balanced`, `Resume`) remain on one row in desktop workspace.
  - Story workspace panel opens taller and shows more content without early scrolling.
  - After `Generate Drafts`, proposal cards render in the same screen under “Potential Attributes / Stories”.
  - `Open Draft Review` moves from workspace preview into existing per-draft add/edit flow.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the proposal-preview section and `openStoryDraftReview` behavior in `PersonEditModal`, plus `.story-mode-row` and panel-height changes in `globals.css`.
- `Design Decision Change`: No design decision change.

## 2026-03-20 (guided two-step workspace flow + bottom close + clean story seed)

- `Date`: 2026-03-20
- `Change`: Converted the story workspace right side into a guided two-step flow: Step 1 identifies/consolidates candidate attributes and accepts additional AI guidance/missing facts; Step 2 provides add-attribute-style draft entry forms for review and direct save. Moved workspace `Close` action to the bottom and removed metadata-style `Top-level ...` preface text from default story seed.
- `Type`: UI | API
- `Why`: Root cause was a `workflow issue`. The prior layout mixed controls and did not support staged refinement before final attribute-entry, while default story seed could include non-narrative profile metadata.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/lib/ai/story-import.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/story-import/route.ts`
- `Data Changes`: None.
- `Verify`:
  - Open story workspace and confirm `Close` appears only in bottom action area.
  - Confirm extraction mode appears above `Generate Drafts`.
  - Confirm right panel Step 1/Step 2 navigation (`Next`, `Back`) works.
  - Confirm Step 1 supports candidate selection + consolidate + additional AI guidance.
  - Confirm Step 2 shows editable draft form fields and supports direct save per draft.
  - Confirm default story text no longer starts with `Top-level ...` metadata preface.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert guided step state/functions and story seed strip helper in `PersonEditModal`, and story-import hint extensions in the API/backend.
- `Design Decision Change`: No design decision change.

## 2026-03-19 (AI story import notes-first narrative shaping)

- `Date`: 2026-03-19
- `Change`: Adjusted AI story-import shaping so story proposals now use a concise title/detail and preserve the full original narrative in notes; also strengthened date-extraction instructions and fallback date parsing for explicit date formats in source text.
- `Type`: API
- `Why`: Root cause was a `code/prompt issue`. The importer prompt and fallback logic explicitly encouraged long `attributeDetail` story bodies and only optional notes, which reversed the intended data shape.
- `Files`:
  - `src/lib/ai/story-import.ts`
- `Data Changes`: None.
- `Verify`:
  - Import a story and confirm the primary draft has a short `label`, a brief one-sentence `attributeDetail`, and full narrative text in `attributeNotes`.
  - Confirm explicit dates in source text (for example `YYYY-MM-DD`, `MM/DD/YYYY`, `Month Day, Year`) populate `attributeDate` when available.
  - Confirm primary proposal remains `event / life_event / story`.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert `src/lib/ai/story-import.ts` prompt and primary-story normalization helpers together.
- `Design Decision Change`: No design decision change.

## 2026-03-19 (AI story import: story-first extraction and anti-fragment guardrails)

- `Date`: 2026-03-19
- `Change`: Reworked AI story import so it is story-first instead of sentence-fragment-first: the pipeline now enforces one primary `life_event/story` proposal for the overall narrative and only keeps high-signal supporting proposals.
- `Type`: API
- `Why`: Root cause was a `code/prompt issue`. The prior prompt explicitly asked the model to extract as many distinct proposals as possible, which encouraged sentence-level fragmentation and produced noisy low-value drafts from a single story.
- `Files`:
  - `src/lib/ai/story-import.ts`
- `Data Changes`: None.
- `Verify`:
  - Submit a long narrative story and confirm the first draft is one coherent `life_event/story` proposal.
  - Confirm supporting proposals are limited to material facts (for example concrete relationship, move/location, or major milestone facts) rather than one per sentence.
  - Confirm duplicate/near-duplicate and tiny fragment proposals are reduced.
  - Confirm output is capped at 10 proposals total.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert `src/lib/ai/story-import.ts` prompt + post-processing guardrail changes together.
- `Design Decision Change`: No design decision change.

## 2026-03-19 (AI story import payload hardening + graceful fallback)

- `Date`: 2026-03-19
- `Change`: Hardened AI story-import payload parsing so minor model shape drift no longer fails the import; invalid/partial model payloads now fall back to a valid primary story draft instead of returning `invalid proposal payload`.
- `Type`: API
- `Why`: Root cause was a `code issue`. The response schema was too strict for occasional model output variation, causing hard failures even when narrative text was valid and a primary story draft could still be produced safely.
- `Files`:
  - `src/lib/ai/story-import-types.ts`
  - `src/lib/ai/story-import.ts`
- `Data Changes`: None.
- `Verify`:
  - Run story import with long narrative text and confirm it no longer errors with `AI story import returned an invalid proposal payload`.
  - Confirm output still includes one primary story proposal and supporting proposals when valid.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert `story-import-types` normalization defaults and `story-import` fallback behavior together.
- `Design Decision Change`: No design decision change.

## 2026-03-19 (thumbnail variants for media uploads + preview routing)

- `Date`: 2026-03-19
- `Change`: Added original+thumbnail image handling for media uploads, persisted thumbnail pointers in media metadata, and switched compact preview surfaces to use thumbnail file IDs when available.
- `Type`: UI | API
- `Why`: Root cause was a `code/performance issue`. The app served original-size images in many list/tile previews, which increased payload size and slowed frequent gallery/tree/profile rendering paths.
- `Files`:
  - `src/lib/media/thumbnail.server.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/upload/route.ts`
  - `src/lib/media/upload.ts`
  - `src/lib/google/photo-path.ts`
  - `src/lib/media/attach-orchestrator.ts`
  - `src/components/media/MediaAttachWizard.tsx`
  - `src/components/MediaLibraryClient.tsx`
  - `src/components/PersonEditModal.tsx`
  - `src/components/HouseholdEditModal.tsx`
  - `src/components/AttributesModal.tsx`
  - `src/lib/media/upload.test.ts`
  - `docs/design-decisions.md`
  - `designchoices.md`
- `Data Changes`: No schema change. New image uploads now include thumbnail metadata fields (`thumbnailFileId`, file info, dimensions, size) in stored `media_metadata`.
- `Verify`:
  - Upload a new image and confirm both original and thumbnail files are created in storage.
  - Confirm `media_metadata` includes `thumbnailFileId` for the new upload.
  - Confirm media list/tile previews (Media Library, Person/Household picture tiles, Attribute media chips, attach wizard previews) load from thumbnail IDs when present.
  - Confirm large/detail image views still load the original file.
  - `npx tsc --noEmit` passes.
  - `npx tsx --test src/lib/media/upload.test.ts` passes.
- `Rollback Notes`: Revert thumbnail generation/upload in both upload routes together with preview-path resolver changes so metadata/UI do not point to non-existent variants.
- `Design Decision Change`: Updated `docs/design-decisions.md` and `designchoices.md` with the original+thumbnail media-delivery rule.

## 2026-03-17 (AI Help expansion + audit username logging + document media support)

- `Date`: 2026-03-17
- `Change`: Expanded grounded AI Help coverage, added first-class audit logging/filtering for attempted login usernames, and added document uploads/rendering across media flows.
- `Type`: UI | API | Schema
- `Why`: Root cause was a `mixed issue`. AI Help coverage in [help-guide.ts](C:/Users/steph/the-eternal-family-link/src/lib/ai/help-guide.ts) lagged current workflows, login attempts were logged but username visibility/filtering was weak because audit only had actor email/person fields, and media upload/display hard-rejected non-image/video/audio files.
- `Files`:
  - `src/lib/ai/help-guide.ts`
  - `src/lib/data/store.ts`
  - `src/lib/auth/options.ts`
  - `src/lib/audit/log.ts`
  - `src/lib/oci/tables.ts`
  - `src/app/api/t/[tenantKey]/audit/route.ts`
  - `src/components/SettingsClient.tsx`
  - `src/lib/media/upload.ts`
  - `src/lib/media/upload.test.ts`
  - `src/lib/media/attach-orchestrator.ts`
  - `src/components/media/MediaAttachWizard.tsx`
  - `src/components/MediaLibraryClient.tsx`
  - `src/components/PersonEditModal.tsx`
  - `src/components/HouseholdEditModal.tsx`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/upload/route.ts`
  - `docs/data-schema.md`
- `Data Changes`: AuditLog compatibility now includes `actor_username` (table/add-column/index compatibility in OCI layer). No destructive data migration.
- `Verify`:
  - Request failed local sign-ins and confirm Audit entries include `action=LOGIN`, `status=FAILURE`, and `actor_username`.
  - In Admin Audit filters, filter by Username and confirm matching entries load.
  - Upload/link a document (for example PDF) from media attach flows and confirm it stores/links successfully.
  - Confirm document tiles and detail views render as document cards with `Open Document` action in Person, Household, and Media Library.
  - `npm run build` passes.
- `Rollback Notes`: Revert audit username threading and `audit_log` compatibility updates together with the UI/API filters to avoid partial behavior; revert document media type support in upload/inference/UI as one unit to restore strict image/video/audio-only behavior.
- `Design Decision Change`: No design decision change.

## 2026-03-17 (password reset dedupe + schema repair)

- `Date`: 2026-03-17
- `Change`: Fixed local password-reset matching for users who have both Google and local family-access rows in the same family group by deduping the tenant local-user query at the OCI source, and repaired the missing live `PASSWORD_RESETS` table in OCI.
- `Type`: API | Data | Schema
- `Why`: Root cause was a `mixed issue`. The reset matcher in [password-reset.ts](C:/Users/steph/the-eternal-family-link/src/lib/auth/password-reset.ts) requires exactly one enabled local user, but [getOciLocalUsersForTenant](C:/Users/steph/the-eternal-family-link/src/lib/oci/tables.ts) was joining `user_access` to `user_family_groups` by `person_id` and returning the same local user twice whenever that person had both Google and local access rows in the same family. In production, the `PASSWORD_RESETS` table was also missing, so even a successful match would not have had a reset-token table to write into.
- `Files`:
  - `src/lib/oci/tables.ts`
- `Data Changes`: Created the live OCI `PASSWORD_RESETS` table plus its expected indexes (`UX_PASSWORD_RESETS_TOKEN_HASH`, `IX_PASSWORD_RESETS_EMAIL_STATUS`, `IX_PASSWORD_RESETS_PERSON_STATUS`).
- `Verify`:
  - For a user with both Google and local access rows in the same family, confirm the tenant local-user query now returns one row per family/person instead of duplicates.
  - Confirm `PASSWORD_RESETS` exists in OCI.
  - Request a password reset for a valid active local user and confirm a token row can be created and the email send path can proceed.
  - `npx tsc --noEmit` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert the `DISTINCT` dedupe in `getOciLocalUsersForTenant` only if the local-user query is replaced with a more specific join strategy; dropping the repaired `PASSWORD_RESETS` table would break the public forgot-password flow and should not be done without replacing the feature.
- `Design Decision Change`: No design decision change.

## 2026-03-17 (build fix: password reset client server-only import)

- `Date`: 2026-03-17
- `Change`: Fixed the production build break in the new password-reset flow by removing the server-only tenant-context import from the client-side password reset screen and replacing it with a client-safe callback-path helper.
- `Type`: Infra | UI
- `Why`: Root cause was a `code issue`. [PasswordResetClient.tsx](C:/Users/steph/the-eternal-family-link/src/components/PasswordResetClient.tsx) imported `getFamilyGroupBasePath` from [context.ts](C:/Users/steph/the-eternal-family-link/src/lib/tenant/context.ts), which imports `next/headers`. That server-only dependency is not allowed in a client component, so Vercel failed the build before the person-profile summary deploy could complete.
- `Files`:
  - `src/components/PasswordResetClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - Confirm the reset-password flow still computes the post-reset callback URL correctly for the default family and non-default family routes.
  - `npx tsc --noEmit` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert the `PasswordResetClient` callback-path helper change and restore the prior import only if the reset callback logic is moved back onto a server-safe path.
- `Design Decision Change`: No design decision change.

## 2026-03-17 (person profile summary-first editing)

- `Date`: 2026-03-17
- `Change`: Reworked the person `Contact Info` tab into a summary-first `Profile` tab that shows compact label/value cards by default and only reveals fields for the active section being edited (`Identity`, `Name`, `Contact`, `Family`, `Notes`).
- `Type`: UI
- `Why`: Root cause was a `code/design issue`. The person modal rendered its entire profile tab as a full edit form all the time, even though most fields are rarely changed. That consumed too much space, kept too many inputs visible, and made the screen feel heavier than necessary.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/app/globals.css`
  - `docs/design-decisions.md`
  - `designchoices.md`
- `Data Changes`: None.
- `Verify`:
  - Open a person and confirm the first tab is now `Profile`.
  - Confirm `Identity`, `Name`, `Contact`, `Family`, and `Notes` open as summary cards instead of always-visible edit fields.
  - Click `Edit` on a section and confirm only that section reveals inputs.
  - Confirm the modal footer only shows `Cancel` + `Save and Close` while a section is actively being edited, and otherwise just shows `Close`.
  - Save a section and confirm it returns to summary mode with the updated values.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the `PersonEditModal` summary/edit refactor, the supporting CSS, and the design-doc updates together so the profile tab does not partially mix summary cards with the old full-form footer behavior.
- `Design Decision Change`: Updated `docs/design-decisions.md` and `designchoices.md` to make summary-first, section-level profile editing the person-screen rule.

## 2026-03-16 (self-service local password reset by email)

- `Date`: 2026-03-16
- `Change`: Added a public `Forgot Password?` flow for local users, including a family-context request form, emailed single-use reset links, a public reset-password page that lets the user choose a new password, and automatic sign-in after a successful reset.
- `Type`: UI | API | Schema
- `Why`: Root cause was a `code/design gap`. The app now uses local username/password as the supported user-facing sign-in path, but there was no self-service recovery flow. Users who forgot their password had no supported path other than asking an admin to reset it manually.
- `Files`:
  - `src/components/LoginPageClient.tsx`
  - `src/app/forgot-password/page.tsx`
  - `src/components/ForgotPasswordPageClient.tsx`
  - `src/app/api/password-reset/request/route.ts`
  - `src/app/reset-password/[token]/page.tsx`
  - `src/components/PasswordResetClient.tsx`
  - `src/app/api/password-reset/[token]/route.ts`
  - `src/lib/auth/password-reset.ts`
  - `src/lib/auth/password-reset-types.ts`
  - `src/lib/oci/tables.ts`
  - `src/lib/ai/help-guide.ts`
  - `docs/design-decisions.md`
  - `designchoices.md`
  - `docs/data-schema.md`
- `Data Changes`: Adds the `PasswordResets` OCI table for single-use reset tokens. Request matching uses existing contact email sources (`UserAccess.user_email`, `People.email`, latest invite email) and does not add new email-based login rows.
- `Verify`:
  - Open `/login` and confirm a `Forgot Password?` link is visible.
  - Request a reset from `/forgot-password` with an email that matches exactly one active local user in the current family group.
  - Confirm the UI always returns the generic success message and, for a valid match, an email is sent with a reset link.
  - Open the reset link, choose a new password twice, and confirm the password updates and the user is signed in automatically.
  - Reuse the same reset link and confirm it is no longer active.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the forgot-password/reset-password routes, remove the `PasswordResets` table compatibility logic, and remove the login/help text updates together so the UI does not advertise a recovery path that no longer exists.
- `Design Decision Change`: Updated `docs/design-decisions.md` and `designchoices.md` to add local self-service password recovery as a supported authentication behavior.

## 2026-03-16 (local-only invite onboarding with explicit install/login guidance)

- `Date`: 2026-03-16
- `Change`: Switched the user-facing invite and login flows to local-only onboarding, removed temporary-password generation from invite creation, updated invite acceptance so the recipient chooses their password on the invite page, and added explicit login plus iPhone/iPad install guidance to the invite UI/message and login screen.
- `Type`: UI | API
- `Why`: Root cause was a `code/design issue`. Invite creation was still pre-generating a temporary password and optional Google path even though the live invite-accept flow already asked the recipient to choose a password twice. That left the onboarding model more complex than necessary and made the generated invite copy misleading.
- `Files`:
  - `src/lib/invite/store.ts`
  - `src/lib/invite/types.ts`
  - `src/app/api/invite/[token]/route.ts`
  - `src/app/invite/[token]/page.tsx`
  - `src/app/api/t/[tenantKey]/invites/route.ts`
  - `src/components/InviteAcceptClient.tsx`
  - `src/components/LoginPageClient.tsx`
  - `src/components/SettingsClient.tsx`
  - `src/lib/ai/help-guide.ts`
  - `docs/design-decisions.md`
  - `designchoices.md`
  - `docs/data-schema.md`
- `Data Changes`: None.
- `Verify`:
  - In `Admin -> Users & Access -> Manage User -> Invite`, confirm there is no `Sign-In Path` selector and the copy explains that the recipient chooses their own password.
  - Create an invite and confirm the suggested message includes the username, local login steps, and iPhone/iPad install guidance but no temporary password.
  - Open a pending invite and confirm the page only offers username/password activation, requires password + confirm password, and no longer offers Google.
  - Open `/login` and confirm it only offers local username/password sign-in plus first-time/install guidance.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the invite-store/local-accept changes, the invite/login UI changes, and the design/doc updates together so the invite model does not partially mix generated passwords with local-only onboarding.
- `Design Decision Change`: Updated the user onboarding and sign-in decision in `docs/design-decisions.md`, aligned `designchoices.md`, and refreshed the invite behavior notes in `docs/data-schema.md`.

## 2026-03-16 (fixed-position modal close control)

- `Date`: 2026-03-16
- `Change`: Refined the shared modal close control so the `X` now uses a consistent inline-SVG icon and anchors to a reserved top-right slot instead of shifting with header wrapping across modal sizes and devices.
- `Type`: UI
- `Why`: Root cause was a `code issue`. Even after standardizing modal actions, the close control was still a normal grid item inside modal headers, so header content and responsive wrapping could move it to different positions on different screens.
- `Files`:
  - `src/components/ui/primitives.tsx`
  - `src/app/globals.css`
  - `src/components/SettingsClient.tsx`
  - `src/components/PersonEditModal.tsx`
  - `src/components/HouseholdEditModal.tsx`
  - `docs/ui-interaction-standards.md`
- `Data Changes`: None.
- `Verify`:
  - Open the migrated admin/person/household modals on desktop and mobile widths.
  - Confirm the close control stays in the same top-right position regardless of header content wrapping.
  - Confirm the control uses the same icon, size, and hover/focus styling in each migrated modal.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the floating close-button styling and the close-button usage updates in the migrated modal headers.
- `Design Decision Change`: No design decision change.

## 2026-03-16 (modal and async interaction standardization)

- `Date`: 2026-03-16
- `Change`: Added a documented modal/button interaction standard, introduced shared UI primitives for async actions and modal feedback (`AsyncActionButton`, `ModalStatusBanner`, `ModalActionBar`, `ModalCloseButton`), and applied that pattern to the main admin/user modals, person edit, household edit, and invite acceptance flows.
- `Type`: UI
- `Why`: Root cause was a `code/design issue`. Async status and button behavior had drifted across screens, so saves could look silent, statuses could appear behind inactive surfaces, close/save semantics varied by modal, and admins could not reliably tell when an action was running or finished.
- `Files`:
  - `docs/ui-interaction-standards.md`
  - `docs/design-decisions.md`
  - `designchoices.md`
  - `src/components/ui/primitives.tsx`
  - `src/app/globals.css`
  - `src/components/SettingsClient.tsx`
  - `src/components/PersonEditModal.tsx`
  - `src/components/HouseholdEditModal.tsx`
  - `src/components/InviteAcceptClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - In `Settings -> Add User`, `Manage User`, and `Invite`, confirm the active buttons change immediately to pending labels, duplicate clicks are disabled, and status stays visible in the active modal.
  - In `Person` and `Household` edit modals, confirm the header uses the shared close button, footer actions read `Cancel` + `Save and Close`, and status appears in the shared action bar.
  - In invite acceptance, confirm local/google actions switch to pending labels and status is shown in a clear inline banner.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the shared interaction primitives, the modal/button migrations in the affected components, and the UI interaction design-decision/docs updates.
- `Design Decision Change`: Added the modal and async interaction standard to `docs/design-decisions.md`, aligned `designchoices.md`, and added `docs/ui-interaction-standards.md`.

## 2026-03-16 (login page uses active family for local sign-in)

- `Date`: 2026-03-16
- `Change`: The generic `/login` page now resolves the active family-group key from the request cookies and uses that tenant for local username/password sign-in, instead of hardcoding the default family. Successful sign-in now returns to that family’s home route.
- `Type`: UI | API
- `Why`: Root cause was a `code issue`. [login/page.tsx](/C:/Users/steph/the-eternal-family-link/src/app/login/page.tsx) always posted credentials with `tenantKey = snowestes`, so valid local credentials for users like Ezra in `meldrumclark` were checked against the wrong family and always failed.
- `Files`:
  - `src/app/login/page.tsx`
  - `src/components/LoginPageClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - Visit `/t/meldrumclark/...`, sign out, then open `/login`.
  - Sign in locally with `ezra / Welcome1`.
  - Confirm the login succeeds and returns into the `meldrumclark` family context.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the server/client split for `/login` and restore the prior fixed-tenant login page.
- `Design Decision Change`: No design decision change.

## 2026-03-16 (manage user immediate password feedback)

- `Date`: 2026-03-16
- `Change`: The Manage User modal now gives immediate inline feedback for `Update User` and `Update Password` by switching the active button labels to pending states, disabling duplicate clicks while the request runs, and showing the status banner in the modal as a clear success/error indicator instead of quiet subtitle text.
- `Type`: UI
- `Why`: Root cause was a `code issue`. The password update request already wrote status text, but the active button never changed state and the modal banner rendered non-error messages with low-emphasis subtitle styling, so admins could not tell whether the action had started or completed.
- `Files`:
  - `src/components/SettingsClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - Open `Admin -> Users & Access -> Manage User`.
  - Enter a password and click `Update Password`.
  - Confirm the button changes to `Updating...`, the button is temporarily disabled, and the modal shows `Updating password...` followed by `Password updated.` or a visible error.
  - Repeat with `Update User` and confirm the button changes to `Saving...` and the modal shows `Saving user changes...` followed by `User updated.` or a visible error.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the pending-action state and button/status-message emphasis changes in `SettingsClient`.
- `Design Decision Change`: No design decision change.

## 2026-03-16 (atomic local-user update for password changes)

- `Date`: 2026-03-16
- `Change`: Reworked the Manage User local-account save path so existing local users are updated through one server-side `update_user` action instead of a chained rename/role/enabled/password sequence, and aligned that path to use the local-role state.
- `Type`: UI | API
- `Why`: Root cause was a `code issue`. The Manage User screen was issuing multiple local-user PATCH requests with admin-data reloads between them, which allowed partial success states where a username rename persisted but the password reset did not. The same handler also pulled the Google `role` state instead of `localRole` for existing local-user updates.
- `Files`:
  - `src/components/SettingsClient.tsx`
  - `src/app/api/t/[tenantKey]/local-users/[username]/route.ts`
- `Data Changes`: None.
- `Verify`:
  - Open `Admin -> Users & Access -> Manage User` for an existing local user.
  - Change the username and password in one save.
  - Confirm the UI reports success once, the local username updates, and the new password works for login in the correct family group.
  - Repeat with only a password change through `Update Password` and confirm the new password works.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the `update_user` action in the local-user route and restore the prior multi-request local-user update flow in `SettingsClient`.
- `Design Decision Change`: No design decision change.

## 2026-03-14 (photo editor save and close)

- `Date`: 2026-03-14
- `Change`: The person photo-detail editor now labels the primary action `Save and Close` and closes the photo editor after a successful save instead of leaving the detail panel open.
- `Type`: UI
- `Why`: Root cause was a `code issue`. The photo-detail save path updated metadata and refreshed the person state, but it never closed the photo detail shell, while the sticky action bar still advertised `Save Changes`, which did not match the actual desired workflow.
- `Files`:
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Open a person photo from `Pictures`.
  - Edit metadata and click `Save and Close`.
  - The save succeeds and the photo detail editor closes back to the person’s picture list.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the photo-detail save/close behavior and sticky-bar label change in `PersonEditModal`.
- `Design Decision Change`: No design decision change.

## 2026-03-14 (person photo attach sets primary profile photo)

- `Date`: 2026-03-14
- `Change`: Adding a photo from a person’s own `Pictures` tab now marks that photo as the current person’s primary/profile photo so it shows in the person header and people/profile views immediately instead of only existing as a gallery item.
- `Type`: UI
- `Why`: Root cause was a `code issue`. The person media attach flow in `MediaAttachWizard` and `attach-orchestrator` ignored the existing `defaultIsPrimary` concept and hardcoded person uploads/links as non-primary (`isHeadshot: false`, `isPrimary: false`), so adding a photo from a person’s profile often left `People.photo_file_id` unchanged.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/lib/media/attach-orchestrator.ts`
  - `src/lib/media/attach-contracts.ts`
- `Data Changes`: None.
- `Verify`:
  - Open a person, go to `Pictures`, and add a photo from that person’s own profile.
  - After save, the person header/profile image updates to the new photo.
  - Existing cross-person or household media links remain non-primary unless explicitly edited later.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the person `Pictures` wizard primary-photo defaults in `PersonEditModal`, `attach-orchestrator`, and `attach-contracts`.
- `Design Decision Change`: No design decision change.

## 2026-03-14 (add user inline password validation)

- `Date`: 2026-03-14
- `Change`: The `Add User` modal now validates required local-user fields before submit and shows missing-password or API validation errors directly inside the modal instead of only in the page-level status area behind it.
- `Type`: UI
- `Why`: Root cause was a `code issue`. `Add User` always posts to the local-user create API, which requires a password, but the modal did not validate that requirement first and only wrote the resulting `400` status to the shared `localUserStatus` message rendered at the bottom of the underlying Settings page.
- `Files`:
  - `src/components/SettingsClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - Open `Admin -> Users & Access -> Add User`.
  - Leave `Temporary Password` blank and click `Create User`.
  - The modal stays open and shows `Temporary Password is required.` inside the modal itself.
  - If the API rejects the create payload, the modal shows a readable inline message instead of a raw hidden `400`.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the `SettingsClient` Add User modal validation and inline-status rendering changes.
- `Design Decision Change`: No design decision change.

## 2026-03-13 (header compact family selector + person quick contact actions)

- `Date`: 2026-03-13
- `Change`: Compacted the app header by moving the family selector into the main top row between the title and user menu, removed the extra visible `Family Group` label row, tightened header spacing, and added compact `Call`, `Text`, and `Email` action chips to the person modal header when contact details exist.
- `Type`: UI
- `Why`: Root cause was a `code issue`. The header height was inflated by a separate desktop-only family-group meta row with an external label, and the person modal already had phone/email data available but forced contact actions to live farther down in the form instead of offering quick access in the header.
- `Files`:
  - `src/components/AppHeader.tsx`
  - `src/components/PersonEditModal.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - The app header shows the family selector inline between the title and the user menu without a separate `Family Group` label row.
  - On mobile, the inline family selector remains usable without wrapping the header into a tall multi-row block.
  - Opening a person shows compact `Call`, `Text`, and/or `Email` actions in the modal header when those contact methods exist.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the `AppHeader`, `PersonEditModal`, and header/person-header CSS changes.
- `Design Decision Change`: No design decision change.

## 2026-03-13 (household add-child defaults + visible validation + spouse dialog spacing)

- `Date`: 2026-03-13
- `Change`: Household `Add Child` now defaults the child last name from the household father name, shows missing-field and API validation errors directly inside the Add Child card, and the inline Add Spouse dialog now adds top spacing/gap so the `First Name` field is no longer visually crowded under the heading.
- `Type`: UI
- `Why`: Root cause was a `code issue`. The Add Child form reset the last name to blank every time and wrote validation errors into the modal-level status line at the bottom of the household panel, which made missing-field feedback easy to miss. The Add Spouse dialog also used a tight fixed card layout with a pulled-up subtitle, which crowded the first field under the heading.
- `Files`:
  - `src/components/HouseholdEditModal.tsx`
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Opening `Add Child` prefills the `Last Name` with the household father last name when available.
  - Saving `Add Child` with missing required fields shows a visible in-card message listing the missing fields.
  - Server-side Add Child validation failures also remain visible in the Add Child card instead of only at the bottom of the household modal.
  - Opening `+ Add Person` in the spouse flow shows the `First Name` field clearly below the heading/subtitle.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the `HouseholdEditModal` and `PersonEditModal` form-layout/status changes.
- `Design Decision Change`: No design decision change.

## 2026-03-13 (invite local membership upsert no longer collides with google row)

- `Date`: 2026-03-13
- `Change`: Fixed invite/local family-access provisioning so it updates only the matching local or Google `UserFamilyGroups` row for a person instead of trying to rewrite both auth rows onto the same `(user_email, family_group_key)` key.
- `Type`: API
- `Why`: Root cause was a `code issue`. The OCI family-access upsert matched `user_family_groups` rows only by `person_id` and `family_group_key`. For people who correctly have both a Google row and a local `@local` row in the same family group, a local invite/save tried to update both rows to the local alias, which triggered Oracle `ORA-00001` on `PK_USER_FAMILY_GROUPS`.
- `Files`:
  - `src/lib/oci/tables.ts`
- `Data Changes`: None.
- `Verify`:
  - Creating or sending an invite for a person who already has both Google and local access no longer fails with `ORA-00001` on `USER_FAMILY_GROUPS`.
  - Rollback-safe OCI checks for `Stephen Estes` in `snowestes` show the local row update affects `1` row and the Google row update affects `1` row, with no uniqueness violation.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the `src/lib/oci/tables.ts` upsert changes to restore the old person-only match behavior.
- `Design Decision Change`: No design decision change.

## 2026-03-13 (home birthday chip age copy + default range)

- `Date`: 2026-03-13
- `Change`: Updated the Home `Birthdays` chip age copy from `Age X` to `Turning X`, and changed the default birthday range from `Today` to `This Month`.
- `Type`: UI
- `Why`: Root cause was a `code issue`. The Home birthdays card reused a generic age label even though the section is explicitly about upcoming birthdays, and the initial range defaulted to `Today`, which hid most upcoming birthdays until the user changed filters manually.
- `Files`:
  - `src/components/home/BirthdaysSection.tsx`
- `Data Changes`: None.
- `Verify`:
  - Home -> `Birthdays` opens with `This Month` selected by default.
  - In Home -> `Birthdays`, people younger than 30 show `Turning X` instead of `Age X`.
  - People 30 and older still omit the age chip.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the `BirthdaysSection.tsx` copy change to restore the old age wording.
- `Design Decision Change`: No design decision change.

## 2026-03-13 (tree focus panel no longer blocks route commit)

- `Date`: 2026-03-13
- `Change`: Stabilized Family Tree focus recentering so top-level navigation can complete immediately even while the tree focus panel is open.
- `Type`: UI
- `Why`: Root cause was a `code issue`. `TreeGraph` rebuilt `focusPanelData` as a new object on every render, `focusToBounds` depended on that unstable object, and the focus-centering effects kept reapplying the same viewport state while the panel was open. Header navigation clicks started the Home route fetch successfully, but the route transition did not commit until closing the focus panel stopped that recenter loop.
- `Files`:
  - `src/components/TreeGraph.tsx`
- `Data Changes`: None.
- `Verify`:
  - Open Family Tree and open the focus panel.
  - Click a top-level navigation item like `Home`.
  - The app should navigate immediately without requiring the focus-panel `X`.
  - Family Tree focus centering should still work when selecting people and households.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the `TreeGraph.tsx` change to restore the prior focus-centering behavior.
- `Design Decision Change`: No design decision change.

## 2026-03-13 (tree mobile bottom navigator + responsive focus spacing)

- `Date`: 2026-03-13
- `Change`: Reworked the Family Tree mobile layout so the focus navigator docks at the bottom instead of covering the upper graph, moved the mobile tree search/control overlays out of the same vertical band, and changed focus centering to reserve space for the mobile overlays while keeping the selected person/household centered and large.
- `Type`: UI
- `Why`: Root cause was a `code issue`. The tree container still used a desktop-shaped viewport (`16 / 9` aspect ratio) on phones, the focus panel still rendered as a top overlay, and mobile focus centering did not reserve any space for that overlay. That made the navigator cover too much of the graph and kept the selected branch framed as if the full card height were still usable.
- `Files`:
  - `src/components/TreeGraph.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - On mobile widths, the Family Tree container is taller and no longer feels landscape-locked.
  - When the tree navigator is visible, it docks at the bottom of the tree instead of the top.
  - Tree search and zoom/fit controls no longer overlap the bottom navigator on mobile.
  - The selected person or household remains centered and relatively large even with the mobile navigator open.
  - Top-level app navigation remains reachable while the tree navigator is open on mobile.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the `TreeGraph.tsx` and `globals.css` changes together so the viewport math and mobile overlay placement stay aligned.
- `Design Decision Change`: No design decision change.

## 2026-03-13 (local login tenant access expansion)

- `Date`: 2026-03-13
- `Change`: Fixed local username/password sign-in so the session token expands to all enabled family-group accesses for that person instead of only the family group used on the login form.
- `Type`: UI
- `Why`: Root cause was a `code issue`. The credentials auth path in `next-auth` returned early with `token.tenantAccesses` seeded only from the submitted login family group. Middleware then checked that incomplete token against routes like `/t/meldrumclark/...` and redirected to `missing_tenant_access`, even though the person's `UserFamilyGroups` rows were correct in OCI.
- `Files`:
  - `src/lib/auth/options.ts`
- `Data Changes`: None.
- `Verify`:
  - A user with local access to more than one family group can sign in with username/password and then open routes in any enabled family group without `missing_tenant_access`.
  - `/api/debug/tenant-access` after local sign-in shows all enabled family groups for that person, not just the login family group.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the `src/lib/auth/options.ts` change to restore the old one-family local-login session behavior.
- `Design Decision Change`: No design decision change.

## 2026-03-13 (AI Help local access troubleshooting note)

- `Date`: 2026-03-13
- `Change`: Added grounded AI Help guidance for the local-sign-in `missing tenant access` recovery path, including full sign-out/sign-in refresh and `/api/debug/tenant-access` as a session-access check.
- `Type`: UI
- `Why`: Root cause was a `code/content issue`. The AI Help guide described local sign-in and family-group switching, but it did not cover the real support case where a stale local session token is missing one of the person's valid family-group accesses. Without that note, Help could not reliably steer users to the correct recovery step.
- `Files`:
  - `src/lib/ai/help-guide.ts`
- `Data Changes`: None.
- `Verify`:
  - AI Help can explain that a local user seeing `missing tenant access` should sign out fully and sign in again to refresh local family-group access.
  - AI Help can mention `/api/debug/tenant-access` as the session-level access check.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the `src/lib/ai/help-guide.ts` change to remove the added troubleshooting guidance.
- `Design Decision Change`: No design decision change.

## 2026-03-13 (home birthdays across accessible families + return-to-home person close)

- `Date`: 2026-03-13
- `Change`: Home birthdays now aggregate people across all family groups the signed-in user can access, while preferring the currently selected family-group route when available, and person profiles opened from Home now close back to the source route instead of always returning to People.
- `Type`: UI
- `Why`: Root cause was a `code issue`. Both Home pages loaded birthdays only from `getPeople(activeTenantKey)`, so the birthday section was limited to one family group. Separately, birthday chips opened the person route without any source context, and `PersonProfileRouteClient` always closed back to `peopleHref`, which forced Home-opened profiles back to the People screen.
- `Files`:
  - `src/lib/home/birthdays.ts`
  - `src/app/page.tsx`
  - `src/app/t/[tenantKey]/page.tsx`
  - `src/components/home/BirthdaysSection.tsx`
  - `src/components/PersonProfileRouteClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - Home birthdays include people from all family groups the current user can access, without duplicate chips for the same `person_id`.
  - Clicking a birthday chip prefers the currently selected family-group route when that person exists there.
  - Closing a person profile opened from Home returns to Home instead of the People screen.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the Home birthday loader, birthday-chip link, and person-profile return-path changes together so Home navigation and person close behavior stay aligned.
- `Design Decision Change`: No design decision change.

## 2026-03-13 (calendar family-group filters)

- `Date`: 2026-03-13
- `Change`: Added family-group filters at the top of Calendar so the user can switch between the current family group, any other accessible family group, or `All Families`, while keeping birthday person links on the currently selected family-group route when that person exists there.
- `Type`: UI
- `Why`: Root cause was a `code issue`. Calendar loaded birthday people only from the active family group, so there was nothing to filter. The client also had no family-group metadata for each birthday person, which prevented switching between one family and all accessible families without reworking the load shape.
- `Files`:
  - `src/lib/home/birthdays.ts`
  - `src/components/calendar/CalendarPageClient.tsx`
  - `src/app/today/page.tsx`
  - `src/app/t/[tenantKey]/today/page.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - Calendar shows family-group filter chips above the month controls.
  - The filters allow the user to view one accessible family group at a time or `All Families`.
  - Birthday chips in Calendar still open under the selected family-group route when the person belongs to that family, and otherwise fall back to a valid linked family route.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the shared birthday loader, calendar client, and calendar page changes together so filter options and birthday-link routing stay aligned.
- `Design Decision Change`: No design decision change.

## 2026-03-13 (home birthdays + calendar shell + tree navigator polish)

- `Date`: 2026-03-13
- `Change`: Removed the old Home horoscope card, added a Birthday section with `Today` / `This week` / `This Month` selectors and clickable birthday chips, renamed `Today` navigation/tile labels to `Calendar`, replaced the placeholder Today pages with an in-progress month calendar shell (month arrows + year selector), removed the tree navigator `Current` chip, kept `Parents / Spouse / Siblings / Children` on one row, and made the full household cluster area clickable in the tree.
- `Type`: UI
- `Why`: Root cause was a `code issue`. Home and Today were still wired to older placeholder surfaces (`HoroscopeCard` and Today placeholder text) instead of the newer birthday/calendar workflow, while the tree focus panel still exposed an extra `Current` action and only the household rect itself handled clicks. That left the requested Home/Calendar experience missing and made the household interaction feel smaller than the visual household target.
- `Files`:
  - `src/components/home/BirthdaysSection.tsx`
  - `src/components/calendar/CalendarPageClient.tsx`
  - `src/components/familyTree/FocusPanel.tsx`
  - `src/components/TreeGraph.tsx`
  - `src/components/HeaderNav.tsx`
  - `src/app/page.tsx`
  - `src/app/today/page.tsx`
  - `src/app/t/[tenantKey]/page.tsx`
  - `src/app/t/[tenantKey]/today/page.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - Home no longer shows the horoscope card.
  - Home shows a `Birthdays` section with range selectors and clickable birthday chips that open the person detail route.
  - Header navigation shows `Calendar` immediately after `Home`.
  - `/today` and `/t/[tenantKey]/today` both show `Calendar`, an `in progress` badge, month arrows, and a year selector.
  - Tree navigator no longer shows `Current`, and the four remaining actions stay on one row.
  - Clicking anywhere on a visible household cluster/label in the tree focuses that household.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the Home/Calendar/tree UI changes together so the navigation labels, home tiles, and shared birthday/calendar components stay aligned.
- `Design Decision Change`: No design decision change.

## 2026-03-13 (calendar birthday chips + welcome title + tree/header hit targets)

- `Date`: 2026-03-13
- `Change`: Personalized the Home title to `Welcome, {nickname/first name}`, added clickable birthday chips inside Calendar day cells with name plus age when under 30, and hardened the Family Tree/header layering so the sticky top navigation stays clickable while tree focus navigation is open.
- `Type`: UI
- `Why`: Root cause was a `code issue`. The Home screen still used a generic title instead of the logged-in person record, the Calendar shell showed empty day cells even when family birthdays were known, and the tree used transformed overlay layers without isolating its stacking context from the sticky header. That made the top nav unreliable while the tree focus overlay was visible on some layouts.
- `Files`:
  - `src/components/calendar/CalendarPageClient.tsx`
  - `src/app/page.tsx`
  - `src/app/t/[tenantKey]/page.tsx`
  - `src/app/today/page.tsx`
  - `src/app/t/[tenantKey]/today/page.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - Home title reads `Welcome, {nickname}` when the logged-in person has a nickname, otherwise falls back to first name.
  - Calendar day cells now show clickable birthday chips for matching dates, with age shown only when the person is under 30.
  - Clicking a birthday chip opens that person’s detail route.
  - Tree top navigation remains clickable while the tree focus navigator is visible.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the Calendar/Home/globals changes together so the shared Calendar props, Home greeting, and tree/header layering stay aligned.
- `Design Decision Change`: No design decision change.

## 2026-03-13 (tree focus navigator compact redesign)

- `Date`: 2026-03-13
- `Change`: Reworked the Family Tree focus navigator into a compact chip-based panel, made `Parents` jump directly to the parent branch, made `Siblings` expand the graph to the sibling view with per-sibling chips, added an in-graph person search card at the lower left, and shifted focus centering left to leave room for the navigator.
- `Type`: UI
- `Why`: Root cause was a `code issue`. The existing tree focus panel was a large tabbed side sheet that only changed list filters inside the panel; it did not treat the panel controls as graph navigation, so `Parents`/`Siblings` required extra clicks and the selected branch still centered for the full viewport instead of the usable space beside the panel. The tree also had no in-graph search overlay, so navigation depended too heavily on the oversized panel and repeated panning.
- `Files`:
  - `src/components/TreeGraph.tsx`
  - `src/components/familyTree/FocusPanel.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - Clicking `Parents` in the tree navigator recenters directly on the parent branch or parent household.
  - Clicking `Siblings` pans out to show the sibling view and shows sibling chips; clicking a sibling chip focuses that sibling.
  - The focus panel header is compact with avatar, name, and birthday/household label instead of the large summary block.
  - Tree search appears inside the graph at the lower left and focuses the selected person.
  - Focused branches now sit left of center on desktop so the navigator no longer covers the selected branch.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the tree navigator UI/CSS changes together so the focus behavior and overlay styling stay aligned.
- `Design Decision Change`: No design decision change.

## 2026-03-13 (tree selection anchor scaling + mobile focus panel)

- `Date`: 2026-03-13
- `Change`: Updated Family Tree focus scaling so the selected person or household stays centered and visually large even when the surrounding branch is wider, and made the compact focus panel fully responsive on mobile by letting it span the available width and scroll its chip area.
- `Type`: UI
- `Why`: Root cause was a `code issue`. The focus viewport logic still fit and centered on the entire emphasized branch, so the selected person/household shrank whenever siblings, spouses, or children widened the branch bounds. The compact focus panel also still behaved like a fixed-width desktop card on mobile, which made its layout less responsive than intended.
- `Files`:
  - `src/components/TreeGraph.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - Selecting a person or household keeps that selected target centered and relatively large even when related branches are also emphasized.
  - Sibling/children context can extend beyond the immediate viewport without shrinking the selected target to tiny cards.
  - On mobile widths, the focus panel stretches across the available width and remains usable with scrolling chips.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the viewport anchor-scaling and responsive CSS changes together so focus behavior stays consistent.
- `Design Decision Change`: No design decision change.

## 2026-03-13 (tree interaction capture fix + selection-aware child spacing)

- `Date`: 2026-03-13
- `Change`: Fixed tree pointer handling so the top app navigation remains usable while the tree navigator is open, added selection-aware child spacing that compacts children under the selected household and expands spacing around a selected child within the sibling row, and animated node/household/connector movement so internal layout changes move together instead of snapping.
- `Type`: UI
- `Why`: Root cause was a `code issue`. The tree surface started pointer capture too broadly, which could leave interaction stuck on the graph instead of allowing normal page navigation. Separately, child-row spacing still used one static layout regardless of selection, so the selected child branch was not visually prioritized and layout changes appeared abrupt.
- `Files`:
  - `src/components/TreeGraph.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - Top app navigation remains clickable while the tree navigator is visible.
  - Selecting a parent household keeps that household’s children centered tightly beneath it.
  - Selecting a child expands spacing around that child within the sibling row while keeping that child’s own branch clearer below.
  - Internal child/household layout changes animate instead of snapping abruptly.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the tree interaction/layout/CSS changes together so pointer behavior and animated spacing stay aligned.
- `Design Decision Change`: No design decision change.

## 2026-03-13 (household add-child 500 repair + SnowEstes child membership cleanup)

- `Date`: 2026-03-13
- `Change`: Fixed Household -> Children -> Add Child so it no longer attempts to create `UserFamilyGroups` rows for children who do not yet have login access, and repaired the partially created SnowEstes child memberships that were left `undeclared` after that server-side failure.
- `Type`: API | Data
- `Why`: Root cause was a `mixed issue`. The child-create route correctly inserted the child `People` row, parent `Relationships`, and `PersonFamilyGroups` membership, but then tried to clone parent `UserFamilyGroups` access for the child using `user_email: \"\"`. Oracle treats the blank string as `NULL`, and `USER_FAMILY_GROUPS.USER_EMAIL` is `NOT NULL`, so the route failed with `500` after the earlier writes had already succeeded. That is why the Add Child panel stayed open even though the child row and parent relationship were already present.
- `Files`:
  - `src/app/api/t/[tenantKey]/households/[householdId]/children/route.ts`
- `Data Changes`: Repaired 4 SnowEstes child membership rows (`Annie Pickett`, `Brooke Estes Miller`, `Lindsey Estes`, `Mandy Bird`) from `family_group_relationship_type = undeclared` to `direct` after confirming each had a direct parent in `snowestes`. No schema change.
- `Verify`:
  - Before repair, SnowEstes had 4 enabled child memberships stuck at `undeclared` despite having direct parents; after the targeted repair query, that list is empty.
  - `Annie Pickett` remains present as the created child row and now has `PersonFamilyGroups.family_group_relationship_type = direct` in `snowestes`.
  - New child saves no longer attempt to insert `UserFamilyGroups` rows for non-login children.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the child-create route change. If rolling back the code after deploy, do not revert the corrected SnowEstes membership data.
- `Design Decision Change`: No design decision change.

## 2026-03-12 (household add-child maiden name + clear missing-field validation)

- `Date`: 2026-03-12
- `Change`: Updated Household -> Children -> Add Child so the maiden-name field appears only for female children older than 19, successful child saves close the add-child form and refresh the child list, and missing-field/save failures show clear messages instead of raw JSON payloads.
- `Type`: UI | API
- `Why`: Root cause was a `code issue`. The add-child form in `HouseholdEditModal` had no maiden-name state or UI gating even though the People model already supported `maiden_name`, and the child-create route ignored that field entirely. Separately, the UI only pre-checked birthdate and gender, then fell back to `JSON.stringify(body)` on save failure, which made missing-field errors hard to understand.
- `Files`:
  - `src/components/HouseholdEditModal.tsx`
  - `src/app/api/t/[tenantKey]/households/[householdId]/children/route.ts`
- `Data Changes`: None.
- `Verify`:
  - In Household -> Children -> Add Child, selecting `Female` with a birthdate older than 19 shows `Maiden Name (optional)`; male children and younger female children do not show it.
  - Saving a valid child closes the add-child card and refreshes the visible children list.
  - Missing required fields now show a clear message such as `Cannot save child. Missing: First Name, Last Name, Birthdate, Gender.`
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the child-form UI changes and child-create route update together so the add-child modal and backend schema stay aligned.
- `Design Decision Change`: No design decision change.

## 2026-03-12 (focused branch default + collapsed tree navigation)

- `Date`: 2026-03-12
- `Change`: Changed Family Tree focus mode from dim-only to a true focused-branch view: the tree now opens focused on a default branch, renders only the selected branch instead of the entire faded graph, and adds a side focus panel for parents, spouse, siblings, and children navigation plus collapsed-branch counts.
- `Type`: UI
- `Why`: Root cause was a `code issue`. The existing tree focus model only lowered opacity on unrelated households, lines, and people, but it still rendered the full graph at full layout width. That meant the tree stayed too wide and visually dense even after selecting a person or household. The existing `FocusPanel` component was also present in the repo but not wired into `TreeGraph`, so there was no lightweight way to move through nearby relatives without reopening the full panoramic tree.
- `Files`:
  - `src/components/TreeGraph.tsx`
  - `src/components/familyTree/FocusPanel.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - Opening the Family Tree now starts in a focused branch view instead of the full-width panoramic tree.
  - When a person or household is focused, unrelated branches are not rendered; the selected branch fills most of the graph area.
  - The focus panel shows parents, spouse, siblings, and children and recentering on one of those relatives updates the focused branch.
  - `Show Full Tree` is still available through the clear-focus control.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the `TreeGraph`, `FocusPanel`, and focus-panel CSS changes together so the tree returns to the prior dim-only soft-focus behavior.
- `Design Decision Change`: No design decision change.

## 2026-03-12 (allow same-person local re-invites + move invite status into modal)

- `Date`: 2026-03-12
- `Change`: Allowed Admin -> Manage User -> Invite to create/send a fresh invite for a person who already has local sign-in by reusing that existing local username instead of treating it as a conflict, and moved invite status/error messaging into the active invite panel so failures are visible where the action happens.
- `Type`: UI | API
- `Why`: Root cause was a `code issue`. The invite creation path called `ensureLocalUsernameAvailable(...)`, and that helper threw even when the matching local username already belonged to the same person, so admins could not resend local-capable invites to existing local users like Catherine Peterson. Separately, the invite flow wrote status to `inviteStatus`, but that status only rendered on the underlying Settings page, which made handled errors appear behind the active Manage User modal.
- `Files`:
  - `src/lib/invite/store.ts`
  - `src/components/SettingsClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - In `Admin -> Users & Access -> Manage User -> Invite`, creating or sending an invite for Catherine Peterson no longer fails with `This person already has local sign-in...`.
  - The invite reuses Catherine's current local username instead of renaming it from the invite screen.
  - Invite failures/status updates now render inside the active Invite tab instead of only on the page behind the modal.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the invite local-username resolution change and the invite-tab status rendering together; otherwise the server/UI behavior will diverge again.
- `Design Decision Change`: No design decision change.

## 2026-03-12 (fix local-user lookup predicate + ignore local access aliases for Google access)

- `Date`: 2026-03-12
- `Change`: Fixed the OCI tenant-local-user query so usernames are no longer filtered out by an Oracle-empty-string comparison, and stopped surfacing `@local` family-link aliases as Google/user-access emails in the admin access snapshot/runtime list.
- `Type`: API
- `Why`: Root cause was a `code issue`. The tenant-local-user query used `TRIM(NVL(u.username, '')) <> ''`, but Oracle treats `''` as `NULL`, so that predicate filtered out valid local users and caused rename/reset flows to report `Local user not found.` even when the `UserAccess` row existed. Separately, local-only users carried `UserFamilyGroups.user_email = <person_id>@local`, and admin access shaping treated that placeholder as a real Google/user-access email, causing the Manage User flow to post an invalid email to `/user-access`.
- `Files`:
  - `src/lib/oci/tables.ts`
  - `src/app/api/t/[tenantKey]/admin-snapshot/route.ts`
- `Data Changes`: None.
- `Verify`:
  - The corrected SnowEstes local-user SQL returns `6` rows, including `Catherine Peterson (p-44b30ff9)`, where the broken predicate returned `0`.
  - Renaming Catherine's local username no longer fails with `rename_failed: Local user not found.`
  - Manage User no longer treats `p-44b30ff9@local` as a Google access email or posts it to `/user-access`.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the tenant-local-user predicate change and the `@local` email filtering together; otherwise rename/reset flows and admin Google-access behavior will diverge again.
- `Design Decision Change`: No design decision change.

## 2026-03-12 (decode local-user route usernames)

- `Date`: 2026-03-12
- `Change`: Decoded the `[username]` route parameter in local-user PATCH/DELETE handlers before lookup, rename, password reset, role update, enable/disable, and delete operations.
- `Type`: API
- `Why`: Root cause was a `code issue`. Existing local-user API routes used the raw path segment value for usernames, so usernames containing spaces could arrive percent-encoded (for example `catherine%20peterson`) and fail lookup in `getLocalUserByUsername` / `renameLocalUser`, producing `rename_failed: Local user not found.` even though the `UserAccess` row existed and direct OCI updates matched by `person_id`.
- `Files`:
  - `src/app/api/t/[tenantKey]/local-users/[username]/route.ts`
- `Data Changes`: None.
- `Verify`:
  - In Manage User for Catherine Peterson, renaming the local username from `catherine peterson` to `cathy` succeeds instead of returning `rename_failed`.
  - Existing usernames containing spaces can be renamed, password-reset, enabled/disabled, or deleted through the same route path.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the route-username decoding helper and the PATCH/DELETE handler substitutions together so all local-user actions keep using the raw route param behavior.
- `Design Decision Change`: No design decision change.

## 2026-03-12 (tree parent centering + user-family dedupe + local password apply)

- `Date`: 2026-03-12
- `Change`: Centered parent households over their child block in Family Tree, taught integrity repair to remove duplicate `UserFamilyGroups` rows per person/family, repaired the live duplicate SnowEstes Brent link in OCI, and made Manage User -> Update User apply an entered local password for existing local users instead of ignoring it.
- `Type`: UI | API | Data
- `Why`: Root cause was a `mixed issue`. The tree layout only nudged children under parents and never ran the inverse centering pass for parent households. SnowEstes had one real duplicate `UserFamilyGroups` row for Brent Estes (`p-c0efc168`), and the integrity repair path reported that condition but did not remediate it. Separately, the Manage User screen accepted a local password while updating an existing local user, but the `Update User` action only renamed/enabled/updated role and never sent `reset_password`, so password entry in that flow had no effect.
- `Files`:
  - `src/components/TreeGraph.tsx`
  - `src/app/api/t/[tenantKey]/integrity/route.ts`
  - `src/components/SettingsClient.tsx`
- `Data Changes`: Deleted the stale SnowEstes `UserFamilyGroups` row for `Brent Estes (p-c0efc168)` with `user_email = brenton.estes.TEMP@TEMP.org`, leaving the active `brent.estes@gmail.com` link as the single family-scoped access row.
- `Verify`:
  - In Family Tree, parent households sit centered over their final child block instead of children merely centering under the previous parent position.
  - Running integrity check/repair in `snowestes` no longer reports duplicate `UserFamilyGroups` for Brent, and future duplicate-person/family links are repairable by the integrity repair route.
  - In Manage User for an existing local user such as Catherine Peterson, changing the username and entering a new password through `Update User` applies both changes in one pass.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the tree centering pass, the integrity duplicate-link repair addition, and the Manage User password-apply change together; if you also want to restore the previous SnowEstes duplicate warning, reinsert only Brent's deleted stale `UserFamilyGroups` row.
- `Design Decision Change`: No design decision change.

## 2026-03-12 (invite defaults follow current access)

- `Date`: 2026-03-12
- `Change`: Updated the Manage User -> Invite defaults so sign-in path follows the selected person’s enabled access setup (`local`, `google`, or `either`), and local username / invite email are recalculated from the selected person instead of stale modal state.
- `Type`: UI
- `Why`: Root cause was a `code issue` in `SettingsClient`: the invite modal initialized `inviteAuthMode` to `google` once and never re-derived it from the selected person’s current access rows, while invite email/local-username state could remain from a previous person or default. That made local-only users like Catherine Peterson open with `Google only` and the wrong suggested local username.
- `Files`:
  - `src/components/SettingsClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - Open Manage User -> Invite for a local-only user with no enabled Google access; `Sign-In Path` defaults to `Local only`.
  - Open Manage User -> Invite for a user with enabled Google and local access; `Sign-In Path` defaults to `Google or Local`.
  - Open Catherine Peterson; `Invite Email` falls back to `People.email` when present and `Suggested Local Username` reflects Catherine’s current local username or a Catherine-based suggestion, not a prior person’s username.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the invite-default helper/state changes in `SettingsClient` together so the modal does not partially keep the new invite-email fallback without the matching auth-mode/local-username reset behavior.
- `Design Decision Change`: No design decision change.

## 2026-03-12 (local-only user family-link repair + invite email fallback)

- `Date`: 2026-03-12
- `Change`: Fixed local-only Add User so it now creates the matching family-scoped `UserFamilyGroups` link, repaired the two affected `snowestes` rows in OCI, and changed the Invite form to fall back to `People.email` when the person has no existing Google access email.
- `Type`: UI | API | Data
- `Why`: Root cause was a `mixed issue`. The Add User local-only path wrote `UserAccess` but skipped `UserFamilyGroups`, while the Users & Access directory is built from family-scoped access rows. That left valid local-only users invisible in the directory. Separately, the invite form only prefilled from existing Google access and ignored a person's profile email when no Google access row existed.
- `Files`:
  - `src/app/api/t/[tenantKey]/local-users/route.ts`
  - `src/app/api/t/[tenantKey]/admin-snapshot/route.ts`
  - `src/app/t/[tenantKey]/settings/page.tsx`
  - `src/components/SettingsClient.tsx`
- `Data Changes`: Repaired missing `UserFamilyGroups` rows for `Catherine Peterson (p-44b30ff9)` and `Lydia Lundquist (p-77e5a587)` in `snowestes`, using stable local-only `user_email` aliases (`<person_id>@local`) and the current family config name.
- `Verify`:
  - In `snowestes`, Catherine Peterson and Lydia Lundquist now appear in Admin -> Users & Access -> User Directory.
  - Creating a local-only user from Add User now produces both `UserAccess` and `UserFamilyGroups` rows for the selected family group.
  - In Manage User -> Invite, if no Google access email exists, the Invite Email field defaults to the person's `People.email` value when present.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert the local-user route, admin snapshot/settings payload changes, and manually remove only the repaired `UserFamilyGroups` rows if you intentionally want to restore the broken state.
- `Design Decision Change`: No design decision change.

## 2026-03-12 (direct Gmail invite sending)

- `Date`: 2026-03-12
- `Change`: Added optional direct invite email sending through Gmail OAuth while preserving the existing copy/share invite flow.
- `Type`: UI | API | Infra
- `Why`: Root cause was a `code gap`: the app already created person-bound invites, URLs, and full invite messages, but the route/UI stopped at manual copy/share and had no outbound mail transport. The minimal safe fix was to reuse the existing invite payload and add an optional send step instead of replacing the invite workflow.
- `Files`:
  - `src/lib/env.ts`
  - `src/lib/google/gmail.ts`
  - `src/lib/invite/types.ts`
  - `src/app/api/t/[tenantKey]/invites/route.ts`
  - `src/components/SettingsClient.tsx`
  - `src/lib/ai/help-guide.ts`
- `Data Changes`: None.
- `Verify`:
  - In Admin -> Users & Access -> User Directory -> Manage User -> Invite, `Create Invite` still returns a copyable link/message without attempting delivery.
  - `Create and Send Email` creates the invite record and sends the same generated invite message to the invited email when Gmail sender env vars are configured.
  - If Gmail delivery fails, the invite is still created, the copyable link/message is shown, and the UI reports that email delivery failed.
  - Audit log includes the invite creation event and a separate `SEND_EMAIL` success/failure event.
- `Rollback Notes`: Revert the Gmail helper, invite route/UI wiring, and help text together so the app returns cleanly to copy/share-only behavior.
- `Design Decision Change`: No design decision change.

## 2026-03-12 (tree soft focus mode)

- `Date`: 2026-03-12
- `Change`: Added a soft-focus mode to Family Tree. Clicking a household or person now fades unrelated branches, keeps close relatives at full opacity, and animates the graph to center/magnify the selected family block with the selected household/person near the top. A focused person/household opens on the second click, and a new clear-focus control restores the full-tree view.
- `Type`: UI
- `Why`: Root cause was a `code gap`: the tree already had pan/zoom/selection primitives, but no focus-state model tying selection to transform, opacity, and neighborhood emphasis. Without that shared focus state, the graph could only show the full tree or open edit modals, not guide attention to one family block.
- `Files`:
  - `src/components/TreeGraph.tsx`
  - `src/components/familyTree/PersonNodeCard.tsx`
  - `src/components/familyTree/GraphControls.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - Click a household cluster once: unrelated branches fade, the household and its children become the visual focus, and the graph animates that block into the main viewport.
  - Click a married person once: the graph focuses that person’s household and children rather than only the single node.
  - Click the same person/household again: the existing person or household edit modal opens.
  - Use the new clear-focus control to return to the full tree.
- `Rollback Notes`: Revert the tree focus UI changes together; do not keep the new click-selection contract without the matching opacity/transform behavior.
- `Design Decision Change`: No design decision change.

## 2026-03-12 (divorce flow + one-parent households)

- `Date`: 2026-03-12
- `Change`: Added a direct-family `Div` spouse action, changed divorce/save handling to convert or create a one-parent household for the direct family member, broadened household/tree/child/integrity flows to treat one-parent households as valid, and relabeled the Notes action to `Import Story with AI (testing)`.
- `Type`: UI | API | Data
- `Why`: Root cause was a `design + code` mismatch: the app modeled households as couple-only in core runtime paths, so a divorce flow that needed to preserve the direct family member's household would have deleted or broken household behavior. Leaving integrity and household-linked cleanup couple-only would also have reintroduced drift after a valid divorce.
- `Files`:
  - `src/app/api/t/[tenantKey]/relationships/builder/route.ts`
  - `src/app/api/t/[tenantKey]/households/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/children/route.ts`
  - `src/app/api/t/[tenantKey]/integrity/route.ts`
  - `src/app/api/t/[tenantKey]/import/csv/route.ts`
  - `src/components/PersonEditModal.tsx`
  - `src/components/HouseholdEditModal.tsx`
  - `src/components/PeopleDirectory.tsx`
  - `src/components/TreeGraph.tsx`
  - `src/lib/google/family.ts`
  - `src/lib/tree/load-tree-page-data.ts`
  - `src/lib/ai/help-guide.ts`
  - `docs/design-decisions.md`
  - `designchoices.md`
  - `docs/data-schema.md`
- `Data Changes`: No DDL/schema migration. Divorce now removes spouse/family edges, disables the removed spouse's family access in affected groups when they become undeclared there, clears household-synced marriage attributes for the former couple household, and preserves or creates the direct member's one-parent household.
- `Verify`:
  - In Person -> Family for a direct/founder member with a spouse, selecting `Div` and saving removes the spouse link, keeps a clickable household for the direct member, and still allows Household -> Children actions.
  - In Tree and People, one-parent households display a label and open the household editor on click.
  - Integrity repair no longer treats valid one-parent households as broken or deletes them during duplicate-merge/spouse-household repair paths.
  - CSV household import can generate a deterministic household ID when only one parent column is populated.
  - The Notes panel button/help text now reads `Import Story with AI (testing)`.
- `Rollback Notes`: Revert the runtime/docs changes together; do not leave the relationship-builder divorce path deployed without the one-parent household readers.
- `Design Decision Change`: Yes. `Households` are now a one-or-two-parent runtime model in the existing schema; see `docs/design-decisions.md`, `designchoices.md`, and `docs/data-schema.md`.

## 2026-03-11 (tree sibling blocks stay contiguous)

- `Date`: 2026-03-11
- `Change`: Family Tree now treats each parent household’s children as an uninterruptible sibling block, ordered by the direct parent household first and by child birth date within that block.
- `Type`: UI
- `Why`: Root cause was a `TreeGraph` layout bug: after computing child target slots, the row-packing pass sorted and placed child units individually. That preserved birth order within each household, but it still allowed adjacent sibling groups to interleave by midpoint, which is why Drake Peterson could land between Amy Estes and Eliza Estes in `snowestes`.
- `Files`:
  - `src/components/TreeGraph.tsx`
- `Data Changes`: None.
- `Verify`:
  - In `snowestes`, the Stephen/Elizabeth children render as one contiguous block and the Catherine/Venn children render as the next block, without interleaving.
  - Within each sibling block, children still render oldest to youngest.
  - Married child households stay attached to the correct sibling block rather than breaking the group apart.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.

## 2026-03-21 (story extraction controls + date row alignment + OCI local test helper)

- `Change`: Tightened story-extraction prompt controls to cap over-splitting, added date inference guidance for missing exact dates, aligned Step 2 Date/End Date fields onto one row in Story Workspace, and added local OCI config/test helper files under `lib/` for object storage connectivity diagnostics.
- `Type`: AI Prompt Quality, UX Layout Consistency, Developer Tooling
- `Why`: Root cause was inconsistent extraction granularity (too many fragments), missing date inference behavior when context exists, and a Step 2 layout request for date-field compactness; OCI helper files were needed to standardize repeatable local connectivity checks.
- `Files`:
  - `src/lib/ai/story-import.ts`
  - `src/components/PersonEditModal.tsx`
  - `src/components/SettingsClient.tsx`
  - `src/components/HouseholdEditModal.tsx`
  - `src/components/MediaLibraryClient.tsx`
  - `src/components/media/MediaAttachWizard.tsx`
  - `lib/ociConfig.ts`
  - `lib/ociTest.ts`
  - `TODO.md`
- `Data Changes`: No schema change.
- `Verify`:
  - `npm run build` passes.
  - `npx tsc --noEmit` passes.
  - Story Workspace Step 2 renders `Date` and `End Date` in the same row.
  - Story prompt now includes over-splitting limits and date-inference instructions.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.

## 2026-03-21 (photo intelligence phase 1 foundation)

- `Change`: Added a first-pass photo-intelligence workflow for image media with deterministic suggestion generation and review controls.
- `Type`: Media Metadata, API, UX
- `Why`: Root cause was no backend/photo-detail contract for generating, persisting, and applying photo caption/date suggestions. Media uploads and edits had no suggestion pipeline to review before save.
- `Files`:
  - `src/lib/media/photo-intelligence.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/intelligence/route.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/route.ts`
  - `src/lib/oci/tables.ts`
  - `src/components/MediaLibraryClient.tsx`
  - `TODO.md`
- `Data Changes`: No schema change.
- `Verify`:
  - `npm run build` passes.
  - `npx tsc --noEmit` passes.
  - Media editor now exposes `Generate Suggestions` for images.
  - Suggestions are persisted to media metadata and surfaced in the media editor with `Use Title`, `Use Description`, and `Use Date` actions.
  - Suggestions never auto-overwrite saved fields; users apply and then save.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.

## 2026-03-21 (photo intelligence switched to OCI Vision-first analysis)

- `Change`: Updated photo-intelligence generation to call OCI Vision (`analyzeImage`) against OCI-stored originals and feed returned labels/objects/faces into suggestion generation, with heuristic fallback retained when Vision is unavailable or fails.
- `Type`: OCI Integration, AI/Media Suggestions
- `Why`: Root cause was low-quality suggestion output from filename-only heuristics. The pipeline now uses actual image content signals before applying naming/date heuristics.
- `Files`:
  - `src/lib/oci/vision.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/intelligence/route.ts`
  - `src/lib/media/photo-intelligence.ts`
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: No schema change.
- `Verify`:
  - `npm run build` passes.
  - `npx tsc --noEmit` passes.
  - Image suggestion payload now includes Vision-derived labels/object names and face-count metadata when Vision succeeds.
  - UI suggestion panel displays Vision labels and face count.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.

## 2026-03-21 (vision troubleshooting visibility for photo suggestions)

- `Change`: Exposed OCI Vision troubleshooting details for photo suggestions in both API response and UI, including attempted/succeeded flags, error/status/service/request IDs, and raw Vision result payload.
- `Type`: Diagnostics, UX Debuggability
- `Why`: Root cause was inability to distinguish Vision success from fallback behavior when suggestion quality was weak. Users needed direct visibility into Vision response/error data to troubleshoot configuration/runtime issues.
- `Files`:
  - `src/app/api/t/[tenantKey]/photos/[fileId]/intelligence/route.ts`
  - `src/lib/media/photo-intelligence.ts`
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: No schema change.
- `Verify`:
  - `npm run build` passes.
  - `npx tsc --noEmit` passes.
  - Media editor now shows a `Vision Debug` expander with run status and raw Vision output/error metadata.
  - `POST /api/t/[tenantKey]/photos/[fileId]/intelligence` includes `debug` in response.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.

## 2026-03-14 (parent-based family-group access inheritance)

- `Change`: Added shared parent-based family-group access inheritance for new user provisioning. Local-user creation, Google access creation, and new family-group provisioning now derive additional family-group access from enabled parent access rows intersected with the child's enabled family memberships, while keeping `UserFamilyGroups` as the canonical persisted access model.
- `Type`: Feature, Access Control
- `Why`: Root cause was that the app only granted access for the selected family group or copied already-existing source-family access rows. That left children without the expected family-group access when their parents already had access to the related grandparent family groups.
- `Files`:
  - `src/lib/family-group/access-inheritance.ts`
  - `src/app/api/t/[tenantKey]/local-users/route.ts`
  - `src/app/api/t/[tenantKey]/user-access/route.ts`
  - `src/app/api/family-groups/provision/route.ts`
  - `docs/design-decisions.md`
  - `designchoices.md`
- `Data Changes`: No schema change. New access rows are written to existing `UserFamilyGroups`; inherited grants default to `USER` role unless an explicit access-copy flow already writes a more specific role.
- `Verify`:
  - Create a user for a child in one family group and confirm additional enabled `UserFamilyGroups` rows are created only for family groups where the child's parents already have enabled access and the child is already a member.
  - Create a new family group from an existing household and confirm imported child users inherit access to the new family group when their parents now have access there.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: Added 2026-03-14 access-inheritance decision documenting create/provision-time parent-based inheritance with persisted `UserFamilyGroups` rows.

## 2026-03-16 (invite login emphasis + visible/failing manage-user status)

- `Change`: De-emphasized Google in invite UX by making local the default invite path when local access exists, reordering `Sign-In Path` options to lead with local, changing invite copy to describe Google as optional, and making the public invite acceptance page lead with username/password when local is available. Also moved Manage User save feedback into the active modal and fixed the local-user PATCH API so username/password/role/enable updates now fail loudly when no local user row was actually updated.
- `Type`: UX, Bugfix
- `Why`: Root cause was split across two UI paths. The admin invite flow and the public invite page both presented Google first when both methods were available, which created confusion about the recommended sign-in path. Separately, `Update User` and `Update Password` wrote their status into shared page-level state that only rendered behind the active modal, and the local-user PATCH route returned success for several actions even when `patchLocalUser(...)` found no matching user and changed nothing.
- `Files`:
  - `src/components/SettingsClient.tsx`
  - `src/components/InviteAcceptClient.tsx`
  - `src/lib/invite/store.ts`
  - `src/app/api/t/[tenantKey]/local-users/[username]/route.ts`
- `Data Changes`: No schema or data change.
- `Verify`:
  - Open `Admin -> Users & Access -> Manage User -> Invite` for a user with both auth methods and confirm local is the default path, local options are listed first, and the explanatory copy leads with local sign-in.
  - Open an invite that allows both auth methods and confirm the local activation form appears before the Google option.
  - In `Manage User`, click `Update User` and `Update Password` and confirm success/failure messages appear inside the active modal instead of behind it.
  - Attempt a password or role update against a missing/stale local username and confirm the route returns a real failure (`Local user not found.`) instead of silent success.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-13 (death as event + memorial display)

- `Change`: Added death as a canonical person event, synchronized the person modal `To Date` field to that event, and updated Home, Calendar, and Tree to display memorial/lifespan cues derived from the death event.
- `Type`: Feature, UX
- `Why`: The app needed to support deceased individuals without making death a prominent profile field. Root cause was that only `birth_date` had a simple edit/save path and the birthday/tree surfaces only understood birth dates, so memorial state had no canonical runtime model.
- `Files`:
  - `src/lib/attributes/store.ts`
  - `src/lib/validation/person.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/route.ts`
  - `src/app/api/people/[personId]/route.ts`
  - `src/lib/attributes/definition-defaults.ts`
  - `src/lib/attributes/event-definitions.ts`
  - `src/lib/person/vital-dates.ts`
  - `src/lib/person/vital-dates-server.ts`
  - `src/lib/home/birthdays.ts`
  - `src/lib/tree/load-tree-page-data.ts`
  - `src/components/PersonEditModal.tsx`
  - `src/components/home/BirthdaysSection.tsx`
  - `src/components/calendar/CalendarPageClient.tsx`
  - `src/components/TreeGraph.tsx`
  - `src/app/tree/page.tsx`
  - `src/app/t/[tenantKey]/tree/page.tsx`
- `Data Changes`: No schema change. Attribute definition defaults now include the `death` event category, and person save can create/update the person’s canonical death event row.
- `Verify`:
  - Edit a person and enter `To Date`; save, reopen, and confirm the date persists without adding a top-level death column to `People`.
  - Home birthday chips show `In Mem` instead of `Turning X` for deceased people.
  - Calendar shows both birth anniversaries and death anniversaries for people with a recorded death event.
  - Tree nodes render lifespan text (`birth year - death year`) for deceased people.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: Yes. Death is now modeled as a canonical person event, not a top-level person field.
## 2026-03-13 (death event entry path correction)

- `Change`: Removed the always-visible editable `To Date` field from person contact edit, restored death entry to the Life Event flow only, and kept `From / To` display visible only after a death event already exists.
- `Type`: Bugfix, UX
- `Why`: Root cause was the first pass wiring death through the person save form as a hidden secondary person-field flow, which contradicted the approved design that death should be an event and not a prominent field.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/lib/validation/person.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/route.ts`
  - `src/app/api/people/[personId]/route.ts`
  - `src/lib/attributes/store.ts`
  - `docs/design-decisions.md`
- `Data Changes`: No schema change. Existing death events remain canonical; person save no longer creates or updates death events directly.
- `Verify`:
  - Person contact edit shows only `Birthdate` until a death event exists.
  - Add a `Death` life event, reopen the person, and confirm the screen now displays `From Date` and read-only `To Date`.
  - Saving normal person edits no longer creates/changes a death event.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No new design decision change; this restores the UI to the approved event-only death-entry model.
## 2026-03-13 (death event single-date form)

- `Change`: Updated the generic Attributes event editor so `Death` is always treated as a single-date event with no `End Date` field or saved end date.
- `Type`: Bugfix, UX
- `Why`: Root cause was the death event using the generic event fallback path in `AttributesModal`, which assumes unknown event types may be date ranges and therefore showed `End Date`.
- `Files`:
  - `src/components/AttributesModal.tsx`
- `Data Changes`: No schema change. Existing stale death end dates are suppressed in the UI, and future death saves send no end date.
- `Verify`:
  - Add or edit a `Death` event and confirm only one date field is shown.
  - Saving a death event does not persist an end date.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.

## 2026-03-11 (repair missing spouse households)

- `Date`: 2026-03-11
- `Change`: Fixed spouse-save household creation so the current family group now gets its `Households` row when a spouse link is created, and repaired the existing missing household rows in OCI.
- `Type`: UI | API | Data
- `Why`: Root cause was a `relationships/builder` bug: after saving `family` relationships, the household-create loop filtered out the current family group and only recreated households for propagated secondary groups. The tree could still draw the spouse cluster from the relationship edge, but with no backing household row it had no label and no household ID to open.
- `Files`:
  - `src/app/api/t/[tenantKey]/relationships/builder/route.ts`
- `Data Changes`: Inserted 6 missing `Households` rows to match existing `family` relationship pairs (`snowestes`: 1, `meldrumclark`: 5) using the canonical household ID and spouse-role/label rules.
- `Verify`:
  - OCI verification query for `family` relationship pairs without matching `Households` rows now returns `0`.
  - In Tree view, the previously broken household cluster opens the household panel on click and shows its household label.
  - Creating a new spouse household produces both the relationship edges and the household row in the current family group.
- `Rollback Notes`: Revert the route change and manually delete the repaired household rows only if you intentionally want to restore the broken state.
- `Design Decision Change`: No design decision change.

## 2026-03-11 (tree household branch ordering by direct parent)

- `Date`: 2026-03-11
- `Change`: Family Tree household branches now sort left-to-right by the direct-line parent’s age, and married children stay grouped under their parent household while children within each household continue to render in birth order.
- `Type`: UI
- `Why`: Root cause was a `TreeGraph` layout bug: each generation row was sorted person-by-person before spouses were paired, and the child-branch centering pass averaged couple positions. That let an in-law spouse skew a household’s branch order and pull a married child household away from the direct parent’s sibling slot.
- `Files`:
  - `src/components/TreeGraph.tsx`
- `Data Changes`: None.
- `Verify`:
  - In Family Tree, confirm sibling households render oldest direct sibling on the left and youngest on the right, even when spouses are older/younger than the direct sibling.
  - Confirm a married child household stays grouped beneath that child’s parents rather than shifting based on spouse placement.
  - Confirm children within the same household still render oldest to youngest.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.

## 2026-03-11 (tree household edit + spouse maiden capture)

- `Date`: 2026-03-11
- `Change`: Restored household edit access from the Family Tree and added a gender-aware maiden name field when creating a new spouse (shown for female spouses, hidden for male/unspecified).
- `Type`: UI
- `Why`: Root causes were (1) the tree lines layer consumed pointer events so household action dots never fired their click handlers, and (2) the inline Add Spouse dialog had no maiden-name field and didn’t gate it by spouse gender.
- `Files`:
  - `src/app/globals.css`
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - In Tree view, click a household cluster dot; Household Edit modal opens.
  - Start “+ Add Person” from the Spouse dropdown: selecting Female shows optional Maiden Name; selecting Male hides/clears it.
  - Create a female spouse with a maiden name and confirm it persists on the new person record.
  - `Rollback Notes`: Revert commit.
  - `Design Decision Change`: No design decision change.

- `Date`: 2026-03-11
- `Change`: Stopped transient household saves from failing with `ORA-14411` by treating concurrent DDL contention as non-fatal in the household compatibility helper.
- `Type`: API
- `Why`: Root cause was the hot-path schema compatibility helper attempting `ALTER TABLE households ADD ...` during household PATCH; concurrent DDL elsewhere could raise `ORA-14411`, returning a 500 even though the schema was already compatible.
- `Files`:
  - `src/lib/oci/tables.ts`
- `Data Changes`: None.
- `Verify`:
  - Save a Household name/notes/address; it should succeed without 500s even under concurrent activity.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.

- `Date`: 2026-03-11
- `Change`: Household modal primary action now reads “Save and Close,” and after a successful save it closes the modal and triggers the parent refresh to reflect updates (including in the Family Tree).
- `Type`: UI
- `Why`: The modal kept focus and the tree view didn’t refresh after a household rename, leaving stale labels until a manual refresh.
- `Files`:
  - `src/components/HouseholdEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Edit household label/notes and click “Save and Close”; the modal dismisses and the underlying page/tree shows the updated name.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.

- `Date`: 2026-03-11
- `Change`: Family Tree now reloads fresh data on each request (tree cache disabled) so person/household display names and saves reflect immediately after edits.
- `Type`: UI | API
- `Why`: The tree used a 20s cache, so editing a person from the tree showed stale names and saves appeared to “not work” until the cache expired.
- `Files`:
  - `src/lib/tree/load-tree-page-data.ts`
- `Data Changes`: None.
- `Verify`:
  - Change a person display name from the Tree modal; close -> tree shows new name immediately.
  - Change a household name from the Tree modal; tree shows new name immediately.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.

- `Date`: 2026-03-11
- `Change`: Disabled people page caching so People tab and Family Tree always read the latest person/household data and stay consistent after edits.
- `Type`: UI | API
- `Why`: People page used a 20s cache, so recent display-name changes in the tree could show differently in the People tab until the cache expired.
- `Files`:
  - `src/app/people/page.tsx`
- `Data Changes`: None.
- `Verify`:
  - Rename a person in the tree or People tab; reopening in either view shows the same updated display name immediately.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.

- `Date`: 2026-03-11
- `Change`: Stopped the Family Tree from rewriting canonical `displayName` values before opening the person modal, so Tree and People views now seed the edit form from the same person record.
- `Type`: UI
- `Why`: Root cause was a tree-only client transform in `TreeGraph` that replaced `displayName` with `first_name + last_name`. For people whose canonical `display_name` differs from their legal first name, the tree modal showed the wrong name and made display-name edits appear not to persist.
- `Files`:
  - `src/components/TreeGraph.tsx`
- `Data Changes`: None. OCI data already contained one canonical person row for this record (`display_name = Brent Estes`, `first_name = Brenton`), so no data remediation was needed.
- `Verify`:
  - Open the same person from People and Family Tree and confirm the modal shows the same `Display Name`.
  - Change `Display Name` from the tree modal, save, reopen from tree, and confirm the modal keeps the updated value.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.

- `Date`: 2026-03-11
- `Change`: Family Tree sibling ordering now places older siblings to the left when birthdates are available, with the prior name sort used only as a fallback.
- `Type`: UI
- `Why`: Root cause was that `TreeGraph` ordered both row layout and child clusters alphabetically by `displayName`, so siblings appeared by name instead of by age.
- `Files`:
  - `src/components/TreeGraph.tsx`
- `Data Changes`: None.
- `Verify`:
  - In Family Tree, confirm siblings with known birthdates render oldest on the left and youngest on the right.
  - Confirm siblings with equal or missing birthdates still render in a stable order.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.

- `Date`: 2026-03-11
- `Change`: Fixed the production Tree page crash introduced by the sibling-order change by converting the new tree-order helpers to hoisted function declarations.
- `Type`: UI
- `Why`: Root cause was a temporal-dead-zone bug in `TreeGraph`: the sibling sort called `comparePeopleForTreeOrder` before that helper was initialized, which produced `ReferenceError: Cannot access ... before initialization` in the deployed bundle.
- `Files`:
  - `src/components/TreeGraph.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run build` passes.
  - Opening `/tree` no longer throws the client-side initialization exception.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.

- `Date`: 2026-03-11
- `Change`: Family-section family-group switching now uses the current person’s enabled `PersonFamilyGroups` memberships, so an in-law cannot switch families unless that person is actually linked to another family group.
- `Type`: UI | API
- `Why`: Root cause was that the modal switcher was gated by the signed-in user’s accessible family groups instead of the viewed person’s linked family memberships. That exposed family switching on in-law records even when the person only belonged to the current family group.
- `Files`:
  - `src/app/api/t/[tenantKey]/people/[personId]/route.ts`
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Open an in-law person who belongs only to the current family group; the Family section no longer allows switching families.
  - Open a person with enabled memberships in multiple family groups; the Family section switcher shows only those linked family groups.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.

## 2026-03-10 (reviewed AI story import from person notes)

- `Date`: 2026-03-11
- `Change`: Tightened spouse eligibility rules so spouse options are hidden for people under 19, parent records cannot be selected as spouse, and the relationship-save API rejects those invalid spouse links.
- `Type`: UI | API
- `Why`: Root cause was incomplete spouse validation. The family UI allowed underage spouse options and could auto-fill a parent’s spouse into the current person’s spouse field, while the backend did not block underage or parent/spouse overlap saves.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/app/api/t/[tenantKey]/relationships/builder/route.ts`
- `Data Changes`: No schema change. New spouse saves now require both people to be at least 19 and not overlap with selected parents.
- `Verify`:
  - Open a person under 19 and confirm the spouse selector is replaced by guidance text.
  - Confirm parent selections no longer make a parent appear as spouse.
  - Confirm saving a spouse link where either person is under 19 returns a 409 if attempted through the API.
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.

- `Date`: 2026-03-11
- `Change`: Fixed the household child-to-person handoff so a newly added child opens with fresh family-group relationship data in the person modal instead of showing stale `undeclared` state from the outer page.
- `Type`: UI | API
- `Why`: Root cause was that the household modal refreshed its own child list after add, but the person modal still opened from stale page-level people data. The household detail API also returned only minimal child rows, so the handoff had no fresh relationship-type payload to use immediately.
- `Files`:
  - `src/app/api/t/[tenantKey]/households/[householdId]/route.ts`
  - `src/components/HouseholdEditModal.tsx`
  - `src/components/PeopleDirectory.tsx`
- `Data Changes`: No schema change. The household detail payload now includes a fuller child person summary for immediate modal handoff.
- `Verify`:
  - Add a child from `Household -> Children -> Add Child`.
  - Open that child immediately from the household child list.
  - Confirm the person modal shows the current family relationship instead of stale `undeclared`.
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.

- `Date`: 2026-03-11
- `Change`: Fixed person-save relationship building so children can inherit family-group membership from a direct/founder parent plus in-law spouse, and changed the standalone `Add Person` form to use a native birthdate picker instead of a plain text field.
- `Type`: UI | API
- `Why`: Root cause for the save failure was that the relationship builder required every selected parent to already be `founder` or `direct`, and it did not propagate parent family-group memberships to the child on the normal person-save path. Root cause for the birthday issue was a stale UI control in the standalone add-person card; newer spouse/child flows already used native date inputs.
- `Files`:
  - `src/app/api/t/[tenantKey]/relationships/builder/route.ts`
  - `src/components/AddPersonCard.tsx`
- `Data Changes`: No schema change. Person-save relationship updates now inherit parent family groups to the child before reconciliation.
- `Verify`:
  - Save a child from the person panel where one parent is `direct` and the spouse parent is `in_law`; confirm the save succeeds.
  - Confirm the child inherits the relevant family groups and is classified correctly after save.
  - Open the standalone `Add Person` form and confirm `Birthday` uses a native date picker.
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.

- `Change`: Added `Import Story with AI` to the person Notes panel, plus a new tenant/person-scoped AI route that turns story text into canonical attribute drafts and opens each draft in the existing attribute modal for user review and save one at a time.
- `Type`: UI | API
- `Why`: The approved design change was to add AI-assisted story import without changing existing attribute save/retrieval flows. Root cause was that the app only had AI Help and no structured, review-first path to turn narrative text into canonical person attributes.
- `Files`:
  - `src/lib/ai/openai.ts`
  - `src/lib/ai/story-import.ts`
  - `src/lib/ai/story-import-types.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/story-import/route.ts`
  - `src/lib/attributes/types.ts`
  - `src/components/AttributesModal.tsx`
  - `src/components/PersonEditModal.tsx`
  - `src/lib/ai/help-guide.ts`
  - `docs/design-decisions.md`
  - `designchoices.md`
  - `README.md`
  - `docs/deploy-runbook.md`
- `Data Changes`: None. AI story import only generates drafts; approved saves still use the existing canonical attribute APIs and `Attributes` table.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - Person -> Notes shows `Import Story with AI`.
  - Submitting story text produces zero or more proposed drafts without auto-saving data.
  - Each proposed draft opens in the normal attribute modal and saves only after user approval.
  - Closing the review sequence stops the remaining drafts without creating them.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: Updated the AI decision so Help stays read-only while story import is allowed as a separate reviewed workflow.

## 2026-03-10 (person modal family switch route sync)

- `Change`: Fixed the person modal Family switch so selecting a different family group performs a real app navigation instead of only updating modal-local state.
- `Type`: UI
- `Why`: Root cause was the person modal posting the active-family switch and then only mutating its own `activeTenantKey` and loaded people/tree data. The app header is server-rendered from the route tenant, so the header stayed on the old family group until the page navigated or refreshed.
- `Files`:
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - Changing the family group from the person modal updates the app header to the newly selected family group.
  - On person profile routes, if the person is not present in the selected family group, the app falls back to that family group's people page.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-10 (media attribute-detail CLOB comparison fix)

- `Change`: Fixed the Media Library selected-file attribute lookup so it matches `Attributes.attribute_detail` against the target `fileId` with a CLOB-safe Oracle comparison.
- `Type`: API
- `Why`: Root cause was a second Oracle `ORA-22848` on the same media detail path. The attribute lookup helper was using `TRIM(a.attribute_detail) = :fileId`, but `attribute_detail` is a CLOB in the canonical OCI attributes table, so Oracle rejected the comparison.
- `Files`:
  - `src/lib/oci/tables.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - Editing media details no longer fails with `ORA-22848` when selected-file detail loading matches person media attributes by `fileId`.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-10 (media metadata CLOB-safe detail query fix)

- `Change`: Fixed the Media Library media-detail read path to use a CLOB-safe fallback for `media_metadata` when loading a selected file after save.
- `Type`: API
- `Why`: Root cause was Oracle rejecting the selected media detail query with `ORA-22848: cannot use CLOB type as comparison key`. The query in the OCI media-link helper was using `NULLIF(TRIM(l.media_metadata), '')` against a CLOB column, which Oracle does not allow.
- `Files`:
  - `src/lib/oci/tables.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - Editing media details no longer fails with `ORA-22848` on the selected-file detail reload path.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-10 (media name save SQL fix)

- `Change`: Fixed the Media Library metadata save path so editing a media `Name` uses a safer OCI update query against `media_links`.
- `Type`: API
- `Why`: Root cause was the media-name PATCH route depending on an aliased Oracle `UPDATE media_links l ...` statement in the OCI helper. That was the highest-risk write on the save path and the likely source of the uncaught save failure that surfaced in the client as `Failed to save media details`.
- `Files`:
  - `src/lib/oci/tables.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - Editing a media item's `Name` in Media Library now saves successfully instead of returning `Failed to save media details`.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-10 (family relationship hover + media save-close fix)

- `Change`: Removed the large family-relationship guidance banner from the person `Family` section and moved the same guidance onto the family relationship chip as hover text. In Media Library, saving media details now closes the editor modal and returns the success message to the library view.
- `Type`: UI
- `Why`: Root cause was duplicated UI state and an incomplete save flow. The Family section was already showing the relationship chip next to `Family Group`, so the full-width guidance banner was duplicating that context and taking unnecessary vertical space. In Media Library, the save handler updated the selected media state but never closed the editor modal, so Save did not complete the expected user flow.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - Person `Family` section no longer shows the large relationship guidance banner.
  - Hovering the family relationship chip shows the relationship guidance text when guidance exists.
  - Saving media details from Media Library closes the editor modal and returns to the library with a success message.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-10 (timeline sort control polish)

- `Change`: Replaced the oversized Timeline sort arrow with a compact pill-style toggle that shows `Oldest first` or `Newest first` with a small inline arrow icon.
- `Type`: UI
- `Why`: Root cause was the Timeline sort control using a large text arrow glyph, which looked oversized next to the section title and also rendered poorly because of encoding. A compact text-plus-icon control better matches the rest of the UI and avoids glyph issues.
- `Files`:
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - Person Timeline shows a compact sort control next to `Timeline` instead of the large standalone arrow.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-10 (person timeline, stories, and spouse picker polish)

- `Change`: Fixed person Timeline chips so dated events open the edit modal when clicked, limited Timeline to dated event rows only, replaced the large Ascending/Descending buttons with a single inline sort arrow, moved story items into the Stories card as editable chips, and routed spouse creation through the spouse dropdown with a `+ Add Person` option that opens the existing add-person modal. The shared attribute add modal now uses launch-aware titles such as `Add Story`, `Add Event`, `Edit Story`, and `Edit Event`.
- `Type`: UI
- `Why`: Root cause was split UI behavior. Timeline chips were rendered as non-clickable spans, Timeline filtering was too broad and still admitted non-date items, spouse creation lived on a separate button path instead of the spouse picker, and story launches still looked like generic attribute creation even when the flow was story-specific.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/components/AttributesModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - `npm run build -- --no-lint` still fails locally only with the pre-existing Windows `spawn EPERM`.
  - Person Timeline only shows dated events and clicking a Timeline chip opens the edit modal.
  - Timeline sort is controlled by a single inline arrow next to `Timeline`.
  - Stories card shows story chips and `+ Add Story`.
  - Spouse picker includes `+ Add Person` and selecting it opens the add-person modal.
  - Story/event launches show story/event-specific add/edit modal titles.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-10 (family header and admin layout polish)

- `Change`: Adjusted the Attribute Definitions category editor so `Kind` and `Category Label` stay on the first row, `Description` moves to a full second row, and `Sort` / `Color` / `Enabled` move to the third row. In the person Family section, the family relationship now appears next to `Family Group`, `Set as Founder` is a compact checkbox instead of a full button, and the relationship banner text now reflects the current state without duplicating the label. In `Users & Access`, the `Add User` modal header was tightened so the close button aligns correctly.
- `Type`: UI
- `Why`: Root cause was layout mismatch, not business logic. The category editor fields were grouped for data density rather than the admin editing flow, the Family section separated closely related information into different visual blocks, and the Add User modal reused a header grid meant for avatar modals, which left the close button visually off.
- `Files`:
  - `src/components/AttributeDefinitionsAdmin.tsx`
  - `src/components/PersonEditModal.tsx`
  - `src/components/SettingsClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - `npm run build -- --no-lint` still fails locally only with the pre-existing Windows `spawn EPERM`.
  - Attribute category editing shows `Kind` and `Category Label` on row 1, `Description` on row 2, and `Sort` / `Color` / `Enabled` on row 3.
  - Person Family section shows the current family relationship next to `Family Group`.
  - Founder control appears as a small checkbox next to `Family Group`.
  - `Users & Access > Add User` modal shows an aligned `Close` button in the header.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-10 (attribute definitions and admin access UI cleanup)

- `Change`: Simplified the Attribute Definitions admin screen so categories are filtered by kind at the top instead of showing `Descriptor`/`Event` badges in every row, hid the internal category key from the editor, reordered the category editor to lead with `Kind`, and tightened the category edit layout so `Sort` is smaller and `Description` is larger. In `Users & Access`, `Add User` is now a modal instead of an inline card, the person picker excludes anyone who already has either Google or local user access, Google/local directory status chips both read `Enabled`/`Disabled`, and the Audit filter controls were compacted into two rows with narrower Actor Person / Action / Result / From fields.
- `Type`: UI
- `Why`: Root cause was admin UX exposing internal implementation details and using layouts optimized for raw editing rather than current admin tasks. Attribute Definitions was surfacing the internal category key and repeating kind labels in every row instead of letting admins filter by kind. `Add User` was an inline form that broke the directory workflow, and its picker only filtered against one user source. The audit filter used three wide rows even though the fields did not need that much space.
- `Files`:
  - `src/components/AttributeDefinitionsAdmin.tsx`
  - `src/components/SettingsClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - Attribute Definitions shows a top-level kind filter and no longer shows `Descriptor`/`Event` badges in category rows.
  - Category edit layout shows `Kind` first, no visible `Category Key`, a smaller `Sort`, and a larger `Description`.
  - `Users & Access > Add User` opens as a modal.
  - The Add User person picker excludes people who already have either Google or local user records.
  - User Directory status chips read `Enabled` / `Disabled` for both Google and Local access.
  - Audit filters render in two rows with the narrower field widths.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-10 (media library detail editing and query-path cleanup)

- `Change`: Reworked Media Library so the per-file editor uses a direct `/photos/[fileId]` API instead of reusing `/photos/search`, enabled editing of media `Name`, `Description`, and `Date` from the media detail modal, and replaced the main media search full-table path with tenant-scoped OCI media queries. Household media linking now uses entity-scoped media-link reads instead of scanning all media links.
- `Type`: API | UI | Performance
- `Why`: Root cause was a query-shape problem plus a disabled UI. The media detail modal had its metadata inputs disabled, and both opening a single file and refreshing links after link/unlink were calling the heavy media search route. That search route was loading whole `Attributes`, `Households`, `MediaLinks`, and `MediaAssets` tables through the generic table reader and joining/filtering in memory before slicing to the requested limit. As data grows, load time scaled with total table size instead of the visible result set.
- `Files`:
  - `src/lib/oci/tables.ts`
  - `src/app/api/t/[tenantKey]/photos/search/route.ts`
  - `src/app/api/t/[tenantKey]/photos/[fileId]/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/link/route.ts`
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: No schema change. Media metadata edits now update the canonical tenant-scoped `MediaLinks` rows for the selected file and, where applicable, matching person media `Attributes` rows for date/description parity.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - Opening a media item in Media Library no longer uses `/photos/search?q=<fileId>` as its detail refresh path.
  - Media detail `Name`, `Description`, and `Date` are editable for app-linked media and save through `/api/t/[tenantKey]/photos/[fileId]`.
  - Linking/unlinking a person or household from the media detail modal refreshes the selected file without reloading the entire library.
  - Main Media Library search still returns the same item shape, but no longer loads generic full tables for `Attributes`, `Households`, `MediaLinks`, and `MediaAssets`.
- `Rollback Notes`: Revert this change and redeploy. Existing media rows remain valid because no schema or ID format changed.
- `Design Decision Change`: No design decision change.

## 2026-03-10 (stored attribute kind and unified attribute definitions)

- `Change`: Added canonical `Attributes.attribute_kind` storage (`descriptor` | `event`), backfilled existing rows compatibly, and unified family-group Attribute Definitions so admins now manage both descriptor and event categories/types from one definitions document. The Add Attribute modal now reads those unified definitions for both kinds instead of mixing event definitions with hardcoded descriptor lists.
- `Type`: Schema | Data | API | UI
- `Why`: Root cause was a split model. Event-vs-descriptor behavior was being inferred from `attribute_type`, old rows could be reinterpreted differently over time, admin definitions only controlled event types, and the add/edit UI still kept a separate hardcoded descriptor taxonomy. That made filtering, validation, and long-term consistency weaker than the schema intended.
- `Files`:
  - `oci-schema.sql`
  - `src/lib/oci/tables.ts`
  - `src/lib/attributes/definition-defaults.ts`
  - `src/lib/attributes/event-definitions-types.ts`
  - `src/lib/attributes/event-definitions.ts`
  - `src/lib/attributes/store.ts`
  - `src/lib/validation/attributes.ts`
  - `src/app/api/t/[tenantKey]/attribute-definitions/route.ts`
  - `src/app/api/attributes/route.ts`
  - `src/app/api/attributes/[attributeId]/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/[attributeId]/route.ts`
  - `src/components/AttributeDefinitionsAdmin.tsx`
  - `src/components/AttributesModal.tsx`
  - `src/lib/ai/help-guide.ts`
  - `docs/data-schema.md`
  - `docs/design-decisions.md`
  - `designchoices.md`
- `Data Changes`: Added and backfilled `Attributes.attribute_kind` in the OCI compatibility layer. Old family-group event-only definition JSON is upgraded compatibly so existing saved event definitions stay intact while descriptor definitions are added automatically.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - Admin `Attribute Definitions` shows both descriptor and event categories/types.
  - A descriptor attribute no longer asks for date fields in Add/Edit.
  - An event attribute still requires/shows date fields in Add/Edit.
  - Existing attribute records still load with the correct descriptor/event behavior after backfill.
- `Rollback Notes`: Revert this change and redeploy. Rows backfilled with `attribute_kind` can be recomputed from `attribute_type` + `attribute_date` if rollback cleanup is needed.
- `Design Decision Change`: Added a design decision for stored `attribute_kind` and unified descriptor/event definition management.

## 2026-03-10 (invite text includes local credentials)

- `Change`: Local-capable invites now generate a local username and temporary password at invite creation time and include those credentials in the copied invite message. The local invite-accept flow still works for older pending invites, but new invites pre-provision the local credential before the recipient opens the link.
- `Type`: API | UX | Access
- `Why`: Root cause was a model mismatch in the invite flow. The copied invite text could not include a real temporary password because local credentials were only created later on invite acceptance. That made the message incomplete and misleading for local/either invites.
- `Files`:
  - `src/lib/invite/store.ts`
  - `src/components/InviteAcceptClient.tsx`
  - `src/components/SettingsClient.tsx`
  - `src/lib/ai/help-guide.ts`
  - `docs/design-decisions.md`
  - `designchoices.md`
- `Data Changes`: No schema change. New local/either invites now create local-user and family-access rows at invite creation time instead of waiting until invite acceptance.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - Creating a `local` or `either` invite returns a suggested message that includes `Username:` and `Temporary password:`.
  - The generated local credential works on the invite page and can still be replaced during invite activation.
  - Existing pending invites created before this change can still be accepted from the invite page.
- `Rollback Notes`: Revert this change and redeploy. New local credentials created from invites may need manual cleanup if a rollback occurs after invite creation.
- `Design Decision Change`: Updated the person-bound invite onboarding decision to pre-provision local credentials when local sign-in is allowed.

## 2026-03-10 (family-group relationship types)

- `Change`: Replaced the intermediate membership-scoped `in_law` flag with canonical `PersonFamilyGroups.family_group_relationship_type` values: `founder`, `direct`, `in_law`, and `undeclared`. Relationship saves and integrity repair now reconcile family-group relationship type centrally, founder assignment is admin-managed, undeclared people show in a `Needs Placement` flow instead of the main tree, and legacy `Attributes.in_law` rows are cleaned up instead of remaining canonical.
- `Type`: API | Data | Schema | UX
- `Why`: Root cause was model mismatch. A boolean `in_law` flag could not represent founders or unplaced family members, and it still relied on a weak heuristic. The product needed an explicit family-group relationship model rather than a single derived spouse flag.
- `Files`:
  - `oci-schema.sql`
  - `src/lib/oci/tables.ts`
  - `src/lib/data/store.ts`
  - `src/lib/family-group/relationship-type.ts`
  - `src/app/api/t/[tenantKey]/relationships/builder/route.ts`
  - `src/app/api/t/[tenantKey]/integrity/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/family-relationship-type/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/route.ts`
  - `src/app/api/family-groups/provision/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/[attributeId]/route.ts`
  - `src/app/api/attributes/route.ts`
  - `src/app/api/attributes/[attributeId]/route.ts`
  - `src/components/PersonEditModal.tsx`
  - `src/components/PeopleDirectory.tsx`
  - `src/components/PersonProfileRouteClient.tsx`
  - `src/components/TreeGraph.tsx`
  - `src/app/people/page.tsx`
  - `src/app/people/[personId]/page.tsx`
  - `src/app/t/[tenantKey]/people/page.tsx`
  - `src/app/t/[tenantKey]/people/[personId]/page.tsx`
  - `src/app/tree/page.tsx`
  - `src/app/t/[tenantKey]/tree/page.tsx`
  - `src/lib/tree/load-tree-page-data.ts`
  - `docs/design-decisions.md`
  - `designchoices.md`
- `Data Changes`: Schema change: replaced the runtime membership classification field with `family_group_relationship_type` on `person_family_groups`. Integrity repair now normalizes family-group relationship types and deletes stale legacy `in_law` attribute rows.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - Adding/removing family relationships recalculates `direct`, `in_law`, and `undeclared` from founder + parent/spouse structure.
  - Founder assignment/removal is admin-only and founder deletion is blocked except for Steve.
  - Integrity audit now reports family-group relationship type drift, missing founders, founder overflow, and legacy `in_law` attribute rows; integrity repair fixes the repairable parts.
  - Direct `POST`/`PATCH`/`DELETE` attempts against `in_law` attributes return `system_managed_attribute`.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: Replaced the membership-scoped `in_law` flag decision with the broader `family_group_relationship_type` model.

## 2026-03-10 (person photo links show names, not IDs)

- `Change`: Updated the person photo detail panel so linked people display the local person name instead of falling back to the raw `personId` when refreshing photo associations.
- `Type`: UI
- `Why`: Root cause was that the person modal trusted `/photos/search` display text directly, while that API intentionally falls back to `personId` if its tenant-scoped name lookup misses. The modal already had the local person list with the correct names but was not using it to normalize the display.
- `Files`:
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - In the person photo detail `Linked To` list, the current person now shows their display name instead of their ID after upload/link refresh.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-10 (family-data editing for USER role)

- `Change`: Broadened regular `USER` permissions from self-edit/admin-mixed behavior to full family-data editing within accessible family groups. `USER` can now add people, edit people and households, manage relationships/children/spouse-family creation, and manage person/household media from People, Tree, and Media flows. Admin-only areas remain limited to invites, access/security, audit, integrity, and family-group administration. Also removed the relationship builder's dead dependency on the removed `PersonAttributes` table.
- `Type`: Access Control, UX, Bugfix
- `Why`: Root cause was a split access model: APIs allowed only self-edit in some person routes, while most shared family creation/edit flows stayed admin-only in both UI and route guards. That blocked the intended collaborative family-building workflow. A second root cause was the relationship builder still trying to write in-law markers through a removed legacy attribute table, which would break spouse/family flows once those routes were opened to regular users.
- `Files`:
  - `src/lib/auth/permissions.ts`
  - `src/app/people/page.tsx`
  - `src/app/t/[tenantKey]/people/page.tsx`
  - `src/app/people/[personId]/page.tsx`
  - `src/app/t/[tenantKey]/people/[personId]/page.tsx`
  - `src/app/tree/page.tsx`
  - `src/app/t/[tenantKey]/tree/page.tsx`
  - `src/app/media/page.tsx`
  - `src/app/t/[tenantKey]/media/page.tsx`
  - `src/app/api/t/[tenantKey]/people/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/[attributeId]/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/[photoId]/route.ts`
  - `src/app/api/t/[tenantKey]/households/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/children/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/link/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/[photoId]/route.ts`
  - `src/app/api/t/[tenantKey]/relationships/builder/route.ts`
  - `src/app/api/t/[tenantKey]/attributes/route.ts`
  - `src/app/api/attributes/route.ts`
  - `src/app/api/attributes/[attributeId]/route.ts`
  - `src/app/api/people/[personId]/route.ts`
  - `src/lib/ai/help-guide.ts`
- `Data Changes`: No schema change in this release entry.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - Family-data write routes now require tenant access instead of admin role, while admin-only routes remain on `requireTenantAdmin`.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: Added 2026-03-10 decision for family-group data editing permissions.

## 2026-03-10 (remove obsolete household media and legacy-local integrity paths)

- `Change`: Removed the obsolete household-gallery compatibility model from active runtime/search/delete/integrity handling, dropped its repo schema/table mapping, removed integrity/UI reporting for retired legacy-local cleanup rows, and cleaned several confirmed unused locals/imports.
- `Type`: API | Data | Schema
- `Why`: Root cause was active runtime and integrity code still encoding retired designs: household media still had a second compatibility model, and integrity/admin UI still surfaced old legacy-local cleanup concepts even though local auth now runs on `UserAccess`. Those paths increased diagnosis noise and kept the repo aligned to models the app no longer uses.
- `Files`:
  - `src/app/api/t/[tenantKey]/photos/search/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/[photoId]/route.ts`
  - `src/app/api/t/[tenantKey]/integrity/route.ts`
  - `src/components/SettingsClient.tsx`
  - `src/lib/oci/tables.ts`
  - `src/lib/data/store.ts`
  - `src/lib/auth/local-users.ts`
  - `src/lib/media/attach-orchestrator.ts`
  - `src/components/PersonEditModal.tsx`
  - `src/app/api/admin/debug/drive-folder/route.ts`
  - `oci-schema.sql`
  - `docs/data-schema.md`
  - `docs/design-decisions.md`
  - `designchoices.md`
- `Data Changes`: No data migration. Existing obsolete household-gallery rows are now ignored by runtime and may be discarded; current runtime uses `MediaLinks` plus `Households.wedding_photo_file_id`.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - Repo search returns no active runtime/integrity/UI references to the removed household-gallery compatibility model or the retired legacy-local cleanup summary fields.
  - Media Library search and household media delete still operate through canonical `MediaLinks`.
  - Integrity repair no longer reports or repairs the retired legacy-local cleanup rows, and orphan-media integrity no longer depends on the removed household-gallery compatibility model.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: Added 2026-03-10 decision clarifying household media uses only `MediaAssets` + `MediaLinks`, while `wedding_photo_file_id` remains the direct household avatar pointer.

## 2026-03-10 (grounded AI help assistant)

- `Change`: Added a tenant-scoped AI Help assistant backed by the OpenAI API, grounded on a curated local product guide, exposed it on new Help pages and header/home navigation, and documented the optional OpenAI environment configuration.
- `Type`: UI | API | Infra
- `Why`: Root cause was that the app had no user-facing help path and no server-side AI integration, so there was no way to answer "how do I use this app?" questions inside the product. The first implementation also needed to avoid inventing features, keep the API key off the client, and stay within current app behavior only.
- `Files`:
  - `src/lib/ai/openai.ts`
  - `src/lib/ai/help-guide.ts`
  - `src/lib/ai/help.ts`
  - `src/app/api/t/[tenantKey]/ai/help/route.ts`
  - `src/components/help/HelpAssistantClient.tsx`
  - `src/components/HeaderNav.tsx`
  - `src/app/help/page.tsx`
  - `src/app/t/[tenantKey]/help/page.tsx`
  - `src/app/page.tsx`
  - `src/app/t/[tenantKey]/page.tsx`
  - `src/app/globals.css`
  - `src/app/api/health/route.ts`
  - `README.md`
  - `docs/deploy-runbook.md`
  - `docs/design-decisions.md`
  - `designchoices.md`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - Signed-in users can open `Help` from the header or home tiles.
  - `POST /api/t/[tenantKey]/ai/help` returns a grounded answer when `OPENAI_API_KEY` is configured, and returns `503 ai_help_unavailable` when it is not.
  - The Help client no longer sends its static intro text to the model and keeps only the most recent request history within the route limit.
  - `GET /api/health` reports `OPENAI_API_KEY` boolean for deploy verification.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: Added 2026-03-10 decision for grounded server-side AI Help.

## 2026-03-10 (deterministic role-aware AI help guardrails)

- `Change`: Added deterministic non-admin guardrails for admin-only AI Help topics so invite, audit, access-management, integrity/import, and family-group admin questions return fixed "ask your admin" guidance instead of relying only on the model prompt.
- `Type`: API | Reliability
- `Why`: Root cause was that AI Help was only role-aware inside the prompt. That made non-admin responses likely to be correct, but not guaranteed, for admin-only tasks like invites and audit.
- `Files`:
  - `src/lib/ai/help.ts`
  - `src/lib/ai/help-guide.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - A non-admin asking about invites receives deterministic admin-only guidance without depending on model inference.
  - A non-admin asking about audit/access-management topics receives deterministic admin-only guidance.
  - Admin users still receive normal grounded AI answers for the same topics.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-10 (tenant audit capability + login/change coverage)

- `Change`: Added a tenant-scoped audit API and Settings audit viewer, expanded audit coverage across local-user admin actions plus active attribute/media writes, and started persisting `last_login_at` on user-access records so admins can see recent login activity per user.
- `Type`: UI | API | Schema
- `Why`: Root cause was incomplete audit architecture. The app already wrote some audit rows, but coverage was uneven, there was no read API or audit UI, failed local logins were not recorded, and there was no persistent last-login field for quick operational visibility.
- `Files`:
  - `src/app/api/t/[tenantKey]/audit/route.ts`
  - `src/app/api/t/[tenantKey]/admin-snapshot/route.ts`
  - `src/app/api/t/[tenantKey]/local-users/route.ts`
  - `src/app/api/t/[tenantKey]/local-users/[username]/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/[attributeId]/route.ts`
  - `src/app/api/attributes/route.ts`
  - `src/app/api/attributes/[attributeId]/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/[photoId]/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/link/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/[photoId]/route.ts`
  - `src/components/SettingsClient.tsx`
  - `src/lib/audit/log.ts`
  - `src/lib/auth/local-users.ts`
  - `src/lib/auth/options.ts`
  - `src/lib/data/store.ts`
  - `src/lib/data/runtime.ts`
  - `src/lib/google/types.ts`
  - `src/lib/oci/tables.ts`
  - `oci-schema.sql`
  - `docs/data-schema.md`
- `Data Changes`: Adds `user_access.last_login_at` compatibility/bootstrap support and begins writing new values on successful logins. Existing historical audit rows remain unchanged.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - Settings -> Users & Access -> Audit loads recent tenant-scoped events and supports user/date/action filters.
  - Successful Google and local logins write audit rows; failed local logins also write failure rows.
  - Attribute/media create/update/delete flows write audit rows.
  - Manage User modal shows `Last Successful Login` when present.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-10 (account modal install app action)

- `Change`: Added an `Install App` action to the account modal opened from the user-avatar icon, reusing PWA install prompt behavior and showing iPhone/iPad Add-to-Home-Screen guidance when native prompt support is unavailable.
- `Type`: UI
- `Why`: Root cause was install-flow discoverability. Install support existed on the invite page only, so signed-in users who skipped install during onboarding had no persistent in-app place to install the PWA later.
- `Files`:
  - `src/components/UserMenu.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - Opening the user-avatar modal shows `Install App` when the app is not already installed and the device/browser can use the prompt or needs iOS install guidance.
  - Clicking `Install App` opens the browser install prompt when available, or shows iOS Add-to-Home-Screen instructions.
  - Once installed in supported browsers, the modal no longer shows the install action and instead indicates the app is installed on this device.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-10 (media wizard UX refinement + video/audio support)

- `Change`: Refined the shared media attach wizard so source selection uses direct icon cards, replaced the ambiguous raw file input with explicit picker actions, and extended the shared attach flow from image-only to support video and audio alongside photos.
- `Type`: UI, API
- `Why`: Root cause was that the wizard still reflected an image-only MVP. The first step relied on generic tab buttons plus a separate `Continue`, the select step relied on the browser's default file input chrome (`Choose Files / No file chosen`), and the shared attach pipeline hard-filtered uploads and library results down to images even though the upload routes and media library already understood video/audio.
- `Files`:
  - `src/components/media/MediaAttachWizard.tsx`
  - `src/lib/media/attach-orchestrator.ts`
  - `src/lib/media/attach-contracts.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - Wizard source step shows direct icon cards for `Device Files`, `Camera`, and `Media Library`.
  - Device-file selection uses explicit CTA buttons instead of the browser's default `Choose Files` control.
  - Person, household, attribute, and library wizard flows accept photos, videos, and audio where supported by the selected source.
  - Selected-item previews and library labels correctly distinguish image, video, and audio items.
  - Local `npm run build -- --no-lint` still fails only on the pre-existing Windows `spawn EPERM` environment issue.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-10 (manage-user modal invite tab)

- `Change`: Moved person-specific invite creation into the `Manage User` flow by replacing the inline user-directory expansion with a modal that has `Manage User` and `Invite` tabs, and removed the standalone `Invites` subtab from `Users & Access`.
- `Type`: UI
- `Why`: Root cause was UI fragmentation after the initial invite rollout. Invites are person-specific actions, but the settings screen split them into a separate admin subtab while `Manage User` stayed on an inline row expander, forcing admins to switch context to do related work for the same person.
- `Files`:
  - `src/components/SettingsClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - `Users & Access > User Directory > Manage User` opens a modal instead of expanding the table row.
  - The modal has `Manage User` and `Invite` tabs.
  - Invite creation works from the `Invite` tab for the currently selected person without reselecting that person.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-10 (person-bound invite flow with manual-share onboarding)

- `Change`: Added a person-bound invite system with OCI-backed invite records, admin invite generation in Settings, a public `/invite/[token]` onboarding page, Google/local acceptance paths, and install/open-app guidance on the invite page.
- `Type`: UI, API, Schema
- `Why`: Root cause was missing onboarding infrastructure. Existing access setup required admins to hand-create Google/local login rows, which made inviting an existing person into the app manual, inconsistent, and hard to distribute before outbound email was available.
- `Files`:
  - `src/lib/oci/tables.ts`
  - `src/lib/invite/types.ts`
  - `src/lib/invite/store.ts`
  - `src/app/api/t/[tenantKey]/invites/route.ts`
  - `src/app/api/invite/[token]/route.ts`
  - `src/app/invite/[token]/page.tsx`
  - `src/components/InviteAcceptClient.tsx`
  - `src/components/SettingsClient.tsx`
  - `oci-schema.sql`
  - `docs/data-schema.md`
  - `docs/design-decisions.md`
  - `designchoices.md`
- `Data Changes`: Adds OCI `invites` table (`invite_id`, `person_id`, `invite_email`, `auth_mode`, `family_groups_json`, `token_hash`, acceptance timestamps/identity fields). Google/either invites provision `UserAccess`/`UserFamilyGroups` for the invited email at invite creation; local setup is completed from the invite page.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - Admin > Users & Access > Invites creates a shareable link/message for a person already in the selected family group.
  - Opening the invite link shows Google and/or local setup according to the invite auth mode.
  - Google invite acceptance returns to the same invite page and marks the invite accepted.
  - Local invite acceptance creates credentials, signs the user in, and returns to the invite page with install/open-app actions.
- `Rollback Notes`: Revert this change and redeploy. Existing invite rows can remain unused or be deleted after rollback.
- `Design Decision Change`: Added 2026-03-10 decision for person-bound invite onboarding.

## 2026-03-10 (OCI-only repo cleanup)

- `Change`: Removed the remaining legacy-backend files, routes, scripts, and documentation references from the repo; renamed the OCI data seam from `tab` terminology to `table` terminology; and deleted the last no-op compatibility helper.
- `Type`: Infra, Docs
- `Why`: Root cause was incomplete cleanup after the OCI cutover. Even after runtime traffic was OCI-only, the repo still carried deleted-backend file references, migration tooling names, and sheet-shaped table abstractions that made search, diagnosis, and future development noisier than necessary.
- `Files`:
  - `src/lib/data/store.ts`
  - `src/lib/data/runtime.ts`
  - `src/lib/oci/tables.ts`
  - `src/app/api/tables/route.ts`
  - `src/app/api/t/[tenantKey]/integrity/route.ts`
  - `src/app/api/t/[tenantKey]/people/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/route.ts`
  - `docs/change-summary.md`
  - `changeHistory.md`
  - `docs/deploy-runbook.md`
  - `docs/qa-matrix.md`
  - `docs/runbook-crash-diagnosis.md`
  - `docs/data-schema.md`
  - `docs/design-decisions.md`
  - `designchoices.md`
- `Data Changes`: None.
- `Verify`:
  - `rg -l -i 'sheet|workbook|spreadsheet' -g '!node_modules' -g '!.next'` returns no matches.
  - `rg -n '\b[A-Z_]+_TAB\b|\blistTabs\b|\blistOciTabs\b|\btabName\b|\bresolveTab\b' src docs README.md changeHistory.md designchoices.md TODO.md AGENTS.md` returns no matches.
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - `npm run build -- --no-lint` still fails locally with the pre-existing Windows environment error `spawn EPERM`.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-10 (OCI-only runtime boundary cleanup)

- `Change`: Added a neutral runtime data module, moved active routes/pages/libs off the deleted legacy adapter, removed runtime backend-mode branches from active media/attribute/household flows, and removed the deleted backend env dependency from OCI runtime.
- `Type`: API, Infra
- `Why`: Root cause was architectural drift after the OCI cutover: active app code still imported legacy-named modules and still carried mode-switch branches that implied both backends were supported at runtime. That slowed diagnosis, kept dead paths alive, and preserved unnecessary runtime dependency on deleted-backend configuration.
- `Files`:
  - `src/lib/data/runtime.ts`
  - `src/lib/env.ts`
  - `src/lib/google/family.ts`
  - `src/lib/attributes/store.ts`
  - `src/lib/attributes/event-definitions.ts`
  - `src/app/api/t/[tenantKey]/photos/search/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/[photoId]/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/[attributeId]/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/link/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/[photoId]/route.ts`
  - `src/app/api/t/[tenantKey]/integrity/route.ts`
  - `README.md`
  - `docs/data-schema.md`
  - `docs/design-decisions.md`
  - `designchoices.md`
- `Data Changes`: No schema change. Runtime reads/writes now assume OCI as the only supported persistence backend.
- `Verify`:
  - `npm run lint` passes.
  - Runtime backend-mode branching is removed from active app flows.
  - Active runtime no longer requires the deleted backend env var to boot in OCI mode.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: OCI is now the only supported runtime persistence backend.

## 2026-03-10 (OCI-only runtime helper cleanup for scaffold/access flows)

- `Change`: Removed the last legacy runtime helper path, made family-group scaffold creation write `FamilyConfig` directly in OCI mode, and moved tenant user-access upsert onto dedicated OCI table writes instead of legacy-backend mutations.
- `Type`: API, Infra
- `Why`: Root cause was incomplete backend cutover: OCI was the intended runtime source of truth, but several active helper paths still instantiated legacy-backend behavior for schema scaffolding and access writes. That kept unsupported dual-backend logic in production code and risked runtime failures when deleted-backend credentials were absent.
- `Files`:
  - `src/lib/data/store.ts`
  - `src/lib/oci/tables.ts`
- `Data Changes`: No schema change. Runtime writes for family config and user access now persist directly to OCI tables instead of relying on legacy-backend branches.
- `Verify`:
  - `npm run lint` passes.
  - Family-group scaffold paths no longer require the deleted backend helper path.
  - Tenant access upsert now writes `user_family_groups` and `user_access` in OCI mode.
  - `npm run build -- --no-lint` still fails on an existing `/games` prerender `workUnitAsyncStorage` invariant after compile, with separate path-casing warnings (`C:\Users\...` vs `C:\users\...`).
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-10 (deploy lint follow-up for OCI helper)

- `Change`: Fixed a deploy-blocking lint error in the new OCI tenant-access helper by changing a non-reassigned variable to `const`.
- `Type`: API, Infra
- `Why`: Root cause was a `prefer-const` violation in the newly added OCI upsert path, which caused Vercel `next build` to fail during lint/type validation.
- `Files`:
  - `src/lib/oci/tables.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npm run build` no longer fails on the `prefer-const` error in `src/lib/oci/tables.ts`.
- `Rollback Notes`: Revert this change and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-07 (media-tab one-family default + wizard skip/duplicate decision UX)

- `Change`: Defaulted Media tab person upload/link operations to family-group scope (`one_family`) and current family-group key, added per-image skip (`Do Not Import`), enlarged selection thumbnails, moved `Caption/Title` and `Date` onto one row, renamed `Notes` to `Story/Notes`, and added explicit duplicate decision workflow (`Duplicate` vs `Not Duplicate`) with side-by-side image comparison.
- `Type`: UI, API
- `Why`: Root cause was Media tab person links defaulting to broad share scope and lacking explicit import controls for duplicate candidates. Users needed clear per-item decisions (skip/import/duplicate) with better visual context.
- `Files`:
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/components/MediaLibraryClient.tsx`
  - `src/components/media/MediaAttachWizard.tsx`
  - `src/lib/media/attach-contracts.ts`
  - `src/lib/media/attach-orchestrator.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - Media-tab person link/create requests persist with `share_scope=one_family` and `share_family_group_key=<active family group>`.
  - Wizard allows skipping an image and skipped items are not imported.
  - Duplicate candidates require an explicit decision before save.
  - Choosing `Duplicate` does not upload a new file and links/details are applied against existing media.
  - Per-item editor shows larger thumbnails, `Caption/Title + Date` on one row, and `Story/Notes` label.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-07 (library item link-load speed + wizard step-state/preview stability)

- `Change`: Optimized Media Library item editor open flow by instant local association prefill plus lightweight background refresh (`includeDrive=0`, lower limit), and fixed wizard step UX issues by clearing stale status on transitions, adding explicit Yes/No selection feedback, and preventing blob preview URLs from being revoked during normal item edits/navigation.
- `Type`: UI
- `Why`: Root cause of slow editor open was heavy link-refresh fetch using `includeDrive=1` on open. Root cause of confusing wizard behavior was stale status text leaking across steps and over-aggressive blob URL cleanup causing previews to disappear when revisiting items.
- `Files`:
  - `src/components/MediaLibraryClient.tsx`
  - `src/components/media/MediaAttachWizard.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - Opening an existing library item shows links quickly (prefilled) and then refreshes.
  - Grouping step shows clear Yes/No selection state and no stale "Select Yes or No" text on shared metadata step.
  - Multi-item per-image previews remain visible when navigating back and forth between items.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-07 (person attribute insert fix for OCI NOT NULL + wizard target guard)

- `Change`: Fixed person attribute create route to include canonical `entity_type` and `entity_id` fields on attribute insert, and added wizard pre-save validation to block saving items that have no person/household targets.
- `Type`: API, UI
- `Why`: Root cause of `ORA-01400` was person-attribute inserts missing `entity_type` for OCI `Attributes` rows. Root cause of repeated "No attachment target selected" failures was wizard save allowing items with zero targets.
- `Files`:
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/route.ts`
  - `src/components/media/MediaAttachWizard.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - Saving wizard attachments to people no longer throws `ORA-01400 ... ATTRIBUTES.ENTITY_TYPE`.
  - Wizard save is blocked until every selected image has at least one person or household target.
  - Wizard jumps to the first invalid item and shows target-required status message.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-07 (wizard duplicate confirmation + stronger multi-item navigation)

- `Change`: Added checksum-based duplicate detection for wizard image uploads, duplicate confirmation UI with side-by-side selected vs existing library image previews, and clearer multi-item per-image navigation in the wizard item-detail step.
- `Type`: UI
- `Why`: Root cause was loss of duplicate-check behavior during Media Library -> shared wizard migration, plus weak per-item navigation cues that made multi-image captioning/editing appear stuck on the first image.
- `Files`:
  - `src/components/media/MediaAttachWizard.tsx`
  - `src/lib/media/attach-orchestrator.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - Selecting duplicate images shows duplicate detection status in selection list.
  - Per-item view shows side-by-side selected/existing duplicate previews when a duplicate is detected.
  - Duplicate items are handled as link-only (no re-upload).
  - Multi-item step shows explicit item navigation controls and supports moving between all selected images.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-07 (shared media attach wizard MVP foundation + Media Library integration)

- `Change`: Added a shared image-only media attach wizard and shared attach orchestrator/contract layer, then integrated Media Library upload flow to launch the wizard instead of maintaining duplicated upload/link UI logic.
- `Type`: UI, API
- `Why`: Root cause was duplicated media attach logic across screens with drift risk in request payloads and behavior. This centralizes orchestration while preserving existing backend contracts and person attribute-link semantics.
- `Files`:
  - `src/lib/media/attach-contracts.ts`
  - `src/lib/media/attach-orchestrator.ts`
  - `src/lib/media/attach-orchestrator.test.ts`
  - `src/components/media/MediaAttachWizard.tsx`
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - Media Library `Add Media` opens shared wizard.
  - Wizard supports image device upload, camera capture input, and existing library linking.
  - Save result status includes `createdLinks`, `createdAttributes`, `skipped`, and `failures`.
  - Person linking still uses attribute creation semantics (`POST /people/:personId/attributes`).
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-07 (admin-managed attribute event definitions)

- `Change`: Added family-group admin management for Attribute event definitions (categories + types + detail labels + date behavior), stored in `FamilyConfig.attribute_event_definitions_json`, and wired Add Attribute modal to use those definitions at runtime with safe defaults fallback.
- `Type`: UI, API, Schema
- `Why`: Event picklists and field labels needed to be configurable by admins without repeated code changes while keeping existing attribute save contracts.
- `Files`:
  - `src/app/api/t/[tenantKey]/attribute-definitions/route.ts`
  - `src/lib/attributes/event-definitions.ts`
  - `src/lib/attributes/event-definitions-types.ts`
  - `src/components/AttributeDefinitionsAdmin.tsx`
  - `src/components/SettingsClient.tsx`
  - `src/components/AttributesModal.tsx`
  - `src/lib/oci/tables.ts`
  - `docs/data-schema.md`
  - `docs/design-decisions.md`
  - `designchoices.md`
- `Data Changes`: Adds `attribute_event_definitions_json` compatibility column to OCI `family_config`; legacy store `FamilyConfig/TenantConfig` header is extended on demand.
- `Verify`:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Admin > Attribute Types tab loads/saves definitions for selected family group.
  - Add Attribute event form loads updated Type/Type Category options and detail label from definitions.
  - End Date field visibility follows selected type configuration (`dateMode` / `askEndDate`).
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: Added 2026-03-07 decision for admin-managed event metadata.

## 2026-03-07 (household info 4-panel layout + married date spouse sync)

- `Change`: Redesigned Household Edit `Info` tab into a 4-panel fixed layout (`Marriage`, `Attributes`, `Address`, `Household Notes`), added a `Married Date` field under spouse tiles, and wired household save to sync a `family_relationship/married` attribute date for both spouses.
- `Type`: UI, API, Data
- `Why`: Household info flow needed to match the person fixed-panel structure and capture marriage date once while keeping spouse life-event data in sync.
- `Files`:
  - `src/components/HouseholdEditModal.tsx`
  - `src/app/api/t/[tenantKey]/households/[householdId]/route.ts`
- `Data Changes`: Extends household write/read shape with `married_date` column compatibility and creates/updates/removes spouse marriage attributes in `Attributes` (marked with a household sync note marker).
- `Verify`:
  - Open Household Edit > `Info` and confirm 4 sections render in two columns on desktop.
  - Husband/Wife tiles remain clickable.
  - `Married Date` shows under spouse tiles and persists after save/reload.
  - Saving household with a married date creates/updates both spouse `married` attributes; clearing married date removes only synced spouse marriage attributes for that household marker.
  - `npm run build -- --no-lint` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-07 (household attributes panel flow alignment + OCI household address persistence fix)

- `Change`: Replaced Household Info upper-right `Attributes` panel from `Manage Attributes` summary UI to the same chip-driven add/view modal flow used in person fixed panel (`AttributesModal` in add/edit mode). Fixed household address persistence by extending OCI Households column mapping/compatibility to include `married_date`, `address`, `city`, `state`, and `zip`.
- `Type`: UI, API, Data
- `Why`: Root cause 1 was OCI payload normalization dropping address fields because Households headers in OCI mapping did not include those columns. Root cause 2 was using `AttributeSummarySection` (legacy manage flow) instead of the person fixed-panel attribute modal pattern requested for household attributes.
- `Files`:
  - `src/components/HouseholdEditModal.tsx`
  - `src/lib/oci/tables.ts`
- `Data Changes`: Adds OCI compatibility `ALTER TABLE households ADD (...)` checks for `married_date/address/city/state/zip` when missing.
- `Verify`:
  - In Household Info, upper-right section shows attribute chips with Ascending/Descending sort and `Add Attribute`.
  - Clicking a chip opens the same add/edit attribute modal flow used by person fixed panel.
  - Editing household address/city/state/zip and saving persists and reloads correctly in OCI-backed env.
  - `npm run build -- --no-lint` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-07 (household load performance + ORA-14411 save hardening)

- `Change`: Deferred household photo-link lookup fetches (`people` + `households`) until the `Pictures` tab is opened, instead of fetching on every household modal open. Hardened OCI household compatibility DDL by retrying transient DDL-concurrency errors (`ORA-14411` / `ORA-00054`) during column-add checks.
- `Type`: UI, API
- `Why`: Root cause of slow load was eager non-critical lookup fetches during initial modal open. Root cause of intermittent save failure was concurrent runtime `ALTER TABLE` compatibility checks in OCI under serverless parallel requests.
- `Files`:
  - `src/components/HouseholdEditModal.tsx`
  - `src/lib/oci/tables.ts`
- `Data Changes`: None to data semantics; runtime compatibility checks remain additive-only.
- `Verify`:
  - Opening household Info tab is faster (no immediate link-option list fetches).
  - First open of Pictures tab still loads link options correctly.
  - Household save no longer fails with `ORA-14411` under normal concurrent access.
  - `npm run build -- --no-lint` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-07 (global household profile values across family groups)

- `Change`: Switched household profile reads from family-group row scope to canonical household-id scope, with duplicate-row merge on read for `label/notes/address/city/state/zip` values. Updated tenant household list and family-tree household loading to filter visibility by people membership in the active family group rather than `Households.family_group_key`.
- `Type`: API, Data
- `Why`: Household profile fields (wedding date/address/etc.) were diverging between family groups because household rows could be family-scoped/duplicated; users expect one shared household profile across groups.
- `Files`:
  - `src/lib/google/family.ts`
  - `src/app/api/t/[tenantKey]/households/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/route.ts`
- `Data Changes`: No destructive migration in this change; duplicate `household_id` rows are merged logically at read time.
- `Verify`:
  - Edit household profile in family group A and save.
  - Switch to family group B (where the same spouses are visible).
  - Household profile values appear consistently.
  - Tenant household list shows only households whose spouses are in active family membership.
  - `npm run build -- --no-lint` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-07 (family view headshot preference + admin-defined attribute category colors)

- `Change`: Family tree data loader now prefers each person’s primary photo attribute over `People.photo_file_id` fallback so family views show real headshots whenever available. Added `categoryColor` to admin-managed attribute event category definitions and surfaced those colors on person/household/attributes chips.
- `Type`: UI, API
- `Why`: Family views were showing fallback avatars even when headshots existed in attributes. Attribute chips needed visual category cues configured by admin (for example Education in light blue).
- `Files`:
  - `src/lib/tree/load-tree-page-data.ts`
  - `src/lib/attributes/event-definitions-types.ts`
  - `src/lib/attributes/event-definitions.ts`
  - `src/app/api/t/[tenantKey]/attribute-definitions/route.ts`
  - `src/components/AttributeDefinitionsAdmin.tsx`
  - `src/components/AttributesModal.tsx`
  - `src/components/PersonEditModal.tsx`
  - `src/components/HouseholdEditModal.tsx`
- `Data Changes`: Existing definitions without `categoryColor` remain valid and are normalized with fallback colors.
- `Verify`:
  - Tree/family views show person headshots when a primary photo attribute exists.
  - Admin > Attribute Event Definitions allows selecting category colors.
  - Person About timeline chips, Household attribute chips, and Attributes modal chips display category tint colors.
  - `npm run build -- --no-lint` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-07 (person fixed panel main events copy + married summary details)

- `Change`: Updated Person fixed panel `About` > `Life Events` copy so `Schools Attended` and `Major Accomplishments and Events` display `coming`. Enhanced `Married` row to show spouse name plus wedding date and computed years married when a married attribute date exists.
- `Type`: UI
- `Why`: Requested content adjustments for contact/fixed-panel summary and clearer marriage snapshot details.
- `Files`:
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Person fixed panel shows `Schools Attended: coming`.
  - Person fixed panel shows `Major Accomplishments and Events: coming`.
  - `Married` shows `Name, Date, X years married` when marriage date exists; otherwise shows available fields/fallback.
  - `npm run build -- --no-lint` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-07 (attribute definitions UX polish + Next themeColor warning fix)

- `Change`: Reorganized Attribute Types admin screen into a cleaner two-pane editor (category list + selected category detail/types grid, sticky action bar, validation hints) and moved `themeColor` from `metadata` to `viewport` export in root layout for Next.js 15 compliance.
- `Type`: UI, Infra
- `Why`: Admin event-definition editor was functionally correct but hard to manage at scale; Next.js warned that `themeColor` in metadata is unsupported.
- `Files`:
  - `src/components/AttributeDefinitionsAdmin.tsx`
  - `src/app/layout.tsx`
- `Data Changes`: None.
- `Verify`:
  - Attribute Types tab supports category selection + focused type editing with save/discard workflow.
  - `npm run lint` passes.
  - `npm run build` passes.
  - Build output no longer includes `Unsupported metadata themeColor` warnings.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-07 (attribute type-category master/detail editor flow)

- `Change`: Updated the Attribute Types admin right pane to a master/detail flow: type category list box for the selected attribute type, and an edit box below for the selected type category (detail label, date mode, ask end date, enabled, sort order).
- `Type`: UI
- `Why`: Reduce editing complexity and match requested workflow (select type category first, then edit focused fields).
- `Files`:
  - `src/components/AttributeDefinitionsAdmin.tsx`
- `Data Changes`: None.
- `Verify`:
  - Select an attribute type in left pane.
  - Type categories appear in list box on right.
  - Selecting one opens editable fields below.
  - Save persists as before.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-07 (attribute definitions button placement refinement)

- `Change`: Moved `Add Category` into the left category panel below search, and placed `Add Type` beside `Delete Type Category` in the selected type editor.
- `Type`: UI
- `Why`: Align action placement with the editing context and requested workflow.
- `Files`:
  - `src/components/AttributeDefinitionsAdmin.tsx`
- `Data Changes`: None.
- `Verify`:
  - Left pane shows `Add Category` below search/list.
  - Selected type editor shows `Add Type` next to `Delete Type Category`.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-07 (category editor row compaction)

- `Change`: Compacted selected category editor top row so `Category Label`, `Sort`, and `Description` display in one row with tighter field widths.
- `Type`: UI
- `Why`: Keep the category edit surface concise and reduce vertical wrapping.
- `Files`:
  - `src/components/AttributeDefinitionsAdmin.tsx`
- `Data Changes`: None.
- `Verify`:
  - In selected category editor, `Category Label`, `Sort`, and `Description` render on a single row.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-07 (person About stories default + timeline chips sorting)

- `Change`: In person fixed panel About tab, Stories now launches the shared attribute modal with default event type category `Story`; Timeline now renders all person attributes as chips and supports ascending/descending sort.
- `Type`: UI
- `Why`: Align Stories entry with requested default flow and make Timeline more scan-friendly with explicit sort control.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/components/AttributesModal.tsx`
  - `src/lib/attributes/event-definitions.ts`
- `Data Changes`: None.
- `Verify`:
  - Clicking Stories add opens attribute modal preselected to life_event/story.
  - Timeline shows chips for person attributes and supports Ascending/Descending toggle.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-07 (suppress dependency DEP0169 url.parse warning)

- `Change`: Added server instrumentation that filters only `DEP0169` deprecation warnings (`url.parse()` legacy warning) emitted by dependency code during runtime.
- `Type`: Infra
- `Why`: Root cause is dependency usage (`next-auth -> openid-client@5.7.1`, plus Next internals) of legacy `url.parse()`, not application code.
- `Files`:
  - `src/instrumentation.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Runtime logs no longer include `(node:*) [DEP0169] ... url.parse()` for dependency paths.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-06 (family relationship safety guard + in-law parent visibility rule)

- `Change`: Hardened Family section persistence to prevent accidental relationship/household deletion by preserving selected spouse values in dropdowns, removing UI auto-clear behavior, tracking explicit family edits, and only invoking relationship prune/update when family values change (`familyChanged=true`). Added in-law UX rule to hide Mother/Father selectors and show guidance text.
- `Type`: UI, API
- `Why`: Root cause was a regression path where filtered spouse options could clear UI values and save payloads would be interpreted as intentional deletes in relationship builder prune logic.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/app/api/t/[tenantKey]/relationships/builder/route.ts`
- `Data Changes`: None.
- `Verify`:
  - Opening/saving person without family edits does not remove existing spouse/parent relationships.
  - Selected spouse remains visible in dropdown even when normally filtered out.
  - Relationship builder returns `skipped: true` when `familyChanged` is false.
  - In-law people hide Mother/Father dropdowns and show:
    `As an in-law your parents are not visible in this view. To see/Select your parents, change the family group.`
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-06 (things-about chip label safety + click-to-open add form)

- `Change`: Fixed Things About chip text rendering to safely handle non-string/object-backed values (preventing `[object Object]` labels) and restored chip click behavior to open the Things About attribute add form.
- `Type`: UI
- `Why`: Root cause was direct string operations on attribute values that could be objects, plus prior chip behavior change to non-clickable pills.
- `Files`:
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Things About chips render readable labels (for example `Eyes: Blue`) and never `[object Object]`.
  - Clicking a Things About chip opens the Things About add form.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-06 (remove chip detail modal path + pill chip visual update)

- `Change`: Removed chip click navigation into attribute detail/list modal flow from About tab, so this surface now uses add-attribute flow only; updated Things About chips to non-clickable pill styling with a light background, subtle border, and left icon dot.
- `Type`: UI
- `Why`: Root cause was chip click wiring that opened nested attribute modals (detail panel then parent attributes panel), creating an unwanted two-form experience.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/components/AttributesModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Clicking a Things About chip does not open attribute detail/list modals.
  - Add Attribute from About tab still opens the add form and returns to fixed person panel on close.
  - Things About chips display as pills with border, light fill, and left icon.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-06 (birthdate timezone fix + inline contact actions)

- `Change`: Fixed person birthdate display off-by-one behavior by parsing date-only strings as local calendar dates, and updated Contact section rows so phone has inline `Call/Text` actions and email has an inline `Email` action on the same line.
- `Type`: UI
- `Why`: Root cause was `new Date("YYYY-MM-DD")` timezone conversion (UTC -> local) shifting displayed date in US timezones; Contact actions were separated from their fields and less direct to use.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/components/PhoneLinkActions.tsx`
- `Data Changes`: None.
- `Verify`:
  - Birthdate shown in About/Life Events matches the stored calendar date (no one-day shift).
  - In Contact section, phone row shows editable number with `Call`/`Text` actions inline.
  - In Contact section, email row shows editable email with `Email` action inline when value is present.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-06 (things-about chips + click-to-open attribute detail)

- `Change`: Replaced static Things About placeholder/summary text with clickable chips derived from saved descriptor attributes (for example `Eyes: Blue`, `Allergy: Penicillin`) and wired chip clicks to open the existing attribute detail modal for that specific attribute.
- `Type`: UI
- `Why`: Root cause was the About panel rendering aggregated text only, so users could not open/edit/delete individual descriptor attributes directly from Things About.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/components/AttributesModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Things About section no longer shows the old placeholder summary lines.
  - Saved descriptor attributes render as chips.
  - Clicking a chip opens attribute detail (not add mode) for that record.
  - Detail view still supports media actions, edit/save, delete, and close.
  - Add buttons still open add mode.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-06 (attributes modal row alignment + About section labels/data binding)

- `Change`: Updated the Add Attribute modal layout so `Date Related` is on its own row and `Type` + `Type of ...` render on the same row; updated About tab section labels to `Life Events` / `Add Life Event` / `Add something about [name]`, and wired Things About summary values to live attribute data (including eye color and related physical/hobby descriptors).
- `Type`: UI
- `Why`: Root cause was inherited global responsive grid behavior (`.settings-chip-list`) causing unintended field pairing in the add form, and About section placeholders not reading descriptor attribute rows for display.
- `Files`:
  - `src/components/AttributesModal.tsx`
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - In Add Attribute modal, `Date Related` appears alone on one row.
  - `Type` and `Type of ...` appear on the same row.
  - About tab shows `Life Events` heading and `Add Life Event` button.
  - Things About section button reads `Add something about [name]`.
  - Saved descriptor values (for example eye color) appear in Things About health summary.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-05 (click-to-call and click-to-text links for phone fields)

- `Change`: Added reusable phone link parsing/rendering and enabled `tel:` + `sms:` actions anywhere phone values are displayed in person/profile attribute views.
- `Type`: UI
- `Why`: Phone values were plain text only; users could not tap to open dialer or messaging apps directly from profile screens.
- `Files`:
  - `src/lib/phone-links.ts`
  - `src/components/PhoneLinkActions.tsx`
  - `src/components/PersonEditModal.tsx`
  - `src/components/ProfileEditor.tsx`
- `Data Changes`: None.
- `Verify`:
  - Person modal header phone value shows `Call` and `Text` actions.
  - Phone-type attributes show `Call` and `Text` actions in both person modal and profile editor.
  - `tel:` launches dialer with target number.
  - `sms:` launches message composer with target number.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-05 (media library selected-links labels and ordering)

- `Change`: Updated Media Library link-selection UX so selected links/chips are shown above search inputs with explicit section labels (`Selected Links` / `Search to Add Links`) across upload modal, library linked-filter controls, and media edit panel.
- `Type`: UI
- `Why`: Improve clarity between already-selected links and typeahead lookup results.
- `Files`:
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - Upload modal shows selected link chips above search with clear labels.
  - Library linked filter shows selected chips above search with clear labels.
  - Edit Photo panel shows selected links section above search-to-add section.
  - `npm run lint` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-05 (media library chip UX + modal upload + linked-photo editor + load performance)

- `Change`: Refined Media Library UX with chip-based typeahead selectors (add via search, remove via `x`) for linked filters and upload targets, moved upload workflow into an `Add Photos` modal, added in-library `Edit Photo` detail panel with linked-to management matching person/household edit flows, and reduced initial load cost by removing duplicate fetch, lowering default load limit, adding optional Drive merge toggle, and adding short-lived API response caching.
- `Type`: UI, API, Performance
- `Why`: Root cause was a combination of heavy initial media-load query behavior and fragmented media-link management UX compared to person/household photo editors.
- `Files`:
  - `src/components/MediaLibraryClient.tsx`
  - `src/app/globals.css`
  - `src/app/api/t/[tenantKey]/photos/search/route.ts`
- `Data Changes`: None.
- `Verify`:
  - Media screen shows `Add Photos` button and opens upload modal.
  - Upload targets and linked filters use chip-style typeahead + removable `x` tokens.
  - Media card `Edit Photo` opens detail panel and supports add/remove people/household links.
  - Initial Media load starts at 100 items and does not double-fetch.
  - `Include unlinked Drive files` toggle controls Drive-merge behavior.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-05 (media library family-scope fallback + orphaned media link integrity tools)

- `Change`: Added family-scoped media search enhancements and dedicated orphan-media integrity actions. Media search now supports configurable limits and optional Drive-folder merge mode for media library views; Settings now includes separate `Scan Orphaned Media Links` and `Repair Orphaned Media Links` actions that audit/repair missing OCI `media_assets`/`media_links` rows from existing person/attribute/household references.
- `Type`: UI, API, Data
- `Why`: Root cause was missing family-scoped media link records for some existing files, causing media library omissions even when files existed in Drive and/or legacy references.
- `Files`:
  - `src/app/api/t/[tenantKey]/photos/search/route.ts`
  - `src/lib/google/drive.ts`
  - `src/components/MediaLibraryClient.tsx`
  - `src/app/api/t/[tenantKey]/integrity/route.ts`
  - `src/components/SettingsClient.tsx`
- `Data Changes`:
  - No schema changes.
  - Added optional repair path that can create missing `MediaAssets` and `MediaLinks` rows in OCI mode.
- `Verify`:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Media page can include family folder files when using Drive-merge query mode.
  - Integrity page exposes orphan-media scan and repair buttons.
  - `repair_orphan_media_links` returns created counts for missing `MediaAssets`/`MediaLinks`.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-05 (spouse family-group propagation + repair backfill)

- `Change`: Fixed spouse add/save flow to propagate spouse membership and household rows into parent-derived family groups, and extended integrity repair to backfill missing spouse family-group/household associations for existing data.
- `Type`: API, Data
- `Why`: Root cause was family-group scoping in spouse builder writes; spouse and household records were only created in the active family group and not propagated to both parents' family groups.
- `Files`:
  - `src/app/api/t/[tenantKey]/relationships/builder/route.ts`
  - `src/app/api/t/[tenantKey]/integrity/route.ts`
- `Data Changes`:
  - No schema changes.
  - Integrity repair now creates missing `PersonFamilyGroups` and `Households` rows for spouse pairs where parent-derived family-group propagation was missing.
- `Verify`:
  - Add spouse from person modal and confirm spouse + household appear in both parent family groups.
  - Run integrity repair and confirm response includes:
    - `repairedSpouseFamilyMembershipRows`
    - `repairedSpouseHouseholdRows`
    - `skippedSpouseHouseholdConflicts`
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-05 (top-level media library + multi-file attach to people/households)

- `Change`: Added a new top-level `Media` page with a shared library and multi-file upload flow that supports category/date and attaching uploads to multiple people and households using existing media attach endpoints.
- `Type`: UI, API
- `Why`: Users needed a centralized media workspace instead of uploading only from person/household modals.
- `Files`:
  - `src/components/HeaderNav.tsx`
  - `src/app/page.tsx`
  - `src/app/t/[tenantKey]/page.tsx`
  - `src/app/media/page.tsx`
  - `src/app/t/[tenantKey]/media/page.tsx`
  - `src/components/MediaLibraryClient.tsx`
  - `src/app/api/t/[tenantKey]/photos/search/route.ts`
- `Data Changes`: None.
- `Verify`:
  - New `Media` top-level nav item appears and routes to `/media` and `/t/[tenantKey]/media`.
  - Media library list loads existing photo/video/audio items.
  - Multi-file upload succeeds with category/date set.
  - Selected people and households receive links for uploaded files.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-05 (media upload multi-select reliability fix)

- `Change`: Fixed Media Library file picker behavior to support reliable multi-select workflows across repeated picks and added selected-files list management (`Remove` and `Clear all`).
- `Type`: UI
- `Why`: Root cause was file selection UX ambiguity and picker behavior that made it appear multi-select was not working consistently.
- `Files`:
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - Selecting files multiple times appends to selected list.
  - Selecting the same file again does not duplicate entry.
  - Selected file count and list are visible before upload.
  - Per-file `Remove` and `Clear all` work.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-05 (household photo tagging parity + attribute media link management)

- `Change`: Added full household photo-detail link management (search/add/remove linked people and households), enabled linking an existing media file to additional households via new API route, and expanded person media-detail/tagging flow to include attribute media (`photo/video/audio/media`) not just photo rows.
- `Type`: UI, API
- `Why`: Root cause was split edit experiences: person photo detail had tagging tools, while household photo detail and attribute media did not expose the same association-management flow.
- `Files`:
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/link/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/[photoId]/route.ts`
  - `src/components/HouseholdEditModal.tsx`
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - In Household -> Pictures -> Photo Detail: can search/add/remove people tags and linked households.
  - In Person -> Attributes -> Media Attributes: `Manage Links` opens shared media-detail flow with tagging tools.
  - Household unlink endpoint accepts either link ID or file ID in OCI mode.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-05 (media attachments: audio/mobile capture + attribute media + OCI search parity)

- `Change`: Expanded media attachments to support image/video/audio uploads across people, households, and attributes with shared validation/metadata handling; added mobile capture-friendly upload inputs; and switched media search to unified OCI media link tables in OCI mode.
- `Type`: UI, API, Data
- `Why`: Root cause was photo-centric media handling (image/video only in parts of UI, no centralized upload validation, no audio capture path, and search still tied to legacy photo rows).
- `Files`:
  - `src/lib/media/upload.ts`
  - `src/lib/media/upload.test.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/[attributeId]/route.ts`
  - `src/app/api/t/[tenantKey]/photos/search/route.ts`
  - `src/components/PersonEditModal.tsx`
  - `src/components/HouseholdEditModal.tsx`
  - `src/components/ProfileEditor.tsx`
  - `package.json`
- `Data Changes`: None (existing unified media tables reused).
- `Verify`:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Person/Household media upload supports image/video/audio from library plus mobile camera/audio capture inputs where browser/device supports `capture`.
  - Person Attributes tab can upload/list/delete media attributes.
  - OCI mode photo search reads `media_links` + `media_assets` instead of legacy-only photo rows.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-05 (unified media schema + one-pass non-destructive migration tooling)

- `Change`: Added unified OCI media tables (`media_assets`, `media_links`), API integration for household/person/attribute photo flows in OCI mode, and one-pass backfill/parity scripts that keep legacy tables intact.
- `Type`: Schema, API, Data, Infra
- `Why`: Photo data was split across multiple legacy tables/columns and did not support a consistent entity-link model for people, households, and attributes.
- `Files`:
  - `oci-schema.sql`
  - `src/lib/oci/tables.ts`
  - `src/lib/media/ids.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/[photoId]/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/[attributeId]/route.ts`
  - `scripts/oci-media-backfill.cjs`
  - `scripts/oci-media-parity.cjs`
  - `package.json`
- `Data Changes`:
  - Added new tables/indexes for unified media model.
  - Added migration script to backfill from legacy photo locations into `media_*`.
  - Kept all legacy tables/columns unchanged for rollback and parity verification.
- `Verify`:
  - `npm run lint` passes.
  - `npm run build` passes.
  - `npm run media:migrate:backfill` completes.
  - `npm run media:migrate:parity` reports `Overall parity: PASS`.
- `Rollback Notes`: Revert code deployment and continue using legacy photo tables; no destructive legacy-table writes were performed by this migration.
- `Design Decision Change`: No design decision change.

## 2026-03-04 (tree relationship lines restore: safe fallback on tenant-scoped read)

- `Change`: Restored Tree relationship rendering robustness by adding a safe fallback in relationship reads: if tenant-scoped OCI relationship load fails or returns zero rows, fall back to global relationship rows and rely on existing in-family filtering.
- `Type`: API, Reliability
- `Why`: Relationship lines could disappear in Tree even when OCI relationship data existed because tenant-scoped reads could resolve to an empty result silently.
- `Files`:
  - `src/lib/google/family.ts`
- `Data Changes`: None.
- `Verify`:
  - Tree view shows relationship lines again for affected families.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-04 (family-group switch feedback + spouse save consistency polish)

- `Change`: Added animated loading feedback in the family-group switcher, updated spouse-action labels for clarity, and strengthened spouse/family relationship upsert logic to keep spouse edges consistent with household saves.
- `Type`: UI, API, Performance
- `Why`: Family-group switches needed immediate visual acknowledgment, and spouse save flows needed stronger relationship-row consistency to avoid stale/missing spouse/family edges.
- `Files`:
  - `src/components/TenantSwitcher.tsx`
  - `src/app/globals.css`
  - `src/components/PersonEditModal.tsx`
  - `src/components/ProfileEditor.tsx`
  - `src/app/api/t/[tenantKey]/relationships/builder/route.ts`
  - `.gitignore`
- `Data Changes`: None.
- `Verify`:
  - Family-group dropdown shows animated `Switching family group...` indicator while switch is pending.
  - Spouse action label reads `Add New Person as Spouse` where applicable.
  - Spouse save updates relationship edges (`spouse`/`family`) consistently and preserves expected household linkage.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-04 (OCI navigation latency reduction: tenant-scoped reads + pooled connections)

- `Change`: Reduced server-side latency for people/tree/profile navigation by removing global relationship/attribute scans from hot paths and reusing OCI pooled connections.
- `Type`: API, Performance, Infra
- `Why`: Navigation remained slow because several pages loaded global `relationships` (then filtered in memory), `person_attributes` in OCI mode read the full table, and each data call created a fresh wallet-backed Oracle connection.
- `Files`:
  - `src/app/people/page.tsx`
  - `src/app/t/[tenantKey]/people/page.tsx`
  - `src/app/people/[personId]/page.tsx`
  - `src/app/t/[tenantKey]/people/[personId]/page.tsx`
  - `src/app/api/t/[tenantKey]/tree/route.ts`
  - `src/lib/tree/load-tree-page-data.ts`
  - `legacy OCI transition adapter`
  - `src/lib/oci/tables.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Route transitions between people/tree/profile are materially faster in OCI mode.
  - Family-group switching no longer triggers global relationships/attributes reads for these paths.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-04 (tree/people navigation performance + household render stability)

- `Change`: Optimized OCI read paths for tree/people navigation and stabilized tree household rendering bounds/refit behavior.
- `Type`: API, UI, Performance
- `Why`: Navigation between tree and people could take 10-25 seconds due to broad data loads, and household clusters could clip or fail to redraw correctly after layout/viewport changes.
- `Files`:
  - `src/lib/oci/tables.ts`
  - `src/lib/google/family.ts`
  - `src/lib/tree/load-tree-page-data.ts`
  - `src/components/TreeGraph.tsx`
- `Data Changes`: None.
- `Verify`:
  - Switching between `/tree` and `/people` feels materially faster in OCI mode.
  - Tree household clusters are no longer clipped after layout changes, viewport resize, or tab navigation.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-04 (duplicate lookup + explicit merge repair tool)

- `Change`: Added an explicit duplicate-people merge tool in Settings and API support to merge a selected source person into a selected target person with reference reassignment and dedupe safeguards.
- `Type`: UI, API, Data
- `Why`: Existing integrity auto-repair intentionally only removed low-risk duplicate rows, so many real duplicate cases appeared unchanged. This adds a controlled, operator-selected merge path.
- `Files`:
  - `src/app/api/t/[tenantKey]/integrity/route.ts`
  - `src/components/SettingsClient.tsx`
- `Data Changes`:
  - Merge operation can update/delete rows in:
    - `Relationships`
    - `Households`
    - `PersonAttributes`
    - `ImportantDates`
    - `PersonFamilyGroups`
    - `UserFamilyGroups`
    - `UserAccess`
    - `People` (source row delete)
- `Verify`:
  - Run Integrity Check and confirm duplicate groups appear in UI merge tool.
  - Select duplicate group, source person, and target person.
  - Execute merge and verify source person is removed and references resolve to target.
  - Re-run Integrity Check to confirm duplicate group count decreases.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy. Data rollback requires restoring affected rows from backup/export.
- `Design Decision Change`: No design decision change.

## 2026-03-04 (default household label on new spouse creation)

- `Change`: When creating a new spouse household, default household label now uses wife maiden last name + husband last name + `Family` (format: `<WifeLastName>-<HusbandLastName> Family`).
- `Type`: API, UI
- `Why`: Household rows created from spouse flow had no default label, causing inconsistent naming and extra manual cleanup.
- `Files`:
  - `src/app/api/t/[tenantKey]/relationships/builder/route.ts`
- `Data Changes`: None.
- `Verify`:
  - Create new spouse from person modal.
  - Confirm created household includes default label in expected format.
  - Confirm spouse/household creation flow still succeeds.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-04 (OCI membership write-path fix + targeted spouse/membership data repair)

- `Change`: Fixed OCI mode membership write path so `ensurePersonFamilyGroupMembership` performs OCI-native upsert instead of legacy-path writes. Repaired affected OCI data by inserting missing `person_family_groups` rows and creating missing household for the reported spouse pair.
- `Type`: API, Data
- `Why`: New spouse/person creation could succeed in `people` but fail tenant-scoped visibility and downstream spouse/household flows when membership rows were not written in OCI mode.
- `Files`:
  - `src/lib/oci/tables.ts`
  - `legacy OCI transition adapter`
- `Data Changes`:
  - Inserted missing `person_family_groups` rows for:
    - `p-0be8e91e` -> `snowestes`
    - `p-2201cda3` -> `snowestes`
    - `p-62ae5519` -> `snowestes`
  - Inserted missing spouse household row for:
    - `p-44b30ff9` + `p-2201cda3` in `snowestes`
- `Verify`:
  - `npm run lint` passes.
  - New spouse/person creates now persist tenant membership in OCI mode.
  - Affected people now resolve in tenant-scoped reads and spouse household exists.
- `Rollback Notes`: Revert this commit and redeploy. For data rollback, delete inserted repair rows by IDs.
- `Design Decision Change`: No design decision change.

## 2026-03-04 (Person modal spouse auto-select after create: race-condition fix)

- `Change`: Fixed spouse auto-selection after creating a new spouse from person modal by preventing transient cleanup logic from clearing the newly created spouse ID before options refresh.
- `Type`: UI
- `Why`: Newly created spouse appeared in the list but was not auto-selected due to a timing race between state updates and spouse-options reconciliation.
- `Files`:
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Create spouse via Add Spouse popout.
  - After create, spouse dropdown is automatically selected to the new person.
  - New spouse remains selected after option list refresh.
  - `npm run lint` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-04 (Person modal spouse flow: remove redundant existing-selector and use create-new popout)

- `Change`: Simplified spouse-add to two paths: existing spouse selection remains only in the Family spouse dropdown, and `Add Spouse` now opens a separate popout modal for `Create New Spouse` only.
- `Type`: UI
- `Why`: Remove redundant existing-person chooser inside Add Spouse and make add-new-person flow clearer and isolated from the main person modal form.
- `Files`:
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Existing spouse can be selected only via spouse dropdown in Family section.
  - `Add Spouse` opens a popout modal (not inline card).
  - Popout includes only create-new-person fields and actions.
  - Creating spouse still auto-links spouse and creates household.
  - `npm run lint` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-04 (Person modal spouse flow: upfront choice with default create-new)

- `Change`: Refined Add Spouse UI so the first step is an explicit choice between `Create New Person` (default) and `Select Existing Person`, and only the relevant panel is shown for the selected choice.
- `Type`: UI
- `Why`: Keep spouse-add flow consistent and clear across person modal usage; avoid showing the add-person form when the user intends to pick an existing person.
- `Files`:
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - In person modal Family section, `Add Spouse` opens with `Create New Person` selected by default.
  - Switching to `Select Existing Person` hides new-person fields and shows existing lookup/select only.
  - Switching back to `Create New Person` restores new-person spouse form.
  - `npm run lint` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-04 (Person modal: default new in-law spouse + immediate spouse/household persistence)

- `Change`: Updated person modal spouse flow to default to creating a new spouse (in-law), default spouse gender to opposite of the edited person, and immediately persist spouse relationship + household creation after spouse record creation.
- `Type`: UI, API
- `Why`: Current flow required an extra Save step after spouse creation and defaulted to existing-person mode, making new in-law spouse entry from person modal feel unavailable/incomplete.
- `Files`:
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Open person modal -> Family -> Add Spouse defaults to `Create New Person`.
  - `in-law` defaults checked.
  - New spouse gender defaults opposite of current person gender.
  - Creating spouse immediately establishes spouse link and household without extra modal Save.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-04 (OCI-only cutover + relational performance optimization for auth/access/people)

- `Change`: Completed OCI-only cutover for remaining direct Google-client routes/functions and moved high-traffic auth/access/people paths to relational OCI queries (DB-side filtering/joining) with supporting indexes.
- `Type`: API, Data, Schema, Infra
- `Why`: Remove residual legacy-backend runtime dependency and eliminate full-table app-side scans that added OCI latency under auth/session and tenant-access workflows.
- `Files`:
  - `src/lib/oci/tables.ts`
  - `legacy OCI transition adapter`
  - `src/app/api/t/[tenantKey]/admin-snapshot/route.ts`
  - `src/app/api/t/[tenantKey]/integrity/route.ts`
  - `src/app/api/family-groups/delete/route.ts`
  - `legacy admin CRUD smoke route`
  - `oci-schema.sql`
- `Data Changes`:
  - Added `audit_log` table DDL for OCI audit persistence.
  - Added OCI indexes:
    - `ix_user_family_groups_email`
    - `ix_user_family_groups_person`
    - `ix_user_family_groups_family`
    - `ix_user_access_person`
    - `ix_user_access_username`
    - `ix_person_family_groups_family`
- `Verify`:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Auth/session callbacks no longer rely on full-table in-memory filtering for OCI mode.
  - Admin snapshot/integrity/family-delete routes no longer require direct legacy source store client usage.
- `Rollback Notes`: Revert this commit and redeploy; OCI mode can be disabled by unsetting `OCI-only runtime mode`.
- `Design Decision Change`: No design decision change.

## 2026-03-04 (OCI parity verifier + OCI-backed table CRUD seam for cutover)

- `Change`: Added a legacy-source-vs-OCI parity verifier and introduced an OCI-backed table CRUD seam in `legacy OCI transition adapter` (enabled by `OCI-only runtime mode`) so existing route imports can switch storage backend without route-by-route rewrites. Added runtime wallet-file loading from `OCI_WALLET_FILES_JSON` for server deployments where local `TNS_ADMIN` paths are not available.
- `Type`: Infra, Data, API
- `Why`: Accelerate clean cutover by preserving current access-layer interface while replacing storage internals and adding objective migration parity checks.
- `Files`:
  - `oci-verify-parity.cjs`
  - `legacy OCI migration runner`
  - `src/lib/oci/tables.ts`
  - `legacy OCI transition adapter`
  - `src/types/oracledb.d.ts`
  - `tsconfig.json`
  - `package.json`
- `Data Changes`:
  - Reloaded OCI data with boolean normalization aligned to legacy-source semantics (`TRUE`/`FALSE`).
  - Revalidated parity after reload.
- `Verify`:
  - `npm run db:migrate:load` passes.
  - `npm run db:parity` returns `Overall parity: PASS`.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and keep `runtime backend mode flag` unset (legacy path remains active by default).
- `Design Decision Change`: No design decision change.

## 2026-03-04 (OCI schema + OCI transition migration tooling and first load)

- `Change`: Added OCI schema bootstrap SQL and a migration runner to move legacy source tables into OCI, including dry-run validation, load mode with truncate, and source/target row-count reporting.
- `Type`: Infra, Data, Schema
- `Why`: Establish an executable migration path from legacy-source-backed storage to OCI with evidence-driven validation before app cutover.
- `Files`:
  - `oci-schema.sql`
  - `legacy OCI migration runner`
  - `package.json`
- `Data Changes`:
  - Fixed 3 `UserFamilyGroups` rows in the legacy source store where `user_email` was blank by generating temporary values in format `firstname.lastname.TEMP@TEMP.org`.
  - Loaded OCI target tables from legacy store after remediation.
- `Verify`:
  - `npm run db:migrate:dry-run` passes and reports source counts.
  - `npm run db:migrate:load` passes and reports target counts matching source counts:
    - `people=11`
    - `person_family_groups=15`
    - `relationships=14`
    - `households=3`
    - `user_access=4`
    - `user_family_groups=10`
    - `family_config=2`
    - `family_security_policy=1`
    - `person_attributes=16`
    - `important_dates=0`
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this deployment commit. For data remediation/load rollback, restore affected Google Sheet rows and truncate/reload OCI tables from known-good snapshot.
- `Design Decision Change`: No design decision change.

## 2026-03-04 (OCI DB preflight gate for repo runtime readiness)

- `Change`: Added a repeatable OCI connection preflight command (`npm run db:preflight`) that validates required OCI env vars and performs a wallet/TNS-backed Oracle connection + `dual` query.
- `Type`: Infra, Ops
- `Why`: Confirm OCI database readiness in the same Node runtime path used by the app before making broader repo/database changes.
- `Files`:
  - `package.json`
  - `package-lock.json`
  - `scripts/oci-db-preflight.cjs`
- `Data Changes`: None.
- `Verify`:
  - `npm run db:preflight` returns `OCI preflight OK` and prints connected DB user/time.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-03 (people+households tiles + video media support + metadata capture)

- `Change`: Expanded People page to support both `People` and `Households` tile modes, added video-capable rendering in person/household media galleries/detail/upload previews, and captured file metadata into a dedicated `media_metadata` column with created timestamp fallback for default media date.
- `Type`: UI, API, Schema
- `Why`: Support mixed entity browsing on People page and make media workflows handle both photos and movies while preserving existing handlers/routes and sheet-backed storage patterns.
- `Files`:
  - `src/components/PeopleDirectory.tsx`
  - `src/app/people/page.tsx`
  - `src/app/t/[tenantKey]/people/page.tsx`
  - `src/components/PersonEditModal.tsx`
  - `src/components/HouseholdEditModal.tsx`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/route.ts`
  - `legacy OCI transition adapter`
  - `src/lib/google/types.ts`
  - `docs/data-schema.md`
- `Data Changes`:
  - Added `media_metadata` column support for person attributes and household gallery media.
  - Upload routes now persist JSON metadata (`fileName`, `mimeType`, `sizeBytes`, `createdAt`) in `media_metadata`.
  - If media date is omitted on upload, API defaults date from provided file-created timestamp (or current timestamp fallback).
- `Verify`:
  - People page toggles between `People` and `Households` card grids and household cards open existing household modal.
  - Person and household gallery/detail views can render video media with controls.
  - Upload picker accepts image/video and shows selected media preview before save.
  - Upload persists metadata to `media_metadata` and date defaults correctly when date input is blank.
  - `npm run build` passes.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-03 (tree vertical row spacing increase to prevent household overlap)

- `Change`: Increased family-tree generation row spacing so household clusters and labels do not overlap vertically.
- `Type`: UI
- `Why`: Root cause was fixed row gap too small for current household cluster/card footprint, causing row-to-row overlap in dense trees.
- `Files`:
  - `src/components/TreeGraph.tsx`
- `Data Changes`: None.
- `Verify`:
  - Family tree shows clear vertical separation between household rows/generations.
  - No household box/label overlap from top to bottom.
  - `npm run build` passes.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-04 (daily horoscope API + home card integration)

- `Change`: Added daily horoscope server route backed by Aztro and surfaced a new Horoscope card on both home pages (`/` and `/t/[tenantKey]`), including loading/missing-birthday/upstream-error states.
- `Type`: API, UI
- `Why`: Provide a lightweight daily engagement feature while reusing existing auth/session and person birthdate data without changing schemas or business flows.
- `Files`:
  - `src/app/api/horoscope/today/route.ts`
  - `src/components/home/HoroscopeCard.tsx`
  - `src/app/page.tsx`
  - `src/app/t/[tenantKey]/page.tsx`
- `Data Changes`: None. No table/column changes.
- `Verify`:
  - Logged-in user with birthdate gets populated horoscope card.
  - Logged-in user without birthdate gets friendly enable message + profile link.
  - Upstream failure shows retry state and does not break page render.
  - Route returns HTTP 200 for `missing_birthday` and `upstream_error` states.
  - Aztro is called only from server route.
  - `npm run build` passes.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-04 (auth token person_id fallback fix for Steve access)

- `Change`: Fixed Steve-access JWT token person resolution to prefer current enabled user-access mapping by email before using legacy fallback person ID.
- `Type`: Auth, Reliability
- `Why`: Root cause of horoscope `missing_birthday` despite valid people data was stale legacy person ID (`19660812-stephen-snow-estes`) retained in token/session after ID migration.
- `Files`:
  - `src/lib/auth/options.ts`
- `Data Changes`: None.
- `Verify`:
  - `GET /api/horoscope/today?tenantKey=<tenant>` resolves logged-in Steve user to current mapped `person_id` (for example `p-ae4081ae`) rather than legacy ID.
  - Horoscope returns `ok:true` when mapped person has birthdate.
  - `npm run build` passes.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-03 (household modal visual parity + pictures UX alignment)

- `Change`: Updated `HouseholdEditModal` to use the same modern modal shell and card-based visual language as person modal, and refactored household pictures tab to gallery/detail/upload overlay flows with staged upload preview actions.
- `Type`: UI
- `Why`: Align household and person editing experiences, improve mobile clarity, and make household photo workflows consistent without changing backend behavior.
- `Files`:
  - `src/components/HouseholdEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Household modal uses sticky header/tabs/content styling consistent with person modal.
  - Pictures tab shows gallery tiles and opens photo detail overlay.
  - Upload flow shows thumbnail preview and explicit `Choose Photo / Save / Cancel`.
  - Remove photo from household still uses existing delete route and does not delete library file.
  - No API routes/payloads/sheet schema changed.
  - `npm run build` passes.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-03 (photo detail typeahead + chips + single save UX)

- `Change`: Refactored Person Photo Detail into componentized Option-2 detail UX with `PhotoDetailHeader`, `PhotoInfoForm`, `PeopleTagger` (typeahead + chips), and `StickySaveBar` (single metadata save control).
- `Type`: UI
- `Why`: Simplify photo-detail interaction by replacing multiple scattered actions with mobile-first staged metadata editing, instant tag feedback, and one clear save path for metadata.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - Photo Detail shows `Back | Photo Detail | View Large` header and large preview.
  - Label/description/date/primary edits are staged in draft metadata and saved by one sticky `Save Changes` button.
  - Tagging uses in-memory typeahead results; selecting a person updates chips immediately and calls existing link behavior.
  - Removing non-current-person chips unlinks and updates chips immediately; failures rollback visual state.
  - `Remove from {CurrentPerson}` action remains explicit with confirmation.
  - No API routes, payload shapes, or sheet/data schema changed.
  - `npm run build` passes.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-03 (photo association management: add/remove with live save-state feedback)

- `Change`: Enhanced person-level photo association management in Photo Detail with explicit remove actions for linked people/households, duplicate-link prevention, and live association refresh/status after saves/removals.
- `Type`: UI
- `Why`: Users need clear confirmation of what is linked, avoid duplicate saves, and know immediately whether association changes persisted.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - `Add To Selected Person` disables when already linked and shows `Already Linked`.
  - Linked people list supports remove actions and updates immediately after removal.
  - Linked households list supports remove actions and updates immediately after removal.
  - Photo action buttons show `Saving...` and are disabled while requests are in flight.
  - Association status text updates for save/remove success/failure.
  - `npm run build` passes.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-03 (upload photo staged preview + explicit save/cancel actions)

- `Change`: Updated Person `Pictures` upload flow to stage selected file before upload, show thumbnail/file preview, and provide explicit `Save`, `Cancel`, and `Choose Another Photo` actions.
- `Type`: UI
- `Why`: Prevent metadata mistakes by confirming the selected image before upload and make upload intent/actions explicit.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - Selecting a photo in upload flow shows thumbnail preview and filename.
  - Metadata can be edited while preview is shown.
  - `Save` uploads the staged file with the same existing endpoint/payload.
  - `Cancel` clears staged file and closes upload flow.
  - `Choose Another Photo` replaces the staged file and updates preview.
  - `npm run build` passes.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-03 (person pictures tab option-2 UX: gallery + mobile full-screen detail)

- `Change`: Refactored Person modal `Pictures` tab UI to an Option-2 flow: gallery-first grid, mobile full-screen Photo Detail editor, dedicated Browse/Search Library picker, and dedicated Upload flow panel.
- `Type`: UI
- `Why`: Improve mobile-first photo management clarity without changing photo business logic, API behavior, or data contracts.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - Pictures tab loads same linked photos as before.
  - Tapping a photo opens detail editor with same metadata fields (name/description/date/primary).
  - Save metadata uses same save behavior and persists correctly.
  - Add-to-another-person action still links via existing handler.
  - Remove-from-current-person still unlinks via existing handler.
  - Browse Library search + link works as before.
  - Upload flow still uploads and links using existing endpoint and payload.
  - `npm run build` passes.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-02 (photo library metadata search + association-based linking)

- `Change`: Added tenant photo-library search endpoint and integrated search UI in Person modal Pictures tab to find photos by metadata and existing associations, then link results to the current person.
- `Type`: API, UI
- `Why`: Users needed to discover existing library photos by name/description/date and association context (people/households) before linking, instead of browsing blindly.
- `Files`:
  - `src/app/api/t/[tenantKey]/photos/search/route.ts`
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Person `Pictures` tab shows `Search Photo Library` with query input.
  - Search matches include metadata and association text (people + households).
  - Search result action can link an existing file to the current person.
  - Already-linked files are clearly disabled from duplicate-link action.
  - `npm run build` passes.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-02 (unified photo-link workflow for person + household)

- `Change`: Replaced file-ID-centric photo actions with a unified `Add Photo` upload/link workflow on person and household modals, added inline linked-photo galleries with metadata (`name`, `description`, `date`), and added checkbox-based link dissociation (without deleting files from Drive library).
- `Type`: UI, API, Schema
- `Why`: Users do not know file IDs; the old flow made photo add appear broken in real usage. Product requirement is one add action (camera/file), visible linked photos, and dissociation-only behavior.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/components/HouseholdEditModal.tsx`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/[photoId]/route.ts`
  - `legacy OCI transition adapter`
- `Data Changes`: Added household gallery media persistence with family-scoped file/link metadata support.
- `Verify`:
  - Person modal Photos tab: one `Add Photo` action opens camera/file picker on mobile and uploads file.
  - Person modal photo gallery displays preview + metadata and supports checkbox-based `Remove Selected Links`.
  - Household modal Pictures tab supports same add/gallery/remove-link behavior.
  - Dissociation removes only links (attribute/household photo row), not Drive file.
  - `npm run build` passes.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-02 (birthday tile date fix + person modal photo upload/gallery)

- `Change`: Fixed date rendering on people tiles to prevent one-day birthday shifts, and upgraded Person modal Photos tab to support direct image upload plus inline photo previews in the catalog.
- `Type`: UI, API Integration
- `Why`: Root causes were timezone-sensitive date parsing (`new Date('YYYY-MM-DD')`) and a Photos tab that only accepted manual file IDs, creating a no-op experience for expected upload behavior.
- `Files`:
  - `src/components/PeopleDirectory.tsx`
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Birthday shown on people tiles matches stored date exactly (no +/- 1 day shift).
  - Person modal `Photos` tab allows choosing an image file and successfully uploads it.
  - Uploaded photos appear in the same tab with visible preview thumbnails.
  - `npm run build` passes.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-02 (child personal address in household add-child flow)

- `Change`: Added optional child personal address capture in household add-child flow and persist to `People.address` when child is created.
- `Type`: UI, API
- `Why`: Unmarried children who do not live at household address need a person-level physical address at creation time.
- `Files`:
  - `src/components/HouseholdEditModal.tsx`
  - `src/app/api/t/[tenantKey]/households/[householdId]/children/route.ts`
- `Data Changes`: None. New child-create requests may include `address`.
- `Verify`:
  - Add Child form shows `Child Address (optional)` input.
  - Saving child persists provided address on the created person record.
  - Existing required child validations (birthdate + gender) still enforced.
  - `npm run build` passes.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-02 (household child add guardrails: required gender/birthdate + save lock)

- `Change`: Enforced required `birth_date` and explicit `gender` when adding a child from household modal, and blocked household save while child-add is in progress until child is saved or canceled.
- `Type`: UI, API, Validation
- `Why`: Root cause was permissive child form defaults (`gender=unspecified`) and missing workflow lock, which allowed partial/inconsistent household edits during child creation.
- `Files`:
  - `src/components/HouseholdEditModal.tsx`
  - `src/app/api/t/[tenantKey]/households/[householdId]/children/route.ts`
- `Data Changes`: None.
- `Verify`:
  - Child save is blocked if `birth_date` is empty.
  - Child save is blocked if `gender` is not selected (`male` or `female`).
  - `Save Household` is disabled while Add Child form is open.
  - Canceling Add Child clears child draft and re-enables household save.
  - `npm run build` passes.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-02 (photo access decoupled from single family folder)

- `Change`: Updated photo proxy resolution so authorized users can load person/household photos regardless of which family photo folder currently contains the file.
- `Type`: API, Reliability
- `Why`: Root cause was tenant-folder coupling in photo routes. The route required file parent to match the route tenant `photos_folder_id`, which blocked valid photos visible through shared person/household access when file storage was in another family folder.
- `Files`:
  - `src/lib/google/photo-resolver.ts`
  - `src/app/t/[tenantKey]/viewer/photo/[fileId]/route.ts`
  - `src/app/viewer/photo/[fileId]/route.ts`
- `Data Changes`: None.
- `Verify`:
  - Same person/household photo renders when viewed from another authorized family context.
  - Photo routes still return `403` when caller lacks viewer/session tenant access.
  - `npm run build` passes.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-02 (household contact fields + people email consistency)

- `Change`: Aligned data ownership so household records now read/write `address`, `city`, `state`, `zip`, and people records consistently read/write `email` and `hobbies` across create/edit/import/provision flows.
- `Type`: API, UI, Schema
- `Why`: Root cause was inconsistent People write paths after introducing `email`; several secondary create/import endpoints omitted `email`, causing data drift. Household contact fields also needed full API/UI wiring.
- `Files`:
  - `src/lib/google/types.ts`
  - `legacy OCI transition adapter`
  - `src/lib/google/family.ts`
  - `src/lib/validation/person.ts`
  - `src/app/api/t/[tenantKey]/people/route.ts`
  - `src/app/api/family-groups/provision/route.ts`
  - `src/app/api/family-groups/[familyGroupKey]/import-members/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/children/route.ts`
  - `src/components/PersonEditModal.tsx`
  - `src/components/HouseholdEditModal.tsx`
  - `src/components/PeopleDirectory.tsx`
  - `src/components/TreeGraph.tsx`
  - `src/app/people/page.tsx`
  - `src/app/t/[tenantKey]/people/page.tsx`
  - `src/app/tree/page.tsx`
  - `src/app/t/[tenantKey]/tree/page.tsx`
- `Data Changes`: No migration run. Existing data remains intact; new/updated writes now preserve `People.email` in all covered API paths.
- `Verify`:
  - Person modal shows/edit-saves `email` and `hobbies` at people level.
  - Household modal shows/edit-saves `address`, `city`, `state`, `zip`.
  - Family provision/import and household-child create flows do not drop `People.email`.
  - `npm run build` passes.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-02 (typed opaque IDs + migration endpoint)

- `Change`: Implemented typed 8-character opaque IDs for new entities (`p-`, `rel-`, `h-`, `attr-`, `date-`) and added admin migration endpoint to remap existing IDs and cross-table references.
- `Type`: API, Data, Schema, Ops
- `Why`: Replace long human-readable IDs with stable typed IDs while preserving entity-type readability and enabling full historical ID migration.
- `Files`:
  - `src/lib/entity-id.ts`
  - `src/lib/person/id.ts`
  - `src/app/api/t/[tenantKey]/people/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/children/route.ts`
  - `src/app/api/t/[tenantKey]/relationships/builder/route.ts`
  - `src/app/api/t/[tenantKey]/import/csv/route.ts`
  - `src/app/api/family-groups/provision/route.ts`
  - `src/app/api/admin/migrate-entity-ids/route.ts`
  - `docs/design-decisions.md`
- `Data Changes`: No automatic runtime migration. Migration available via admin endpoint:
  - dry-run: `POST /api/admin/migrate-entity-ids?dryRun=1`
  - execute: `POST /api/admin/migrate-entity-ids?dryRun=0` with body `{"confirm":"MIGRATE_ENTITY_IDS"}`
- `Verify`:
  - New people IDs are created as `p-xxxxxxxx`.
  - New relationships/households/attributes follow `rel-`, `h-`, `attr-` prefixes.
  - CSV imports auto-generate IDs for relationships/households/important dates when missing.
  - Migration dry-run returns remap counts and samples without writing.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit; if migration executed, restore legacy-source backup.
- `Design Decision Change`: Updated entity ID decision in `docs/design-decisions.md`.

## 2026-03-02 (header user modal with sign-out + account/app info)

- `Change`: Replaced static top-right user chip with a clickable user modal showing name, role, login type, app version, and a direct `Sign out` action.
- `Type`: UI
- `Why`: Users needed a clear sign-out path and quick account/session diagnostics in the header, especially on mobile.
- `Files`:
  - `src/components/AppHeader.tsx`
  - `src/components/UserMenu.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - Tapping/clicking the upper-right avatar opens the user menu.
  - Menu shows display name, role, login type (`Google` or `Local`), and app version.
  - `Sign out` in the modal routes to `/api/auth/signout`.
  - Menu works on desktop and mobile header layouts.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit.
- `Design Decision Change`: No design decision change.

## 2026-03-02 (tenant access diagnostics for mobile 403s)

- `Change`: Added explicit tenant-access diagnostics (`/api/debug/tenant-access`) and a user-facing `/access-denied` page; middleware now redirects tenant-access denials there with requested tenant/path context.
- `Type`: Ops, Routing, Diagnostics
- `Why`: Root cause investigation for mobile-only failures needed definitive evidence when `/t/[tenantKey]/*` is blocked by session access mismatch (`403`) rather than data/render issues.
- `Files`:
  - `src/middleware.ts`
  - `src/app/api/debug/tenant-access/route.ts`
  - `src/app/access-denied/page.tsx`
- `Data Changes`: None.
- `Verify`:
  - Accessing a tenant route without membership redirects to `/access-denied` instead of generic plain `Forbidden`.
  - `/api/debug/tenant-access?tenantKey=<key>` returns current user email, active tenant cookies, tenantAccesses, and `hasRequestedTenantAccess`.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit.
- `Design Decision Change`: No design decision change.

## 2026-03-02 (tenant header/navigation now route-tenant aware)

- `Change`: Made `AppHeader` accept an optional route tenant key and updated all tenant-scoped pages to pass it, so header family switch context and mobile page-selector links are built from the route tenant.
- `Type`: UI, Routing, Reliability
- `Why`: Root cause was mixed tenant resolution: page data on `/t/[tenantKey]/*` used the route tenant, but header/nav still used cookie-selected tenant. On mobile this could navigate to the wrong family path and show incorrect/empty tree results.
- `Files`:
  - `src/components/AppHeader.tsx`
  - `src/app/t/[tenantKey]/page.tsx`
  - `src/app/t/[tenantKey]/tree/page.tsx`
  - `src/app/t/[tenantKey]/people/page.tsx`
  - `src/app/t/[tenantKey]/people/[personId]/page.tsx`
  - `src/app/t/[tenantKey]/today/page.tsx`
  - `src/app/t/[tenantKey]/games/page.tsx`
  - `src/app/t/[tenantKey]/settings/page.tsx`
- `Data Changes`: None.
- `Verify`:
  - Open `/t/meldrumclark/tree` on mobile and confirm page selector links stay under `/t/meldrumclark/*`.
  - Switch family via header dropdown and confirm destination and data remain aligned to selected route family.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit.
- `Design Decision Change`: No design decision change.

## 2026-03-02 (admin delete person + household workflow)

- `Change`: Added admin delete workflows for person and household with preview-first impact reporting and explicit confirm actions in Admin > Data & System.
- `Type`: API, UI
- `Why`: Admin had no built-in way to safely remove incorrect people/households; deletes needed dependency cleanup and clear impact visibility before execution.
- `Files`:
  - `src/app/api/t/[tenantKey]/people/[personId]/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/route.ts`
  - `src/components/SettingsClient.tsx`
  - `src/app/globals.css`
- `Data Changes`: No migration. Runtime delete actions now remove dependent rows tied to target person/household (relationships, memberships/access, attributes, and related household/spouse rows per preview).
- `Verify`:
  - Admin > Data & System shows `Delete Person / Household` section.
  - Person delete supports preview and removes targeted dependent rows on confirm.
  - Household delete supports preview and removes targeted household plus spouse/family relationship rows on confirm.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-02 (delete-flow quota hotfix: remove post-delete fan-out reads)

- `Change`: Removed automatic post-delete admin reload fan-out (`loadFamilyAccessRows` + `runIntegrityCheck`) from person/household delete actions.
- `Type`: UI, Performance, Reliability
- `Why`: Root cause of immediate post-delete crashes was quota pressure from stacked reads right after a delete request; `family-access` read path was hitting upstream 429.
- `Files`:
  - `src/components/SettingsClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - Delete person/household still completes and refreshes UI.
  - Post-delete flow no longer auto-calls integrity/family-access reads.
  - `npm run lint` passes.
- `Rollback Notes`: Revert this hotfix commit.
- `Design Decision Change`: No design decision change.

## 2026-03-02 (settings quota hotfix: lazy cross-family people fetch)

- `Change`: Made cross-family people fetch in Settings lazy and one-time per tenant set, loading only when `Family Groups` tab/modal needs it.
- `Type`: UI, Performance, Reliability
- `Why`: Root cause of extra legacy-store reads after unrelated actions was eager `tenantOptions -> /api/t/{tenant}/people` fan-out on Settings mount.
- `Files`:
  - `src/components/SettingsClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - Opening Settings no longer immediately triggers `/api/t/*/people` for all tenants unless entering Family Groups/create flow.
  - Family Groups existing-person/import options still load when that tab/modal is used.
  - `npm run lint` passes.
- `Rollback Notes`: Revert this hotfix commit.
- `Design Decision Change`: No design decision change.

## 2026-03-02 (delete household UX: on-demand list + dropdown)

- `Change`: Added admin households list API and wired Delete Household UI with `Load Households` on-demand button plus selectable dropdown (manual ID input kept as fallback).
- `Type`: API, UI
- `Why`: Users do not know household IDs; previous delete-household input-only UX was not usable.
- `Files`:
  - `src/app/api/t/[tenantKey]/households/route.ts`
  - `src/components/SettingsClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - Admin > Data & System > Delete Household shows `Load Households`.
  - Clicking `Load Households` populates dropdown with household label/spouse names/ID.
  - Selecting a household fills delete target and preview/confirm still work.
  - `npm run lint` passes.
- `Rollback Notes`: Revert this commit.
- `Design Decision Change`: No design decision change.

## 2026-03-02 (tree spacing/label fixes + child family-group inheritance)

- `Change`: Tuned tree spouse-cluster geometry and row nudge logic to keep spouse pairs adjacent/overlapping consistently, reduced household box over-width pressure, and ensured household label fallback shows household ID when label is blank; also updated add-child flow to inherit all enabled family-group memberships from either parent.
- `Type`: UI, API
- `Why`: Household cards showed inconsistent spouse spacing/overlap and missing top household label in some clusters; child add was only attaching child to active family instead of parent-access families.
- `Files`:
  - `src/components/TreeGraph.tsx`
  - `src/app/api/t/[tenantKey]/households/[householdId]/children/route.ts`
- `Data Changes`: No migration. New child-create operations now write additional `PersonFamilyGroups`/`UserFamilyGroups` links when parents are enabled in multiple families.
- `Verify`:
  - Tree households render tighter (less over-wide), spouse pairs remain adjacent/overlapped consistently.
  - Household label area shows content for previously blank-label clusters (falls back to household ID).
  - Adding child from household in one family results in child membership in all enabled parent family groups.
  - `npm run lint` passes.
- `Rollback Notes`: Revert this commit.
- `Design Decision Change`: No design decision change.

## 2026-03-02 (delete person preview table compact layout)

- `Change`: Made delete-person preview table use compact fixed layout with wrapping to reduce horizontal overflow/scrolling.
- `Type`: UI
- `Why`: Impact labels were too wide, forcing horizontal scroll and hiding values.
- `Files`:
  - `src/components/SettingsClient.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - Delete Person preview table fits card width on desktop/laptop without left-right scrolling.
  - Long impact labels wrap cleanly and counts remain visible.
  - `npm run lint` passes.
- `Rollback Notes`: Revert this commit.
- `Design Decision Change`: No design decision change.

## 2026-03-02 (mobile header compact variant + page switcher)

- `Change`: Added mobile-specific header layout with compact top row (`logo`, `EFL`, family dropdown, user avatar) and a second-row page selector showing current section options (`Home`, `People`, `Family Tree`, `Today`, `Games`, `Admin` for admins).
- `Type`: UI
- `Why`: Existing mobile header consumed too much vertical space and duplicated desktop structure; needed a denser mobile-first control layout.
- `Files`:
  - `src/components/AppHeader.tsx`
  - `src/components/HeaderNav.tsx`
  - `src/components/FamilyGroupSwitcher.tsx`
  - `src/components/TenantSwitcher.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - On mobile width, header is shorter and subtitle `Keep your family story alive` is hidden.
  - Top row shows `logo`, `EFL`, family dropdown (without role text), and avatar.
  - Second row shows page selector with current section selected and navigation works.
  - Desktop header/nav remain unchanged.
  - `npm run lint` passes.
- `Rollback Notes`: Revert this commit.
- `Design Decision Change`: No design decision change.

## 2026-03-02 (person modal parent defaulting from spouse)

- `Change`: Updated Person Edit modal parent selectors so choosing Mother auto-defaults Father to her known spouse, and choosing Father auto-defaults Mother similarly.
- `Type`: UI
- `Why`: Parent entry flow was only defaulting `Spouse` field but not auto-populating the opposite parent field.
- `Files`:
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - In person modal `Family` section, selecting Mother auto-sets Father when selected Mother has a spouse link.
  - Selecting Father auto-sets Mother when selected Father has a spouse link.
  - `Spouse` field continues to default from selected parent.
  - `npm run lint` passes.
- `Rollback Notes`: Revert this commit.
- `Design Decision Change`: No design decision change.

## 2026-03-02 (PWA installability + standalone launch splash)

- `Change`: Updated web manifest for install-friendly app metadata and added a standalone-launch splash overlay (`logo`, app name, tagline) shown once per session when launched in installed app mode.
- `Type`: UI, PWA
- `Why`: Support phone home-screen install behavior with app-like launch experience and branded tagline.
- `Files`:
  - `public/site.webmanifest`
  - `src/app/layout.tsx`
  - `src/components/AppLaunchSplash.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - iOS Safari `Add to Home Screen` / Android Chrome `Install app` available.
  - App launches in standalone mode with icon/name from manifest.
  - On first standalone launch per session, branded splash appears briefly with `Keep your family story alive.`.
  - `npm run lint` passes.
- `Rollback Notes`: Revert this commit.
- `Design Decision Change`: No design decision change.

## 2026-03-02 (tenant-scoped pages now honor route tenant key)

- `Change`: Updated tenant-scoped app pages (`/t/[tenantKey]/*`) to resolve tenant context from route param rather than active-family cookie/session default.
- `Type`: UI, Routing, Reliability
- `Why`: Root cause of incorrect tree/people/settings rendering for one family on mobile was tenant mismatch: page path pointed to one family while data loaded using a different active cookie family.
- `Files`:
  - `src/lib/auth/session.ts`
  - `src/app/t/[tenantKey]/page.tsx`
  - `src/app/t/[tenantKey]/tree/page.tsx`
  - `src/app/t/[tenantKey]/people/page.tsx`
  - `src/app/t/[tenantKey]/people/[personId]/page.tsx`
  - `src/app/t/[tenantKey]/today/page.tsx`
  - `src/app/t/[tenantKey]/games/page.tsx`
  - `src/app/t/[tenantKey]/settings/page.tsx`
- `Data Changes`: None.
- `Verify`:
  - Visiting `/t/<family>/tree` consistently loads people for `<family>` regardless of prior active-family cookie state.
  - Same consistency for `/t/<family>/people`, `/today`, `/games`, `/settings`, and person detail.
  - `npm run lint` passes.
- `Rollback Notes`: Revert this commit.
- `Design Decision Change`: No design decision change.

## 2026-02-27

- `Change`: Globalized relationship handling and removed legacy household partner compatibility.
- `Type`: API, Data, Schema
- `Why`: Relationships should remain consistent across family groups; simplify household column usage.
- `Files`:
  - `src/lib/google/family.ts`
  - `src/app/api/t/[tenantKey]/relationships/builder/route.ts`
  - `src/app/api/family-groups/provision/route.ts`
  - `src/app/api/t/[tenantKey]/import/csv/route.ts`
  - `src/app/tree/page.tsx`
  - `src/app/t/[tenantKey]/tree/page.tsx`
  - `src/app/api/t/[tenantKey]/tree/route.ts`
  - `src/app/people/[personId]/page.tsx`
  - `src/app/t/[tenantKey]/people/[personId]/page.tsx`
  - `scripts/normalize-relationships-global.cjs`
- `Data Changes`: Normalized legacy `rel_id` values to canonical global IDs and removed duplicate rows if present.
- `Verify`:
  - Tree view shows only people/edges for selected family membership.
  - Relationship edits persist consistently across families.
  - CSV import for `households` requires `husband_person_id` and `wife_person_id`.
- `Rollback Notes`: Revert commit and restore `Relationships` tab from backup if needed.

## 2026-02-27 (follow-up)

- `Change`: Removed scoped-table resolution capability and added touch pinch-zoom for tree navigation.
- `Type`: API, UI
- `Why`: Reduce resolver overhead/complexity and improve mobile tree usability.
- `Files`:
  - `legacy OCI transition adapter`
  - `src/components/TreeGraph.tsx`
  - `AGENTS.md`
  - `docs/release-checklist.md`
  - `docs/design-decisions.md`
- `Data Changes`: No direct data mutation in this release entry.
- `Verify`:
  - App resolves all table reads/writes from global tabs only.
  - Family tree supports touch pinch in/out and pan on mobile.
  - Existing mouse wheel zoom and control buttons still work.
- `Rollback Notes`: Revert commits `5e46436` and the scoped-table cleanup commit if required.

## 2026-02-27 (family delete + create modal)

- `Change`: Added Family Group deletion workflow (preview + execute), orphan integrity checks, and moved Create Family Group into modal UX.
- `Type`: API, UI
- `Why`: Support safe family-group deletion without deleting people/households and improve settings flow clarity.
- `Files`:
  - `src/app/api/family-groups/delete/route.ts`
  - `src/app/api/t/[tenantKey]/integrity/route.ts`
  - `src/components/SettingsClient.tsx`
- `Data Changes`: Deletion workflow removes family membership/access/config rows for a selected group; optional user disable when no remaining family access.
- `Verify`:
  - Settings > Family Groups shows `Delete Family Group` button and modal.
  - Delete preview lists orphaned people, orphaned households, users-to-disable, and family attributes to delete.
  - Integrity checker reports orphaned people/households/users with no family groups.
  - Create Family Group opens as a modal and preserves existing create/import behavior.
- `Rollback Notes`: Revert commits `0b00504` and modal follow-up commit if required.
- `Design Decision Change`: No design decision change.

## 2026-02-28 (family create wizard + workflow governance)

- `Change`: Replaced Create Family Group flow with a 4-step modal wizard (matriarch, patriarch, initial admin/import preview, summary/create), added preview API for suggested spouse/children import, and enforced repo workflow governance in `AGENTS.md`.
- `Type`: UI, API, Docs
- `Why`: Match the required creation process, improve clarity/debug visibility, and standardize release workflow rules.
- `Files`:
  - `src/components/SettingsClient.tsx`
  - `src/app/api/family-groups/provision/route.ts`
  - `src/app/api/family-groups/provision-preview/route.ts`
  - `AGENTS.md`
  - `designchoices.md`
  - `changeHistory.md`
- `Data Changes`: No direct migration; new family creation now captures first/middle/last/nick/birthdate for matriarch/patriarch and uses selected import candidates.
- `Verify`:
  - Settings > Family Groups > Create Group opens step wizard.
  - Step 3 loads suggested spouse/children for selected initial admin.
  - Step 4 shows summary and create status/debug notes.
  - Successful create switches active family group to new group.
- `Rollback Notes`: Revert this deployment commit and restore prior modal behavior.
- `Design Decision Change`: No design decision change.

## 2026-02-28 (reuse existing parents in family create flow)

- `Change`: Added optional reuse of existing matriarch/patriarch in Create Family Group wizard, with searchable lookup.
- `Type`: UI, API
- `Why`: Avoid forced creation of duplicate top-level parent records and reduce orphan risk when deleting families.
- `Files`:
  - `src/components/SettingsClient.tsx`
  - `src/app/api/family-groups/provision/route.ts`
  - `TODO.md`
- `Data Changes`: No migration. New creates may reference existing parent person IDs instead of creating new parent rows.
- `Verify`:
  - In Create Group wizard, Step 1/2 supports `Use existing ...` + search/select.
  - Create request succeeds when existing parent IDs are selected.
  - Parent members are linked into the new family and household creation still works.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-02-28 (family-create diagnostics + person duplicate guard)

- `Change`: Added family-create failure diagnostics (no more `500 null`) and duplicate prevention flow for Add Person (same birthdate + same/similar name).
- `Type`: API, UI
- `Why`: Improve incident diagnosis and prevent accidental duplicate person creation.
- `Files`:
  - `src/app/api/family-groups/provision/route.ts`
  - `src/components/SettingsClient.tsx`
  - `src/app/api/t/[tenantKey]/people/route.ts`
  - `src/components/AddPersonCard.tsx`
  - `TODO.md`
- `Data Changes`: None.
- `Verify`:
  - Family create failures return meaningful JSON error in modal debug text.
  - Add Person blocks exact same-name+birthdate duplicates.
  - Add Person prompts confirmation for same-birthdate similar-name cases.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-02-28 (build fix: typed family-create response)

- `Change`: Fixed TypeScript build failure in `SettingsClient` by adding explicit typing/guards for family-create API response parsing.
- `Type`: UI
- `Why`: Vercel build failed with `Property 'familyGroupKey' does not exist on type '{}'`.
- `Files`:
  - `src/components/SettingsClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - Vercel build passes the previous `SettingsClient.tsx:518` type error stage.
  - Family create modal still displays success/failure/debug text.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-02-28 (gender-filtered global parent lookup)

- `Change`: Updated Create Family Group existing-parent lookup to allow global people selection by gender:
  - Matriarch list = female only
  - Patriarch list = male only
  - Includes people from any family group (including orphans if gender is set)
- `Type`: UI
- `Why`: Support selecting existing parents across families while enforcing role/gender intent.
- `Files`:
  - `src/components/SettingsClient.tsx`
  - `src/app/t/[tenantKey]/settings/page.tsx`
- `Data Changes`: None.
- `Verify`:
  - Create Group modal existing matriarch search returns only female people.
  - Create Group modal existing patriarch search returns only male people.
  - Results include people outside current family when present in global People data.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-02-28 (existing-parent UX completion in family create)

- `Change`: Completed existing-parent create flow UX:
  - fixed global name resolution for selected existing matriarch/patriarch
  - hid manual name/birth fields when using existing parent
  - auto-defaulted matriarch maiden name from selected person middle name (editable)
- `Type`: UI
- `Why`: Remove confusing required-field behavior after selecting existing parent and support faster family-key generation.
- `Files`:
  - `src/components/SettingsClient.tsx`
  - `src/app/t/[tenantKey]/settings/page.tsx`
- `Data Changes`: None.
- `Verify`:
  - Selecting existing matriarch/patriarch no longer requires manual name/birth fields.
  - Selected existing names resolve correctly across families.
  - Matriarch maiden name defaults from middle name when blank and remains editable.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-02-28 (fix existing-parent scope mismatch)

- `Change`: Fixed family create API validation/copy path for existing parents to use global people scope (not source-family-only scope).
- `Type`: API
- `Why`: UI now allows selecting matriarch/patriarch from any family, but API still rejected non-source-family selections with `invalid_existing_patriarch` / `invalid_existing_matriarch`.
- `Files`:
  - `src/app/api/family-groups/provision/route.ts`
- `Data Changes`: None.
- `Verify`:
  - Create Group succeeds when selecting existing parents that are not in the source family.
  - Existing parent records are copied/linked into new family as expected.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-02-28 (provision call-count instrumentation + read-pressure reduction)

- `Change`: Reduced family-provision read pressure and added per-run debug call counters.
- `Type`: API, UI
- `Why`: Investigate and mitigate Google upstream quota errors during family creation.
- `Files`:
  - `src/app/api/family-groups/provision/route.ts`
  - `src/components/SettingsClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - Family create success debug output includes call counters.
  - Provision flow uses fewer repeated membership reads than previous implementation.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-02-28 (provision quota hardening follow-up)

- `Change`: Added failure-path debug counters and removed extra source-family people read in family provision flow.
- `Type`: API
- `Why`: Quota errors still occurred and failure responses did not include call-counter diagnostics.
- `Files`:
  - `src/app/api/family-groups/provision/route.ts`
- `Data Changes`: None.
- `Verify`:
  - On `provision_failed`, response includes `debug` counters.
  - Source people derivation uses global people + source membership filtering, avoiding one full extra people read.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-02-28 (create-flow call reduction: initial admin step + optional preview)

- `Change`: Moved Initial Admin selection to step 1 and made spouse/children preview optional; skipped household/relationship recompute when explicit candidate IDs are provided.
- `Type`: UI, API
- `Why`: Reduce legacy-store read pressure and quota hits during family creation.
- `Files`:
  - `src/components/SettingsClient.tsx`
  - `src/app/api/family-groups/provision/route.ts`
- `Data Changes`: None.
- `Verify`:
  - Initial Admin is selected in step 1.
  - Step 3 preview no longer auto-loads unless requested.
  - Provision skips household/relationship reads when candidate IDs are already supplied.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-02-28 (hidden Steve super-access)

- `Change`: Added hidden developer super-access behavior for `stephensestes@gmail.com` that grants global family-group ADMIN session scope without introducing a new visible role in dropdowns.
- `Type`: Auth, Access
- `Why`: Ensure full cross-family administrative control for developer workflows while preserving current `ADMIN`/`USER` UI schema.
- `Files`:
  - `src/lib/auth/options.ts`
  - `legacy OCI transition adapter`
  - `src/types/next-auth.d.ts`
  - `docs/design-decisions.md`
- `Data Changes`: None.
- `Verify`:
  - Developer account can access/switch all family groups without explicit per-family access rows.
  - Existing role dropdowns remain unchanged (`ADMIN`/`USER` only).
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: Added access-control decision record in `docs/design-decisions.md`.

## 2026-02-28 (stabilize Steve session auth)

## 2026-03-01 (profile crash diagnostics + relationship quota reduction + parent/tree relationship UX hardening)

- `Change`: Added request-scoped diagnostics/fallback on profile pages, reduced relationship-builder read/write amplification to lower upstream quota failures, constrained parent selection to age-eligible candidates (>=15 years older), and centered sibling placement under parent household midpoints in tree layout.
- `Type`: API, UI, Ops
- `Why`: Root causes were limited production observability on server-render failures and avoidable repeated upstream operations causing `Read requests per minute per user` quota exhaustion; relationship editing also allowed implausible parent selection and tree child alignment drift under parent households.
- `Files`:
  - `src/app/people/[personId]/page.tsx`
  - `src/app/t/[tenantKey]/people/[personId]/page.tsx`
  - `src/app/api/t/[tenantKey]/relationships/builder/route.ts`
  - `src/components/ProfileEditor.tsx`
  - `src/components/PersonEditModal.tsx`
  - `src/components/TreeGraph.tsx`
- `Data Changes`: None.
- `Verify`:
  - Profile load failures render a user-safe fallback including `requestId` and `errorCode`, with matching server logs per route step.
  - Saving relationships returns `429` with quota hint on quota exceed and avoids unnecessary edge/household rewrites.
  - Mother/father picklists exclude candidates that are not at least 15 years older than the edited person (when birthdates are present).
  - Family tree children appear visually centered beneath the related parent household cluster.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-01 (people page crash diagnostics hardening)

- `Change`: Added request-scoped diagnostics and safe fallback rendering to both People page routes.
- `Type`: UI, Ops
- `Why`: Root cause was unhandled server errors in people page data-loading path (`getPeople/getRelationships/getHouseholds/getPersonAttributes`) that surfaced only as production digest crashes. The page now logs step-level telemetry and returns a non-crashing fallback with `requestId` + `errorCode`.
- `Files`:
  - `src/app/people/page.tsx`
  - `src/app/t/[tenantKey]/people/page.tsx`
- `Data Changes`: None.
- `Verify`:
  - On transient backend failure/quota event, people page shows fallback card with `requestId/errorCode` instead of generic application error.
  - Server logs include `load_people_page_data` step start/ok/error with matching `requestId`.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-01 (quota hotfix: people/tree read pressure + fallback diagnostics)

- `Change`: Added short TTL server read-bundle caching for People/Tree routes, added step-level diagnostics + fallback cards on Tree routes, and replaced hard page reloads after editor saves with route refresh calls.
- `Type`: API, UI, Ops
- `Why`: Root cause confirmed in Vercel logs was upstream read-quota exhaustion on read-heavy server routes (`/people`, `/tree`). This reduces burst read amplification and ensures graceful failure with actionable request identifiers.
- `Files`:
  - `src/lib/server/route-cache.ts`
  - `src/app/people/page.tsx`
  - `src/app/t/[tenantKey]/people/page.tsx`
  - `src/app/tree/page.tsx`
  - `src/app/t/[tenantKey]/tree/page.tsx`
  - `src/components/PeopleDirectory.tsx`
  - `src/components/TreeGraph.tsx`
- `Data Changes`: None.
- `Verify`:
  - Repeated route visits to People/Tree no longer fail as quickly under burst usage.
  - On quota failures, People/Tree show non-crashing fallback with `requestId` and `errorCode`.
  - Save flows from directory/tree editors still refresh and show updated data.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

- `Change`: Stabilized Steve-access JWT callback by reusing cached tenant access list and avoiding repeated legacy-store reads on each token refresh.
- `Type`: Auth
- `Why`: Prevent intermittent login/session drops caused by repeated access-list reads under quota pressure.
- `Files`:
  - `src/lib/auth/options.ts`
- `Data Changes`: None.
- `Verify`:
  - Login remains stable for developer account.
  - Session does not drop when navigating across family groups.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-02-28 (crash diagnosis runbook + requestId instrumentation)

- `Change`: Added collaborative crash-diagnosis runbook, expanded logging standards with request correlation/error codes, and implemented shared route diagnostics in high-risk APIs (`/api/people`, `/api/family-groups/provision`).
- `Type`: API, Docs, Infra
- `Why`: Improve true root-cause diagnosis for `500`/quota failures and make incident triage repeatable with Steve.
- `Files`:
  - `docs/runbook-crash-diagnosis.md`
  - `docs/logging-standards.md`
  - `src/lib/diagnostics/route.ts`
  - `src/app/api/people/route.ts`
  - `src/app/api/family-groups/provision/route.ts`
- `Data Changes`: None.
- `Verify`:
  - Error responses from instrumented routes include `requestId`, `step`, and `errorCode`.
  - Logs include `requestId=<id>` and matching `status=error` entries for failures.
  - Lint/build pass.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-02-28 (relationship save diagnostics + parent selection consistency)

- `Change`: Hardened relationship builder ID compatibility (`rel_id`/`relationship_id`/`id`) with failure-phase diagnostics, and updated Profile Editor parent selection to use gender-filtered options while auto-aligning spouse selection.
- `Type`: API, UI
- `Why`: Improve root-cause visibility for relationship-save failures and reduce inconsistent parent/spouse combinations during profile editing.
- `Files`:
  - `src/app/api/t/[tenantKey]/relationships/builder/route.ts`
  - `src/components/ProfileEditor.tsx`
  - `src/app/people/[personId]/page.tsx`
  - `src/app/t/[tenantKey]/people/[personId]/page.tsx`
- `Data Changes`: None.
- `Verify`:
  - Relationship save failure responses include `debug.phase`.
  - Relationship updates succeed when `Relationships` uses any of `rel_id`, `relationship_id`, or `id`.
  - Profile parent dropdowns show mother/father options by gender and spouse auto-updates when selecting a parent with known spouse.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-01 (settings UI hierarchy + tabbed admin layout refresh)

- `Change`: Restyled Settings screen into a compact 3-tab hierarchy (`Users & Access`, `Family Groups`, `Data & System`), simplified Users default view with toolbar + Users card, converted boolean access columns into status chips, and consolidated integrity/import tools under `Data & System` without changing behavior.
- `Type`: UI
- `Why`: Reduce visual noise, improve hierarchy/readability, and align settings UX with modern soft-neutral design standards.
- `Files`:
  - `src/components/SettingsClient.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - Settings top tabs map to the same existing tools/actions.
  - Family-group selector still drives the same state and data loads.
  - Add/Manage User actions still perform the same API calls and flows.
  - CSV Import and Integrity Checker actions still work from `Data & System`.
  - Lint/build pass.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-01 (quota reduction: relationship builder read amplification)

- `Change`: Reduced legacy-store read amplification in relationship-save flow by batching relationship creates, batching stale-edge deletes by row number, and caching table metadata lookups.
- `Type`: API, Performance, Reliability
- `Why`: Vercel logs showed repeated `legacy metadata calls` and `GET values/Relationships!A1:ZZ` calls during relationship updates, causing upstream per-user read quota exhaustion (`429` -> surfaced `500` in UI flows).
- `Files`:
  - `legacy OCI transition adapter`
  - `src/app/api/t/[tenantKey]/relationships/builder/route.ts`
- `Data Changes`: None.
- `Verify`:
  - Relationship save performs one relationships read, one batched delete (if needed), and one batched append (if needed), rather than repeated per-edge/per-delete full-tab reads.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-01 (incremental legacy store hardening: nav prefetch + read dedupe)

- `Change`: Disabled Next.js link prefetch on header/home navigation links to reduce multi-route background SSR fan-out, added in-flight tab read de-duplication in legacy access layer, and throttled recurring People schema checks in hot read path.
- `Type`: UI, API, Performance, Reliability
- `Why`: Vercel logs showed single navigation actions triggering multiple route renders and repeated legacy-store reads (`People`, `PersonFamilyGroups`, metadata) that increase quota pressure.
- `Files`:
  - `src/components/HeaderNav.tsx`
  - `src/components/AppHeader.tsx`
  - `src/app/page.tsx`
  - `src/app/t/[tenantKey]/page.tsx`
  - `legacy OCI transition adapter`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Family-group switch/tree navigation no longer prefetches multiple app pages in the background.
  - Concurrent same-tab reads in one request path collapse to one in-flight read.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-01 (family-group switch duplicate tree render fix)

- `Change`: Removed redundant `router.refresh()` after `router.push()` in family-group switch flow to prevent duplicate page renders on switch.
- `Type`: UI, Routing, Performance
- `Why`: Vercel logs showed one family-group switch action causing two `/tree` renders with different request IDs, doubling legacy-store reads for the same transition.
- `Files`:
  - `src/components/TenantSwitcher.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Family-group switch generates one route render instead of two for the destination page.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-01 (family-group switch deterministic navigation)

- `Change`: Updated family-group switch navigation to perform deterministic full-page navigation (`window.location.assign`) after active-family update, removing remaining App Router transition duplicates.
- `Type`: UI, Routing, Performance
- `Why`: Logs still showed multiple `/tree` renders from one switch event after removing `router.refresh`; this change enforces one destination navigation.
- `Files`:
  - `src/components/TenantSwitcher.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npm run build` passes.
  - One family-group switch should produce one destination page render request.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-01 (tree page duplicate-render read dedupe guard)

- `Change`: Added shared tree-page data loader with per-tenant in-flight de-duplication and a short (3s) cache window, and wired both `/tree` and `/t/[tenantKey]/tree` pages to it.
- `Type`: API, Performance, Reliability
- `Why`: Switch-flow telemetry showed duplicate tree renders with repeated legacy-store read sets; this guard prevents immediate duplicate renders from re-reading legacy store.
- `Files`:
  - `src/lib/tree/load-tree-page-data.ts`
  - `src/app/tree/page.tsx`
  - `src/app/t/[tenantKey]/tree/page.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Immediate duplicate tree renders reuse cached/in-flight load and reduce repeated legacy-store reads.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-01 (remove hot-path People schema check)

- `Change`: Removed runtime schema-enforcement call from `getPeople()` hot read path.
- `Type`: API, Performance, Reliability
- `Why`: Tree/People page reads were still issuing duplicate `People!A1:ZZ` fetches; one source was schema-check work in the same request path.
- `Files`:
  - `legacy OCI transition adapter`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Tree/People load external API calls no longer include a second `People!A1:ZZ` read from this path.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-01 (tree UX simplification: direct person modal flow)

- `Change`: Updated tree person cards to vertical format (photo, first name, birthdate), removed per-card dot actions, removed non-editable focus panel flow, and routed person-card click directly to the person modal. Also moved household label text to top-center inside household cluster box.
- `Type`: UI
- `Why`: Improve tree readability and reduce interaction complexity by using a single person-detail interaction path.
- `Files`:
  - `src/components/TreeGraph.tsx`
  - `src/components/familyTree/PersonNodeCard.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Clicking a person card opens person modal directly.
  - Person cards render vertical with image, first name, and birthdate.
  - Household label appears top-center in household box.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-01 (tree visual density + interaction safety refinements)

- `Change`: Reduced person card width, tightened spouse spacing, reduced household actions to one dot, improved household label typography/wrapping (shorter, larger, bold with line-wrap), disabled mouse-wheel zoom, and increased top tree padding to prevent clipping of top household box.
- `Type`: UI
- `Why`: Improve tree readability, reduce accidental interactions, and prevent top-of-canvas clipping.
- `Files`:
  - `src/components/TreeGraph.tsx`
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Tree cards are narrower, spouse pairs are visually tighter.
  - Household shows one action dot.
  - Long household labels wrap cleanly within top-center label area.
  - Mouse wheel no longer zooms.
  - Top household cluster no longer clips at viewport top.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-05 (edit photo linked-to redesign + edit phone formatting)

- `Change`: Refactored Edit Photo detail UI in person and household modals to match the redesigned structure: `Edit Photo` header with top-right close, large preview, cleaner photo info block, consolidated `Linked To` section (people + households), per-row unlink controls, and sticky footer actions (`Cancel`, `Save Changes`) while preserving existing link/save API behavior. Also normalized edit-screen phone formatting to `(XXX) XXX-XXXX` for person phone input and phone attribute input flows.
- `Type`: UI, UX
- `Why`: Remove duplicated linking UI paths, align photo editor with modern modal layout, and improve phone value readability/consistency in edit screens.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/components/HouseholdEditModal.tsx`
  - `src/app/globals.css`
  - `src/components/ProfileEditor.tsx`
  - `src/lib/phone-format.ts`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Edit Photo shows one `Linked To` list with people (gender placeholder avatars) and households (house icon), with per-row remove controls.
  - Photo save/link/unlink behavior remains on existing routes and persists as before.
  - Phone fields in edit screens format to `(XXX) XXX-XXXX` on blur / save path where applicable.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-05 (attributes for people/households + attribute media attachments)

- `Change`: Added a new `Attributes` data model for people and households (one value per attribute row), new `/api/attributes` CRUD endpoints, compact grouped Attribute summaries on both Person and Household modals, and a reusable `AttributesModal` manager with add/edit/delete/search/tabs. Extended existing photo upload routes to support attaching media directly to an existing attribute via `attributeId`, reusing current upload/link flows and media-link persistence (`entity_type = "attribute"`).
- `Type`: API, Data, UI, UX
- `Why`: Implement compact, data-dense attributes management across both entity types without introducing a separate uploader or changing existing person/household photo behavior.
- `Files`:
  - `src/lib/attributes/types.ts`
  - `src/lib/attributes/store.ts`
  - `src/lib/validation/attributes.ts`
  - `src/app/api/attributes/route.ts`
  - `src/app/api/attributes/[attributeId]/route.ts`
  - `src/components/AttributesModal.tsx`
  - `src/components/PersonEditModal.tsx`
  - `src/components/HouseholdEditModal.tsx`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/upload/route.ts`
  - `legacy OCI transition adapter`
  - `src/lib/oci/tables.ts`
  - `docs/data-schema.md`
- `Data Changes`: Additive schema support for `Attributes` table mapping (legacy store + OCI) and OCI runtime table bootstrap for `attributes`.
- `Verify`:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Person and Household screens show compact grouped Attributes sections (Descriptors/Events) with summarize-on-duplicates behavior.
  - `AttributesModal` supports add/edit/delete/search and media attach/remove against attribute records.
  - Existing person/household photo upload and linkage behavior remains unchanged when `attributeId` is not supplied.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-05 (person attributes UX redesign to list + detail drawer + add modal; media-card click-to-edit)

- `Change`: Refactored the Person/Household `AttributesModal` into a 3-part flow (list-only default view, attribute detail drawer with view/edit toggle, and dedicated add-attribute modal) while preserving existing attribute/media API routes and payloads. Also updated Media Library cards so clicking a thumbnail opens the edit photo panel, removing the separate `Edit Photo` button.
- `Type`: UI, UX
- `Why`: Root cause was a mixed single-screen attributes experience (list + add/edit + attachments together), which made workflows hard to follow; media edit affordance was split between thumbnail and a secondary button.
- `Files`:
  - `src/components/AttributesModal.tsx`
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: None.
- `Verify`:
  - `AttributesModal` opens to list-only view with filter tabs + search.
  - Clicking an attribute opens detail drawer; edit toggle and delete keep existing behavior.
  - `+ Add Attribute` opens dedicated modal and saves via existing `/api/attributes` create flow.
  - Attribute media attach/remove in drawer still uses existing upload/remove routes.
  - Media Library thumbnail click opens photo editor; separate card `Edit Photo` button is no longer shown.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-05 (person attributes tab cleanup: remove legacy inline controls)

- `Change`: Removed the legacy inline attributes UI from the Person modal Attributes tab (table, inline Add Attribute, Upload Media Attribute, and media-attribute tile actions) so the tab now relies on the unified `Manage Attributes` flow only.
- `Type`: UI, UX
- `Why`: Root cause was mixed rendering of old and new attributes UIs in the same tab, creating duplicate/inconsistent actions and user confusion.
- `Files`:
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Person `Attributes` tab shows `Manage Attributes` section only (no inline add/upload controls).
  - Attribute create/edit/delete/media attach workflows still work via `Manage Attributes` modal.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-05 (attributes modal CTA dedupe + add-modal media attach wiring)

- `Change`: Removed duplicate `+ Add Attribute` CTA rendering in `AttributesModal` (single bottom action), and wired Add Modal media actions (`Add Photo`, `Add Video`, `Add Audio`) to save-first then auto-open the corresponding upload picker in the attribute detail drawer.
- `Type`: UI, UX
- `Why`: Root cause was dual CTA rendering (empty-state CTA + sticky CTA) and intentionally disabled media buttons in add modal, which caused confusion and non-functional controls.
- `Files`:
  - `src/components/AttributesModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Manage Attributes screen shows only one bottom `+ Add Attribute` button.
  - In Add Attribute modal, media buttons are clickable.
  - Clicking `Add Photo/Video/Audio` saves the attribute and opens the relevant file picker flow.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-05 (attribute detail card readability + safe title rendering + add-media chooser)

- `Change`: Reworked `AttributesModal` saved-detail drawer into a readable card hierarchy with safe display helpers, fixed raw object title rendering (`[object Object]`), formatted date ranges for display, moved media section ahead of destructive actions, lowered delete visual emphasis, and added a single `Add Media` chooser with `File From Device`, `Camera` (mobile), `Media Library`, and `Audio` options.
- `Type`: UI, UX
- `Why`: Root cause was direct interpolation of raw attribute values in the detail title and chip-like detail presentation that made saved state hard to read; media next-step actions were fragmented and not clearly prioritized.
- `Files`:
  - `src/components/AttributesModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Saved attribute header never shows `[object Object]` and displays a readable title.
  - Detail section shows clean read-only rows and user-friendly date format.
  - Media appears before delete; delete has lower emphasis than edit.
  - `Add Media` exposes file/camera/library/audio choices.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-05 (attributes modal UX polish: simplified close/actions/layout language)

- `Change`: Removed add-modal top-right close `X`, aligned `Type` and `Category` on one row, capitalized category/type option labels, updated `Value` copy to event/mission naming language, simplified media source chooser options to `File From Device`, `Media Library`, and `Camera` (mobile), and stabilized list-view panel height to reduce tab-based layout jumps.
- `Type`: UI, UX
- `Why`: Root cause was redundant close affordances, inconsistent field language, and shifting panel layout that made the workflow feel unstable and harder to scan.
- `Files`:
  - `src/components/AttributesModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Add modal closes via `Cancel` / save flow only (no top-right X).
  - Type + Category render side-by-side on common widths.
  - Category/type option labels are title-cased.
  - Value field labels/event naming are clearer.
  - Add Media options match requested sources.
  - Switching tabs no longer causes major panel height jumps.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-06 (person About labeling + stable modal sizing)

- `Change`: Renamed person-facing `Attributes` labels to `About [FirstName]` in the Person modal tab, summary section title, manage button, and attributes manager subtitle. Added stable minimum height to person modal content to prevent visible size/shape shifts when selecting the About tab.
- `Type`: UI, UX
- `Why`: Root cause was inconsistent/legacy naming and variable-content height causing modal layout jumpiness when switching tabs.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/components/AttributesModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Person tab label shows `About [FirstName]`.
  - Summary section and manage flow use matching `About [FirstName]` wording.
  - Switching tabs no longer changes the modal frame size noticeably.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-06 (contact tab layout: Name section + conditional maiden name + full-width notes)

- `Change`: Updated Person modal Contact Info layout by renaming `Basics` to `Name`, showing a conditional `Maiden Name` field (for female with spouse selected) in the Name section, and moving notes out of the Family section into a dedicated `Notes` section that spans both grid columns.
- `Type`: UI, UX
- `Why`: Improve information hierarchy and reduce crowding in Family details while matching requested naming and layout behavior.
- `Files`:
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Contact tab shows section title `Name`.
  - `Maiden Name` appears only when gender is female and a spouse is selected.
  - `Notes` appears in its own full-width section below the two-column cards.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-06 (about tab: fixed-size 4-panel scaffold + full-width unknowns section)

- `Change`: Replaced the Person modal `About [FirstName]` tab content with a fixed two-column/four-panel layout (`Main Events`, `Things about [Name]`, `Stories`, `Timeline`) plus a full-width `What we don't yet know about you` section matching Contact tab notes placement. Added `Add (coming soon)` buttons at the bottom of sections 1-4 and removed the embedded manage-attributes summary panel from this tab.
- `Type`: UI, UX
- `Why`: Root cause was the About tab using a different embedded modal/screen pattern than Contact Info, which caused inconsistent sizing/shape and mismatched layout expectations.
- `Files`:
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - About tab keeps the same modal shell size pattern as Contact Info.
  - Four cards render in the requested positions with section titles.
  - Sections 1-4 each show `Add (coming soon)` at the bottom.
  - Full-width `What we don't yet know about you` section renders in row-spanning position.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-06 (person modal fixed panel with internal tab scrolling)

- `Change`: Converted person modal shell to a fixed-height panel and moved tab overflow to internal content scrolling so switching between `Contact Info`, `About [FirstName]`, and `Pictures` does not resize the modal frame.
- `Type`: UI, UX
- `Why`: Root cause was content-driven panel sizing (`max-height` + outer overflow and tab content min-height), which allowed taller tabs like Contact Info to expand the modal relative to shorter tabs.
- `Files`:
  - `src/app/globals.css`
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: None.
- `Verify`:
  - Modal frame height stays fixed when switching person tabs.
  - Tab content scrolls inside the content area when content exceeds available height.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-06 (attributes: remove embedded media_metadata usage from Attributes flows)

- `Change`: Removed `media_metadata` dependency from attribute schema headers and attribute write paths. Attribute media linking remains in `MediaAssets`/`MediaLinks`; Attributes now no longer writes/depends on `media_metadata`.
- `Type`: Architecture, Data, API cleanup
- `Why`: Root cause was mixed media storage responsibility, with media metadata still being written/read on `Attributes` while link tables already exist for media associations.
- `Files`:
  - `legacy OCI transition adapter`
  - `src/lib/oci/tables.ts`
  - `src/lib/attributes/store.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/import/csv/route.ts`
  - `src/app/api/t/[tenantKey]/integrity/route.ts`
- `Data Changes`: No net DB mutation required in current environment.
  - Verified via OCI query that `attributes.media_metadata` was already absent (`Column already absent`).
- `Verify`:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Attribute create/update/upload flows no longer attempt to write `media_metadata` on Attributes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-06 (person modal fixed panel height increased ~15%)

- `Change`: Increased the person modal fixed panel height budget from `min(92vh, 920px)` to `min(96vh, 1058px)` to show more content at once while keeping fixed-frame behavior.
- `Type`: UI, UX
- `Why`: Root cause was limited visible content area after switching to fixed panel mode; this adjustment increases available viewport space without reverting to content-driven frame resizing.
- `Files`:
  - `src/app/globals.css`
- `Data Changes`: None.
- `Verify`:
  - Person modal frame remains fixed across tab switches.
  - Visible content area is noticeably taller than prior fixed-height release.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: No design decision change.

## 2026-03-06 (single-table attribute consolidation: migrate legacy PersonAttributes into Attributes)

- `Change`: Consolidated attribute persistence to the unified `Attributes` table and added compatibility coverage for legacy person/photo flows. Implemented one-time migration on read that copies legacy `PersonAttributes` rows into `Attributes` (by `attribute_id`) and switched legacy constants/routes/import/integrity references to operate on the unified table path.
- `Type`: Architecture, Data, API
- `Why`: Root cause was a mixed storage model (`PersonAttributes` and `Attributes`) where different screens/endpoints read and wrote different tables, producing inconsistent behavior and incomplete cross-screen visibility.
- `Files`:
  - `legacy OCI transition adapter`
  - `src/lib/attributes/store.ts`
  - `src/lib/oci/tables.ts`
  - `src/app/api/t/[tenantKey]/import/csv/route.ts`
  - `src/app/api/t/[tenantKey]/integrity/route.ts`
  - `src/app/api/admin/migrate-entity-ids/route.ts`
  - `docs/design-decisions.md`
  - `designchoices.md`
- `Data Changes`: Yes (migration behavior)
  - On first unified person-attribute read per tenant, legacy `PersonAttributes` rows are copied into `Attributes` if missing by `attribute_id`.
  - OCI `attributes` table ensure step now adds legacy-compat columns used by person/photo flows.
- `Verify`:
  - Legacy person-attribute endpoints continue returning expected records while sourcing from unified `Attributes`.
  - Unified `/api/attributes` reads include rows created by legacy person/photo flows.
  - CSV import target `person_attributes` writes to `Attributes` with canonical and compatibility fields.
  - Integrity checks referencing person attributes operate against unified tab constant.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this commit and redeploy.
- `Design Decision Change`: Updated (`docs/design-decisions.md`, `designchoices.md`).

## 2026-03-06 (legacy person_attributes table removed)

- `Change`: Removed remaining runtime references to legacy `PersonAttributes` and dropped OCI table `person_attributes` after cutover validation. Updated attribute media utility scripts and schema docs to reflect a single-table attribute model.
- `Type`: Architecture, Data, Cleanup
- `Why`: Root cause was lingering legacy table existence after consolidation, which risked drift/confusion despite canonical reads/writes already targeting `Attributes`.
- `Files`:
  - `legacy OCI transition adapter`
  - `src/lib/oci/tables.ts`
  - `scripts/oci-media-backfill.cjs`
  - `scripts/oci-media-parity.cjs`
  - `scripts/drop-legacy-person-attributes.cjs`
  - `docs/data-schema.md`
  - `docs/design-decisions.md`
  - `designchoices.md`
- `Data Changes`: Yes.
  - Executed `DROP TABLE person_attributes PURGE` in OCI.
- `Verify`:
  - Drop script returns `Legacy table not found: person_attributes` on repeat run.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Restore from DB backup/snapshot if legacy table is needed again.
- `Design Decision Change`: Updated (`docs/design-decisions.md`, `designchoices.md`).
## 2026-03-06 (attributes schema reset to event/descriptor model with dynamic type categories)

- `Change`: Reworked attribute create/edit payloads and storage mapping to a simplified schema focused on event/descriptor facts, and added a one-time OCI reset script that deletes all existing attribute rows and drops legacy columns.
- `Type`: Data, Schema, UI
- `Why`: Root cause was legacy attribute shape drift (`type_key/category/value_text/date_start/...`) from older flows, which conflicted with the new desired model and made Add Attribute behavior inconsistent.
- `Files`:
  - `src/components/AttributesModal.tsx`
  - `src/components/PersonEditModal.tsx`
  - `src/lib/validation/attributes.ts`
  - `src/lib/attributes/store.ts`
  - `legacy OCI transition adapter`
  - `src/lib/oci/tables.ts`
  - `scripts/reset-attributes-schema.cjs`
  - `package.json`
  - `docs/design-decisions.md`
  - `designchoices.md`
  - `docs/data-schema.md`
- `Data Changes`: Yes.
  - Executed `npm run attributes:reset-schema`.
  - Evidence:
    - `attributes rows before delete: 2`
    - `attributes rows after delete: 0`
    - `columns added: 6`
    - `legacy columns dropped: 8`
- `Verify`:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Add Attribute flow now writes canonical fields:
    - `attribute_id, entity_type, entity_id, attribute_type, attribute_type_category, attribute_date, date_is_estimated, estimated_to, attribute_detail, attribute_notes, end_date`.
- `Rollback Notes`: Restore attributes table from DB backup snapshot and revert this commit.
- `Design Decision Change`: Updated (`docs/design-decisions.md`, `designchoices.md`).
## 2026-03-06 (person family spouse fallback + attribute modal flow regressions)

- `Change`: Fixed person Family spouse initialization to fall back to spouse/family relationship edges when no household row is present, prevented parent dropdown changes from auto-clearing spouse to blank, and continued the in-progress Attributes modal fixes for chip text safety, add-modal delete action, and return-to-About-tab flow.
- `Type`: UI, Logic
- `Why`: Root cause was data-source mismatch (Family Tree can resolve spouse from relationships while person editor spouse value previously relied on households only), plus add/edit modal branch gaps that caused missing delete action and confusing post-save navigation.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/components/AttributesModal.tsx`
- `Data Changes`: No.
- `Verify`:
  - `npm run lint` passes.
  - `npm run build` compiles and completes static generation in this environment (command timeout occurred after completion output; no build errors were emitted).
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-06 (attribute editor object-value coercion fix)

- `Change`: Normalized attribute editor field binding to coerce object-shaped runtime values into safe text for `attributeTypeCategory`, `attributeDetail/valueText`, `label`, and date fields before rendering chips/forms.
- `Type`: UI, Logic
- `Why`: Root cause was object-shaped payload fragments reaching input bindings during edit-load, causing literal `[object Object]` in `Describe ...` fields and degraded chip labels.
- `Files`:
  - `src/components/AttributesModal.tsx`
- `Data Changes`: No.
- `Verify`:
  - Edit existing attributes no longer renders `[object Object]` in detail inputs.
  - Things/About chip labels can render `TypeCategory: Detail` when both fields exist.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-06 (attribute object fallback for display/detail binding)

- `Change`: Extended safe attribute value extraction to fall back to first primitive object value when preferred keys are absent.
- `Type`: UI, Logic
- `Why`: Root cause was object-shaped runtime values with non-standard keys resolving to empty text, causing blank `Describe ...` fields even when DB `attribute_detail` was correct.
- `Files`:
  - `src/components/AttributesModal.tsx`
- `Data Changes`: No.
- `Verify`:
  - DB rows remain unchanged; UI now shows text instead of blank for object-shaped values.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-06 (temporary attribute raw JSON debug panel)

- `Change`: Added a temporary debug panel under the Add/Edit Attribute Save actions to display raw JSON from the GET attributes payload (selected/editing item preferred).
- `Type`: Debug
- `Why`: Diagnose mismatch between stored `attribute_detail` values and form/chip rendering without guessing.
- `Files`:
  - `src/components/AttributesModal.tsx`
- `Data Changes`: No.
- `Verify`:
  - Open Add/Edit Attribute modal and confirm raw object payload is visible below Save.
- `Rollback Notes`: Remove debug panel once diagnosis is complete.
- `Design Decision Change`: No design decision change.
## 2026-03-06 (OCI CLOB fetch fix for attribute_detail)

- `Change`: Configured Oracle driver to fetch CLOB values as strings.
- `Type`: Data access
- `Why`: Root cause of `[object Object]` payload values was CLOB/Lob conversion via `String(value)` in generic row mapping.
- `Files`:
  - `src/lib/oci/tables.ts`
- `Data Changes`: No.
- `Verify`:
  - Attribute GET payload returns text for `attributeDetail/valueText` instead of `[object Object]` when source column is CLOB.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-06 (person modal polish + in-law reconciliation + debug toggle)

- `Change`: Implemented relationship-save in-law reconciliation (family-group scoped), improved person contact action button alignment and shading, swapped footer button order (Close then Save), made About chips size-to-content, switched Add Attribute modal to dynamic height, and gated attribute debug payload output behind an Admin Debug Mode toggle.
- `Type`: UI, Logic
- `Why`: Resolve in-law drift in person flow and UI consistency issues while keeping diagnosis tooling available only when intentionally enabled.
- `Files`:
  - `src/app/api/t/[tenantKey]/relationships/builder/route.ts`
  - `src/components/PersonEditModal.tsx`
  - `src/components/AttributesModal.tsx`
  - `src/components/SettingsClient.tsx`
  - `TODO.md`
- `Data Changes`: No.
- `Verify`:
  - Saving person family updates now reconciles scoped in-law marker for person/spouse in active family group.
  - Contact action buttons align with input rows and show subtle shaded style.
  - Person footer action order is Close (left) and Save (right).
  - Things/About chips render at text width.
  - Add Attribute modal uses dynamic height.
  - Raw JSON debug block only appears when Admin Debug Mode is On.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-07 (household spouse tiles + person modal family-group switcher)

- `Change`: Added husband/wife person tiles to Household Info tab (between household label and address), wired tile clicks to open person detail/edit flow from People view, and added a person-modal family-group switcher row below the Family Group label in the header.
- `Type`: UI, Navigation
- `Why`: Align Household modal UX with People tab card interactions and make cross-family parent/in-law context switching accessible directly from person editing.
- `Files`:
  - `src/components/HouseholdEditModal.tsx`
  - `src/components/PeopleDirectory.tsx`
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: No.
- `Verify`:
  - Household Info shows spouse tiles between label and address.
  - Clicking spouse tile opens person edit/detail modal in People view.
  - Person modal shows family-group switch row under Family Group label and switches active group via `/api/family-groups/active`.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-07 (person modal in-place family-group switch)

- `Change`: Updated person modal family-group switcher to stay in modal context (no page redirect), refresh active family-group session, and reload people/relationships/households + person attributes in-place.
- `Type`: UI, Data loading
- `Why`: Switching family groups from person Family section should not close the panel and interrupt edit context.
- `Files`:
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: No.
- `Verify`:
  - Change family group inside person Family card keeps modal open.
  - Family section data (parents/spouse/in-law visibility) updates to selected group context.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-07 (fix tenant relationship query bind mismatch + household headshot fallback)

- `Change`: Fixed OCI tenant-scoped relationship query bind usage to prevent NJS-098, and updated household modal header image fallback to use spouse primary headshot when wedding photo is absent.
- `Type`: Backend, UI
- `Why`: Family-group switching triggered client failure due to server-side bind mismatch in relationship loading; household should display available primary person headshot when no wedding image exists.
- `Files`:
  - `src/lib/oci/tables.ts`
  - `src/components/HouseholdEditModal.tsx`
- `Data Changes`: No.
- `Verify`:
  - `/api/t/{tenantKey}/tree` no longer logs NJS-098 bind placeholder error.
  - Household modal header uses wife/husband headshot fallback if wedding photo not set.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-07 (family-switch crash fix + household person return flow)

- `Change`: Fixed person-modal family-switch crash by normalizing switched relationship payloads (`relationshipType` -> `label`) and hardening edge label reads; added return-to-household behavior when opening spouse/child person modals from household; added child-row avatars with click-to-open person edit.
- `Type`: Bugfix, UI
- `Why`: Changing family group produced client-side `trim` on undefined due to payload shape mismatch; household-driven person navigation should return users to household context.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/components/PeopleDirectory.tsx`
  - `src/components/HouseholdEditModal.tsx`
- `Data Changes`: No.
- `Verify`:
  - Switching family group in person modal no longer throws `Cannot read properties of undefined (reading 'trim')`.
  - Opening husband/wife/child person modal from household and closing returns to same household modal.
  - Children tab shows gender/headshot avatars and opens person editor on selection.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-07 (shared media wizard rollout to person/household/attribute launch points)

- `Change`: Rolled out the shared image-only `MediaAttachWizard` beyond Media Library into `PersonEditModal`, `HouseholdEditModal`, and `AttributesModal`, all using one shared launch-context contract via orchestrator wiring.
- `Type`: UI, Orchestration
- `Why`: Remove duplicated attach UX across screens while preserving existing backend contracts and centralizing attach/link behavior in the shared orchestrator.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/components/HouseholdEditModal.tsx`
  - `src/components/AttributesModal.tsx`
  - `src/components/media/MediaAttachWizard.tsx`
  - `src/lib/media/attach-orchestrator.ts`
- `Data Changes`: No.
- `Verify`:
  - Person, Household, and Attributes launch points now open the shared wizard shell.
  - Wizard context defaults are prefilled from launch source while continuing to use existing media endpoints/contracts.
  - Attribute-context flow preserves person-link semantics and avoids unsupported existing-library attach path for MVP.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-07 (wizard parity cleanup + attach performance optimization)

- `Change`: Removed remaining legacy per-screen media attach/upload pickers from Person, Household, and Attributes modals so attach flows run through the shared wizard only; optimized duplicate detection by caching library checksum catalog per wizard session and caching file hashes; reduced unnecessary association lookups during orchestrator save when no extra links are pending.
- `Type`: UI, Performance, Orchestration
- `Why`: Eliminate duplicated attach UI paths and improve wizard responsiveness for multi-image selections and existing-item save operations while preserving existing backend contracts.
- `Files`:
  - `src/components/PersonEditModal.tsx`
  - `src/components/HouseholdEditModal.tsx`
  - `src/components/AttributesModal.tsx`
  - `src/components/media/MediaAttachWizard.tsx`
  - `src/lib/media/attach-orchestrator.ts`
- `Data Changes`: No.
- `Verify`:
  - Person/Household/Attribute attach entry points now route through shared `MediaAttachWizard` only.
  - Re-selecting/adding image batches in the same wizard session no longer rebuilds duplicate checksum catalog each time.
  - Save path avoids `/photos/search` association fetch when an item has no additional links beyond its upload target.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-07 (build fix: wizard summary callback typing)

- `Change`: Updated modal wizard completion handlers to use shared `MediaAttachExecutionSummary` type instead of local narrowed `{ message }` failure shape.
- `Type`: Build fix, Typing
- `Why`: Vercel type-check failed because `formatMediaAttachUserSummary` requires failure entries with `clientId` via `MediaAttachExecutionSummary`.
- `Files`:
  - `src/components/AttributesModal.tsx`
  - `src/components/HouseholdEditModal.tsx`
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: No.
- `Verify`:
  - Prior compile error at `AttributesModal.tsx` summary formatting call is resolved.
  - Type-check now proceeds past this failure point.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-08 (wizard item-validation guardrails + TODO hygiene)

- `Change`: Added per-item wizard validation guardrails (duplicate decision required when applicable, required person/household target, missing source detection), surfaced inline "Needs attention" messages in per-item/review steps, and blocked next/review/save transitions when current item is invalid; also updated `TODO.md` to mark multi-photo upload flow complete.
- `Type`: UX, Validation
- `Why`: Prevent late-stage save failures by moving required decisions/target checks earlier in the wizard flow and give users immediate corrective feedback.
- `Files`:
  - `src/components/media/MediaAttachWizard.tsx`
  - `TODO.md`
- `Data Changes`: No.
- `Verify`:
  - Attempting to proceed with unresolved duplicate decision or no link target now shows inline validation and prevents advancement.
  - Review/save highlights first invalid item and routes back to fix.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-09 (media attach OCI null entity_type fix + media-tab preselected link targets)

- `Change`: Fixed person photo upload attribute insert payload to include required `entity_type` and `entity_id` fields for OCI-backed `Attributes` writes, and updated Media tab wizard launch context to preselect current linked-filter people/households as default attach targets.
- `Type`: Bugfix, Orchestration
- `Why`: Media wizard saves were failing with ORA-01400 (`ATTRIBUTES.ENTITY_TYPE` null) during person-upload path; Media tab uploads also needed stronger default link targeting based on current user-selected context.
- `Files`:
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: No.
- `Verify`:
  - Person upload path now sends `entity_type=person` and `entity_id=<personId>` when creating attribute rows.
  - Media tab launches wizard with preselected people/households from active linked filters.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-09 (duplicate detection compatibility: legacy metadata fallback + checksum writes)

- `Change`: Updated wizard duplicate detection to support legacy media metadata without `checksumSha256` using a compatibility fingerprint fallback (`sizeBytes|width|height|mimeType`), and added SHA-256 checksum persistence on new person/household uploads.
- `Type`: Bugfix, Compatibility
- `Why`: Duplicate side-by-side confirm did not appear for older library assets because duplicate scan only matched checksum and many historical records lacked checksum fields.
- `Files`:
  - `src/components/media/MediaAttachWizard.tsx`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/upload/route.ts`
- `Data Changes`: No schema change. New uploads now store `checksumSha256` in `media_metadata`.
- `Verify`:
  - Uploading an existing image now flags duplicate candidates even when existing record metadata predates checksum support.
  - New uploads include checksum in metadata for stronger future duplicate matching.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-09 (duplicate UX cleanup: remove redundant skip + add direct save)

- `Change`: Refined duplicate decision UX by hiding generic "Skip Image" for duplicate-flagged items and adding direct "Save" action on the final per-item screen (alongside Review).
- `Type`: UX
- `Why`: Duplicate flow had redundant controls ("skip/do not import duplicate") and required extra navigation to save.
- `Files`:
  - `src/components/media/MediaAttachWizard.tsx`
- `Data Changes`: No.
- `Verify`:
  - Duplicate-flagged item shows only Duplicate/Not Duplicate decision controls.
  - Final per-item screen provides both Review and Save actions.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-09 (duplicate decision expansion + shared-link targets for bulk metadata)

- `Change`: Extended duplicate actions to include `Duplicate (Skip Import)`, `Not A Duplicate (Import)`, and `New Image Is Better (Overwrite Existing)`; removed redundant top duplicate preview image; added shared people/household link targeting in Shared Metadata step and apply-to-all behavior.
- `Type`: UX, Orchestration
- `Why`: Duplicate flow needed clearer non-redundant decision options and bulk metadata step needed one-pass link assignment across selected items.
- `Files`:
  - `src/components/media/MediaAttachWizard.tsx`
  - `src/lib/media/attach-orchestrator.ts`
- `Data Changes`: No schema change.
- `Verify`:
  - Duplicate item now presents exactly three decision buttons, with no extra redundant preview.
  - Shared Metadata allows selecting link targets and applies them to all selected items.
  - `Overwrite Existing` removes selected-target links to old duplicate file and links new upload.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-09 (selected-photo delete + per-file progress + household permission guard)

- `Change`: Added delete action in Media Library selected-photo editor (removes current person/household links for selected file), added per-file wizard save progress statuses/bars, and added pre-save household permission probe to block unauthorized household-target saves before upload attempts.
- `Type`: UX, Reliability
- `Why`: Users needed direct selected-photo deletion outside the add wizard, clearer visibility into long-running save operations, and earlier handling of household admin permission limits that previously surfaced as late `unauthorized` upload failures.
- `Files`:
  - `src/components/MediaLibraryClient.tsx`
  - `src/components/media/MediaAttachWizard.tsx`
  - `src/lib/media/attach-orchestrator.ts`
- `Data Changes`: No.
- `Verify`:
  - Selected photo editor includes a `Delete` action that unlinks selected file from linked people/households.
  - Wizard review/save shows per-item progress states (`pending/working/uploaded/linked/skipped/failed`) with progress bars and status text.
  - Saving with household targets now pre-checks permissions and shows a clear message instead of late `Failed to upload image to household | unauthorized`.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-09 (media library selected-link refresh cache bypass)

- `Change`: Added explicit `noCache` support to media search API and updated Media Library selected-photo association refresh calls to request uncached results.
- `Type`: Bugfix, Reliability
- `Why`: Linking from selected image in Media Library could appear to fail because post-link association refresh read a 20s cached `photos/search` response and showed stale links.
- `Files`:
  - `src/app/api/t/[tenantKey]/photos/search/route.ts`
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: No.
- `Verify`:
  - Link a person/household from selected-image editor and confirm `Linked To` updates immediately without waiting for cache expiry.
  - General media library browsing/search cache behavior remains unchanged.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-09 (media library add-link persistence + delete parity hardening)

- `Change`: Fixed household `Add Child` so new children are immediately reclassified from default `undeclared` to the correct family-group relationship type after parent edges are created.
- `Type`: Bugfix, Data Integrity
- `Why`: Root cause was the household child-create route inserting `PersonFamilyGroups` rows as `undeclared` and writing parent relationships, but never running family-group relationship-type reconciliation. That left correctly-parented children stuck as unassigned in the family group.
- `Files`:
  - `src/app/api/t/[tenantKey]/households/[householdId]/children/route.ts`
- `Data Changes`: No schema change. New child-add operations now update `PersonFamilyGroups.family_group_relationship_type` immediately through the existing reconciliation path.
- `Verify`:
  - From `Household -> Children -> Add Child`, save a new child and confirm the child no longer remains in `Needs Placement`.
  - Confirm the child appears with `Direct` family relationship after save.
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.

- `Change`: Fixed Media Library selected-image add-link persistence by creating direct OCI person media links when linking from person attribute API, added dedicated person-photo unlink API, and updated Media Library mutation refreshes to force uncached library reads after add/remove/delete actions.
- `Type`: Bugfix, Reliability
- `Why`: Root cause was add-link writes only creating `entity_type=attribute` media links while Media Library chip/list behavior depended on direct person linkage; delete/unlink also missed person-level media links and could leave stale results due to cache.
- `Files`:
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/[photoId]/route.ts`
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: No schema change.
- `Verify`:
  - From Media Library selected-image editor, add person link and confirm chip appears immediately and persists after close/reopen.
  - Delete selected media links and confirm the item no longer appears in linked library results for that family/person context.
  - Person unlink from selected-image editor removes chip immediately and remains removed after refresh.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-10 (final OCI person attribute/media contract cleanup)

- `Change`: Removed the last active runtime dependency on the legacy person-attribute adapter by switching person attribute GET/PATCH/DELETE and person photo upload flows to canonical `Attributes` + OCI media-link reads, added canonical helpers for attribute-with-media and primary-photo resolution, fixed test import paths plus media-link `sortOrder` propagation, and deleted the obsolete `person-legacy` adapter plus dead legacy compatibility person-attribute exports/types.
- `Type`: Bugfix, Cleanup, Compatibility
- `Why`: Active person/media routes were still reading through a legacy sheet-shaped compatibility adapter even after OCI became the only supported runtime backend, which kept diagnosis harder and could flatten media ordering metadata on update paths.
- `Files`:
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/attributes/[attributeId]/route.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `legacy OCI transition adapter`
  - `src/lib/attributes/store.ts`
  - `src/lib/attributes/media-response.ts`
  - `src/lib/attributes/types.ts`
  - `src/lib/google/types.ts`
  - `src/lib/data/runtime.ts`
  - `src/lib/attributes/person-legacy.ts` (deleted)
  - `src/lib/media/upload.test.ts`
  - `src/lib/tenant/guard.test.ts`
- `Data Changes`: No schema change. Runtime reads/writes now use canonical OCI attribute/media rows directly in active person routes.
- `Verify`:
  - `npm run lint` passes.
  - `npx tsc --noEmit` passes.
  - Search for `person-legacy`, `PersonAttributeRecord`, `getPersonAttributes(`, and `getPrimaryPhotoFileIdFromAttributes(` in `src` returns no matches.
  - Local `npm run build -- --no-lint` still fails on Windows with the pre-existing `spawn EPERM` environment error before app compile output.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-20 (story workspace step-2 picklist parity + unified in-panel review)

- `Change`: Updated Story Import Workspace so Step 2 uses definition-driven picklists for `Attribute Type` and `Type Category` (same source as Add Attribute), added detail suggestions, removed both legacy draft-review buttons, and made the left panel support Step 2 draft queue navigation/select.
- `Type`: UX Consistency, Bugfix
- `Why`: Root cause was a split review flow: Step 2 used free-text fields and legacy handoff buttons, so behavior diverged from Add Attribute and required extra clicks through old review routes.
- `Files`:
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: No.
- `Verify`:
  - Story Import Workspace Step 2 shows dropdown-style selections for type and type category.
  - Left panel no longer shows `Open Draft Review` or `Open Classic Draft Review`.
  - Left panel supports selecting/cycling drafts while Step 2 form on the right updates accordingly.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-20 (date mode tri-state + story step-1 ask-ai consolidation)

- `Change`: Added tri-state attribute date mode support (`No Date`, `Date`, `Range`) across definitions API, normalization, admin editor, and attribute add/edit behavior; also consolidated Story Workspace Step 1 guidance into one `Ask AI` input + response stream and removed the separate guidance/missing-facts fields and `Ask AI About Step 1` action.
- `Type`: UX Consistency, Bugfix
- `Why`: Root cause was split logic. Date behavior was constrained to `single|range` with event-centric assumptions, and Step 1 guidance was fragmented across multiple controls that all mapped to one refinement intent.
- `Files`:
  - `src/lib/attributes/event-definitions-types.ts`
  - `src/lib/attributes/event-definitions.ts`
  - `src/lib/attributes/definition-defaults.ts`
  - `src/app/api/t/[tenantKey]/attribute-definitions/route.ts`
  - `src/components/AttributeDefinitionsAdmin.tsx`
  - `src/components/AttributesModal.tsx`
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: No schema change.
- `Verify`:
  - Attribute definition type editor offers `No Date`, `Date`, and `Range` for all types.
  - Attribute add/edit form hides date controls for `No Date`, shows one date for `Date`, and start/end for `Range`.
  - Date-required validation applies only when selected mode is `Date` or `Range`.
  - Story workspace Step 1 shows a single `Ask AI` input/response area and no longer shows separate guidance/missing-facts controls.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-20 (ai documentarian workflow, no extraction modes, planning-rule update)

- `Change`: Updated AI story extraction to an expert-documentarian flow that supports single-story vs multi-vignette proposals, removed extraction-mode controls/contracts, and made draft regeneration follow iterative user/AI interaction guidance. Added repo operating-rule update requiring agreed multi-step designs to be written to `TODO.md` before implementation, and added the full AI redesign plan entry.
- `Type`: UX Consistency, AI Workflow, Process
- `Why`: Root cause was a constrained import model that forced one primary story and mode toggles (`story/balanced/resume`) instead of iterative guidance-based refinement, which limited intelligent multi-vignette extraction and user-directed adjustment.
- `Files`:
  - `AGENTS.md`
  - `TODO.md`
  - `src/components/PersonEditModal.tsx`
  - `src/app/api/t/[tenantKey]/people/[personId]/story-import/route.ts`
  - `src/lib/ai/story-import.ts`
  - `src/lib/ai/story-chat.ts`
- `Data Changes`: No schema change.
- `Verify`:
  - Story import request payload no longer accepts/uses extraction mode.
  - Story workspace no longer displays extraction mode chips.
  - Regeneration uses accumulated AI/user conversation guidance.
  - Import prompt supports one or multiple story-vignette outputs and retains supporting fact extraction.
  - At least one story proposal is still guaranteed via fallback when model output is incomplete.
  - `npx tsc --noEmit` passes.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-20 (oci media migration tooling + todo execution plan)

- `Change`: Added a detailed TODO execution plan for migrating existing media to OCI Object Storage with thumbnail generation, and added a new migration script plus npm commands for dry-run/apply execution.
- `Type`: Infra Tooling, Process
- `Why`: Existing uploads can generate thumbnails, but legacy files were not migrated to OCI originals + thumbnails. A controlled migration tool is needed to backfill safely and idempotently.
- `Files`:
  - `TODO.md`
  - `package.json`
  - `scripts/oci-object-media-migrate.cjs`
- `Data Changes`: No direct schema change. Script updates `MediaAssets` metadata and storage provider during apply runs.
- `Verify`:
  - `npm run media:oci:migrate:dryrun` executes and reports scan summary without DB writes.
  - `npm run media:oci:migrate:apply` is available for controlled migration execution.
  - Script supports `--limit` and optional `--tenant` filtering.
- `Rollback Notes`: Revert commit; no runtime path cutover is included in this change.
- `Design Decision Change`: No design decision change.
## 2026-03-20 (oci media migration execution + safe oci-first photo reads)

- `Change`: Fixed migration candidate detection in OCI media migration script, executed staged + full migration for existing media assets, propagated migrated metadata to media links, and added runtime OCI-first media read resolution with Drive fallback for safe transition.
- `Type`: Infra, Migration, Runtime Fallback
- `Why`: Root cause was mixed storage state. Existing media had not been backfilled to OCI originals/thumbnails, and runtime retrieval still assumed legacy source-only reads.
- `Files`:
  - `scripts/oci-object-media-migrate.cjs`
  - `src/lib/oci/object-storage.ts`
  - `src/lib/google/photo-resolver.ts`
- `Data Changes`: Existing `MediaAssets` rows and linked `MediaLinks.media_metadata` were updated during migration apply runs to include OCI object pointers (`originalObjectKey`, `thumbnailObjectKey`) and `storage_provider=oci_object`.
- `Verify`:
  - Dry-run staged check succeeded with candidates detected.
  - Apply batch (`--limit 10`) succeeded.
  - Full apply succeeded.
  - Post-run DB verification showed all assets migrated (`73/73`) with original and thumbnail object metadata present.
  - Runtime keeps Drive fallback if OCI object read fails.
- `Rollback Notes`: Revert code commit; data rollback would require a dedicated reverse migration if needed.
- `Design Decision Change`: No design decision change.
## 2026-03-20 (oci upload write cutover + thumbnail/object variant delivery)

- `Change`: Switched new person/household media uploads from Drive writes to OCI object writes (original + generated thumbnail), persisted OCI object pointers in media metadata, stored new assets as `storage_provider=oci_object`, and updated photo delivery to request preview variants so compact surfaces use OCI thumbnails while detail views continue using originals.
- `Type`: Runtime, Media Storage, Performance
- `Why`: Root cause was partial cutover. Existing code only migrated old assets and used OCI-first reads, but new uploads still wrote to Drive and preview routing could not select OCI thumbnail objects for list/grid usage.
- `Files`:
  - `src/app/api/t/[tenantKey]/people/[personId]/photos/upload/route.ts`
  - `src/app/api/t/[tenantKey]/households/[householdId]/photos/upload/route.ts`
  - `src/lib/attributes/person-media.ts`
  - `src/lib/oci/object-storage.ts`
  - `src/lib/google/photo-resolver.ts`
  - `src/lib/google/photo-path.ts`
  - `src/app/viewer/photo/[fileId]/route.ts`
  - `src/app/t/[tenantKey]/viewer/photo/[fileId]/route.ts`
  - `src/lib/media/ids.ts`
- `Data Changes`: No schema change. New upload rows now persist OCI object metadata (`objectStorage.originalObjectKey`, `objectStorage.thumbnailObjectKey`) and `storage_provider=oci_object`.
- `Verify`:
  - `npx tsc --noEmit` passes.
  - `npm run build` passes.
  - New person/household uploads produce OCI-backed media metadata and media assets with `storage_provider=oci_object`.
  - Preview image URLs use `variant=preview` when OCI thumbnail object metadata exists.
  - Full-size views still resolve to original object content.
- `Rollback Notes`: Revert commit to restore previous upload/write and resolver behavior.
- `Design Decision Change`: No design decision change.
## 2026-03-20 (ai story chat empty-answer fix + stronger multi-vignette split guidance)

- `Change`: Fixed AI Story Chat no-answer failures by using resilient response text extraction across response shapes and by sending chat context as a normalized transcript input. Also strengthened story-import prompt guidance for multi-vignette splitting and adjusted proposal dedupe so distinct story titles are less likely to collapse into one proposal.
- `Type`: Bugfix, AI Workflow
- `Why`: Root cause was mixed API-shape fragility. Story chat depended only on `response.output_text` and could return empty despite valid model output in other response content shapes; additionally, story extraction could still under-split by prompt ambiguity and over-aggressive dedupe keys.
- `Files`:
  - `src/lib/ai/story-chat.ts`
  - `src/lib/ai/story-import.ts`
- `Data Changes`: No schema or data migration changes.
- `Verify`:
  - `npx tsc --noEmit` passes.
  - Story chat requests return an answer even when model output is surfaced outside `output_text` convenience field.
  - Multi-vignette prompts now explicitly request separate stories for distinct arcs (e.g., depression context vs home narrative).
  - Story proposal dedupe now includes label, reducing accidental merge of distinct story proposals.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-20 (preview-avatar routing + resolver query optimization + reduced first-story bias)

- `Change`: Added avatar/list preview path helper and switched key people surfaces to request preview variants; replaced OCI media lookup full-table cache scans with direct lookup-by-file-id query + per-file TTL cache; reduced first-story bias in AI story post-processing for multi-vignette imports by using proposal-scoped normalization and only applying title/date hints automatically when a single story proposal exists.
- `Type`: Performance, AI Workflow, Runtime Optimization
- `Why`: Root causes were (1) multiple avatar/list paths still requesting original media payloads, (2) resolver cache rebuild scanning all `MediaAssets`, and (3) story normalization/hinting logic privileging first-story behavior even when multiple vignettes were returned.
- `Files`:
  - `src/lib/google/photo-path.ts`
  - `src/components/home/BirthdaysSection.tsx`
  - `src/components/PeopleDirectory.tsx`
  - `src/components/ViewerPeopleGrid.tsx`
  - `src/components/PersonEditModal.tsx`
  - `src/lib/oci/tables.ts`
  - `src/lib/google/photo-resolver.ts`
  - `src/lib/ai/story-import.ts`
- `Data Changes`: No schema change.
- `Verify`:
  - `npx tsc --noEmit` passes.
  - `npm run build` passes.
  - Avatar/list requests now call preview route variant in updated components.
  - OCI object resolution no longer relies on periodic full-table media scans.
  - Multi-vignette story imports preserve proposal-specific titles/details more reliably and avoid first-story-only hint overrides when multiple stories are present.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-21 (story workspace exact prompt visibility)

- `Change`: Added a read-only "Exact Prompt Sent To AI" field directly under the Story Workspace `Generate Drafts` action so users can inspect the full instructions and input payload used for each story-import request.
- `Type`: UX Transparency, AI Debuggability
- `Why`: Root cause was opaque AI behavior during extraction tuning. Users could not verify the exact prompt being sent, making prompt-quality diagnosis and iterative refinement difficult.
- `Files`:
  - `src/lib/ai/story-import.ts`
  - `src/app/api/t/[tenantKey]/people/[personId]/story-import/route.ts`
  - `src/components/PersonEditModal.tsx`
- `Data Changes`: No schema change.
- `Verify`:
  - `npx tsc --noEmit` passes.
  - Story Workspace shows full prompt text after `Generate Drafts` runs.
  - Prompt field appears directly below `Generate Drafts` and is read-only.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-21 (person-centered story extraction prompt tightening)

- `Change`: Updated the AI story-import prompt rules to enforce person-centered extraction, tighter story-scope control, stricter supporting-fact filtering, an explicit relevance test, and prioritization toward the subject's lived environment and formative context.
- `Type`: AI Prompt Quality, Extraction Precision
- `Why`: Root cause was over-extraction of side facts and insufficient subject-centering, which produced too many fragmented or context-only proposals that were not core to the current person's life narrative.
- `Files`:
  - `src/lib/ai/story-import.ts`
- `Data Changes`: No schema change.
- `Verify`:
  - `npx tsc --noEmit` passes.
  - Prompt text now includes `PERSON-CENTERED EXTRACTION RULES`, `STORY SCOPE CONTROL`, `RELEVANCE TEST`, and `PRIORITIZATION RULE`.
  - Existing JSON response schema and allowed category/type constraints remain unchanged.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-21 (vignette segmentation anti-merging prompt update)

- `Change`: Updated story-import prompt segmentation instructions to improve vignette splitting by section/theme detection and explicit anti-merging guidance, including section/theme splitting rules, multiple-vignette tests, anti-merging constraints, and a tie-breaker preferring multiple proposals when headings/themes differ.
- `Type`: AI Prompt Quality, Segmentation Precision
- `Why`: Root cause was over-merging adjacent but distinct narrative sections into one broad story proposal, reducing extract quality for multi-part narratives.
- `Files`:
  - `src/lib/ai/story-import.ts`
- `Data Changes`: No schema change.
- `Verify`:
  - `npx tsc --noEmit` passes.
  - Prompt text now includes section/theme splitting and anti-merging rule blocks.
  - Existing JSON schema and attribute/category constraints remain unchanged.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-21 (fix Vercel OCI helper build blocker)

- `Change`: Updated the root-level OCI object-storage diagnostic helper to read its required env vars directly instead of importing a separate local-only helper module.
- `Type`: Build Reliability, Deployment Unblock
- `Why`: Root cause was Vercel production builds failing on `Cannot find module './ociConfig'` because `lib/ociTest.ts` imported `lib/ociConfig.ts`, while `.gitignore` excluded `lib/ociConfig.ts` from git. That blocked the redeploy needed to apply current OCI environment variables in production.
- `Files`:
  - `lib/ociTest.ts`
- `Data Changes`: No schema change.
- `Verify`:
  - `npm run build` passes.
  - Production deploy is no longer blocked by `lib/ociTest.ts` importing a git-ignored module.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
## 2026-03-21 (photo intelligence request sends session credentials explicitly)

- `Change`: Updated the Media Library photo-intelligence `POST` request to send cookies explicitly with `credentials: "same-origin"` when calling the tenant-scoped intelligence endpoint.
- `Type`: Auth Reliability, Media Suggestions
- `Why`: Root cause was the photo-intelligence modal surfacing plain `unauthorized` from the app endpoint before OCI Vision ran. The failing path was the client-side fetch to `/api/t/[tenantKey]/photos/[fileId]/intelligence`, which needed to send the signed-in session cookie explicitly on the protected request.
- `Files`:
  - `src/components/MediaLibraryClient.tsx`
- `Data Changes`: No schema change.
- `Verify`:
  - `npm run build` passes.
  - Opening a photo and selecting `Generate Suggestions` no longer fails immediately with plain `unauthorized` before Vision debug can populate.
- `Rollback Notes`: Revert commit.
- `Design Decision Change`: No design decision change.
