# Project TODO

This file tracks development tasks for this project.
I will update this list as we add, complete, or remove work.

## Active
- [ ] Unit 1 greenfield lab app (isolated, no legacy feature imports)
  Priority: High (#0)
  Status: In progress 2026-04-11 (execution model clarified after rollback)
  Progress 2026-04-08:
  - Completed: Rolled production back to pre-Unit-1 deployment (`dpl_9g8DGF1Hp2ueAknScdeEume7hFD5`).
  - Completed: Created isolated implementation branch (`unit1-greenfield`).
  - Completed earlier (kept for reference only, not release target): additive `/u1` implementation on `main` in commit `b6bd3a3` was rolled back in production.
  Progress 2026-04-11:
  - Confirmed: subscription is a notification/update preference, not a profile/tree visibility gate.
  - Confirmed: supported family members remain visible in the tree at least by name and relationship.
  - Confirmed: sharing controls content visibility (`vitals`, `stories`, `media`, `conversations`).
  - Confirmed: MVP should prove the model through a family tree test view, not only a rule-editor/admin page.
  Progress 2026-04-12:
  - Completed: `famailink/` now includes an authenticated preferences page with direct OCI CRUD for subscription defaults, subscription person exceptions, sharing defaults, and sharing person exceptions.
  - Completed: Added live Famailink preview API/UI that reports tree visibility, subscription status, and content-sharing scope separately for a selected family member.
  - Completed: Added Famailink recompute trigger/status with persisted derived subscription and visibility/share maps plus latest job/run summary on the preferences page.
  - Completed: Tree lab now links directly to the new preferences surface.
  Progress 2026-04-13:
  - Completed: Tree lab now reads back persisted recompute state (`profile_visibility_map`, `profile_subscription_map`, and recompute summary) so saved subscription/share outcomes are visible directly on the tree surface.
  - Completed: Famailink now represents one-hop in-law categories explicitly across derivation, preferences, preview/catalog, and tree rendering.
  - Completed: Famailink now defaults broadly inclusive in the MVP, with synthesized broad defaults and person exceptions positioned as the primary narrowing tool.
  Progress 2026-04-14:
  - Completed: Famailink tree/preferences wording was tightened so graph-wide counts read clearly, pending derived states are explicit (`Subscription Pending` / `Sharing Pending`), and the user-facing copy no longer leans on confusing internal `lab` framing.
  Progress 2026-04-15:
  - Completed locally: Famailink household tree now canonicalizes duplicate household identities by parent pair/person and nests child households under parent households instead of rendering duplicate peer households plus loose child cards. Pending Steve visual confirmation after deploy.
  Agreed implementation plan 2026-04-18 (Famailink tree in-law switch removal):
  - Scope:
    - Remove the visible `/tree` In-laws switch.
    - Always include existing one-hop in-law categories in the family tree graph model.
    - Keep relationship derivation unchanged; this is a UI/model-display cleanup, not a schema or data change.
  - Reproduction path:
    - Open Famailink `/tree` after login.
    - Use the navigation/focus panel to select a spouse, parent-in-law, or sibling-in-law.
    - Observe that tree context depends on the separate In-laws switch instead of only the selected person/focus navigation state.
  - Failing data/query/code path:
    - `TreeClient` stores `showInLaws` state and passes `{ includeInLaws: showInLaws }` into `buildTreeGraphModel()`.
    - `buildTreeGraphModel()` skips `_in_law` relationship buckets when that option is false, which can remove people needed to render the selected focus person's household context.
  - Root cause:
    - The old optional in-law display mode now conflicts with the selected-person-centered tree behavior. The navigation panel should dictate the tree context; the renderer should not have a separate toggle that hides supported relationship categories.
  - Implementation:
    - Remove the `TreeGraphOptions`/`includeInLaws` path and always load all supported relationship buckets into the tree graph.
    - Remove the visible In-laws switch, its state, and the in-law count.
    - Remove unused switch CSS and adjust the toolbar layout for search plus navigation controls.
  - Validation checks:
    - `npm run lint --prefix famailink`
    - `npm run build --prefix famailink`
  - Completion criteria:
    - The `/tree` toolbar no longer shows an In-laws switch.
    - Selecting in-law relatives still has access to their supported tree context through the existing relationship buckets.
  Agreed implementation plan 2026-04-17 (Famailink sibling-in-law descendant household links):
  - Scope:
    - Fix selected sibling-in-law views where some child links and child-spouse household links are missing.
    - Keep the change in the existing `siblings_in_law` and `nieces_nephews_in_law` buckets; do not add schema or new broad default categories.
  - Reproduction path:
    - Open Famailink `/tree` after login.
    - Select a brother-in-law/sibling-in-law.
    - Observe that some children may be absent when the direct parent-child row is attached to the sibling-in-law's spouse, and child spouses are absent from child household tiles.
  - Failing data/query/code path:
    - `computeRelativeHitsForViewer()` adds spouse-side sibling-in-law spouses and children, but child derivation only checks `childrenByParent` for the original sibling-in-law ID.
    - It also does not add spouses of those niece/nephew-in-law children, so `TreeClient` cannot build child household tiles with spouse cards.
  - Root cause:
    - The visible relationship hit set is still too narrow for sibling-in-law household rendering. The tree renderer can render child households, but only if both child and child spouse are present in `visiblePersonIds`.
  - Implementation:
    - For each spouse-side sibling-in-law, derive household parent IDs from the sibling-in-law plus visible spouses.
    - Add children from any of those household parent IDs as `nieces_nephews_in_law`.
    - Add spouses of those children as `nieces_nephews_in_law` so child household tiles can render spouse links.
    - Stop there; do not add deeper descendants.
  - Validation checks:
    - `npm run lint --prefix famailink`
    - `npm run build --prefix famailink`
  - Completion criteria:
    - Selecting a sibling-in-law can show children linked through either parent in that sibling-in-law household.
    - Those children can show spouse tiles when direct spouse rows exist.
    - Missing rows after this point indicate data remediation, not renderer/derivation gaps.
  Agreed implementation plan 2026-04-17 (Famailink spouse-side sibling household visibility):
  - Scope:
    - Fix the selected parent-in-law tree context so spouse-side siblings-in-law can show their spouses and children.
    - Keep the change within existing supported Famailink categories (`siblings_in_law` and `nieces_nephews_in_law`); do not add schema, new relationship categories, or recursive deeper in-law expansion.
  - Reproduction path:
    - Open Famailink `/tree` after login.
    - Select a parent-in-law from the navigation/focus panel.
    - Observe that the parent-in-law's children appear as siblings-in-law, but those children's spouses and children do not render in the child household/grandchild rows.
  - Failing data/query/code path:
    - `computeRelativeHitsForViewer()` adds spouse-side siblings as `siblings_in_law`, but does not add those siblings' spouses or children to the relationship hit map.
    - `TreeClient.buildTreeGraphModel()` filters relationship edges to `visiblePersonIds` from the hit map, so spouse/child edges for those siblings-in-law are dropped before layout.
  - Root cause:
    - The relationship derivation is too narrow for the selected parent-in-law view. The tree layout can render child households and grandchildren, but the needed people are absent from the derived visible set.
  - Implementation:
    - While deriving spouse-side siblings-in-law, collect those sibling IDs and their lineage side.
    - Add each sibling-in-law's spouse as `siblings_in_law` using the same side.
    - Add each sibling-in-law household child as `nieces_nephews_in_law` using the same side.
    - Stop there so grandchildren of siblings-in-law and other recursive in-law branches are not added.
  - Validation checks:
    - `npm run lint --prefix famailink`
    - `npm run build --prefix famailink`
  - Completion criteria:
    - Selecting a parent-in-law can render each visible child household with spouse tiles when spouse rows exist.
    - Those sibling-in-law households can render their children as the selected parent-in-law's grandchildren/nieces-nephews-in-law.
    - No new schema or broad recursive in-law category is introduced.
  Agreed implementation plan 2026-04-17 (Famailink selected-person-centered tree):
  - Scope:
    - Update only Famailink `/tree` client layout behavior; preserve current auth, access rules, data schema, and save APIs.
    - Keep EFL-style image tiles and compact tile styling from the previous pass.
  - Reproduction path:
    - Open Famailink `/tree` after login and select a person from the right focus/navigation panel.
    - Observe that the displayed tree is rooted by the current focus group/household subtree rather than always placing the selected person's generation as the central row.
    - Selecting a spouse can center the spouse household without consistently showing that spouse's parents as the upper generation.
    - Child household recursion can continue beyond grandchildren.
  - Failing code path:
    - `displayedRootUnits` chooses root household units from `focusGroup`, then `HouseholdTreeUnit` recursively renders the full child-household chain.
    - The renderer has no selected-person-centered view model with explicit parent, center, child, and grandchild generations.
  - Root cause:
    - The previous tree pass made the right navigation dictate which subtree is shown, but it still reused the generic recursive household renderer.
    - A generic subtree renderer cannot enforce the requested visual contract: selected person's generation central, selected person's parents above, children/child households below, grandchildren below, and no deeper descendants.
  - Implementation:
    - Build a selected-person tree context from existing parent/child/spouse/household maps.
    - Render an upper parent household row for the selected person when parents exist.
    - Render the selected person's generation in the center: selected household when partnered, or selected person plus siblings only when the selected person is single.
    - Render children and their spouse/household tiles below the selected generation in birth order.
    - Render grandchildren below those children in birth order, with no deeper descendants.
    - Keep focus-panel person selection as the navigation action; focus chips may still select parents/spouse/siblings/children, but the tree pane recenters around the selected person after selection.
  - Validation checks:
    - `npm run lint --prefix famailink`
    - `npm run build --prefix famailink`
    - Signed-out deployed checks after deploy if Steve chooses to deploy.
  - Completion criteria:
    - Selecting any person recenters the tree around that person's generation.
    - That person's parents render above them when available, including spouse-as-selected parent/in-law context.
    - Children and child households render below the selected person, grandchildren render below children, and no further generations render.
    - Siblings are omitted unless the selected person is single.
  Agreed implementation plan 2026-04-16 (Famailink compact image-based tree view):
  - Scope:
    - Update only the Famailink family tree view and its lightweight family graph snapshot data.
    - Preserve existing auth/access behavior, sharing/subscription save APIs, and OCI schema.
  - UI phases:
    - Replace initials circles with EFL-style placeholder avatar images.
    - Remove relationship labels and `Sub`/`Share` status pills from tree tiles.
    - Shrink tree person tiles and household spacing so the tree reads closer to the EFL reference.
    - Keep the right focus panel as the control surface for household, parents, spouse, siblings, and children views.
  - Data/layout phases:
    - Include existing person birth dates in the tree snapshot.
    - Sort child rows by birth date with name fallback when birth dates are absent.
    - Derive the displayed root household units from the selected focus-panel group so the selected person context is centered in the tree pane.
  - Validation checks:
    - `npm run lint --prefix famailink`
    - `npm run build --prefix famailink`
    - If Steve chooses deploy, commit/push/deploy and validate the deployed `/tree`.
  - Completion criteria:
    - Tree nodes use image avatars instead of initials.
    - Tiles are compact and omit relationship/sub/share tile text.
    - Children render below parents in birth order.
    - Focus-panel navigation changes the tree context.
    - Selecting a person recenters the displayed tree around that person or that person's selected relationship context.
  Agreed implementation plan 2026-04-15 (Famailink EFL-style household tree parity pass):
  - Scope:
    - Default all `/rules-tree` generation sections to collapsed on first load.
    - Replace the current `/tree` relationship-bucket/generation rendering with a household-first graph layout that uses direct parent/spouse structure.
    - Display household units, center children under their parent household, and draw visible household-to-child connector lines.
    - Add compact EFL-style navigation controls to the tree: person search, zoom/reset controls, clear focus, and focus chips for parents, spouse, siblings, and children.
    - Keep the existing person detail modal and Inclusion Rules tab; do not change the defaults/exceptions schema or save APIs.
  - Reproduction path:
    - Open Famailink `/tree` after login.
    - Observe that the page renders derived relationship rows by generation instead of household units.
    - Select a person and compare the behavior to the legacy EFL tree: households are not shown as parent units, children are not centered beneath parents, connector lines do not run from households to children, and graph navigation controls are missing.
    - Open `/rules-tree` and observe that generation sections are expanded by default.
  - Failing data/query/code path:
    - `buildTreeLabSnapshot()` returns only `viewer`, derived relationship `buckets`, and counts; it does not expose direct people, direct relationship rows, or household rows to the client.
    - `TreeClient` maps `snapshot.buckets` into `TREE_GENERATIONS`, so the UI cannot render real household structure even when direct parent/spouse data exists.
    - `RulesTreeClient` initializes `collapsedGenerations` to an empty set, so every rules generation starts expanded.
  - Root cause:
    - The Famailink `/tree` was still an MVP readback surface organized around derived rule categories, not the EFL household graph model.
    - The client had no household input and no household-to-child layout stage, so it could not show the structural tree behavior Steve expects.
    - The rules tree collapse state default was set for editing convenience, not compact review.
  - Implementation:
    - Extend the Famailink family snapshot with direct `people`, direct `relationships`, and lightweight `households`.
    - Query household rows from OCI using the app's shared connection pattern and normalize them to `householdId`, parent person IDs, and label.
    - In `TreeClient`, build parent/child/spouse/household maps from the snapshot and render household units grouped by generation around the signed-in viewer.
    - Use household rows where available and synthesize spouse/one-parent household units from direct graph rows when household metadata is absent.
    - Render person cards inside household frames, child cards centered below parent frames, and connector lines from the household frame to the child row.
    - Add search/focus/zoom controls without importing legacy EFL components, preserving the isolated Famailink implementation decision.
    - Initialize `/rules-tree` with all generation IDs collapsed.
  - Validation checks:
    - `npm run lint --prefix famailink`
    - `npm run build --prefix famailink`
    - `/rules-tree` first load shows all generation rows collapsed.
    - `/tree` renders household units instead of category buckets.
    - Children render centered below their parent household unit with connector lines from household to child row.
    - Person selection/focus navigation can move to parents, spouse, siblings, and children when those graph relationships exist.
    - Opening a selected person still shows the person detail modal and Inclusion Rules tab using the existing save/recompute routes.
  - Completion criteria:
    - Famailink `/tree` behaves as a household graph prototype rather than a relationship bucket list.
    - The tree remains isolated from legacy EFL runtime imports while matching the key EFL concepts: households, parent-child connectors, centered children, and navigation.
    - No schema or data migration is required.
  Agreed implementation plan 2026-04-14 (Famailink administration tab + EFL-style tree shell):
  - Scope:
    - Add a top-level `Administration` tab/surface for Famailink management tools.
    - Move the Rules Tree into Administration navigation instead of presenting it as a peer to the main family tree.
    - Keep `/rules-tree` and `/preferences` routes for now, but position them as administration options.
    - Make `/rules-tree` more compact by preventing relationship-name wrapping, removing repeated instructional text from tiles, and making each generation collapsible.
    - Rework the main `/tree` surface toward the EFL family-tree mental model: person cards, selection/navigation, and a person detail modal.
    - Add an `Inclusion Rules` tab inside the person detail modal so the existing subscription/sharing default and person override controls live with the person details.
    - Add EFL/Famailink branding to the login screen and add a user-circle account menu with app/build version details.
  - Root cause:
    - Famailink evolved as an MVP test harness, so `/preferences`, `/rules-tree`, and `/tree` all became visible user-facing peers even though two of them administer the same defaults model.
    - The current `/tree` still renders relationship buckets rather than an EFL-like family relationship map with selection and person details.
    - The current person-edit modal mixes relationship-default and person-only controls directly into a settings modal instead of treating inclusion/exclusion as a tab on a person detail view.
    - Login and app shell branding/version affordances lag behind the main EFL app.
  - Navigation/admin changes:
    - Add a reusable Famailink app header with:
      - primary `Family Tree` tab
      - `Administration` tab
      - user-circle account menu with username, person ID, app version/build marker, and sign-out
    - Add `/administration` as the management landing page with options for Rules Tree and Full Preferences.
    - Update `/tree`, `/rules-tree`, and `/preferences` to use the app header and avoid duplicate ad hoc header actions.
  - Rules-tree changes:
    - Keep relationship nodes clickable for modal editing.
    - Prevent relationship labels from wrapping on tiles.
    - Remove repeated "Tap to edit this default" tile text.
    - Add collapse/expand behavior per generation row.
  - Main tree/person modal changes:
    - Replace the bucket-column readback layout with an EFL-inspired tree shell using generational rows and person cards.
    - Add person selection state and lightweight focus/navigation controls for parents, spouse, siblings, children, and current relationship peers where available from the current Famailink graph.
    - Add a person detail modal with tabs:
      - Details: person name, relationship badges, saved subscription/share readback
      - Inclusion Rules: existing relationship-default and person-only subscription/sharing controls
    - Reuse the existing Famailink defaults/exceptions APIs and recompute-on-save behavior; no schema changes.
  - Branding/version changes:
    - Add the EFL/Famailink logo treatment to the login screen.
    - Add an app/build version string to the user account menu using package version and current release marker.
  - Validation checks:
    - `npm run lint --prefix famailink`
    - `npm run build --prefix famailink`
    - `/tree` loads with the new family-tree shell and person modal.
    - `/administration` links to Rules Tree and Full Preferences.
    - `/rules-tree` generation rows collapse/expand, relationship names do not wrap, and tiles no longer repeat edit instructions.
    - Person modal Inclusion Rules saves defaults/person overrides through the existing routes and refreshes readback.
    - Login screen shows the logo/brand and signed-in pages expose version/build details in the user menu.
  - Completion criteria:
    - Normal users primarily use `/tree`.
    - Broad rule/default tools live under Administration.
    - Person-specific inclusion/exclusion is managed from the person detail modal instead of a separate settings-looking modal.
    - The MVP keeps its isolated Famailink implementation while visually aligning more closely with EFL.
  Agreed implementation plan 2026-04-14 (Famailink rules-tree compaction + narrowed in-law defaults):
  - Scope:
    - Narrow the Famailink default relationship model by removing `aunts_uncles_in_law` and `cousins_in_law` from supported categories.
    - Make the `/rules-tree` default nodes substantially more compact and mobile-friendly.
    - Keep person-level edge cases and exceptions on the real person tree/modal rather than expanding the default category tree.
  - Root cause:
    - The current rules tree is still reflecting a broader in-law model than the desired MVP, so the screen is spending space on low-value relationship buckets.
    - The current node UI uses decorative icon circles plus verbose summary labels, which wastes vertical space and weakens scanability on mobile.
    - The current in-law default model still treats the remaining in-law categories too generically for the compact branch-side shorthand the product now wants.
  - Relationship-model changes:
    - Remove these supported default/tree categories from Famailink:
      - `aunts_uncles_in_law`
      - `cousins_in_law`
    - Keep these supported one-hop in-law categories:
      - `parents_in_law`
      - `grandparents_in_law`
      - `siblings_in_law`
      - `children_in_law`
      - `nieces_nephews_in_law`
    - Extend side-specific handling to the in-law categories that have a stable family-side meaning in the current graph:
      - `parents_in_law`
      - `grandparents_in_law`
      - `siblings_in_law`
      - `nieces_nephews_in_law`
    - Keep `children_in_law` broad/non-branch-specific in the current MVP because there is no stable maternal/paternal branch meaning for that relationship in the existing graph model.
  - Runtime/data changes:
    - Remove the dropped in-law categories from the active Famailink relationship constants, editable defaults list, empty tree buckets, derivation logic, and tree grouping surfaces.
    - Derive lineage sides for the remaining branchable in-law categories from the existing blood-relative path they come through, rather than inventing new schema.
    - Keep existing OCI rule tables unchanged.
    - Continue tolerating old saved rows for removed categories by ignoring them in the active defaults surfaces rather than adding a migration in this pass.
  - Rules-tree UI changes:
    - Remove the relationship icon/orb circle from every node.
    - Render compact summary headings with `Subs` and `Share` on the same row.
    - Show the subscription branch shorthand on the next row:
      - `B`
      - `M`
      - `P`
      - `-` when disabled
    - Show sharing scopes as compact content letters:
      - `V`
      - `S`
      - `M`
      - `C`
      - `-` when nothing is shared
    - Keep editing in the modal popout rather than inline on the tree.
  - Validation checks:
    - `npm run lint --prefix famailink`
    - `npm run build --prefix famailink`
    - `/rules-tree` no longer renders `Aunts / Uncles-In-Law` or `Cousins-In-Law`.
    - The remaining rules-tree nodes are visibly more compact and the summaries use the new shorthand.
    - Saved defaults edited on `/rules-tree` still survive reload and remain aligned with `/preferences`.
    - Remaining in-law categories that keep branch-side behavior match correctly in preview/recompute.
  - Completion criteria:
    - The default rules tree reflects only the supported MVP in-law groups.
    - The main rules-tree surface is compact enough to scan and navigate on mobile.
    - Broad defaults stay relationship-level, while exceptions and edge cases remain person-level.
  Agreed implementation plan 2026-04-13 (Famailink in-law category expansion) [Completed]:
  - Scope:
    - Extend the Famailink relationship model to include explicit one-hop in-law categories in the tree, catalog, preview, defaults, and recompute/readback surfaces.
    - Preserve the existing blood-line categories and their maternal/paternal side behavior.
    - Keep the current OCI rule tables and derived map tables unchanged; this is a relationship-model and UI/runtime expansion, not a schema redesign.
  - Root cause:
    - The current Famailink model only derives blood-line categories plus spouse.
    - Existing side selectors such as `Both Sides` broaden maternal/paternal blood lineage only; they do not express by-marriage relatives.
    - Users expect in-laws to be represented explicitly rather than hidden inside an existing blood category such as `siblings`.
  - Relationship-model changes:
    - Add explicit relationship categories:
      - `parents_in_law`
      - `siblings_in_law`
      - `children_in_law`
      - `aunts_uncles_in_law`
      - `nieces_nephews_in_law`
      - `cousins_in_law`
    - Derive these as one marriage hop only:
      - `parents_in_law` = spouse's parents
      - `siblings_in_law` = spouse's siblings plus sibling spouses
      - `children_in_law` = children's spouses
      - `aunts_uncles_in_law` = spouses of aunts/uncles
      - `nieces_nephews_in_law` = spouses of nieces/nephews
      - `cousins_in_law` = spouses of cousins
    - Do not derive recursive in-law networks in this pass (`in-laws of in-laws`, spouse-family of cousin-spouse, etc.).
  - API/runtime changes:
    - Extend `RelationshipCategory` constants/labels and request validation to accept the new categories.
    - Update family-graph derivation to emit explicit in-law hits while keeping current blood-line hit logic unchanged.
    - Treat the new in-law categories as `not_applicable` for lineage selection in v1.
    - Ensure access preview and recompute continue to evaluate defaults/exceptions correctly against the expanded category set without schema changes.
  - UI changes:
    - Preferences:
      - Add one logical default row for each new in-law category in both subscription and sharing defaults.
      - Keep the lineage selector for these categories non-side-specific in v1.
    - Tree:
      - Surface the new categories in a distinct in-law section/column rather than silently mixing them into blood-line buckets.
    - Catalog/preview:
      - Show the explicit in-law relationship labels wherever relationship hits are listed.
  - Validation checks:
    - `npm run lint --prefix famailink`
    - `npm run build --prefix famailink`
    - Supported in-laws appear in the access catalog and tree for users with applicable relationship paths.
    - New in-law categories can be saved in defaults and survive reload.
    - Preview and recompute treat explicit in-law categories as valid relationship hits.
    - Existing blood-line categories and side-specific behavior still work unchanged.
  - Completion criteria:
    - In-laws are represented explicitly in the Famailink relationship model.
    - `Both Sides` on blood relatives no longer has to carry the burden of implying in-laws.
    - Users can set defaults for supported in-law categories without ambiguity.
  Agreed implementation plan 2026-04-13 (Famailink inclusive-defaults UX pass) [Completed]:
  - Scope:
    - Keep the current Famailink model intact: tree visibility, subscription, and sharing remain separate; relationship categories and person exceptions remain in place.
    - Change the default posture so the MVP behaves broadly inclusive when no explicit rows exist.
    - Make defaults and person exceptions easier to understand without adding presets or hiding rows.
  - Root cause:
    - The current Famailink MVP is exclusive by absence: when no saved default rows exist, runtime evaluation falls through to `no matching rule`, which behaves as deny/no-share.
    - The preferences UI mirrors that posture by initializing side-specific subscription defaults to `None` and sharing scopes to unchecked.
    - Person exceptions exist, but the screen copy does not present them as the normal way to narrow a broad default.
  - Runtime/default-model changes:
    - Treat missing default rows as inclusive system defaults instead of deny-by-absence.
    - Subscription defaults:
      - Supported categories default to subscribed.
      - Side-specific categories default to `Both Sides`.
      - Non-side-specific categories default to `Not Side-Specific`.
    - Sharing defaults:
      - Supported categories default to `Both Sides` or `Not Side-Specific` as applicable.
      - Baseline sharing scopes default on for the current MVP broad-default posture.
    - Existing saved rows and explicit person exceptions still override the synthesized defaults.
  - UI changes:
    - Preferences defaults tables load broad inclusive defaults even before first save.
    - Defaults section copy explicitly says the app starts broad and person exceptions are the normal way to exclude specific people.
    - Person exception add flows default to `deny` so exclusions are faster to create.
    - Keep all rows visible; do not add presets in this pass.
  - API/data changes:
    - No schema changes.
    - No data migration required; synthesized defaults apply in runtime/read paths.
  - Validation checks:
    - `npm run lint --prefix famailink`
    - `npm run build --prefix famailink`
    - With no saved defaults, preview/recompute treat supported relatives as subscribed/shared by default.
    - Existing explicit `none` or person-level deny settings still narrow behavior correctly.
    - Preferences page initially shows broad defaults instead of empty/unchecked state.
  - Completion criteria:
    - Famailink behaves liberally inclusive by default in the MVP.
    - Users can narrow behavior primarily through person exceptions without first opting broad categories in one by one.
    - The preferences copy makes the intended broad-default mental model clear.
  Agreed implementation plan 2026-04-13 (Famailink deployment split documentation):
  - Scope:
    - Document the repeatable deployment and verification path for the isolated `famailink-mvp` Vercel project.
    - Make the split between the legacy app and Famailink explicit so future deploys do not target the wrong project/root.
    - Keep this pass documentation-only; no runtime or schema changes.
  - Root cause:
    - Famailink has been deployed through an isolated project/root flow, but the exact procedure currently lives in chat history and local knowledge rather than a canonical runbook.
    - Without a written runbook, the highest near-term risk is project/root-dir drift or accidental deployment to the wrong target.
  - Documentation changes:
    - Update the shared deploy runbook with a Famailink-specific section that covers:
      - Vercel project name and app root
      - required environment variables for Famailink
      - local pre-deploy checks
      - production deploy command from the correct working directory
      - post-deploy verification checklist for `/login`, `/tree`, and `/preferences`
      - rollback guidance using Vercel deployment history or git revert on `famailink-mvp`
    - Update the Famailink README with a short production deployment section that points to the canonical runbook.
  - Validation checks:
    - The documented project name matches `.vercel/project.json` under `famailink/`.
    - The documented env list matches Famailink runtime requirements.
    - The deploy command matches the working deploy path already used successfully for `famailink-mvp`.
  - Completion criteria:
    - A future deploy can be executed correctly from the written runbook without relying on memory or chat history.
    - The isolated Famailink deployment path is clearly separated from the legacy app deployment path.
  Agreed implementation plan 2026-04-13 (Famailink login UX + password reset):
  - Scope:
    - Improve the Famailink login experience by adding a show/hide password control and a visible `Forgot Password?` path.
    - Add a minimal Famailink-native self-service password reset flow aligned with the existing local-password product decision.
    - Keep local username/password sign-in as the only user-facing auth mode in Famailink.
  - Root cause:
    - The current Famailink login page is missing common usability affordances (`show password`, `forgot password`) even though local password recovery is already an approved product behavior in the main app.
    - Famailink has no reset-token/email/update plumbing yet, so users who forget their password in this isolated app track have no self-service recovery path.
  - API/runtime changes:
    - Add Famailink password-reset request route that accepts email, resolves exactly one active local user, stores a reset token, and sends a reset email.
    - Add Famailink password-reset completion route that validates token status/expiry, updates `user_access.password_hash`, marks the reset token used, and returns the username for optional sign-in.
    - Add additive OCI compatibility for `password_resets` in Famailink using the canonical table shape already documented in `docs/data-schema.md`.
    - Reuse the same Gmail env contract as the main app for outbound reset email delivery.
  - UI changes:
    - Login page:
      - Add show/hide password toggle.
      - Add `Forgot Password?` link.
    - Add `forgot-password` page with email-entry form and generic success messaging.
    - Add `reset-password/[token]` page with new-password + confirm-password form and clear expired/used-link messaging.
    - After successful reset, attempt to sign the user in automatically and redirect to `/tree`.
  - Validation checks:
    - `npm run lint --prefix famailink`
    - `npm run build --prefix famailink`
    - Login page renders show/hide password affordance and forgot-password link.
    - Request route returns generic success message for both match and non-match cases.
    - Valid reset token allows password update and subsequent sign-in.
    - Used/expired token shows a clear invalid-link state.
  - Completion criteria:
    - Famailink local login is more user friendly.
    - Famailink users have a self-service password reset path compatible with the current local-auth model.
    - The reset flow stays isolated to Famailink without reintroducing mixed-auth behavior.
  Agreed implementation plan 2026-04-13 (Famailink tree-driven preference modal):
  - Scope:
    - Add a tree-driven edit path so clicking a relative on `/tree` opens a modal for managing that relative's subscription and sharing preferences.
    - Keep the existing Famailink defaults/exceptions storage model intact in this pass.
    - Preserve `/preferences` as the full-table fallback surface for broader edits and recompute controls.
  - Root cause:
    - The current preferences experience is table-first and abstract, even though the product intent is relationship-centered and inclusive.
    - Users naturally think in terms of real relatives in the tree, not in terms of rule rows and exception tables.
    - The current tree is a readback surface only, so the most intuitive place to act on a relative cannot yet be used to edit that relative.
  - UI changes:
    - Make relative cards on `/tree` clickable.
    - Open a modal showing:
      - the selected person's name and relationship badges
      - current saved subscription/sharing readback
      - person-level subscription control (`follow relationship default`, `always subscribe`, `do not subscribe`)
      - person-level sharing control (`follow relationship default`, `share all`, `name only`, `custom scopes`)
      - the matching relationship category/default context with a shortcut back to `/preferences` for broader relationship-wide editing
    - Keep the modal person-first rather than exposing raw exception-table language.
  - Runtime/API changes:
    - Reuse existing Famailink defaults and person-exception routes:
      - `/api/access/subscription/defaults`
      - `/api/access/sharing/defaults`
      - `/api/access/subscription/exceptions/people`
      - `/api/access/sharing/exceptions/people`
    - Save from the modal by updating the existing person-exception collections and reusing the current recompute-on-save behavior.
    - Do not add new schema or new preference tables in this pass.
  - Implementation notes:
    - Keep tree counts, saved readback badges, and recompute summary intact.
    - Refresh the tree after a modal save so the badges reflect the saved derived rows immediately.
    - Keep the existing `/preferences` screen for full defaults/exceptions management until the tree-driven flow proves out.
  - Validation checks:
    - `npm run lint --prefix famailink`
    - `npm run build --prefix famailink`
    - Clicking a visible relative card opens the modal.
    - Saving a person-level subscription or sharing choice updates the tree badges after refresh.
    - The modal keeps the distinction clear between this-person exceptions and broader relationship defaults.
  - Completion criteria:
    - Famailink tree cards are directly actionable.
    - A user can manage one relative's subscription/sharing from the tree without navigating into the table-heavy preferences screen.
    - The existing defaults/exceptions model remains valid underneath the simpler tree-driven UI.
  Agreed implementation plan 2026-04-14 (Famailink generic relationship rules tree):
  - Scope:
    - Add a separate generic relationship-tree defaults surface for Famailink so broad sharing/subscription rules can be managed by relationship structure instead of tables.
    - Keep the current person-tree modal for person-level exceptions and keep `/preferences` available as the table fallback.
    - Reuse the existing defaults APIs and storage model; no schema changes in this pass.
  - Root cause:
    - The current person-tree modal is good for one-person overrides, but defaults are still easier to understand as relationship buckets than as table rows.
    - Users want to see broad rules in a generic family-structure layout closer to the main EFL tree presentation, not only in spreadsheet-style tables.
  - UI changes:
    - Add a new authenticated route `/rules-tree`.
    - Render relationship nodes in a generic tree-like layout centered on `You` / `Spouse`, with surrounding relationship groups such as `Parents`, `Parents-In-Law`, `Grandparents`, `Siblings`, `Siblings-In-Law`, `Children`, `Children-In-Law`, and other supported Famailink categories.
    - Show unsupported future categories only as clearly marked placeholders if needed for visual completeness; do not make them editable in this pass.
    - Each supported relationship node should expose:
      - subscription default selector
      - sharing lineage selector
      - sharing scope toggles
    - Add save actions for subscription defaults and sharing defaults on this route.
  - Runtime/API changes:
    - Reuse:
      - `/api/access/subscription/defaults`
      - `/api/access/sharing/defaults`
    - Use the existing one-row-per-relationship defaults model underneath the graphical presentation.
    - Do not add new preference tables or new rules APIs in this pass.
  - Implementation notes:
    - Prefer visual hierarchy inspired by the EFL tree presentation, but keep the content generic and relationship-based rather than person-based.
    - Keep `/preferences` as the fallback for full recompute controls, preview, and exception tables until the rules tree proves out.
    - Add navigation links between `/tree`, `/rules-tree`, and `/preferences`.
  - Validation checks:
    - `npm run lint --prefix famailink`
    - `npm run build --prefix famailink`
    - `/rules-tree` loads for an authenticated user.
    - Editing and saving defaults on `/rules-tree` persists correctly and survives reload.
    - Saved defaults edited on `/rules-tree` are reflected on `/preferences` and vice versa.
  - Completion criteria:
    - Famailink has a relationship-first graphical defaults surface.
    - Broad subscription/sharing rules can be tested without using the defaults tables directly.
    - The existing defaults model remains unchanged underneath the new UI.
  Agreed implementation plan 2026-04-14 (Famailink compact rules-tree modal UX):
  - Scope:
    - Refine `/rules-tree` so the main relationship tree is a compact navigation surface rather than an always-open editor.
    - Keep the existing Famailink defaults APIs and storage model unchanged.
    - Preserve `/tree` for person-level overrides and `/preferences` as the full table fallback.
  - Root cause:
    - The current `/rules-tree` renders full selectors and sharing toggles inline on every relationship node.
    - That makes the screen too tall and dense, especially on mobile, and weakens the intended tree-navigation mental model.
    - Peer relationships (`Siblings`, `Siblings-In-Law`) are visually separated from `You` / `Spouse`, which makes the center of the family structure harder to scan quickly.
  - UI changes:
    - Convert supported relationship nodes on `/rules-tree` into compact summary cards/buttons.
    - Move peer relationships onto the same center row as `You` and `Spouse`.
    - Keep placeholders non-editable and clearly marked.
    - Clicking an editable relationship node opens a small modal popout that contains:
      - subscription default selector
      - sharing side selector
      - sharing scope toggles
      - concise relationship guidance
    - Keep a route-level `Save Defaults` action for persisting the current draft across multiple node edits.
  - Runtime/API changes:
    - Reuse:
      - `/api/access/subscription/defaults`
      - `/api/access/sharing/defaults`
    - Continue saving the same one-row-per-relationship default model; no schema or API contract changes.
  - Implementation notes:
    - The compact node should summarize current defaults clearly enough that users can scan the tree without opening every modal.
    - Modal editing should update local draft state; route-level save should remain the persistence action in this pass.
    - Mobile layout should favor fewer controls on the main surface and a narrower modal footprint.
  - Validation checks:
    - `npm run lint --prefix famailink`
    - `npm run build --prefix famailink`
    - `/rules-tree` shows compact, non-inline-editable relationship nodes.
    - `Siblings` and `Siblings-In-Law` render on the same center row as `You` and `Spouse`.
    - Clicking an editable node opens the modal and updates draft defaults correctly.
    - Saving still persists changes that survive reload and remain reflected on `/preferences`.
  - Completion criteria:
    - The rules tree is easier to scan on desktop and mobile.
    - Editing is focused into a small modal instead of inline controls on every node.
    - The defaults model stays unchanged underneath the refined interaction.
  Agreed implementation plan 2026-04-14 (Famailink rules-tree EFL-style generational redesign):
  - Scope:
    - Rework `/rules-tree` so the defaults surface looks and reads more like the main EFL family tree instead of stacked relationship buckets.
    - Keep the existing modal editing model from the latest Famailink rules-tree pass.
    - Preserve the existing defaults APIs and one-row-per-relationship storage model.
  - Root cause:
    - The current `/rules-tree` is still category-bucket driven rather than visually generational.
    - Its node layout does not mirror the EFL tree structure, so it fails the visual test even though it exposes the right concepts.
    - The current warm palette and legacy font choices do not align with the cooler, cleaner visual language of the main EFL tree.
  - UI changes:
    - Replace the current stacked level layout with a graph-style generational canvas inspired by the EFL tree.
    - Use generation rows rather than category buckets:
      - grandparents generation
      - parents generation
      - self/peer generation
      - children generation
      - grandchildren generation
    - Place side-categories in the generation where they naturally belong:
      - `aunts_uncles` and `aunts_uncles_in_law` with the parents generation
      - `cousins` and `cousins_in_law` with the self/peer generation
      - `nieces_nephews` and `nieces_nephews_in_law` with the children generation
      - `cousins_children` with the grandchildren generation
    - Keep `You`, `Spouse`, `Siblings`, and `Siblings-In-Law` on the center generation row.
    - Render compact node cards styled closer to EFL tree cards, with clearer relationship summaries and click-to-edit behavior.
    - Keep unsupported future categories like `Grandparents-In-Law` visibly marked as placeholders but integrated into the generational structure.
  - Visual/style changes:
    - Move the rules-tree surface away from the warm parchment palette on this route and toward the cooler EFL tree visual language.
    - Replace the current Trebuchet/Georgia-heavy feel on this route with a cleaner sans-forward typographic treatment that better matches the main app tree.
    - Use connector lines and spacing that make the generations readable on desktop while still collapsing acceptably on mobile.
  - Runtime/API changes:
    - None beyond the existing `/api/access/subscription/defaults` and `/api/access/sharing/defaults` usage.
    - Modal editing and route-level save continue to use the current draft/persist flow.
  - Validation checks:
    - `npm run lint --prefix famailink`
    - `npm run build --prefix famailink`
    - `/rules-tree` now presents the relationship defaults in generational rows rather than stacked category buckets.
    - The center generation visually matches the expected self/spouse/peer structure.
    - Editing still happens through the modal and persists correctly after save/reload.
    - The route’s visual treatment is visibly closer to the EFL tree surface than the prior parchment-style rules tree.
  - Completion criteria:
    - The rules tree feels like a generic family tree rather than a categorized settings page.
    - Generational relationships are visually clearer and easier to navigate.
    - The EFL tree structure and visual language are meaningfully reflected without changing the Famailink rules model.
  Agreed implementation plan 2026-04-14 (Famailink grandparents-in-law support):
  - Scope:
    - Promote `Grandparents-In-Law` from a visual placeholder to a real supported Famailink relationship category.
    - Keep the current one-hop in-law model otherwise unchanged.
    - Reuse the existing defaults/exceptions storage and API shape; no schema changes in this pass.
  - Root cause:
    - The current rules tree shows `Grandparents-In-Law` only as a placeholder for visual symmetry.
    - The supported relationship category list, default builders, and family-graph derivation do not currently include a `grandparents_in_law` category.
    - That mismatch leaves the UI visually suggestive but functionally incomplete.
  - Relationship-model changes:
    - Add explicit `grandparents_in_law` to the supported Famailink relationship categories and labels.
    - Derive `grandparents_in_law` as spouse parents' parents, limited to that explicit generation only.
    - Keep `grandparents_in_law` non-side-specific in v1.
  - Runtime/API changes:
    - Extend relationship validation/default builders and any category-order helpers to include `grandparents_in_law`.
    - Update family-graph hit derivation so a viewer with a spouse can receive `grandparents_in_law` hits for the spouse's grandparents.
    - Ensure preview, recompute, defaults persistence, and tree/rules-tree surfaces treat `grandparents_in_law` as a first-class category without new tables.
  - UI changes:
    - Replace the current `Grandparents-In-Law` placeholder in `/rules-tree` with a real editable relationship node.
    - Ensure the category also appears anywhere else editable relationship defaults are surfaced, including `/preferences`.
    - Keep the generational placement with the grandparents row for symmetry and easier scanning.
  - Design decision updates:
    - Update `designchoices.md` to expand the approved explicit in-law category set so it now includes `grandparents_in_law`.
  - Validation checks:
    - `npm run lint --prefix famailink`
    - `npm run build --prefix famailink`
    - `Grandparents-In-Law` appears as a real editable category in `/rules-tree` and `/preferences`.
    - Saving a default for `grandparents_in_law` survives reload.
    - Derived relationship hits include `grandparents_in_law` when the viewer has a spouse-grandparent path.
  - Completion criteria:
    - `Grandparents-In-Law` is no longer a placeholder.
    - Famailink supports the new in-law category consistently across derivation, defaults, preview/readback, and the rules tree.
  Agreed implementation plan 2026-04-14 (Famailink UX clarity pass):
  - Scope:
    - Improve the Famailink tree/preferences wording so the MVP remains explicit without sounding like internal-only diagnostics.
    - Keep the current access model, derivation logic, and recompute/storage behavior unchanged in this pass.
    - Focus only on labels, explanatory copy, and empty/pending-state wording that caused user confusion.
  - Root cause:
    - Several current labels expose internal implementation framing rather than user intent.
    - `Relationship Rows` reads like a viewer-specific count when it is actually the full graph row count loaded from OCI.
    - Per-person `Pending Recompute` badges are ambiguous because they do not say whether subscription, sharing, or both are missing derived rows.
    - Repeated `Lab` / `This slice proves` phrasing makes the surface harder to read as a working product test view.
  - UI changes:
    - Tree page:
      - Rename graph-wide counters to make their scope explicit.
      - Add brief guidance that badges are saved derived readback, not live rule inputs.
      - Replace generic pending badges with explicit subscription/sharing pending wording.
      - Tighten the bottom explanatory panel so it reads as page guidance rather than internal project framing.
    - Preferences page:
      - Replace internal/lab framing with clearer user-facing copy.
      - Clarify the purpose of family-member list, defaults, recompute, and preview sections.
  - API/data/runtime changes:
    - None. This pass is copy/label only.
  - Validation checks:
    - `npm run lint --prefix famailink`
    - `npm run build --prefix famailink`
    - Tree labels no longer imply `339 relationships for me`.
    - Missing derived rows show distinct subscription/sharing pending states.
    - Preferences copy remains aligned with the current model: tree visibility, subscription, and sharing are separate.
  - Completion criteria:
    - The Famailink UX is understandable without explaining internal implementation terms during normal use.
    - The tree page makes clear which counts are graph-wide vs viewer-specific.
    - Pending derived states are specific enough that they do not read like a generic failure.
  - Remaining: deployment split documentation.
  Agreed implementation plan 2026-04-12 (preferences simplification):
  - Scope:
    - Replace the current side-row default editor model that renders separate `both`, `maternal`, and `paternal` rows for the same relationship bucket.
    - Keep person-level exception behavior unchanged in this pass.
    - Keep existing OCI tables in place; normalize the runtime and UI to one default row per relationship category.
  - Root cause:
    - The current Famailink preferences UI exposed the storage granularity directly, which allowed overlapping side rules for the same relationship bucket and created ambiguous evaluation behavior.
    - Subscription and sharing default evaluators both matched multiple rows for one target person when side-specific rows overlapped.
  - API/data/runtime changes:
    - Subscription defaults:
      - Move to one logical default per relationship category.
      - For side-specific categories, store a single lineage selection value (`both`, `maternal`, `paternal`, or `none`) instead of multiple active rows.
      - For non-side-specific categories, keep one logical row only.
    - Sharing defaults:
      - Move to one logical default per relationship category.
      - Use one lineage selection per relationship row; scope booleans (`vitals`, `stories`, `media`, `conversations`) remain on that single row.
    - Runtime compatibility:
      - Fold any older multi-row side-specific defaults into the new one-row shape on read so existing saved data does not break the UI.
      - Persist saves back as one row per relationship category.
  - UI changes:
    - Subscription defaults table becomes one row per relationship.
    - Side-specific relationships use a single selector (`None`, `Both Sides`, `Maternal`, `Paternal`) instead of three rows.
    - Sharing defaults table becomes one row per relationship and no longer repeats the same relationship across multiple side rows.
  - Validation checks:
    - `npm run lint --prefix famailink`
    - `npm run build --prefix famailink`
    - Preferences page shows each relationship once in both defaults tables.
    - Saving/reloading preserves the selected side value per relationship.
    - Preview/recompute still report expected subscription and sharing outcomes with no overlapping side-rule ambiguity.
  - Completion criteria:
    - No defaults table shows duplicate rows for the same relationship category.
    - The saved default model is one logical row per relationship category.
    - Evaluation logic no longer depends on overlapping side rows for the same relationship bucket.
  - Remaining: deployment split documentation.
  Est date: 2026-04-10
  Desc: Build a standalone Unit 1/Famailink MVP that proves relationship-based tree visibility, notification subscriptions, and content sharing from a clean baseline. Do not carry over legacy EFL feature UIs/modules (media, people, calendars, shares, attributes, household editors, etc.) beyond what is explicitly needed for the MVP.
  Guardrails:
  - No imports from legacy feature UI modules under `src/app` or `src/components` except explicitly approved auth/session utilities.
  - No deployment of this track to the existing production project alias.
  - No schema-destructive changes; add-only schema/table/index updates when needed.
  Scope:
  - Create standalone Unit 1/Famailink app with:
    - login page
    - authenticated Unit 1 preferences page
    - subscription defaults editor
    - subscription person exception editor
    - sharing defaults editor
    - sharing person exception editor
    - family tree test view
    - recompute trigger + status
    - preview panel for selected family member
  - Create isolated Unit 1 API surface only for preference CRUD, preview, tree reads, and recompute.
  - Keep the model split explicit:
    - tree visibility = supported family relationship graph
    - subscription = notifications/newsletters/update preference
    - sharing = content visibility by type
  - Reuse only required database entities for Unit 1 behavior plus any new derived map tables needed to keep visibility and subscription results separate:
    - `subscription_default_rules`
    - `subscription_person_exceptions`
    - `owner_share_default_rules`
    - `owner_share_person_exceptions`
    - derived visibility/share map table(s)
    - derived subscription map table(s)
    - `access_recompute_jobs`
    - `access_recompute_runs`
  Phases:
  - Phase 1: Greenfield scaffold and boundaries
    - Create the isolated app shell, package scripts, and route structure.
    - Add explicit module-boundary note and lint guard to prevent legacy feature imports.
  - Phase 2: Minimal auth/session
    - Implement login/session gate for Unit 1 routes.
    - Keep token handling standard and secure.
    - Keep normal sign-in local username/password; any Stephen-only recovery path must remain an explicit break-glass exception, not a general mixed-auth model.
  - Phase 3: Unit 1 data/store + API
    - Implement minimal OCI data access for approved Unit 1 tables only.
    - Add CRUD endpoints for defaults/exceptions, tree reads, preview, and recompute/status.
    - Keep direct family structure in relationship rows only; derive extended relationships (`siblings`, `cousins`, etc.) from direct rows.
  - Phase 4: Unit 1 UI
    - Build minimal UX for editing rules, running recompute, previewing results, and testing the model in a family tree view.
    - Add clear pending/progress/success/failure messaging for long-running operations.
  - Phase 5: Verification + docs + deployment split
    - Run lint/build for the active Unit 1 app root.
    - Update `docs/change-summary.md` and `changeHistory.md`.
    - Document separate Vercel project/root-dir deployment steps for the isolated Unit 1 app.
  MVP relationship categories:
  - `self`
  - `spouse`
  - `parents`
  - `grandparents`
  - `children`
  - `grandchildren`
  - `siblings`
  - `aunts_uncles`
  - `nieces_nephews`
  - `cousins`
  - `cousins_children`
  MVP tree rules:
  - Every supported family member is visible in the tree at least by name and relationship.
  - Subscription never hides a person from the tree.
  - Sharing controls visibility of `vitals`, `stories`, `media`, and `conversations`.
  - Every visible family member can be subscribed/unsubscribed for updates.
  Validation:
  - Unauthenticated access to Unit 1 routes is blocked and redirected to login.
  - Logged-in user can save/read subscription/share preferences.
  - Logged-in user can view a family tree with supported family members present by name.
  - Recompute can run and status can be queried.
  - Preview returns the expected relationship, subscription, sharing, and final content-visibility outcome.
  - The isolated Unit 1 build/lint pass without importing unrelated legacy feature modules.
  Completion criteria:
  - Unit 1/Famailink is independently deployable as a separate project.
  - Existing EFL production app remains untouched by Unit 1 lab deployments.

- [ ] Legacy media/share compatibility hard cutover + test-content reset
  Priority: High
  Status: In progress 2026-04-04
  Est date: 2026-04-05
  Desc: Remove compatibility support for pre-canonical media/share behaviors and purge existing test-only media/share content so only the canonical write/read model remains active.
  Scope:
  - Remove media-link read fallback that mixes `MediaLinks` descriptive fields and legacy metadata JSON when canonical `MediaAssets` fields are missing.
  - Stop returning legacy `usage_type='share'` media-link rows in canonical media read paths.
  - Remove `getOciMediaAssetByFileId` legacy metadata fallback behavior and use normalized asset columns only.
  - Add a deterministic OCI reset script to clear test-only share/media/face/comment payloads and media-type attributes.
  Phases:
  - Phase 1: Remove compatibility reads in runtime paths.
  - Phase 2: Add/reset script with dry-run and apply modes.
  - Phase 3: Run lint/build and execute dry-run evidence capture.
  - Phase 4: Apply reset in environment when approved.
  Validation:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Dry-run reset script reports current counts.
  - Apply reset script leaves share/media/face/comment content tables empty and clears stale profile photo pointers.
  Completion criteria:
  - Old test media/share data no longer appears.
  - Runtime no longer relies on previous media compatibility behavior.
- [ ] Family Shares feed (WhatsApp-style media sharing threads) with audience targeting and push-ready notifications
  Priority: High (#1)
  Status: In progress 2026-04-05
  Progress 2026-04-04:
  - Completed: Phase 1 schema/OCI compatibility foundation.
  - Completed: Phase 2 API foundation (threads, posts, upload, comments, read-state, audience resolve, push subscription endpoints).
  - Completed: Phase 3 initial UX surface (Home/Nav `Shares` entry + Shares page in current style).
  - Completed: Phase 4 scaffold (notification outbox writes + admin dispatch scaffold route).
  - In progress: Phase 5 hardening (cross-family-group thread access resolution across all share endpoints and direct-media fallback behavior).
  - In progress: Thread-group UX update (show group members at top of selected thread, support custom member-based groups with duplicate-member-set prevention, and open audience threads by selection without a separate Open Thread button).
  - In progress: Normalize custom share groups into first-class `share_groups` / `share_group_members` with `share_threads.group_id` linkage.
  - In progress: Shares media upload cutover to canonical person-attribute/media association path (no migration/backfill required for current test-only data set).
  - In progress: Share thread UX pass (remove quick-audience selector, auto-ensure default audience threads, chip-based member editing in Create New Group, unread count badge on thread list, and right/left chat bubble alignment).
  - In progress: Phase 9 people-first conversation model kickoff (member-based thread access/listing independent of active family group; family group retained as audience-template metadata).
  - Completed 2026-04-05: Shares conversation/comment mutation controls now include corner ellipsis actions with inline `Edit`/`Delete`; conversation edit/delete is creator-only end-to-end (UI + API), with conversation-title `PATCH` support on the conversation route.
  - Remaining: deeper UX polish and production push transport.
  Est date: 2026-04-12
  Desc: Add a Home-level family sharing feed where users can upload media, tag/link people, choose a sharing audience (siblings, household, entire family, specific family group), and continue conversation threads with comments.
  Scope:
  - Reuse current media storage pipeline (`MediaAssets` originals + thumbnails, direct preview URLs).
  - Add thread model grouped by sharing audience and designed for continuous conversation.
  - Keep media-link associations for tagged people/households so shared media remains connected to family profiles.
  - Add Home-level feed surface and dedicated Shares screen using current app UX style (no new visual system).
  - Add push-notification readiness:
    - web-push subscription storage
    - notification outbox events for new posts/comments
    - dispatch hook/worker route for later rollout
  - Preserve existing People/Households/Media functionality and avoid regressions in current upload/link flows.
  Phases:
  - Phase 1: Data model + OCI compatibility
    - Status: Completed 2026-04-04
    - Add tables:
      - `share_threads`
      - `share_thread_members`
      - `share_posts`
      - `share_post_comments`
      - `push_subscriptions`
      - `notification_outbox`
    - Add indexes for tenant/thread/post/member lookup and unread ordering.
    - Add OCI helper functions for thread/post/comment CRUD and member resolution.
  - Phase 2: API foundation
    - Status: Completed 2026-04-04
    - Add APIs:
      - list/create threads
      - list/create posts (with media upload path)
      - list/create comments on posts
      - mark thread read
      - resolve audience recipients (`siblings`, `household`, `entire family`, selected family group)
      - register/unregister push subscriptions
    - Add audit log entries for create/update operations.
  - Phase 3: UX implementation (current style)
    - Status: Completed 2026-04-04
    - Add `Family Shares` section on Home.
    - Add Shares page with:
      - thread list grouped by audience
      - compose area with audience selector and media upload
      - post stream with comments
    - Keep controls consistent with existing People/Media design patterns.
  - Phase 4: Notification pipeline
    - Status: Completed 2026-04-04 (scaffold)
    - Write notification outbox entries for new posts/comments.
    - Add dispatcher route/job scaffold for push delivery with retries and failure state.
    - Keep delivery idempotent and non-blocking for user actions.
  - Phase 5: Hardening + validation
    - Status: In progress 2026-04-04
    - Verify tenant access guards on all share endpoints.
    - Verify thumbnail/original URL performance path and pagination/cursor behavior.
    - Confirm no regressions in existing Media tab, person modal media, and comments.
  - Phase 6: Normalized custom-group model + immediate-family audience rule
    - Status: In progress 2026-04-04
    - Scope:
      - Add `share_groups` (group identity) and `share_group_members` (membership history/current state).
      - Add `group_id` column on `share_threads` and wire custom-thread creation to first resolve/create a group row.
      - Keep duplicate-prevention deterministic by unique member signature (`family_group_key + member_signature`) at group level.
      - Keep thread behavior unchanged for existing standard audiences (`siblings`, `household`, `entire_family`, `family_group`).
      - Update `household` audience semantics to "Immediate Family":
        - actor + spouse + user-children (if any user-children exist),
        - else actor + parents + siblings + spouse.
      - Rename UI label from `My Household` to `Immediate Family`.
    - API/UI/data changes:
      - API:
        - `/api/t/[tenantKey]/shares/threads` custom-group POST path now resolves/creates `share_groups` and writes `group_id` on thread.
        - Existing thread-list/read/post endpoints continue to work; thread payload includes optional `groupId`.
      - UI:
        - Shares audience selector label updated to `Immediate Family` (internal key remains `household` for compatibility).
      - Data/schema:
        - New tables: `share_groups`, `share_group_members`.
        - New column: `share_threads.group_id`.
        - Add indexes for group signature and member lookup.
    - Validation:
      - `npm run lint` passes.
      - `npm run build` passes.
      - Creating custom group with same exact members reuses existing group/thread.
      - Creating custom group with different members creates new group/thread.
      - Shares audience selector displays `Immediate Family`.
      - Immediate-family resolution returns:
        - spouse + user-children when user-children exist,
        - otherwise parents + siblings + spouse.
    - Completion criteria:
      - Custom groups are first-class normalized entities linked from threads.
      - Duplicate group prevention is enforced by normalized group signature.
      - Immediate-family audience behavior matches the requested rule and UI naming.
  - Phase 7: Share list and chat UX normalization
    - Status: In progress 2026-04-04
    - Scope:
      - Remove inline quick-audience selector UI from the Share screen.
      - Ensure default threads (siblings, immediate family, entire family, family-group scope) are present and visible in the thread list without manual quick-open actions.
      - Keep thread list focused on all threads the signed-in member belongs to and show unread count badges on the right.
      - Upgrade Create New Group member selection to chip-based add/remove with search, plus optional audience-seed loading for starter membership.
      - Render thread messages in text-thread alignment: signed-in user messages on the right, others on the left, while preserving member color coding.
    - API/UI/data changes:
      - API: Reuse existing `/shares/threads` and `/shares/audience/resolve` contracts; no schema changes.
      - UI: `SharesClient` thread list and modal compose/thread rendering updates.
      - Data: No migration/backfill required.
    - Validation:
      - `npm run lint` passes.
      - `npm run build` passes.
      - Share screen loads with thread list only (no quick-audience selector block).
      - Default audience threads appear in the list and are reusable.
      - Create-group modal supports search chips add/remove and optional audience-seed member loading.
      - Signed-in user posts render right-aligned; other members left-aligned.
      - Thread rows show unread count badge on the right.
    - Completion criteria:
      - Thread-first Share UX is in place with no quick-audience dependency.
      - Default audience conversations are visible and usable from the thread list.
  - Phase 8: Conversation-topics model inside each share group + header action relocation
    - Status: In progress 2026-04-04
    - Scope:
      - Treat each share group (`share_threads`) as a continuous communication container.
      - Add distinct conversation/topic records inside each share group with required titles.
      - Track per-conversation read state so unread status reflects unseen uploads/comments per conversation.
      - Allow creating a new conversation with:
        - required `title`
        - optional initial message
        - optional media via the canonical Add Media attach flow
      - Ensure conversations are linked to:
        - creator person (`owner_person_id` / `created_by_person_id`)
        - tagged people through canonical media links on attached media posts
      - Surface linked conversations in Person modal media context (readable list).
      - Move top-level Help/Admin actions into the user-initials area and remove duplicate Sign out from main nav.
    - API/UI/data changes:
      - Data/schema:
        - Add `share_conversations` (conversation identity + metadata + last activity).
        - Add `share_conversation_members` (conversation membership/read state).
        - Add `conversation_id` on `share_posts` (nullable for compatibility reads).
      - API:
        - Add conversation list/create routes under share thread:
          - `GET/POST /api/t/[tenantKey]/shares/threads/[threadId]/conversations`
        - Add conversation read-state route:
          - `POST /api/t/[tenantKey]/shares/threads/[threadId]/conversations/[conversationId]/read`
        - Extend posts routes to filter/create by `conversationId`.
        - Add person-linked conversation list route for Person modal reads.
      - UI:
        - Shares: selecting a share group shows conversation list ordered by recent activity.
        - Shares: selecting a conversation loads its messages/media/comments.
        - Shares: Add New Conversation flow requires title and supports optional initial text/media.
        - Header: question-mark Help action beside user initials; Admin moved into initials popout; remove Sign out from main menu.
        - Person modal: linked conversation list under media context with open-navigation affordance.
    - Validation:
      - `npm run lint` passes.
      - `npm run build` passes.
      - In a share group, user can create multiple titled conversations and reopen them by date/activity order.
      - Conversation unread badges clear only after conversation read update.
      - New conversation can be created with title-only, title+text, or title+media.
      - Media attached in conversation still creates canonical media/person links.
      - Header nav no longer shows Help/Admin/Sign out pills; Help/Admin/Sign out available from initials area.
      - Person modal shows linked conversations for that person (creator-linked and media-tag-linked).
    - Completion criteria:
      - Share groups contain multiple durable conversation topics with per-topic unread tracking.
      - New conversation creation and media posting run through canonical media link behavior.
      - Navigation/action placement matches requested UX with no duplicate sign-out entry.
  - Phase 9: People-first conversation identity and access model (cross-family conversations)
    - Status: In progress 2026-04-05
    - Scope:
      - Shift Shares mental model from family-group containers to people/member containers.
      - Make thread/conversation visibility primarily membership-based (`person_id` in active members), not active family-group based.
      - Keep family-group audiences (`Immediate Family`, `Siblings`, `Family Group`) as recipient templates for conversation creation, not as read/access gates.
      - Preserve existing media-link behavior so posts continue to augment person/media history.
      - Deliver in safe incremental passes without breaking existing shares UX.
    - Phases:
      - Phase 9.1 (current): member-based read/access foundation
        - Add OCI helper reads for:
          - list all threads for a person across all family groups
          - resolve thread by (`thread_id`, `person_id`) membership
        - Update share thread list and thread resolution paths to use member-based lookup first.
        - Keep payload/contracts unchanged for current UI compatibility.
      - Phase 9.2: creation model split (template vs conversation identity)
        - Keep audience template selection in UI.
        - Store conversation identity by member-set/thread membership semantics, not by active family-group route.
        - Prevent duplicate conversations by canonical active-member signature where applicable.
      - Phase 9.3: UI language and flow simplification
        - Rename user-facing surfaces from family-group wording to conversation wording (`Conversations`, `Chats`).
        - Keep family-group picker only for template defaults and filtering, not inbox scoping.
      - Phase 9.4: migration and cleanup
        - Backfill or normalize existing share rows into the final people-first model.
        - Remove obsolete family-group-scoped share guard logic once parity is proven.
    - API/UI/data changes:
      - API:
        - `/api/t/[tenantKey]/shares/threads` GET should return all conversations the actor belongs to, regardless of active family-group route.
        - `/api/t/[tenantKey]/shares/threads/[threadId]/...` routes should resolve access by membership first.
      - UI:
        - Shares list behaves as a member inbox.
        - Existing post/comment/conversation behavior remains while access semantics shift.
      - Data:
        - Start with helper/index/query changes only; no destructive schema migration in Phase 9.1.
    - Validation:
      - `npm run lint` passes.
      - `npm run build` passes.
      - Member sees the same threads when switching active family group.
      - Opening/posting/commenting in a thread does not fail due to active family-group mismatch when membership is valid.
    - Completion criteria:
      - Shares behaves as people-first conversation inbox.
      - Family group is no longer the primary runtime access key for reading conversations.
      - Existing media/person linkage remains intact.
  API/UI/data changes:
  - API: new `/api/t/[tenantKey]/shares/...` routes plus push subscription endpoints and dispatch hook.
  - UI: Home feed card + Shares screen + compose/comments interactions.
  - Data: new normalized share-thread and notification-support tables.
  Validation:
  - `npm run lint` passes.
  - `npm run build` passes (environment permitting).
  - User can create a thread by audience, upload media, and see post in continuous thread.
  - Thread comments persist and reload in order.
  - Tagged people media links are created/updated correctly.
  - Notification outbox entries are created for recipients.
  Completion criteria:
  - Family Shares is usable end-to-end with audience-based continuous threads.
  - Existing app media functionality remains stable.
  - Push infrastructure is wired and ready for production dispatch enablement.
- [ ] Media comments with threaded family conversations
  Priority: High
  Status: In progress 2026-03-30
  Est date: 2026-03-31
  Desc: Add robust media comments so family members can hold conversational threads on each media item, including replies, edit/delete controls, and audit-safe write behavior.
  Scope:
  - Add media-comment persistence table as a child model of media (`file_id`) scoped by family group.
  - Support threaded replies via `parent_comment_id`.
  - Support top-level comments and nested replies from media modal.
  - Store author identity context (`person_id`, display fallback, email), status, and timestamps.
  - Support comment edit and soft-delete while preserving thread continuity.
  - Enforce author/admin permissions for edit/delete.
  - Render comments in media modal with clear chronological thread ordering.
  - Keep current media metadata/linking/AI behavior unchanged.
  Phases:
  - Phase 1: Data model + OCI compatibility
    - Add `MediaComments` table contract in runtime table map.
    - Add compatibility bootstrap for create/alter/index in OCI path.
    - Add read/write helpers for list/create/update/soft-delete by tenant/file.
  - Phase 2: API routes
    - Add `GET/POST` comments route under media file path.
    - Add `PATCH/DELETE` comment-id route.
    - Validate payloads, parent-child linkage, and permission checks.
  - Phase 3: Media modal UI
    - Add `Comments` tab in media modal.
    - Add top-level comment composer and per-comment reply/edit/delete actions.
    - Render threaded view with status/error feedback.
  - Phase 4: Verification + docs
    - Run lint/build checks.
    - Update schema/design/change docs in same commit cycle.
  API/UI/data changes:
  - API: new media comments routes (`/api/t/[tenantKey]/photos/[fileId]/comments` and comment-id mutations).
  - UI: media modal gains threaded comments tab and actions.
  - Data: new `media_comments` table with indexes for (`family_group_key`, `file_id`, `created_at`) and (`parent_comment_id`).
  Validation:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Family member can add top-level comment and replies on a media file.
  - Author/admin can edit/delete; non-author non-admin cannot mutate others' comments.
  - Deleted comment keeps thread structure and reply visibility.
  Completion criteria:
  - Media modal supports stable conversational threads per media item.
  - Thread writes/reads are permission-safe and auditable.
  - No regressions in existing media detail, linking, and AI tabs.
- [ ] Weekly birthday newsletter emails by family-group membership
  Priority: High
  Status: Planned 2026-03-29
  Est date: 2026-04-03
  Desc: Send weekly emails to users with upcoming birthdays for people in family groups they can access, including profile highlights (attributes/hobbies/facts) with safe privacy-aware content.
  Scope:
  - Build weekly digest job for upcoming birthdays (default next 7 days; configurable window).
  - Resolve user recipients by active family-group memberships.
  - Group digest content by family group and birthday date.
  - Include concise person highlights where available:
    - hobbies
    - selected attributes/facts/events
    - optional profile/photo snippet
  - Add per-user newsletter preferences:
    - opt-in/out
    - frequency (weekly initial; extensible)
    - delivery day/time window
  - Add dedupe logic so multi-group users receive one consolidated send per schedule window.
  - Add delivery/audit tracking for sent, skipped, failed, and retried messages.
  - Keep role/access constraints aligned to family-group visibility rules.
  Phases:
  - Phase 1: Recipient + birthday query model
    - Define deterministic query for upcoming birthdays per family group and per user access.
    - Define exclusion rules (disabled users, missing email, opt-out).
  - Phase 2: Content assembly
    - Build digest template model (subject, grouped sections, highlights).
    - Add safe fallback content when highlights are sparse.
  - Phase 3: Preferences + controls
    - Add user preference fields and UI controls for newsletter opt-in/schedule.
    - Add admin visibility where needed for support/debug.
  - Phase 4: Scheduled send pipeline
    - Implement scheduled runner (cron/job) to compose and send digests.
    - Add idempotency keys + dedupe window to prevent duplicate sends.
  - Phase 5: Monitoring + retry + hardening
    - Add send audit and error tracking.
    - Add bounded retry logic and failure reporting.
    - Validate timezone handling and send windows.
  API/UI/data changes:
  - API/Jobs: scheduled digest generator/sender and support endpoints.
  - UI: user preference controls for birthday newsletter delivery.
  - Data: newsletter preference + send-log persistence (table(s) or equivalent store) for idempotency and audit.
  Validation:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Eligible users receive one correct weekly digest grouped by accessible family groups.
  - Content includes correct upcoming birthdays and selected highlights.
  - Opt-out users do not receive newsletter sends.
  - Multi-group users are deduped to one scheduled send per cycle.
  Completion criteria:
  - Weekly digest pipeline runs reliably with auditability.
  - Users can control subscription preferences.
  - Birthday content is accurate, access-scoped, and delivered on schedule.
- [ ] Family relationship games (child selection + sibling age order) with optional AI quiz generation
  Priority: High
  Status: Planned 2026-03-29
  Est date: 2026-04-02
  Desc: Build engaging family-learning quizzes in Games using deterministic family data for correctness, with optional AI assistance for prompt variety and round generation.
  Scope:
  - Add quiz mode 1: `Which children belong to these parents?`
    - Show parent(s) and a candidate list (ex: 8 names) with mixed distractors.
    - User selects all correct children.
  - Add quiz mode 2: `Order siblings by age`
    - Show sibling set and require oldest-to-youngest ordering.
  - Add scoring model based on accuracy + completion time.
  - Add round progression across multiple families/households in one session.
  - Keep answer correctness deterministic from canonical relationship and birth-date data.
  - Add optional AI-assisted content generation for:
    - wording/theme variants
    - hint text
    - difficulty tuning
  - Validate all AI-generated rounds against deterministic data rules before display.
  Phases:
  - Phase 1: Quiz data selectors + deterministic validators
    - Build household/sibling candidate selectors from canonical graph data.
    - Build strict validators for child-membership and age-order answers.
  - Phase 2: Core game engine
    - Implement round loop, timer, scoring, and result summary.
    - Implement difficulty settings (candidate size, distractor similarity, sibling count).
  - Phase 3: Game UI in `Games`
    - Build quiz cards, answer controls (checkbox + ordering UI), and progress display.
    - Build result/review view with correct-answer explanations.
  - Phase 4: Optional AI assist layer
    - Add AI generation path for prompt phrasing and round flavor text only.
    - Add deterministic post-generation validation and fallback to non-AI round generation.
  - Phase 5: Validation and balancing
    - Validate scoring fairness and timing behavior.
    - Validate edge-case handling (unknown birthdates, twins, incomplete households).
  API/UI/data changes:
  - API: game-round endpoints and scoring session endpoint (or server actions) for deterministic round generation and scoring.
  - UI: new Games flows for child-selection and sibling-order quizzes with timer/progress/score.
  - Data: optional game-session persistence for score history/leaderboards; no required schema change for core quiz correctness.
  Validation:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Child-selection quiz answers are always checked against deterministic parent-child links.
  - Sibling-order quiz answers are always checked against deterministic birth-date ordering rules.
  - AI-generated round text never overrides deterministic correctness.
  Completion criteria:
  - Two quiz modes are playable end-to-end with scoring and timing.
  - Correctness is deterministic and auditable.
  - Optional AI assistance improves variety without reducing accuracy.
- [ ] Person profile external private survey link -> attribute ingestion
  Priority: High
  Status: Planned 2026-03-29
  Est date: 2026-03-31
  Desc: Add a person-profile action that creates a private temporary survey link for a specific person, and map completed survey responses into canonical `Attributes` rows for that person.
  Scope:
  - Add `Create Survey Link` action on person profile/modal for authorized users.
  - Create tokenized survey links tied to:
    - `tenantKey`
    - `personId`
    - expiration timestamp
    - optional one-time or multi-submit policy
  - Provide a private external survey page reachable by token URL only.
  - On save/submit, map survey answers to canonical attribute writes for the linked person.
  - Support configurable survey field mapping (question -> attribute type/category/detail/date/notes).
  - Track audit metadata for survey-origin writes.
  - Support link revoke/disable before expiration.
  - Preserve current auth/session behavior for in-app users; survey token route uses token auth only.
  Phases:
  - Phase 1: Survey link data model + token lifecycle
    - Define storage for survey links/tokens, status, expiry, and target person.
    - Add token create/revoke/validate logic.
  - Phase 2: Survey page + submission API
    - Build token-gated survey page.
    - Build submission route that validates token and payload.
  - Phase 3: Attribute mapping engine
    - Implement deterministic mapping from survey answers to `Attributes` payloads.
    - Write attributes on explicit save/submit (not per keystroke).
  - Phase 4: Person profile action + admin controls
    - Add `Create Survey Link` button on person profile/modal.
    - Add copy link + revoke controls and status display.
  - Phase 5: Validation and hardening
    - Verify link expiry/revoke behavior.
    - Verify mapped attributes appear under target person.
    - Verify audit rows include survey-source context.
  API/UI/data changes:
  - API: survey-link create/revoke endpoints; token validate/submit endpoint.
  - UI: person profile survey-link controls; token survey form page.
  - Data: new survey-link/survey-response persistence layer (table(s) or equivalent store), plus canonical `Attributes` writes.
  Validation:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Created survey link opens only while valid and unrevoked.
  - Submit creates expected attribute rows for linked person and tenant.
  - Expired/revoked tokens cannot submit.
  Completion criteria:
  - Authorized user can generate and manage private person-specific survey links.
  - External responses reliably create canonical attributes for the target person.
  - Token security and auditability are in place.
- [x] Harden Help with deterministic task playbooks + dynamic deep links
  Priority: High
  Status: Completed 2026-03-30
  Est date: 2026-03-30
  Desc: Make Help reliable for common "how do I..." tasks by combining deterministic guidance for core workflows with dynamic, session-aware action links (including "Add photo to my profile"), while keeping AI fallback for unmatched questions.
  Scope:
  - Add a curated help intent/playbook set for top tasks:
    - add person
    - add photo/media to my profile
    - what is an attribute
    - add attribute/event/story
    - invite/access basics
  - Extend Help API response to support structured actions (`label`, `href`, `kind`, `requiresRole`, optional `description`) in addition to text answer.
  - Generate action links dynamically from current session context (`tenantKey`, `role`, `session.user.person_id`) so links target the current user and active tenant.
  - Add Help UI action rendering (button/link cards under the answer) instead of relying only on free-text instructions.
  - Add deep-link handling in person-profile flow so Help links can open specific context (`tab=photos`, `action=add-media`) for the active person route.
  - Preserve guardrails and role-aware responses (admin-only vs user-safe guidance).
  - Preserve AI text fallback for questions outside deterministic playbooks.
  Phases:
  - Phase 1: Intent and response contract
    - Define top-priority playbooks and matching logic.
    - Extend `/api/t/[tenantKey]/ai/help` response shape with structured action list.
  - Phase 2: Dynamic action builders
    - Add session-aware link builder utilities for tenant/person scoped routes.
    - Implement "Add photo to my profile" dynamic link generation.
  - Phase 3: Help UI actions
    - Render structured actions in Help panel with clear labels and safe navigation.
    - Keep answer text plus actions together for clarity.
  - Phase 4: Deep-link execution path
    - Add query-param handling in person-profile client/modal to switch to Media tab and trigger add-media action.
    - Ensure return path back to Help remains intact.
  - Phase 5: Validation and rollout
    - Validate deterministic responses and links for target intents.
    - Validate fallback AI behavior for unmatched questions.
  API/UI/data changes:
  - API: `/api/t/[tenantKey]/ai/help` adds structured action payloads for supported intents.
  - UI: Help assistant renders answer actions as clickable buttons/links.
  - UI routing: person profile/modal reads optional deep-link query params for tab/action targeting.
  - Data: No schema/data migration.
  Validation:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Asking "How do I add a photo to my profile?" returns a working action link for the signed-in person.
  - Clicking that action opens person profile in Media context and can launch add-media flow.
  - Asking "What is an attribute?" returns deterministic definition + relevant action links.
  - Non-playbook questions still get grounded AI responses.
  Completion criteria:
  - Core help intents return deterministic guidance with actionable links.
  - Links are user/tenant-aware and route correctly.
  - Help remains stable for unmatched questions via AI fallback.
- [ ] Person attribute import with in-modal format guide + file upload
  Priority: High
  Status: In progress 2026-03-29
  Est date: 2026-03-29
  Desc: Add a person-scoped attribute import workflow directly in the Person modal Attributes tab, including a format/guide button with sample data and a second button to upload an import file.
  Scope:
  - Add `Format & Guide` action in Person modal Attributes tab.
  - Add `Upload Import File` action in Person modal Attributes tab.
  - Limit imported rows to the active person in the open modal (no cross-person imports).
  - Provide import guidance with:
    - expected CSV headers
    - field type/size guidance
    - allowed attribute type/category options from active tenant definitions
    - sample CSV rows
  Phases:
  - Phase 1: Person import API
    - Add person-scoped import route to return guide metadata and accept CSV import payloads.
    - Validate rows against canonical attribute constraints and report row-level failures.
  - Phase 2: Person modal UI
    - Add two buttons in the Attributes tab for guide display and file upload.
    - Add guide modal/panel showing format details and sample rows.
  - Phase 3: Import execution + refresh
    - Read selected file client-side and post CSV to route.
    - Refresh person attributes/media state after successful import.
  - Phase 4: Validation
    - Confirm imports create attributes for active person only.
    - Confirm guide shows current attribute type/category options and sample CSV.
  API/UI/data changes:
  - API: new person-scoped attributes import route (guide + upload import).
  - UI: Person modal Attributes tab gets guide and upload controls.
  - Data: creates person attributes via canonical `Attributes` write path; no schema change.
  Validation:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Uploading valid CSV in person modal creates attributes and refreshes the view.
  Completion criteria:
  - Two-button import UX exists in person modal Attributes tab.
  - Guide includes field sizing/types, allowed types/categories, and sample data.
  - Import is constrained to the active person.
- [ ] Add attribute linking in Person modal Media detail ("Linked To")
  Priority: High
  Status: In progress 2026-03-29
  Est date: 2026-03-29
  Desc: Extend the Person modal Media detail link picker so users can link selected media to existing attributes of the active person, in addition to people and households.
  Scope:
  - Add `attribute` as a supported link target in the Person modal `Linked To` search picker.
  - Limit attribute search candidates to attributes owned by the active person in the open modal.
  - Show linked attribute chips in the same `Linked To` list and support removing those links.
  - Keep existing person/household link behavior unchanged.
  Phases:
  - Phase 1: API route support
    - Add tenant-scoped route to add/remove a media link for an existing person attribute.
    - Validate person and attribute ownership before link mutation.
  - Phase 2: Person modal UI wiring
    - Extend search result types and chips to include attributes.
    - Add attribute link/unlink handlers and pending-operation state.
  - Phase 3: Association refresh model
    - Include active-person attribute associations in selected-photo association refresh.
    - Preserve people/household refresh behavior from existing `/photos/search` path.
  - Phase 4: Validation
    - Confirm attribute options are limited to active person attributes.
    - Confirm add/remove link updates chips and persists after modal reopen.
  API/UI/data changes:
  - API: add person-attribute media link mutation route under tenant/person/attribute path.
  - UI: `PersonEditModal` `Linked To` list includes `attribute` chips and search options.
  - Data: `media_links` adds/removes `entity_type='attribute'` rows for selected attribute IDs.
  Validation:
  - `npm run lint` passes.
  - `npm run build` passes.
  - In deployed UI, selected media can be linked/unlinked to active-person attributes from the same linking control.
  Completion criteria:
  - `Linked To` supports people, households, and attributes.
  - Attribute search candidates are restricted to the active person's attributes.
  - Link changes persist and reload correctly.
- [ ] Extend direct media delivery model to Person modal Media tab
  Priority: High
  Status: In progress 2026-03-29
  Est date: 2026-03-29
  Desc: Apply the media-library direct-loading model to the Person modal `Media` tab so tiles stop depending on per-image proxy auth checks and load reliably/speed-first.
  Scope:
  - Authorize once on `/api/t/[tenantKey]/attributes` for the person entity.
  - Return direct OCI media URLs in that attributes response for linked media (`previewUrl` and `originalUrl`) when object keys exist.
  - Load image tiles directly from OCI preview URLs with per-file fallback to existing `/viewer/photo/...` proxy paths on load error.
  - Load modal originals from direct OCI original URLs where available, with safe fallback for failures.
  - Keep runtime thumbnail backfill behavior active for rows missing `thumbnail_object_key` so preview fallback self-heals legacy assets.
  - Ensure person-linked media visibility is not constrained to only the active family group for users with access to multiple groups.
  Phases:
  - Phase 1: API payload extension
    - Extend person-attributes media link payload shape to include object keys and direct URL fields.
    - Generate direct URLs once per request via OCI direct URL factory.
  - Phase 2: Person modal UI cutover
    - Update tile/detail image sources to prefer direct URLs.
    - Add per-file fallback tracking for preview and original URL failures.
  - Phase 3: Legacy thumbnail resilience
    - Preserve preview fallback path so missing thumbnail keys continue to self-heal via existing backfill behavior.
    - Verify fallback no longer leaves persistent blank tiles.
  - Phase 4: Validation
    - Confirm person modal tiles render directly from OCI for keyed assets.
    - Confirm no regression for audio/video/document media paths.
    - Confirm person modal still shows linked media across accessible family groups.
  API/UI/data changes:
  - API: `/api/t/[tenantKey]/attributes` includes direct URL fields for media links.
  - UI: `PersonEditModal` media tile/detail image loads prefer direct URLs with fallback.
  - Data: No schema change required; existing thumbnail backfill remains the healing mechanism.
  Validation:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Deployed person modal media images load reliably and faster than proxy-only behavior.
  Completion criteria:
  - Person modal image tiles no longer rely primarily on per-image proxy endpoints.
  - Missing thumbnails no longer produce persistent blank tiles in normal usage.
- [ ] Direct thumbnail delivery (authorized list + OCI direct URLs + thumbnail backfill)
  Priority: High
  Status: In progress 2026-03-29
  Est date: 2026-03-29
  Desc: Remove per-image auth/proxy bottlenecks on media tiles by authorizing once on media search, returning OCI-direct thumbnail URLs in the search/detail payload, and backfilling missing thumbnail object keys so preview requests do not keep falling back to large originals.
  Scope:
  - Keep tenant authorization at `/api/t/[tenantKey]/photos/search` as the primary access gate for tile eligibility.
  - Add direct OCI URL fields to media search/detail payloads (`previewUrl`, `originalUrl`) when object keys are available.
  - Move media tile image loading to direct preview URLs with safe fallback to existing proxy routes on load failure.
  - Support modal image/document direct loading from signed/direct object URLs with fallback to existing proxy paths.
  - Add missing `thumbnailObjectKey` to list payloads so modal metadata no longer waits on detail fetch just to display that field.
  - Add safe thumbnail backfill behavior for image assets missing `thumbnail_object_key` so preview paths can self-heal legacy rows.
  - Preserve existing behavior for non-image assets and for rows without OCI object keys.
  Phases:
  - Phase 1: URL delivery plumbing
    - Add OCI direct URL generation helper in object storage layer with safe fallback behavior when signing/direct URL generation is unavailable.
    - Extend search/detail routes to include `previewUrl`/`originalUrl` and key fields from canonical `MediaAssets`.
  - Phase 2: UI cutover with fallback
    - Update media tiles and modal preview to use direct URLs first.
    - Keep robust per-item fallback to existing `/viewer/photo/...` proxy paths on image load error.
  - Phase 3: Thumbnail-key healing
    - Add runtime-safe thumbnail generation/backfill path for image assets that have original object keys but missing thumbnail keys.
    - Persist generated thumbnail keys on `MediaAssets` to eliminate repeated fallback work.
  - Phase 4: Validation
    - Confirm tile network behavior uses OCI-direct URLs for items with thumbnail keys.
    - Confirm unauthorized media still does not appear from search results.
    - Confirm modal metadata shows `thumbnailObjectKey` immediately when present in list payload.
    - Confirm legacy rows with missing thumbnail keys are healed and then serve previews without original-size fallback.
  API/UI/data changes:
  - API: `/photos/search` and `/photos/[fileId]` include direct URL fields and thumbnail/original object key-backed fields.
  - UI: media tile/modal preview use direct URLs first with proxy fallback.
  - Data: `MediaAssets.thumbnail_object_key` can be backfilled for legacy image assets when missing.
  Validation:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Deployed media tiles load via direct preview URLs for keyed assets and remain functional via fallback for edge cases.
  Completion criteria:
  - Media tile loading is no longer bottlenecked by per-image session-checked proxy requests for keyed OCI assets.
  - Missing thumbnail keys are reduced through backfill and no longer routinely force large-original preview fallbacks.
- [ ] Correct media recency to use database add timestamp
  Priority: High
  Status: In progress 2026-03-25
  Est date: 2026-03-25
  Desc: Fix media ordering so "recent" means the date/time the file was added to the database, not the file's old browser `lastModified` timestamp or the photo's capture date. Keep `photo_date` and EXIF fields as the media-date model, and make `MediaAssets.created_at` the immutable database add/upload timestamp used for library recency.
  Scope:
  - Redefine `MediaAssets.created_at` in active runtime behavior as the immutable database add/upload timestamp.
  - Stop seeding `MediaAssets.created_at` from browser `fileCreatedAt` / `lastModified`.
  - Preserve `MediaAssets.photo_date` as the canonical user/media date and keep EXIF capture fields separate.
  - Backfill existing `MediaAssets.created_at` rows where upload audit data proves the real add time.
  - Reverify media library sorting using the new timestamp semantics.
  Phases:
  - Phase 1: Design + schema contract
    - Update `designchoices.md` and `docs/data-schema.md` so `created_at` means database add/upload timestamp, not media creation/capture time.
    - Record that `photo_date` and EXIF fields remain the media-date model.
  - Phase 2: Write-path correction
    - Update person and household upload routes so `created_at` is set to `new Date().toISOString()` at upload time.
    - Keep `photo_date` defaulting from the requested user date or the file timestamp fallback, not from the upload timestamp.
    - Preserve the existing immutable-upsert rule so later links/edits do not overwrite asset `created_at`.
  - Phase 3: Data backfill
    - Backfill `MediaAssets.created_at` from `AuditLog.timestamp` for upload events where `AuditLog.entity_id = MediaAssets.file_id`.
    - Restrict the backfill to rows where the upload audit timestamp is authoritative for the original add event.
    - Leave rows without upload-audit evidence unchanged in this phase rather than inventing a weaker timestamp.
  - Phase 4: Validation
    - Verify the just-uploaded OCI-native file sorts into the first page by `created_at`.
    - Verify top-12 ordering from `/photos/search` matches `MediaAssets.created_at DESC`.
    - Verify newly uploaded old photos no longer inherit 2022-style file timestamps as recency values.
  API/UI/data changes:
  - API: Media search/detail continue returning `createdAt`, but it now represents database add/upload time.
  - UI: Media library recency becomes true upload recency.
  - Data: Targeted OCI backfill updates existing `MediaAssets.created_at` values from authoritative audit evidence.
  Validation:
  - `npm run build` passes.
  - The latest uploaded file appears in the top 12 when sorted by recent.
  - `MediaAssets.created_at` for new uploads reflects current upload time, not browser file age.
  - Existing rows with upload audit evidence are normalized to audit-backed add timestamps.
  Completion criteria:
  - `created_at` means database add/upload time everywhere in active media runtime behavior.
  - `photo_date` and EXIF remain separate from upload recency.
  - The media library's recent ordering matches actual upload timing.
- [ ] Reset media modal to stored-detail and stored-snapshot mode
  Priority: High
  Est date: 2026-03-24
  Desc: Remove live intelligence behavior from the media modal so the modal only displays stored media detail, stored links, and stored analysis/process snapshots. The modal should stop triggering or offering any active intelligence, EXIF, processing-status refresh, or face-association actions until the intelligence workflow is redesigned.
  Scope:
  - Remove active modal controls for:
    - `Generate Suggestions`
    - `Load Processing Status`
    - `Load EXIF`
    - `Use Title`
    - `Use Description`
    - `Use Date`
    - `Associate Face`
  - Remove any auto-run intelligence behavior when the modal opens.
  - Keep media detail editing, linked people/households editing, and stored analysis/process snapshot display.
  - Do not delete intelligence routes/tables in this phase; only deactivate them from the modal UI and modal-triggered behavior.
  Phases:
  - Phase 1: Design reset documentation
    - Record that the media modal is now a stored-data/read-only intelligence surface.
    - State explicitly that modal intelligence actions are inactive pending redesign.
  - Phase 2: Modal UI shutdown
    - Remove the active intelligence button from the modal header.
    - Remove the embedded interactive photo-suggestions card from the `Info` tab.
    - Convert the `Analysis` tab to read-only stored snapshot display only.
    - Remove modal-triggered EXIF/status refresh and face-association actions.
  - Phase 3: Active behavior shutdown
    - Remove the modal auto-run intelligence effect.
    - Ensure opening the modal does not trigger intelligence/status/exif requests.
    - Ensure the modal no longer posts to intelligence or face-association routes from any button path.
  - Phase 4: Validation
    - Confirm the media modal still opens and shows media detail plus stored snapshot/process data.
    - Confirm modal open no longer triggers intelligence/status/exif network activity.
    - Confirm linked people/households editing and normal media detail save still work.
  API/UI/data changes:
  - UI: Media modal becomes a stored-detail and stored-snapshot surface with no active intelligence controls.
  - API: Existing intelligence-related routes remain available but are no longer invoked from the media modal.
  - Data: No schema/data migration in this phase.
  Validation:
  - `npm run build` passes.
  - Media modal header contains no active intelligence action.
  - Opening the modal no longer auto-runs intelligence.
  - `Analysis` tab shows stored snapshot/process data only.
  Completion criteria:
  - No modal control can trigger intelligence, EXIF loading, processing-status recompute, or face association.
  - Media detail and stored snapshot display remain functional.
  - The design reset is documented.
- [x] Canonicalize media asset fields on `MediaAssets` and stop `media_metadata` writes
  Priority: High
  Status: Completed 2026-03-25
  Est date: 2026-03-25
  Desc: Move the remaining canonical photo-level fields onto `MediaAssets`, stop writing runtime JSON into `MediaAssets.media_metadata`, treat `created_at` as the immutable asset timestamp, and reduce `MediaLinks` to association-only runtime behavior. Defer the `media_id` / `file_id` simplification until this task is complete so the current release stays focused on one storage-model cutover.
  Scope:
  - Add canonical `MediaAssets` columns for:
    - `media_kind`
    - `label`
    - `description`
    - `photo_date`
  - Keep `created_at` as the canonical immutable asset timestamp and stop any route/helper from overwriting it after the first asset write.
  - Remove active runtime dependence on `MediaAssets.media_metadata` for:
    - `captureSource`
    - `processingStatus`
    - `photoIntelligence`
    - `photoIntelligenceDebug`
    - legacy object-key/source/checksum/dimension data
    - leftover thumbnail detail payload fields
  - Remove active runtime dependence on `MediaLinks.label`, `MediaLinks.description`, and `MediaLinks.photo_date` as canonical media metadata; keep link rows for association only.
  - Remove `storage_provider` from the active schema/runtime contract in this phase because OCI object storage is now the only supported backend.
  - Do not address `media_id` / `file_id` redundancy in this task; keep that as an explicitly deferred follow-up after the new canonical asset model is stable.
  Phases:
  - Phase 1: Design + schema contract
    - Update `designchoices.md` and `docs/data-schema.md` to state that canonical media-level name, description, user date, media kind, and immutable created timestamp live on `MediaAssets`.
    - Extend `oci-schema.sql` and `ensureMediaAssetsTableCompatibility()` for `media_kind`, `label`, `description`, and `photo_date`.
    - Remove `storage_provider` from the active documented contract and plan the schema/runtime cleanup for the same release.
  - Phase 2: Data backfill + timestamp normalization
    - Backfill `MediaAssets.label`, `MediaAssets.description`, and `MediaAssets.photo_date` from existing `MediaLinks` using deterministic per-`file_id` precedence rules.
    - Backfill missing `media_kind` from existing metadata or file-extension/mime inference.
    - Normalize `MediaAssets.created_at` so each asset keeps one stable timestamp and future writes never replace it.
    - Do not derive `created_at` from EXIF capture date or user-entered `photo_date`; those remain separate concepts.
  - Phase 3: Write-path cutover
    - Update upload, link, detail edit, and media association flows to write canonical media fields to `MediaAssets`.
    - Stop writing `MediaAssets.media_metadata` for capture source, processing status, intelligence/debug payloads, legacy object-storage data, and thumbnail detail payloads.
    - Stop updating `MediaLinks.label`, `MediaLinks.description`, and `MediaLinks.photo_date` as the canonical write target.
  - Phase 4: Read-path cutover
    - Update media library/detail/order logic to read canonical media name, description, user date, media kind, and created timestamp from `MediaAssets`.
    - Update UI media-type detection to read `MediaAssets.media_kind` instead of parsing JSON.
    - Remove active runtime reads of `processingStatus`, `photoIntelligence`, and other media-metadata JSON from media library/detail surfaces.
  - Phase 5: Cleanup + validation
    - Remove `storage_provider` from remaining code paths and schema references.
    - Verify `MediaAssets.media_metadata` is no longer written by active routes.
    - Confirm the media library and detail APIs still return the expected item shape using normalized columns only.
    - Leave `media_id` / `file_id` simplification deferred to a later dedicated task.
  API/UI/data changes:
  - API: `/photos/search`, `/photos/[fileId]`, upload routes, and edit routes should resolve canonical media metadata from `MediaAssets`.
  - UI: Media detail and media library should display asset-level name/date/description from `MediaAssets`; stored processing/intelligence snapshots should no longer come from JSON on these surfaces after cutover.
  - Data: One-time backfill is required for the new `MediaAssets` columns and immutable `created_at` normalization.
  Validation:
  - `npm run build` passes.
  - Media upload/link/edit flows persist `media_kind`, `label`, `description`, `photo_date`, and stable `created_at` on `MediaAssets`.
  - Media library ordering uses `MediaAssets.created_at`, not link timestamps.
  - No active route writes new `media_metadata` payloads.
  - `storage_provider` is gone from active schema/runtime behavior.
  Completion criteria:
  - `MediaAssets` is the only canonical storage location for media-level metadata.
  - `MediaLinks` is association-only in active runtime behavior.
  - `created_at` is immutable after initial asset write.
  - `media_metadata` is no longer used by active runtime writes.
  - `media_id` / `file_id` redundancy is explicitly deferred, not mixed into this change.
- [x] Rework media display controls after the `MediaAssets` canonicalization cutover
  Priority: Med
  Status: Completed 2026-03-25
  Est date: 2026-03-26
  Desc: After the canonical `MediaAssets` cutover lands, fix the media display so it no longer behaves like an implicit newest-10 image list driven by non-canonical ordering. Add explicit filters and `Next 12` / `Last 12` navigation based on canonical asset fields.
  Scope:
  - Change the default media display to use canonical `MediaAssets` ordering instead of `MediaLinks.created_at`.
  - Add user-facing filter controls for the agreed media slices.
  - Replace the current implicit limit behavior with explicit batched navigation using `Next 12` and `Last 12`.
  - Keep the media detail editor and link-management flows working with the new list controls.
  Validation:
  - Media display order matches canonical `MediaAssets.created_at`.
  - Users can filter the media list without losing the current selection state unexpectedly.
  - `Next 12` and `Last 12` navigation work without falling back to the current hidden top-10 behavior.
- [ ] Make auth/session multi-tenant (no re-auth on family switch)
  Priority: High
  Status: In progress 2026-03-27 (awaiting validation)
  Desc: Replace the single-tenant session model with one session that lists all accessible family groups so switching families no longer causes 401/403, with a feature flag to fall back to current behavior.
  Scope:
  - Session payload includes `accessibleTenants[]` and `preferredTenant` on sign-in.
  - `requireTenantAccess` allows any tenant in `accessibleTenants`; still denies tenants not in the list.
  - Callback/session validity is tenant-agnostic; derive tenant from the request path.
  - `active_tenant` becomes UI preference only; switching tenants just reloads data.
  Phases:
  - Phase 1: Feature flag + guard support (multi-tenant guard when flag on, existing behavior when off). ✅ Done in `requireTenantAccess`, gated by `ENABLE_MULTI_TENANT_SESSION`.
  - Phase 2: Session issuance populates `accessibleTenants`/`preferredTenant`.
  - Phase 3: Client updates remove assumptions that session tenant === active tenant. (Middleware and family switch API now allow refresh when flag is on; client fetches already key off route+cookies—no further changes planned unless validation exposes gaps.)
  - Phase 4: Validation with multi-family user (API/media/viewer) and intentional forbidden tenant check. **Pending**
  Validation:
  - `npm run build` passes.
  - Switching family groups for a user with multiple memberships requires no re-auth and no 401/403 for allowed tenants.
  - Accessing a non-member tenant still returns 403.
  Completion criteria:
  - Tenant switches are auth-stable; feature flag can revert to single-tenant checks if needed.
- [ ] Update login screen UX (show password, add logo)
  Priority: Med
  Status: Planned 2026-03-27
  Desc: Modernize login: show a password field, remove “look for password in email” messaging, and display the app logo.
  Scope:
  - Add visible password input to the login form.
  - Remove any “check email for password” text.
  - Add the app logo to the login page header.
  Validation:
  - `npm run build` passes.
  - Login page renders with logo and password field; no legacy messaging.
- [ ] Normalize person primary-photo model to one global canonical headshot
  Priority: High
  Est date: 2026-03-23
  Desc: Make person headshot selection person-based only by treating `People.photo_file_id` as the single canonical primary photo for a person across all family groups. Remove tenant-scoped person-photo primary authority from runtime behavior, repair stale data left by the old dual-source model, and fix person-photo surfaces that fall back to person IDs instead of names.
  Scope:
  - Treat `People.photo_file_id` as the only authoritative primary photo pointer for people.
  - Stop relying on `MediaLinks.is_primary` for `entity_type='person'` when reading, saving, or rendering person photos.
  - Keep household primary-photo behavior unchanged.
  - Repair stale `People.photo_file_id` rows and duplicate person-photo primaries left by the old route behavior.
  - Ensure person-linked photo flows resolve and display person names, not person IDs.
  Phases:
  - Phase 1: Design + source-of-truth alignment
    - Update design docs to record that person primary photos are global/person-scoped, not family-group-scoped.
    - Identify all person-photo save/upload/link/delete code paths that still read or write `isPrimary` as authoritative state.
    - Define the runtime rule that a linked person photo is primary only when its `fileId === People.photo_file_id`.
  - Phase 2: Runtime write-path changes
    - Update person photo upload, attribute create, attribute patch, and delete flows to set or clear `People.photo_file_id` directly.
    - Ensure new primary selection validates that the chosen file is linked to that person before updating the person row.
    - Keep person `MediaLinks` rows for association/search metadata, but stop using `is_primary` on those rows as the deciding field.
  - Phase 3: Runtime read-path + UI changes
    - Update person media read models and person photo UI to compute `isPrimary` from `People.photo_file_id`.
    - Remove person-photo sorting/selection logic that depends on tenant-scoped `media_links.is_primary`.
    - Keep existing household media read logic unchanged.
  - Phase 4: Data remediation + person-name display fix
    - Backfill stale `People.photo_file_id` values where a single linked person photo should now be canonical.
    - Normalize duplicate person-photo primary flags that were left behind by the old model.
    - Fix person-photo flows that currently fall back to raw `personId` strings by resolving names from canonical person records with safe display-name fallback.
  Validation:
  - A person can have only one effective primary photo because the UI and runtime derive primary from `People.photo_file_id` only.
  - Changing a person’s primary photo in one family group updates the same canonical headshot everywhere for that person.
  - Removing the current primary photo recomputes or clears `People.photo_file_id` correctly.
  - Existing stale rows like Brent Estes are repaired and the People tile matches the linked primary photo.
  - New person-photo suggestion/search surfaces show the person’s display name, not `p-xxxxxxxx`.
  Completion criteria:
  - No person-photo save/read path depends on tenant-scoped `media_links.is_primary` for authority.
  - `People.photo_file_id` is the only canonical person headshot field in active runtime behavior.
  - Targeted build and OCI data checks confirm the old split-brain state is removed.
- [ ] Face recognition architecture and phased implementation for media upload
  Priority: High
  Est date: 2026-04-20
  Desc: Add reviewed face-recognition suggestions in media flows so uploads can propose likely people matches across accessible family groups, with strict permission filtering, one global person identity model, and no silent auto-assignment.
  Scope:
  - Detect faces from uploaded images and create per-face records.
  - Generate embeddings and query nearest candidates from a face index.
  - Return ranked match suggestions with confidence for user review.
  - Allow confirm/reject actions to improve matching quality over time.
  - Enforce access controls so suggestions only include people the current user can access.
  - Treat person face profiles and detected face instances as global identity data, not family-scoped duplicates.
  - Add biometric/privacy controls (retention, delete cascade, audit).
  Architecture:
  - Services
    - `FaceDetector`: extracts face bounding boxes from image bytes.
    - `FaceEmbedder`: generates embedding vectors for each detected face crop.
    - `FaceMatchEngine`: similarity search + score normalization + thresholding.
    - `FaceReviewService`: confirm/reject lifecycle and profile update logic.
  - Processing model
    - Upload is write-fast and enqueues async face processing job.
    - Worker pipeline: load image -> detect faces -> embed -> match -> persist suggestions.
    - Existing media backfill runs as resumable batch jobs.
  - Suggested data model
    - `face_instances`
      - `face_id` (PK), `media_id`, `file_id`, `bbox_x`, `bbox_y`, `bbox_w`, `bbox_h`,
      - `embedding_vector` (or `embedding_ref`), `quality_score`, `created_at`, `updated_at`.
    - `face_matches`
      - `match_id` (PK), `face_id`, `candidate_person_id`, `confidence_score`,
      - `match_status` (`suggested|confirmed|rejected`), `reviewed_by`, `reviewed_at`, `created_at`.
    - `person_face_profiles`
      - `profile_id` (PK), `person_id`, `embedding_centroid` (or references), `sample_count`, `updated_at`.
    - `face_review_audit`
      - `audit_id` (PK), `face_id`, `person_id`, `action`, `actor_user_id/email`, `family_group_key`, `created_at`.
  - Access model
    - Face/profile storage is global by `person_id` and `file_id`.
    - Candidate search can use all global person face profiles.
    - Response filter enforces current-user family access before returning candidates.
    - No cross-tenant leakage in responses; access is enforced at suggestion/read/review time instead of by duplicating storage per family.
  - UX model
    - Upload card shows `Face analysis in progress`.
    - Suggestions panel per photo: face chips + top candidates + confidence bands.
    - Actions: `Confirm`, `Reject`, `Not sure`, `Create person`.
    - Never auto-link without explicit confirmation.
  Phase 1 (MVP suggest-only):
  - 2026-03-22 progress: Face/profile storage and canonical identity are now global by `file_id` and `person_id`, with family access enforced when candidate suggestions are read instead of by duplicating biometric rows per family.
  - Add schema tables + migration.
  - Add worker scaffold + queue trigger from upload routes.
  - Persist face instances and raw candidate suggestions.
  - Add read-only suggestion UI.
  Validation:
  - Uploading an image with faces produces `face_instances` and `face_matches`.
  - The same person has one canonical face-profile identity everywhere in the app.
  - Only accessible people appear in suggestions.
  - 2026-03-22 implementation plan:
    - Use the existing `/api/t/[tenantKey]/photos/[fileId]/intelligence` route as the first persisted face-analysis trigger so the app reuses the already-working OCI object-byte load, auth, and media metadata update path before adding a separate worker queue.
    - Add OCI bootstrap support plus schema/docs entries for `face_instances`, `face_matches`, and `person_face_profiles`, with face/profile identity stored globally by `file_id` and `person_id` instead of partitioning storage by `family_group_key`.
    - Extend OCI Vision image analysis to request face embeddings in addition to labels/objects, then persist detected face boxes, quality/confidence scores, and embedding payloads for the analyzed image.
    - Seed or refresh global `person_face_profiles` from canonical person headshots, preferring cached profile rows and opportunistically updating profiles when a primary person photo upload provides fresh image bytes.
    - Generate suggest-only candidate matches by comparing detected face embeddings against global cached person profiles, then filter the returned candidate set to people accessible in the current family context before writing UI-facing suggestion metadata.
    - Render a read-only face suggestions section in the media detail modal that shows each detected face plus top candidate people/confidence bands without auto-linking or creating person relationships yet.
    - Validate with `npm run build`, then regenerate production photo intelligence on images with and without faces and confirm table persistence plus metadata-backed UI rendering.
  Phase 2 (review + learning loop):
  - 2026-03-22 implementation plan (manual face association MVP):
    - Add a reviewed manual-association workflow in the media detail modal that operates on already-detected OCI face instances instead of relying on automatic candidate ranking.
    - Render a visible crop/preview for each detected face using the stored normalized face bounding box so the user can confirm the exact face region being associated.
    - Add a tenant-scoped API to explicitly associate one detected `face_id` with one accessible `person_id`, without auto-linking any other faces in the photo.
    - On manual confirmation, persist that relationship in `face_matches` with `match_status='confirmed'` and update the canonical `person_face_profiles` row for that `person_id` using the confirmed face embedding.
    - For the first cut, support the single-person-in-photo use case cleanly, while keeping the UI/API shape compatible with multiple detected faces later.
    - Keep existing suggest-only matching code available, but treat this manual face-to-person confirmation flow as the required reviewed path for building trustworthy person face profiles.
    - Validate with `npm run build`, then confirm in production that a detected face crop can be associated to a selected person and that the person profile row stores the embedding for that person.
  - 2026-03-22 performance experiment plan:
    - Remove the generic OCI Vision label/object detection request from the recognition path and test whether a single `FACE_EMBEDDING` request can supply both detected face regions and usable embeddings for matching.
    - Add step-level latency metrics for source-byte load, image preparation, OCI Vision request time, face-persistence time, metadata-update time, and total route time so slow photos can be diagnosed from the debug payload instead of inferred.
    - Keep this as an implementation experiment only for now: do not update the permanent design decision docs until runtime behavior and performance are validated.
    - Validate with `npm run build`, then compare production debug timings and face-suggestion responsiveness on known slow photos before deciding whether to keep the one-call Vision path.
  - 2026-03-22 experiment adjustment:
    - Root cause from production debug showed whole-image `FACE_EMBEDDING` requests failing before the OCI TypeScript SDK could surface a readable service error, while source-byte load and EXIF remained fast.
    - Switch `Generate Suggestions` to `FACE_DETECTION` only so the route still finds and persists face boxes quickly without paying for or failing on full-image embedding requests.
    - Generate embeddings later from the selected face crop during manual `Associate Face`, and use the same detect-then-crop-then-embed path when seeding canonical person face profiles from headshots.
    - Keep the latency debug fields so production runs still expose source-load, Vision request, face-persistence, and total route timing for diagnosis.
  - 2026-03-22 experiment rollback note:
    - Production debug showed that `FACE_DETECTION` alone was also less reliable than the older mixed OCI analyze request on some images.
    - Revert `Generate Suggestions` to the last known-good primary OCI analysis request (`IMAGE_CLASSIFICATION` + `OBJECT_DETECTION` + `FACE_DETECTION`) for face-box generation, while keeping crop-based embedding for manual face association and headshot profile seeding.
    - Persist the final latency/debug payload after timing fields are populated so stored media metadata no longer reopens with zeroed `metadataUpdateMs` and `routeTotalMs`.
  - 2026-03-22 OCI diagnostics patch:
    - Patch the OCI helper error formatter at runtime so if the SDK crashes while building `OciError`, the app still preserves the raw OCI response body, service code, status code, and request ID.
    - Surface that preserved raw OCI rejection through the existing Vision debug message path so future Vision failures can be diagnosed from the actual service response instead of the masked `toLowerCase` crash.
  - 2026-03-23 direct REST diagnostic:
    - Add a standalone signed OCI Vision diagnostic script that bypasses the SDK error formatter entirely and prints raw HTTP status, body, and `opc-request-id` for a local test image.
    - Support `mixed`, `detect`, and `embed` feature modes so the same image can be tested against the exact request shapes the app has been using.
  - 2026-03-23 Vision transport replacement plan:
    - Root cause from direct A/B testing showed that the same failing production image succeeds via a direct signed OCI Vision REST request and fails only through the high-level `AIServiceVisionClient.analyzeImage(...)` wrapper path.
    - Replace the production Vision request path with direct signed REST calls that keep the existing OCI SDK auth/signing/http client, but bypass the generated `analyzeImage` response/error wrapper for `Generate Suggestions` and face-embedding requests.
    - Keep the existing request shapes, image-preparation logic, and app-normalized Vision output contract unchanged so only the transport/error layer changes.
    - Surface explicit HTTP status, service code, raw body, and `opc-request-id` from the direct response path whenever OCI returns a non-OK response.
    - Validate with `npm run build`, then compare production behavior on a known failing image (`Steve's Mission to Guatemala`) and a known working image (`Brent Headshot - Working`).
  - 2026-03-23 EXIF-at-upload + media processing status plan:
    - Move EXIF extraction from the photo-intelligence route to every image upload path so file metadata is collected once when the original bytes are first written to OCI.
    - Persist the normalized EXIF fields during upload for both person-photo and household-photo uploads, and leave non-image uploads with empty EXIF fields.
    - Update the intelligence route to reuse only the already-persisted EXIF fields instead of reparsing the source image bytes during `Generate Suggestions`.
    - Add a dedicated status tab to the media modal that shows the current step state for upload, EXIF, thumbnail generation, face coordinates identified, face vectors stored, and face identities verified.
    - Drive those status indicators from persisted media metadata, persisted EXIF columns, stored face-instance rows, confirmed face-match rows, and current suggestion/debug payloads instead of transient UI state alone.
    - Validate with `npm run build`, then confirm in production that new uploads already have EXIF before running suggestions and that the media modal status tab reflects both completed and pending steps correctly.
  - 2026-03-23 analysis-tab on-demand status/exif plan:
    - Stop computing processing status automatically on every media-detail open so the modal does not pay for extra status queries unless the user asks for them.
    - Add a manual `Load Processing Status` action that recomputes the status snapshot on demand, persists it back to media metadata, and then lets future opens reuse the cached snapshot.
    - Add a manual `Load EXIF` action for older image files whose EXIF was never collected at upload, and persist the extracted EXIF plus refreshed processing status when that button is used.
    - Keep the `Face Vectors` and `Face Identities` tiles behavior unchanged, but show the original file name in the `Upload` tile, show the thumbnail file/object name in the `Thumbnail` tile, and show the detected face count directly in the `Face Coordinates` tile.
    - Validate with `npm run build`, then confirm in production that opening the media modal no longer auto-loads processing status, that the two on-demand buttons work, and that the requested tile details display correctly.
  - Add confirm/reject APIs and UI actions.
  - Persist review actions + audit rows.
  - Update `person_face_profiles` from confirmed samples.
  Validation:
  - Confirmed suggestions create durable person links and improve future ranking.
  - Rejected suggestions are suppressed for the same face/profile pair.
  Phase 3 (backfill + quality controls):
  - Backfill existing media in batches with resumable checkpoints.
  - Add confidence thresholds and false-positive guardrails.
  - Add admin settings for enable/disable and confidence tuning.
  Validation:
  - Backfill completes without blocking normal uploads.
  - Precision/recall metrics are captured for tuning.
  Phase 4 (privacy + lifecycle hardening):
  - Add delete cascade for person/media removal.
  - Add retention rules and optional reprocessing controls.
  - Document biometric handling in help/admin policy surfaces.
  Validation:
  - Deleting person/media removes or invalidates associated face artifacts.
  - Audit shows who confirmed/rejected each suggestion.
- [ ] Photo intelligence pipeline: people tagging + AI description + date inference
  Priority: High
  Est date: 2026-04-24
  Desc: Enrich uploaded photos with reviewed people tags, AI-generated human-friendly descriptions (for example "Fun with cousins at the beach"), and best-available photo date (explicit or estimated), then persist all outputs in existing media entities and audit trails.
  Scope:
  - Add caption generation for photos after upload.
  - Add date extraction/inference with confidence and estimated flag behavior.
  - Integrate face-tag suggestions with person-link confirmation UI.
  - Persist outputs in the canonical media model without reintroducing active `media_metadata` JSON writes.
  Data mapping (current app model after `MediaAssets` canonicalization):
  - `MediaAssets.label`: short title/caption (editable, user-facing).
  - `MediaAssets.description`: richer AI photo description (editable).
  - `MediaAssets.photo_date`: resolved date (explicit or inferred).
  - `MediaLinks`: reviewed people/household/attribute associations only.
  - `Audit`: log AI suggestion generation and user confirm/reject/edit actions.
  - If inference/debug payload persistence is needed later, use a dedicated storage model instead of reviving active `media_metadata` writes.
  - `Audit`: log AI suggestion generation and user confirm/reject/edit actions.
  Date resolution policy:
  - Priority order:
    1. User-entered date (always wins)
    2. EXIF capture timestamp (when valid)
    3. OCR/date text found in image
    4. Contextual inference (linked people/events/location hints)
  - Store inferred dates with:
    - `photo_date` set to inferred value
    - metadata flags: `dateIsEstimated=true`, `estimatedTo=year|month` as applicable
    - `dateInferenceSource` and `dateConfidence`
  Caption policy:
  - Generate short, human-friendly caption for `label` (about 3-10 words).
  - Generate optional fuller sentence/phrase for `description`.
  - Never overwrite user-edited caption/description without explicit user action.
  UX behavior:
  - Upload response state: `Processing photo intelligence...`.
  - Suggestions panel:
    - Suggested people tags with confidence
    - Suggested caption + description
    - Suggested date with source and confidence
  - User actions:
    - Confirm/reject each person suggestion
    - Accept/edit caption
    - Accept/edit/clear date suggestion
    - Save all
  Phase 1:
  - 2026-03-21 progress: Added deterministic image suggestion generation endpoint (`/photos/[fileId]/intelligence`), persisted `photoIntelligence` metadata, and media-editor apply controls (`Use Title/Description/Date`).
  - 2026-03-21 progress: Switched generation to OCI Vision-first analysis (labels/objects/faces) with deterministic fallback when Vision is unavailable.
  - 2026-03-22 progress: Production OCI Vision integration now works end-to-end for photo suggestions. The intelligence route reaches OCI auth, reads original image bytes from OCI Object Storage, and executes Vision analysis successfully in production.
  - 2026-03-22 implementation plan (persisted EXIF fields):
    - Add normalized EXIF columns to `MediaAssets` for the high-value file-level fields we want to query later (`exif_extracted_at`, `exif_source_tag`, `exif_capture_date`, `exif_capture_timestamp_raw`, `exif_make`, `exif_model`, `exif_software`, `exif_width`, `exif_height`, `exif_orientation`, `exif_fingerprint`) without adding new indexes yet.
    - Extend the OCI table compatibility layer and `MediaAssets` lookup/update helpers so EXIF columns can be read and updated alongside existing media metadata without changing family-scoped `MediaLinks`.
    - Refactor EXIF extraction to return a normalized structured payload, then persist that payload back to `MediaAssets` the first time image bytes are analyzed.
    - Update the photo-intelligence route so it reuses persisted `MediaAssets` EXIF fields when present and only reruns EXIF parsing when the stored EXIF columns are blank.
    - Keep checksum-based duplicate detection as the primary exact-match rule for now; do not wire EXIF into duplicate scans yet beyond storing the normalized values/fingerprint for future use.
    - Validate with `npm run build`, then confirm a second forced `Generate Suggestions` run on the same photo no longer needs fresh EXIF extraction once the columns are populated.
  - 2026-03-22 implementation plan:
    - Add EXIF parser support for OCI-backed image bytes and extract capture-date candidates before heuristic fallback.
    - Extend photo-intelligence suggestion building to rank date signals in this order: EXIF capture date, file name date, createdAt fallback.
    - Add optional OpenAI caption refinement using linked people plus OCI Vision labels/objects/faces, while preserving deterministic fallback when OpenAI is unavailable or returns unusable output.
    - Persist the richer suggestion metadata (`dateSource`, `dateConfidence`, caption notes/model hints) without changing the existing media-editor apply workflow.
    - Validate with `npm run build` and redeployed photo-suggestion generation against production OCI media.
  - Remaining for full Phase 1: add EXIF parser-backed date extraction and optional OpenAI caption refinement using Vision outputs.
  - Implement caption + EXIF date extraction and persist suggestions.
  - Render suggestions in media detail panel with accept/edit controls.
  Validation:
  - New uploads show suggested caption/date.
  - Accepted values save to `MediaLinks` and display in media search/detail.
  Phase 2:
  - Integrate face candidate suggestions from face pipeline and confirmation actions.
  - Persist confirmed people tags as canonical media links.
  Validation:
  - Confirmed people appear immediately in linked entities.
  - Rejected candidates are recorded and suppressed.
  Phase 3:
  - Add OCR/context date inference fallback and confidence display.
  - Add admin controls for enabling/disabling auto-suggestion categories.
  Validation:
  - Date source is visible and auditable.
  - Low-confidence suggestions are clearly marked and not auto-accepted.
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
- [ ] Migrate existing media assets to OCI Object Storage with generated thumbnails
  Priority: High
  Est date: 2026-03-23
  Desc: Backfill all existing media files to OCI Object Storage by uploading full originals and generating thumbnail variants for images during migration, then persist OCI object pointers/metadata on media assets without breaking existing file associations.
  Scope:
  - Add migration tooling with dry-run + apply modes.
  - Read legacy media bytes from current storage and upload originals to OCI bucket.
  - Generate/store thumbnail objects for image media in OCI.
  - Update `MediaAssets` metadata to include OCI original/thumbnail object keys and mark provider state for migrated assets.
  - Keep migration idempotent and resumable across reruns.
  Phase 1:
  - Build script scaffolding and safety flags (`--apply`, `--limit`, optional tenant filtering).
  - Add environment and auth validation for DB, Drive source access, and OCI bucket access.
  Phase 2:
  - Implement per-asset migration pipeline (read source, upload original, create/upload thumbnail, update metadata).
  - Add robust per-item error capture and continue behavior.
  - Add summary reporting (processed, migrated, skipped, failed, thumbnails created).
  Phase 3:
  - Verify parity counts and sample retrieval after migration.
  - Add follow-up task for runtime cutover to serve OCI object storage content directly.
  Validation:
  - Dry-run reports candidate count and planned actions without DB writes.
  - Apply run uploads originals + thumbnails and updates metadata pointers.
  - Rerun does not duplicate work for already migrated assets.
  Completion criteria:
  - Existing media library items have OCI object metadata for original and thumbnail where applicable.
  - Migration can be resumed safely after interruption.
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
- [x] Expand AI Help guide coverage and permission accuracy
  Priority: Med
  Status: Completed 2026-03-30
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
