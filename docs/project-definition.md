# Project Definition

Eternal Family Link exists to build and strengthen family relationships by making it natural and easy for family members to share thoughts, memories, stories, and media with each other.

The product is a private family communication and family-history app. It should feel familiar, like a blend of text messaging, Instagram-style media sharing, and family archive building. The important product goal is that everyday family conversation naturally grows the family record instead of requiring a separate archival chore.

## Existing App Tracks

The root EFL app is the current feature reference for family sharing: group/circle threads, named conversations, posts, comments, media upload, tagging, unread state, and notification scaffolding.

Famailink is the cleaner person-based access and family-tree foundation. It defines relationship-derived visibility, subscription preferences, and owner-controlled content-sharing rules for `vitals`, `stories`, `media`, and `conversations`.

EFL2 is an isolated Unit 1 access/preference lab. It does not implement people, media, stories, shares, or conversations as product surfaces.

When root EFL behavior conflicts with Famailink's person-based data access rules, the Famailink person/member access model is the intended direction.

## Core Experience

Family members share thoughts, comments, photos, videos, audio, and other media inside family Groups. A Group defines who participates, such as immediate family, siblings, a family branch, or a custom set of family members.

Within each Group, members can create multiple named conversations. A conversation is a durable topic inside that Group, not a temporary chat message. When a conversation is started:

- It has a name or title.
- It is retained inside the Group.
- Members can keep adding comments, replies, thoughts, and media over time.
- New conversations can be added inside the same Group without replacing older conversations.

A Group is therefore a named, described, member-based container for multiple ongoing conversations. For example, one sibling Group might have separate conversations for a reunion, old photos, a birthday, family recipes, or a specific memory.

In the current root EFL implementation, these Groups are represented by Family Shares thread/group tables. That implementation is a useful feature reference, but the long-term access model should be person/member based rather than active-family-group based.

## Access Model

Conversation and Group access is based on people, not on whichever family group is active in the UI.

- A person can see a Group when they are an active participant/member of that Group.
- A person can see a conversation when they are an active participant/member of that conversation or its parent Group.
- The active family group may be used as audience-template metadata, lineage context, or a filtering convenience, but it should not be the primary read/access gate for conversations.
- Family group keys from the root EFL implementation should be treated as implementation metadata unless a future design decision explicitly makes them access gates again.

Famailink's person-based sharing rules remain the source for profile-content visibility. A user may participate in a conversation while still having limited access to another person's profile details depending on owner sharing rules.

Groups are also an access-permission method for group-shared media and stories. Subscription preferences and profile-sharing settings remain important, but group membership can grant direct access to content shared into that Group when the media/story feature is wired to canonical storage.

The access model should keep these concepts separate:

- Group membership: whether a person participates in a Group.
- Conversation membership: whether a person participates in a conversation.
- Profile/content visibility: whether a viewer can see another person's vitals, stories, media, or conversations on that person's profile.
- Subscription preferences: whether a viewer wants updates/notifications from a person or relationship category.

## Read State

Each conversation tracks read/unread state for participating members. The app should show when a user has not yet read new comments or seen newly shared media in conversations they participate in.

Unread indicators should be conversation-specific. A user should be able to tell which named conversation needs attention without treating the entire group as unread.

The product model should keep these concepts distinct:

- Group: who participates.
- Conversation: the named durable topic inside the Group.
- Post, message, media, comment, or reply: the content added to a conversation.
- Read state: what each participant has or has not seen in each conversation.

The root EFL `share_conversation_members.last_read_at` pattern is the current implementation reference for conversation read state.

## Family History

Shared content has two purposes:

- Conversation: the content lives in the group conversation where it was shared, with comments and replies preserved in context.
- Family history: shared media and stories can also become part of the linked person or household history.

Media can be automatically or manually tagged to people shown in an image. Media can also be manually linked to people, households, attributes, events, or stories even when no face appears in the media.

Linked media and stories should appear under each person's history/profile so the family archive grows from normal family sharing.

Conversation context should be retained. A media item linked to a person should be able to point back to the conversation where it was shared when that context is relevant and visible to the viewer.

## Media Storage And Linking

When media is uploaded, the app should preserve both an optimized viewing version and an archived source version:

- Store the high-resolution original/archive asset.
- Generate and store a thumbnail or preview asset.
- Store canonical media-level fields in `MediaAssets`.
- Store person, household, attribute, event, story, or conversation associations in `MediaLinks` or the appropriate normalized linking table.

`MediaAssets` is the canonical media file registry. `MediaLinks` is the association map that connects media to people, households, attributes, and related history surfaces. Media registry rows and media association rows are not disposable conversation data.

Conversation cleanup must not destroy the family archive. Resetting or rebuilding share conversations must preserve canonical media assets and media links unless a future targeted cleanup explicitly identifies specific media rows for removal.

## Data Model Reference

The root EFL schema already contains useful tables for the sharing/conversation model. These are the reference concepts, with access semantics adjusted toward Famailink's person-based rules:

- Group identity and membership:
  - Current root EFL reference: `share_groups`, `share_group_members`, `share_threads`, `share_thread_members`.
  - Intended direction: membership rows keyed by `person_id` should control access.
  - Family group fields may remain as metadata/template context, not primary access gates.
- Named conversations:
  - Current root EFL reference: `share_conversations`.
  - Each conversation belongs inside a Group/thread, has a required title, and is retained over time.
- Conversation membership and read state:
  - Current root EFL reference: `share_conversation_members`.
  - Stores per-person participation and `last_read_at`.
- Posts/messages/media in conversations:
  - Current root EFL reference: `share_posts`.
  - Supports text-only posts and media-backed posts.
- Comments and replies:
  - Current root EFL reference: `share_post_comments`.
  - Supports threaded family comments on posts.
- Notifications:
  - Current root EFL reference: `notification_outbox` and `push_subscriptions`.
  - Notification delivery should be non-blocking and derived from membership/subscription state.
- Media registry and history links:
  - Current root EFL reference: `MediaAssets` and `MediaLinks`.
  - `MediaAssets` stores canonical file-level media data.
  - `MediaLinks` associates media to people, households, attributes, events, stories, and other history surfaces.

## Feature Requirements

The target product should support:

- Create and manage family Groups from selected people or relationship templates.
- Store a Group name, description, owner, and active member set.
- Prevent duplicate active Groups with the exact same active member set.
- Create named conversations inside a Group.
- Continue adding comments, replies, text, and media to an existing conversation.
- Create multiple conversations inside the same Group.
- Show conversation-specific unread counts and new-media indicators.
- Upload media into a conversation.
- Store an archived original and generated thumbnail/preview for uploaded media.
- Tag people in uploaded media automatically when possible and manually when needed.
- Manually link media to people, households, attributes, events, or stories.
- Show linked media/stories under the relevant person or household history.
- Preserve the original conversation context for shared media when the viewer has permission to see it.
- Notify participants about new posts/comments/media according to membership and subscription preferences.

## Product Direction

Future planning should refine:

- Group membership and relationship-template behavior.
- Named conversation creation, retention, and unread/read behavior.
- Media upload, thumbnail generation, and high-resolution archive storage.
- Tagging people in media and manually linking media to people or history records.
- How shared conversation content becomes person or household history.
- How person profiles surface linked media, stories, and conversation context.
- How Famailink person-based sharing rules apply to conversation-derived profile/history content.

The guiding principle is that the app should make family history creation feel like ordinary family communication.
