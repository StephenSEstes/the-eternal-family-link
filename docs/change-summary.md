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

- `Change`: Removed scoped-tab resolution capability and added touch pinch-zoom for tree navigation.
- `Type`: API, UI
- `Why`: Reduce resolver overhead/complexity and improve mobile tree usability.
- `Files`:
  - `src/lib/google/sheets.ts`
  - `src/components/TreeGraph.tsx`
  - `AGENTS.md`
  - `docs/release-checklist.md`
  - `docs/design-decisions.md`
- `Data Changes`: No direct data mutation in this release entry.
- `Verify`:
  - App resolves all table reads/writes from global tabs only.
  - Family tree supports touch pinch in/out and pan on mobile.
  - Existing mouse wheel zoom and control buttons still work.
- `Rollback Notes`: Revert commits `5e46436` and the scoped-tab cleanup commit if required.

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
- `Why`: Investigate and mitigate Google Sheets quota errors during family creation.
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
- `Why`: Reduce Sheets read pressure and quota hits during family creation.
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
  - `src/lib/google/sheets.ts`
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

- `Change`: Added request-scoped diagnostics/fallback on profile pages, reduced relationship-builder read/write amplification to lower Sheets quota failures, constrained parent selection to age-eligible candidates (>=15 years older), and centered sibling placement under parent household midpoints in tree layout.
- `Type`: API, UI, Ops
- `Why`: Root causes were limited production observability on server-render failures and avoidable repeated Sheets operations causing `Read requests per minute per user` quota exhaustion; relationship editing also allowed implausible parent selection and tree child alignment drift under parent households.
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
- `Why`: Root cause confirmed in Vercel logs was Google Sheets `Read requests per minute per user` quota exhaustion on read-heavy server routes (`/people`, `/tree`). This reduces burst read amplification and ensures graceful failure with actionable request identifiers.
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

- `Change`: Stabilized Steve-access JWT callback by reusing cached tenant access list and avoiding repeated Sheets reads on each token refresh.
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

- `Change`: Reduced Sheets read amplification in relationship-save flow by batching relationship creates, batching stale-edge deletes by row number, and caching tab/sheet metadata lookups.
- `Type`: API, Performance, Reliability
- `Why`: Vercel logs showed repeated `GET spreadsheets` and `GET values/Relationships!A1:ZZ` calls during relationship updates, causing Google Sheets per-user read quota exhaustion (`429` -> surfaced `500` in UI flows).
- `Files`:
  - `src/lib/google/sheets.ts`
  - `src/app/api/t/[tenantKey]/relationships/builder/route.ts`
- `Data Changes`: None.
- `Verify`:
  - Relationship save performs one relationships read, one batched delete (if needed), and one batched append (if needed), rather than repeated per-edge/per-delete full-tab reads.
  - `npm run lint` passes.
  - `npm run build` passes.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-01 (incremental Sheets hardening: nav prefetch + read dedupe)

- `Change`: Disabled Next.js link prefetch on header/home navigation links to reduce multi-route background SSR fan-out, added in-flight tab read de-duplication in Sheets access layer, and throttled recurring People schema checks in hot read path.
- `Type`: UI, API, Performance, Reliability
- `Why`: Vercel logs showed single navigation actions triggering multiple route renders and repeated Sheets reads (`People`, `PersonFamilyGroups`, metadata) that increase quota pressure.
- `Files`:
  - `src/components/HeaderNav.tsx`
  - `src/components/AppHeader.tsx`
  - `src/app/page.tsx`
  - `src/app/t/[tenantKey]/page.tsx`
  - `src/lib/google/sheets.ts`
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
- `Why`: Vercel logs showed one family-group switch action causing two `/tree` renders with different request IDs, doubling Sheets reads for the same transition.
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
- `Why`: Switch-flow telemetry showed duplicate tree renders with repeated Sheets read sets; this guard prevents immediate duplicate renders from re-reading Sheets.
- `Files`:
  - `src/lib/tree/load-tree-page-data.ts`
  - `src/app/tree/page.tsx`
  - `src/app/t/[tenantKey]/tree/page.tsx`
- `Data Changes`: None.
- `Verify`:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Immediate duplicate tree renders reuse cached/in-flight load and reduce repeated Sheets reads.
- `Rollback Notes`: Revert this deployment commit.
- `Design Decision Change`: No design decision change.

## 2026-03-01 (remove hot-path People schema check)

- `Change`: Removed runtime schema-enforcement call from `getPeople()` hot read path.
- `Type`: API, Performance, Reliability
- `Why`: Tree/People page reads were still issuing duplicate `People!A1:ZZ` fetches; one source was schema-check work in the same request path.
- `Files`:
  - `src/lib/google/sheets.ts`
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
