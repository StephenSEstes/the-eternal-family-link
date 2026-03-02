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
- `Rollback Notes`: Revert this commit; if migration executed, restore workbook backup.
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
- `Why`: Root cause of immediate post-delete crashes was quota pressure from stacked reads right after a delete request; `family-access` read path was hitting Sheets 429.
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
- `Why`: Root cause of extra Sheets reads after unrelated actions was eager `tenantOptions -> /api/t/{tenant}/people` fan-out on Settings mount.
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
