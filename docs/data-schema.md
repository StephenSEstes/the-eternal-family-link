# Data Schema

Canonical data structure reference for The Eternal Family Link.

## Scope

- Storage backend: OCI tables for active runtime and operational tooling
- Model style: global tables with family membership/access joins
- Notes:
  - OCI is the runtime source of truth and naming baseline for this document.
  - "Indexes" below are logical lookup keys and uniqueness rules enforced by app logic.

## Focused Model: Person + Attributes + Media

This section is a quick reference for the three data areas that drive profile/media behavior.

### 1) Person Core

- Core record: `People`
- Key: `person_id`
- Family visibility and family-group relationship typing: `PersonFamilyGroups (person_id, family_group_key, is_enabled, family_group_relationship_type)`
- Primary headshot pointer: `People.photo_file_id`

### 2) Attributes

- Unified attributes: `Attributes`
  - Key: `attribute_id`
  - Owner model: `entity_type` + `entity_id` (`person` or `household`)
  - Canonical columns for attribute facts only (type/category/date/detail/notes)

### 3) Media

- File registry: `MediaAssets`
  - One logical media row per file (`media_id`, `file_id`, metadata)
- Association table: `MediaLinks`
  - One association row per family/entity/media relationship
  - Scope: `family_group_key`
  - Target: `entity_type` + `entity_id` (`person` | `household` | `attribute`)
  - Link to file: `media_id -> MediaAssets.media_id`
  - Display semantics: `usage_type`, `label`, `description`, `photo_date`, `is_primary`

### 4) How One Photo Can Appear In Multiple Families

- File is shared at asset level (`MediaAssets`).
- Visibility is family-scoped at link level (`MediaLinks.family_group_key`).
- Same file can appear in multiple family groups by having multiple `MediaLinks` rows (one per family scope/entity association).

### 5) Practical Join Paths

- Person profile photo:
  - `People.photo_file_id` -> `MediaAssets.file_id` (or direct Drive proxy by file ID)
- Person gallery/media:
  - `MediaLinks(entity_type='person', entity_id=People.person_id)` for direct links
  - `MediaLinks(entity_type='attribute', entity_id=Attributes.attribute_id)` for event/descriptor-linked media
- Household gallery/media:
  - `MediaLinks(entity_type='household', entity_id=Households.household_id)`
- Attribute-attached media:
  - `MediaLinks.entity_type = 'attribute'`
  - `MediaLinks.entity_id = Attributes.attribute_id`

### 6) Suggested Integrity Rules (Logical)

- Asset uniqueness:
  - Unique `MediaAssets.file_id` (or strict dedupe by checksum + file_id policy)
- Link uniqueness:
  - Recommended unique composite:
  - (`family_group_key`, `entity_type`, `entity_id`, `media_id`, `usage_type`)
- No orphan links:
  - Every `MediaLinks.media_id` must resolve to a `MediaAssets.media_id`

## Tables And Columns

## People

- Columns:
  - `person_id` (primary logical key)
  - `display_name`
  - `first_name`
  - `middle_name`
  - `last_name`
  - `nick_name`
  - `birth_date`
  - `gender`
  - `phones`
  - `address`
  - `hobbies`
  - `notes`
  - `photo_file_id`
  - `is_pinned`
  - `relationships`
- Logical index/key:
  - Unique: `person_id`

## PersonFamilyGroups

- Columns:
  - `person_id`
  - `family_group_key`
  - `is_enabled`
  - `family_group_relationship_type` (`founder` | `direct` | `in_law` | `undeclared`)
- Purpose:
  - Join table for person membership in one or more family groups, including the person’s family-specific placement/classification.
- Logical index/key:
  - Unique composite: (`person_id`, `family_group_key`)

## Relationships

- Columns:
  - `family_group_key` (legacy compatibility column; no longer used for scoping logic)
  - `rel_id`
  - `from_person_id`
  - `to_person_id`
  - `rel_type`
- Purpose:
  - Global relationship edges between people.
- Logical index/key:
  - Unique: `rel_id`
  - Canonical ID format: `<from_person_id>-<to_person_id>-<rel_type>`

## Households

- Columns:
  - `family_group_key`
  - `household_id`
  - `husband_person_id`
  - `wife_person_id`
- Purpose:
  - Household records for one-parent or two-parent family units.
- Logical index/key:
  - Unique: `household_id`
  - Recommended uniqueness rule: (`family_group_key`, sorted set of present parent person IDs, allowing either one or two parents)

## UserAccess

- Columns:
  - `person_id`
  - `role`
  - `user_email`
  - `username`
  - `google_access`
  - `local_access`
  - `is_enabled`
  - `password_hash`
  - `failed_attempts`
  - `locked_until`
  - `must_change_password`
  - `last_login_at`
- Purpose:
  - Credential/access flags and login state by person.
- Logical index/key:
  - Recommended unique: `person_id`
  - Recommended unique when present: `user_email`, `username`

## UserFamilyGroups

- Columns:
  - `user_email`
  - `family_group_key`
  - `family_group_name`
  - `role`
  - `person_id`
  - `is_enabled`
- Purpose:
  - Family access assignments for authenticated users.
- Logical index/key:
  - Unique composite: (`user_email`, `family_group_key`)

## AuditLog

- Columns:
  - `event_id`
  - `timestamp`
  - `actor_email`
  - `actor_person_id`
  - `action`
  - `entity_type`
  - `entity_id`
  - `family_group_key`
  - `status`
  - `details`
- Purpose:
  - Immutable audit trail for login outcomes and admin/user data changes, scoped to a family group when applicable.
- Logical index/key:
  - Unique: `event_id`
  - Common lookup: (`family_group_key`, `timestamp`), (`actor_email`, `timestamp`), (`actor_person_id`, `timestamp`)

## Invites

- Columns:
  - `invite_id`
  - `family_group_key`
  - `person_id`
  - `invite_email`
  - `auth_mode`
  - `role`
  - `local_username`
  - `family_groups_json`
  - `status`
  - `token_hash`
  - `expires_at`
  - `accepted_at`
  - `accepted_by_email`
  - `accepted_auth_mode`
  - `created_at`
  - `created_by_email`
  - `created_by_person_id`
- Purpose:
  - Person-bound onboarding records used to generate shareable invite links, snapshot family-group access at invite time, and track acceptance for local username/password setup.
- Logical index/key:
  - Unique: `invite_id`
  - Recommended unique: `token_hash`
  - Common lookup: (`invite_email`, `status`), (`person_id`, `status`)

## FamilyConfig

- Columns:
  - `family_group_key`
  - `family_group_name`
  - `viewer_pin_hash`
  - `photos_folder_id`
  - `attribute_event_definitions_json`
- Purpose:
  - Family-level config, media folder mapping, and admin-managed event-definition metadata for the Attributes add flow.
- Logical index/key:
  - Unique: `family_group_key`

## FamilySecurityPolicy

- Columns:
  - `family_group_key`
  - `id`
  - `min_length`
  - `require_number`
  - `require_uppercase`
  - `require_lowercase`
  - `lockout_attempts`
- Purpose:
  - Family-specific local-password policy.
- Logical index/key:
  - Unique: (`family_group_key`, `id`)

## Attributes

- Columns:
  - `attribute_id`
  - `entity_type` (`person` | `household`)
  - `entity_id`
  - `attribute_kind` (`descriptor` | `event`)
  - `attribute_type`
  - `attribute_type_category`
  - `attribute_date`
  - `date_is_estimated`
  - `estimated_to` (`month` | `year` | empty)
  - `attribute_detail`
  - `attribute_notes`
  - `end_date`
  - `created_at`
  - `updated_at`
- Purpose:
  - Canonical one-value-per-row descriptors/events for people and households, with explicit stored kind for filtering and validation.
- Logical index/key:
  - Unique: `attribute_id`
  - Common lookup: (`entity_type`, `entity_id`, `attribute_type`)

## MediaAssets

- Columns:
  - `media_id`
  - `file_id`
  - `storage_provider`
  - `mime_type`
  - `file_name`
  - `file_size_bytes`
  - `media_metadata`
  - `created_at`
- Purpose:
  - Canonical uploaded media file metadata registry.
- Logical index/key:
  - Unique: `media_id`
  - Common lookup: `file_id`

## MediaLinks

- Columns:
  - `family_group_key`
  - `link_id`
  - `media_id`
  - `entity_type` (`person` | `household` | `attribute`)
  - `entity_id`
  - `usage_type`
  - `label`
  - `description`
  - `photo_date`
  - `is_primary`
  - `sort_order`
  - `media_metadata`
  - `created_at`
- Purpose:
  - Link uploaded media to people, households, or attributes without duplicating files.
- Logical index/key:
  - Unique: `link_id`
  - Common lookup: (`family_group_key`, `entity_type`, `entity_id`, `usage_type`)

## ImportantDates

- Columns:
  - `id`
  - `date`
  - `title`
  - `description`
  - `person_id`
  - `share_scope`
  - `share_family_group_key`
- Purpose:
  - Date-based events with optional family-scoped sharing.
- Logical index/key:
  - Unique: `id`
  - Common lookup: (`person_id`, `date`)

## Legacy Compatibility

- `TenantConfig` may still exist as legacy alias of family config.
- Column aliases still normalized by code:
  - `tenant_key` -> `family_group_key`
  - `tenant_name` -> `family_group_name`

## Entity ID Descriptions

- `person_id`:
  - Stable person identifier used across all person-linked tables.
  - Current convention is deterministic from person identity fields (name + birth date) where available.
- `rel_id`:
  - Canonical global relationship ID:
  - `<from_person_id>-<to_person_id>-<rel_type>`
- `household_id`:
  - Household ID generated from family key plus either the sorted parent pair or the deterministic `single|person_id` form for one-parent households.
- `attribute_id`:
  - Unique attribute row ID (often generated from family/person/type/value or timestamp strategy, depending on flow).
- `family_group_key`:
  - Family membership/access partition key; used in join tables and family config.

## Joins (Logical)

- People in family:
  - `People.person_id` -> `PersonFamilyGroups.person_id`
  - Filter by `PersonFamilyGroups.family_group_key`
- User directory/access by family:
  - `UserAccess.person_id` -> `PersonFamilyGroups.person_id` (membership context)
  - `UserFamilyGroups.user_email` + `family_group_key` for family-specific user access links
- Invite acceptance:
  - `Invites.person_id` -> `People.person_id`
  - `Invites.family_groups_json[*].tenantKey` mirrors the family groups granted when the invite was created
  - Current runtime creates local-only invites and uses `invite_email` as the delivery/contact email, not the login identity
  - Accepted invites write/update `UserAccess.username/password_hash/local_access` and ensure `UserFamilyGroups`
- Relationships:
  - `Relationships.from_person_id` and `Relationships.to_person_id` -> `People.person_id`
  - Family views filter edges by membership of both endpoint people
- Households:
  - `Households.husband_person_id` and/or `Households.wife_person_id` -> `People.person_id`
  - Family views filter by `Households.family_group_key`
- Attributes and dates:
  - `Attributes.entity_type/entity_id` -> (`People.person_id` or `Households.household_id`)
  - `ImportantDates.person_id` -> `People.person_id`
- Media:
  - `MediaLinks.media_id` -> `MediaAssets.media_id`
  - `MediaLinks.entity_type/entity_id` links to person, household, or attribute rows

## Media Link Design

- Primary person photo:
  - `People.photo_file_id` stores the current headshot file ID.
- Photo gallery:
  - Use `MediaLinks` rows to associate files to people/households/attributes.
- Attribute media:
  - `MediaLinks` supports `entity_type = "attribute"` with `entity_id = Attributes.attribute_id`.
- Media metadata:
  - JSON payload may include:
    - `mimeType`
    - `mediaKind`
    - `sizeBytes`
    - `durationSec`
    - `width`
    - `height`
    - `captureSource`
- Media storage:
  - Files uploaded to Google Drive folder from `FamilyConfig.photos_folder_id`.
- Media delivery:
  - Proxied via:
    - `/viewer/photo/[fileId]`
    - `/t/[tenantKey]/viewer/photo/[fileId]`
  - Helper path builder: `getPhotoProxyPath(...)`.

## Query/Performance Notes

- OCI supports real indexes and constraints; continue to rely on:
  - deterministic IDs
  - strict dedupe checks on write
  - integrity checks for duplicates/orphans
- As data volume grows, add more native OCI constraints and indexes where profiling shows benefit.
