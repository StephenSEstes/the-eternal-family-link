# Data Schema

Canonical data structure reference for The Eternal Family Link.

## Scope

- Storage backend: OCI tables for active runtime and operational tooling
- Model style: global tables with family membership/access joins
- Notes:
  - OCI is the runtime source of truth and naming baseline for this document.
  - "Indexes" below are logical lookup keys and uniqueness rules enforced by app logic.

## Focused Model: Person + Attributes + Media + Face Suggestions

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

- Supported runtime media kinds are `image`, `video`, `audio`, and `document`.
- File registry: `MediaAssets`
  - One logical media row per file (`media_id`, `file_id`)
  - Canonical media-level fields live here: `media_kind`, `label`, `description`, `photo_date`, immutable `created_at`
  - `created_at` means the database add/upload timestamp for the asset
  - `photo_date` and EXIF capture fields carry the media's own date model separately
  - Asset technical fields and EXIF fields also live here
- Association table: `MediaLinks`
  - One association row per family/entity/media relationship
  - Scope: `family_group_key`
  - Target: `entity_type` + `entity_id` (`person` | `household` | `attribute`)
  - Link to file: `media_id -> MediaAssets.media_id`
  - Association semantics: `usage_type`, `is_primary`, `sort_order`, family/entity visibility
  - Legacy compatibility columns such as `label`, `description`, and `photo_date` may still exist physically, but active runtime should treat `MediaAssets` as canonical for those media-level values
  - Person-note: person primary-headshot authority does not live here; person links are non-authoritative associations, and `People.photo_file_id` is the canonical person headshot field
- Conversation table: `MediaComments`
  - One row per comment/reply thread node on a media file
  - Scope: `family_group_key`
  - Parent model: `file_id -> MediaAssets.file_id`
  - Threading model: `parent_comment_id -> MediaComments.comment_id` (nullable for top-level comments)
  - Author metadata: `author_person_id`, `author_display_name`, `author_email`
  - Lifecycle: `comment_status` (`active` | `deleted`) with `deleted_at` soft-delete support to preserve thread continuity

### 4) Family Shares + Notifications

- Share thread model:
  - `ShareGroups`
    - First-class custom-group identity rows (normalized member-signature model)
    - Key: `group_id`
    - Unique signature scope: (`family_group_key`, `member_signature`)
  - `ShareGroupMembers`
    - One membership row per custom group + person
    - Key: `group_member_id`
    - Uniqueness: (`group_id`, `person_id`)
  - `ShareThreads`
    - One audience thread per family group + audience tuple; optional `group_id` link for custom-group threads
    - Key: `thread_id`
    - Scope key: (`family_group_key`, `audience_type`, `audience_key`)
  - `ShareThreadMembers`
    - One member row per thread + person
    - Key: `thread_member_id`
    - Uniqueness: (`thread_id`, `person_id`)
  - `ShareConversations`
    - Conversation/topic containers inside each share thread
    - Key: `conversation_id`
    - Parent: `thread_id -> ShareThreads.thread_id`
  - `ShareConversationMembers`
    - One membership/read-state row per conversation + person
    - Key: `conversation_member_id`
    - Uniqueness: (`conversation_id`, `person_id`)
  - `SharePosts`
    - One row per conversation post (text-only or media-backed by `file_id`)
    - Key: `post_id`
    - Parent: `thread_id -> ShareThreads.thread_id`
    - Parent: `conversation_id -> ShareConversations.conversation_id`
  - `SharePostComments`
    - Threaded post comments using `parent_comment_id`
    - Key: `comment_id`
    - Parent: `post_id -> SharePosts.post_id`
- Runtime access model (current kickoff phase):
  - Primary read/access check is membership (`ShareThreadMembers.person_id` / `ShareConversationMembers.person_id`).
  - `family_group_key` remains on share rows for template/context metadata and compatibility, but it is no longer the primary read gate for inbox/thread resolution.
- Notification readiness model:
  - `PushSubscriptions`
    - Active web-push endpoints per person/device in a family group
    - Key: `subscription_id`
    - Endpoint uniqueness: `endpoint`
  - `NotificationOutbox`
    - Asynchronous delivery queue rows for share post/comment events
    - Key: `notification_id`
    - Delivery is non-blocking for user actions (`pending` -> `sent` lifecycle)

### 5) Face Suggestions

- Detected faces per analyzed image: `FaceInstances`
  - Key: `face_id`
  - Storage scope: global by file (`family_group_key="__global__"` for canonical rows; legacy family-scoped rows may still exist during transition)
  - Image join: `file_id -> MediaAssets.file_id`
  - Stores normalized bounding box, detection score, quality score, and embedding payload
- Suggested candidate people per detected face: `FaceMatches`
  - Key: `match_id`
  - Parent: `face_id -> FaceInstances.face_id`
  - Storage scope: global by detected face (`family_group_key="__global__"` for canonical rows)
  - Stores ranked candidate person rows and review status (`suggested|confirmed|rejected`)
- Cached per-person reference embedding: `PersonFaceProfiles`
  - One canonical profile per `person_id` for the current face-suggestion phase (`family_group_key="__global__"` for canonical rows)
  - Seeded from the person's current primary headshot when available

### 6) How One Media File Can Appear In Multiple Families

- File is shared at asset level (`MediaAssets`).
- Visibility is family-scoped at link level (`MediaLinks.family_group_key`).
- Same file can appear in multiple family groups by having multiple `MediaLinks` rows (one per family scope/entity association).

### 7) Practical Join Paths

- Person profile photo:
  - `People.photo_file_id` -> `MediaAssets.file_id` (or direct Drive proxy by file ID)
  - This is the only canonical primary-headshot pointer for people across all family groups
- Person gallery/media:
  - `MediaLinks(entity_type='person', entity_id=People.person_id)` for direct links
  - `MediaLinks(entity_type='attribute', entity_id=Attributes.attribute_id)` for event/descriptor-linked media
- Household gallery/media:
  - `MediaLinks(entity_type='household', entity_id=Households.household_id)`
- Attribute-attached media:
  - `MediaLinks.entity_type = 'attribute'`
  - `MediaLinks.entity_id = Attributes.attribute_id`
- Face suggestions:
  - `FaceInstances.file_id` -> `MediaAssets.file_id`
  - `FaceMatches.face_id` -> `FaceInstances.face_id`
  - `PersonFaceProfiles.person_id` -> `People.person_id`
- Family shares:
  - Membership-first resolution: `ShareThreadMembers (thread_id, person_id)` is the primary read/access path.
  - `ShareGroups.group_id` -> `ShareGroupMembers.group_id`
  - `ShareGroups.group_id` -> `ShareThreads.group_id` (custom-group threads)
  - `ShareThreads.thread_id` -> `ShareThreadMembers.thread_id`
  - `ShareThreads.thread_id` -> `ShareConversations.thread_id`
  - `ShareConversations.conversation_id` -> `ShareConversationMembers.conversation_id`
  - `ShareThreads.thread_id` -> `SharePosts.thread_id`
  - `ShareConversations.conversation_id` -> `SharePosts.conversation_id`
  - `SharePosts.post_id` -> `SharePostComments.post_id`
  - `SharePosts.file_id` -> `MediaAssets.file_id` (optional media-backed post)
- Notification pipeline:
  - `NotificationOutbox.person_id` -> `People.person_id`
  - `NotificationOutbox.entity_id` references share post/comment IDs by `entity_type`
  - `PushSubscriptions.person_id` -> `People.person_id`

### 8) Suggested Integrity Rules (Logical)

- Asset uniqueness:
  - Unique `MediaAssets.file_id` (or strict dedupe by checksum + file_id policy)
- Link uniqueness:
  - Recommended unique composite:
  - (`family_group_key`, `entity_type`, `entity_id`, `media_id`, `usage_type`)
- No orphan links:
  - Every `MediaLinks.media_id` must resolve to a `MediaAssets.media_id`
- Share thread uniqueness:
  - Unique (`family_group_key`, `audience_type`, `audience_key`) in `ShareThreads`
- Share custom-group uniqueness:
  - Unique (`family_group_key`, `member_signature`) in `ShareGroups`
- Share membership uniqueness:
  - Unique (`thread_id`, `person_id`) in `ShareThreadMembers`
  - Unique (`group_id`, `person_id`) in `ShareGroupMembers`
  - Unique (`conversation_id`, `person_id`) in `ShareConversationMembers`

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
  - `actor_username`
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
  - Common lookup: (`family_group_key`, `timestamp`), (`actor_email`, `timestamp`), (`actor_username`, `timestamp`), (`actor_person_id`, `timestamp`)

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

## PasswordResets

- Columns:
  - `reset_id`
  - `person_id`
  - `family_group_key`
  - `reset_email`
  - `username`
  - `token_hash`
  - `status`
  - `expires_at`
  - `completed_at`
  - `created_at`
- Purpose:
  - Single-use local password recovery tokens for one active user in one family group, delivered by email and consumed by the public reset-password flow.
- Logical index/key:
  - Unique: `reset_id`
  - Recommended unique: `token_hash`
  - Common lookup: (`reset_email`, `status`), (`person_id`, `family_group_key`, `status`)

## SubscriptionDefaultRules

- Columns:
  - `rule_id`
  - `viewer_person_id`
  - `relationship_category`
  - `lineage_side`
  - `is_subscribed`
  - `is_active`
  - `created_at`
  - `updated_at`
- Purpose:
  - Viewer-owned default notification/update preference rules for Famailink.
  - These rules affect newsletter/update subscription state only; they do not control whether a supported relative is visible in the tree.
- Logical index/key:
  - Unique: `rule_id`
  - Unique composite: (`viewer_person_id`, `relationship_category`, `lineage_side`)
  - Common lookup: (`viewer_person_id`, `is_active`)

## SubscriptionPersonExceptions

- Columns:
  - `exception_id`
  - `viewer_person_id`
  - `target_person_id`
  - `effect` (`allow` | `deny`)
  - `created_at`
  - `updated_at`
- Purpose:
  - Viewer-owned person-specific subscription overrides for Famailink.
  - Used to explicitly subscribe or unsubscribe one supported family member regardless of matched default rules.
- Logical index/key:
  - Unique: `exception_id`
  - Unique composite: (`viewer_person_id`, `target_person_id`)
  - Common lookup: (`viewer_person_id`)

## OwnerShareDefaultRules

- Columns:
  - `rule_id`
  - `owner_person_id`
  - `relationship_category`
  - `lineage_side`
  - `share_vitals`
  - `share_stories`
  - `share_media`
  - `share_conversations`
  - `is_active`
  - `created_at`
  - `updated_at`
- Purpose:
  - Person-owned default content-sharing rules for Famailink.
  - These rules determine which categories of profile content are visible to a supported relative; they do not control tree visibility.
- Logical index/key:
  - Unique: `rule_id`
  - Unique composite: (`owner_person_id`, `relationship_category`, `lineage_side`)
  - Common lookup: (`owner_person_id`, `is_active`)

## OwnerSharePersonExceptions

- Columns:
  - `exception_id`
  - `owner_person_id`
  - `target_person_id`
  - `effect` (`allow` | `deny`)
  - `share_vitals`
  - `share_stories`
  - `share_media`
  - `share_conversations`
  - `created_at`
  - `updated_at`
- Purpose:
  - Person-owned relative-specific sharing overrides for Famailink.
  - A `null` scope value means the override applies to all content scopes; `Y`/`N` values allow the app to scope the override to selected visibility areas.
- Logical index/key:
  - Unique: `exception_id`
  - Unique composite: (`owner_person_id`, `target_person_id`)
  - Common lookup: (`owner_person_id`)

## ProfileVisibilityMap

- Columns:
  - `map_id`
  - `viewer_person_id`
  - `target_person_id`
  - `tree_visible`
  - `can_vitals`
  - `can_stories`
  - `can_media`
  - `can_conversations`
  - `placeholder_only`
  - `reason_code`
  - `map_version`
  - `computed_at`
- Purpose:
  - Persisted Famailink derived visibility/share results for one viewer against supported relatives.
  - Tree visibility and content visibility stay together here because they both describe what the viewer can currently see of the target profile, independent of notification subscription state.
- Logical index/key:
  - Unique: `map_id`
  - Unique composite: (`viewer_person_id`, `target_person_id`)
  - Common lookup: (`viewer_person_id`, `computed_at`)

## ProfileSubscriptionMap

- Columns:
  - `map_id`
  - `viewer_person_id`
  - `target_person_id`
  - `is_subscribed`
  - `reason_code`
  - `map_version`
  - `computed_at`
- Purpose:
  - Persisted Famailink derived subscription results for one viewer against supported relatives.
  - This table is intentionally separate from `ProfileVisibilityMap` so notification/update preferences do not act as the visibility gate.
- Logical index/key:
  - Unique: `map_id`
  - Unique composite: (`viewer_person_id`, `target_person_id`)
  - Common lookup: (`viewer_person_id`, `computed_at`)

## AccessRecomputeJobs

- Columns:
  - `job_id`
  - `viewer_person_id`
  - `reason`
  - `status`
  - `dedupe_key`
  - `requested_at`
  - `started_at`
  - `completed_at`
  - `error_message`
- Purpose:
  - Job-level audit trail for Famailink recompute requests.
  - Tracks the viewer, request reason, current lifecycle state, and any failure message.
- Logical index/key:
  - Unique: `job_id`
  - Common lookup: (`viewer_person_id`, `status`)

## AccessRecomputeRuns

- Columns:
  - `run_id`
  - `job_id`
  - `viewer_person_id`
  - `status`
  - `started_at`
  - `completed_at`
  - `processed_count`
  - `changed_count`
  - `error_message`
- Purpose:
  - Run-level result summary for one completed or failed Famailink recompute execution.
  - Stores how many target rows were processed and how many changed versus the previous persisted snapshot.
- Logical index/key:
  - Unique: `run_id`
  - Common lookup: (`viewer_person_id`, `started_at`)
  - Common lookup: (`job_id`)

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
  - `media_kind`
  - `label`
  - `description`
  - `photo_date`
  - `source_provider`
  - `source_file_id`
  - `original_object_key`
  - `thumbnail_object_key`
  - `checksum_sha256`
  - `mime_type`
  - `file_name`
  - `file_size_bytes`
  - `media_width`
  - `media_height`
  - `media_duration_sec`
  - `media_metadata`
  - `created_at`
  - `exif_extracted_at`
  - `exif_source_tag`
  - `exif_capture_date`
  - `exif_capture_timestamp_raw`
  - `exif_make`
  - `exif_model`
  - `exif_software`
  - `exif_width`
  - `exif_height`
  - `exif_orientation`
  - `exif_fingerprint`
- Purpose:
  - Canonical uploaded media file registry.
  - Stores canonical media-level display/edit fields (`media_kind`, `label`, `description`, `photo_date`) plus the immutable asset upload timestamp `created_at`.
  - Stores normalized asset technical fields (source/object keys/checksum/dimensions/duration) plus normalized EXIF fields that are extracted once and reused on later photo-intelligence runs.
  - `media_metadata` is retained only as a historical/compatibility field; active runtime should not persist new JSON payloads into it.
- Logical index/key:
  - Unique: `media_id`
  - Common lookup: `file_id`
  - `created_at` note: this is the canonical immutable database add/upload timestamp and must not be overwritten after the asset row is first created.
  - `photo_date` note: this is the canonical user/media date and may differ from `created_at`.
  - EXIF note: EXIF columns are intentionally unindexed in the current phase; they are persisted now so future search/duplicate tooling can use them without rereading file bytes.

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
  - Active runtime treats this as the association/scope table, not the canonical storage location for media-level name, description, user date, or asset timestamp.
  - `label`, `description`, `photo_date`, and `media_metadata` are legacy/compatibility columns only and should not be treated as canonical sources in new runtime work.
- Logical index/key:
  - Unique: `link_id`
  - Common lookup: (`family_group_key`, `entity_type`, `entity_id`, `usage_type`)

## MediaComments

- Columns:
  - `comment_id`
  - `family_group_key`
  - `file_id`
  - `parent_comment_id`
  - `author_person_id`
  - `author_display_name`
  - `author_email`
  - `comment_text`
  - `comment_status` (`active` | `deleted`)
  - `created_at`
  - `updated_at`
  - `deleted_at`
- Purpose:
  - Family-scoped conversational thread storage for media files, including replies and soft-delete behavior.
  - Keeps comment history attached to the media file while preserving thread shape when a comment is deleted.
- Logical index/key:
  - Unique: `comment_id`
  - Common lookup: (`family_group_key`, `file_id`, `created_at`)
  - Thread lookup: (`family_group_key`, `parent_comment_id`, `created_at`)

## ShareThreads

- Columns:
  - `thread_id`
  - `family_group_key`
  - `group_id` (nullable FK-style pointer to `ShareGroups.group_id` for normalized custom groups)
  - `audience_type` (`siblings` | `household` | `entire_family` | `family_group` | `custom_group`)
  - `audience_key`
  - `audience_label`
  - `owner_person_id`
  - `created_by_person_id`
  - `created_by_email`
  - `created_at`
  - `updated_at`
  - `last_post_at`
  - `thread_status`
- Purpose:
  - Canonical thread container for Family Shares conversations, keyed by audience resolution.
  - For normalized custom groups, thread membership intent is sourced from `ShareGroups` / `ShareGroupMembers`, while active thread access remains enforced by `ShareThreadMembers`.
- Logical index/key:
  - Unique: `thread_id`
  - Unique scope: (`family_group_key`, `audience_type`, `audience_key`)
  - Group lookup: (`group_id`, `family_group_key`)
  - Common lookup: (`family_group_key`, `last_post_at`)

## ShareGroups

- Columns:
  - `group_id`
  - `family_group_key`
  - `group_type` (`custom_group`)
  - `member_signature` (canonical sorted member-set signature)
  - `display_label`
  - `owner_person_id`
  - `created_by_person_id`
  - `created_by_email`
  - `created_at`
  - `updated_at`
  - `group_status`
- Purpose:
  - First-class normalized group identity for custom share groups.
  - Prevent duplicate custom groups with identical exact membership sets.
- Logical index/key:
  - Unique: `group_id`
  - Unique signature scope: (`family_group_key`, `member_signature`)
  - Common lookup: (`family_group_key`, `owner_person_id`, `updated_at`)

## ShareGroupMembers

- Columns:
  - `group_member_id`
  - `group_id`
  - `family_group_key`
  - `person_id`
  - `member_role` (`owner` | `member`)
  - `joined_at`
  - `left_at`
  - `is_active`
- Purpose:
  - Membership table for normalized custom groups.
  - Tracks active/inactive member lifecycle independently from thread read-state.
- Logical index/key:
  - Unique: `group_member_id`
  - Unique composite: (`group_id`, `person_id`)
  - Common lookup: (`family_group_key`, `person_id`, `is_active`)

## ShareThreadMembers

- Columns:
  - `thread_member_id`
  - `thread_id`
  - `family_group_key`
  - `person_id`
  - `member_role` (`owner` | `member`)
  - `joined_at`
  - `last_read_at`
  - `muted_until`
  - `is_active`
- Purpose:
  - Membership/access table for share threads including read-state tracking.
- Logical index/key:
  - Unique: `thread_member_id`
  - Unique composite: (`thread_id`, `person_id`)
  - Common lookup: (`family_group_key`, `person_id`, `is_active`)

## ShareConversations

- Columns:
  - `conversation_id`
  - `thread_id`
  - `family_group_key`
  - `title`
  - `conversation_kind` (`general` | `topic`)
  - `owner_person_id`
  - `created_by_person_id`
  - `created_by_email`
  - `created_at`
  - `updated_at`
  - `last_activity_at`
  - `conversation_status`
- Purpose:
  - Topic-level conversation containers inside each share group/thread.
  - Drive conversation ordering and per-conversation unread state.
- Logical index/key:
  - Unique: `conversation_id`
  - Common lookup: (`thread_id`, `last_activity_at`, `created_at`)
  - Common lookup: (`family_group_key`, `owner_person_id`, `last_activity_at`)

## ShareConversationMembers

- Columns:
  - `conversation_member_id`
  - `conversation_id`
  - `thread_id`
  - `family_group_key`
  - `person_id`
  - `member_role` (`owner` | `member`)
  - `joined_at`
  - `last_read_at`
  - `is_active`
- Purpose:
  - Membership and read-state per conversation topic.
- Logical index/key:
  - Unique: `conversation_member_id`
  - Unique composite: (`conversation_id`, `person_id`)
  - Common lookup: (`family_group_key`, `thread_id`, `person_id`, `is_active`)
  - Common lookup: (`family_group_key`, `conversation_id`, `is_active`)

## SharePosts

- Columns:
  - `post_id`
  - `thread_id`
  - `conversation_id`
  - `family_group_key`
  - `file_id`
  - `caption_text`
  - `author_person_id`
  - `author_display_name`
  - `author_email`
  - `created_at`
  - `updated_at`
  - `post_status`
- Purpose:
  - Post rows for Family Shares threads; supports text-only and media-backed entries.
- Logical index/key:
  - Unique: `post_id`
  - Common lookup: (`thread_id`, `created_at`)
  - Common lookup: (`conversation_id`, `thread_id`, `created_at`)
  - Common lookup: (`family_group_key`, `created_at`)

## SharePostComments

- Columns:
  - `comment_id`
  - `post_id`
  - `thread_id`
  - `family_group_key`
  - `parent_comment_id`
  - `author_person_id`
  - `author_display_name`
  - `author_email`
  - `comment_text`
  - `comment_status`
  - `created_at`
  - `updated_at`
  - `deleted_at`
- Purpose:
  - Threaded comments attached to share posts.
- Logical index/key:
  - Unique: `comment_id`
  - Common lookup: (`post_id`, `created_at`)
  - Thread lookup: (`thread_id`, `created_at`)

## PushSubscriptions

- Columns:
  - `subscription_id`
  - `family_group_key`
  - `person_id`
  - `user_email`
  - `endpoint`
  - `p256dh`
  - `auth`
  - `device_label`
  - `user_agent`
  - `last_seen_at`
  - `created_at`
  - `is_active`
- Purpose:
  - Registered browser/device push endpoints for future share notifications.
- Logical index/key:
  - Unique: `subscription_id`
  - Unique: `endpoint`
  - Common lookup: (`family_group_key`, `person_id`, `is_active`)

## NotificationOutbox

- Columns:
  - `notification_id`
  - `family_group_key`
  - `person_id`
  - `user_email`
  - `channel`
  - `event_type`
  - `entity_type`
  - `entity_id`
  - `payload_json`
  - `status`
  - `attempt_count`
  - `next_attempt_at`
  - `last_error`
  - `created_at`
  - `sent_at`
- Purpose:
  - Asynchronous notification queue so post/comment writes are not blocked on delivery.
- Logical index/key:
  - Unique: `notification_id`
  - Common lookup: (`status`, `next_attempt_at`, `created_at`)
  - Recipient lookup: (`family_group_key`, `person_id`, `created_at`)

## FaceInstances

- Columns:
  - `family_group_key` (`"__global__"` for canonical runtime rows; legacy family-scoped rows may remain temporarily during transition)
  - `face_id`
  - `file_id`
  - `bbox_x`
  - `bbox_y`
  - `bbox_w`
  - `bbox_h`
  - `detection_confidence`
  - `quality_score`
  - `embedding_json`
  - `created_at`
  - `updated_at`
- Purpose:
  - Persist normalized per-face detections for analyzed images so reruns can replace one canonical face set for each file globally, regardless of which family view triggered the analysis.
- Logical index/key:
  - Unique: `face_id`
  - Common lookup: `file_id`
  - Compatibility index retained in OCI: (`family_group_key`, `file_id`)

## FaceMatches

- Columns:
  - `family_group_key` (`"__global__"` for canonical runtime rows; retained in schema for compatibility)
  - `match_id`
  - `face_id`
  - `candidate_person_id`
  - `confidence_score`
  - `match_status`
  - `reviewed_by`
  - `reviewed_at`
  - `created_at`
  - `match_metadata`
- Purpose:
  - Persist suggest-only or reviewed candidate-person matches for each detected face, with candidate visibility filtered at read time by accessible people rather than by duplicating rows per family.
- Logical index/key:
  - Unique: `match_id`
  - Common lookup: (`face_id`), (`candidate_person_id`)
  - Compatibility index retained in OCI: (`family_group_key`, `match_status`)

## PersonFaceProfiles

- Columns:
  - `family_group_key` (`"__global__"` for canonical runtime rows; retained in schema for compatibility)
  - `profile_id`
  - `person_id`
  - `source_file_id`
  - `sample_count`
  - `embedding_json`
  - `updated_at`
- Purpose:
  - Cache the current global per-person reference embedding used for suggest-only face matching, seeded from the person's primary headshot.
- Logical index/key:
  - Unique: `profile_id`
  - Canonical uniqueness: `person_id`
  - Compatibility unique index retained in OCI: (`family_group_key`, `person_id`)

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
- Password reset:
  - `PasswordResets.person_id` -> `People.person_id`
  - `PasswordResets.family_group_key` scopes recovery to one active family-group login context
  - `PasswordResets.reset_email` is the delivery/match contact email only; it is not the canonical login identity key
  - `PasswordResets.username` snapshots the expected local username at request time, while reset completion still resolves the active local user by `person_id`
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
- Face suggestions:
  - `FaceInstances.file_id` -> `MediaAssets.file_id`
  - `FaceMatches.face_id` -> `FaceInstances.face_id`
  - `FaceMatches.candidate_person_id` -> `People.person_id`
  - `PersonFaceProfiles.person_id` -> `People.person_id`

## Media Link Design

- Primary person photo:
  - `People.photo_file_id` stores the one canonical current headshot file ID for the person.
  - Person `MediaLinks.is_primary` is legacy/non-authoritative and should not be used as the source of truth.
- Photo gallery:
  - Use `MediaLinks` rows to associate files to people/households/attributes.
  - Use `MediaAssets` as the canonical source for media-level title/description/date/kind/created timestamp.
  - Treat `MediaAssets.created_at` as upload recency and `MediaAssets.photo_date` as the media date.
- Attribute media:
  - `MediaLinks` supports `entity_type = "attribute"` with `entity_id = Attributes.attribute_id`.
- Media metadata:
  - `MediaAssets.media_metadata` and `MediaLinks.media_metadata` are no longer active runtime write targets.
  - Historical rows may still contain legacy JSON.
  - Active runtime should not depend on those JSON fields for canonical media behavior.
- Media storage:
  - Files are stored in OCI Object Storage using normalized object-key columns on `MediaAssets`.
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
