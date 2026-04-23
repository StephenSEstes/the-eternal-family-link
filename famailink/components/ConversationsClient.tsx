"use client";

import { useEffect, useMemo, useState } from "react";
import { FamailinkChrome } from "@/components/FamailinkChrome";

type SessionInfo = {
  username: string;
  personId: string;
};

type PersonOption = {
  personId: string;
  displayName: string;
};

type ConversationMember = {
  personId: string;
  displayName: string;
  groupDisplayName: string;
  role: string;
};

type ConversationCircle = {
  circleId: string;
  title: string;
  defaultTitle: string;
  description: string;
  lastActivityAt: string;
  unreadCount: number;
  canDelete: boolean;
  members: ConversationMember[];
};

type CircleConversation = {
  conversationId: string;
  circleId: string;
  title: string;
  lastActivityAt: string;
  unreadCount: number;
};

type ConversationComment = {
  commentId: string;
  postId: string;
  authorPersonId: string;
  authorDisplayName: string;
  commentText: string;
  createdAt: string;
};

type ConversationPost = {
  postId: string;
  authorPersonId: string;
  authorDisplayName: string;
  caption: string;
  createdAt: string;
  comments: ConversationComment[];
};

type ConversationsClientProps = {
  session: SessionInfo;
  initialCircles: ConversationCircle[];
  initialCircleId: string;
  initialConversationId: string;
  people: PersonOption[];
  relationshipOptions: RelationshipOption[];
};

type RelationshipOption = {
  key: string;
  label: string;
  personIds: string[];
};

function normalize(value?: string) {
  return String(value ?? "").trim();
}

function formatDate(value?: string) {
  const raw = normalize(value);
  if (!raw) return "";
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(parsed));
}

function memberNames(members: ConversationMember[]) {
  return members.map((member) => member.displayName || member.personId).join(", ");
}

function personSignature(personIds: Iterable<string>) {
  return Array.from(new Set(Array.from(personIds).map(normalize).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right))
    .join("|");
}

function uniqueIds(values: Iterable<string>) {
  return Array.from(new Set(Array.from(values).map(normalize).filter(Boolean)));
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    credentials: "same-origin",
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(payload.error ?? `Request failed (${response.status}).`));
  }
  return payload;
}

function unreadBadge(count: number) {
  if (count <= 0) return null;
  return <span className="conversation-unread">{count}</span>;
}

export function ConversationsClient({
  session,
  initialCircles,
  initialCircleId: requestedCircleId,
  initialConversationId: requestedConversationId,
  people,
  relationshipOptions,
}: ConversationsClientProps) {
  const startingCircleId = initialCircles.some((circle) => circle.circleId === requestedCircleId)
    ? requestedCircleId
    : initialCircles[0]?.circleId ?? "";
  const [circles, setCircles] = useState(initialCircles);
  const [selectedCircleId, setSelectedCircleId] = useState(startingCircleId);
  const [conversations, setConversations] = useState<CircleConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [posts, setPosts] = useState<ConversationPost[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [newCircleTitle, setNewCircleTitle] = useState("");
  const [newCircleDescription, setNewCircleDescription] = useState("");
  const [circleSearch, setCircleSearch] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [memberGroupNames, setMemberGroupNames] = useState<Record<string, string>>({});
  const [relationshipModalOpen, setRelationshipModalOpen] = useState(false);
  const [selectedRelationshipKeys, setSelectedRelationshipKeys] = useState<string[]>([]);
  const [groupNameDrafts, setGroupNameDrafts] = useState<Record<string, string>>({});
  const [groupNameBusy, setGroupNameBusy] = useState(false);
  const [newConversationTitle, setNewConversationTitle] = useState("");
  const [initialMessage, setInitialMessage] = useState("");
  const [postDraft, setPostDraft] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  const selectedCircle = useMemo(
    () => circles.find((circle) => circle.circleId === selectedCircleId) ?? null,
    [circles, selectedCircleId],
  );
  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.conversationId === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );
  const filteredPeople = useMemo(() => {
    const query = circleSearch.trim().toLowerCase();
    return people
      .filter((person) => person.personId !== session.personId)
      .filter((person) => !query || person.displayName.toLowerCase().includes(query) || person.personId.toLowerCase().includes(query))
      .slice(0, 40);
  }, [circleSearch, people, session.personId]);
  const peopleById = useMemo(() => new Map(people.map((person) => [person.personId, person])), [people]);
  const selectedGroupMembersForNames = useMemo(() => {
    const creator = peopleById.get(session.personId) ?? {
      personId: session.personId,
      displayName: "You",
    };
    return [creator, ...selectedMemberIds.map((personId) => peopleById.get(personId)).filter((person): person is PersonOption => Boolean(person))];
  }, [peopleById, selectedMemberIds, session.personId]);
  const selectedRelationshipPeopleCount = useMemo(() => {
    const personIds = new Set<string>();
    for (const key of selectedRelationshipKeys) {
      const option = relationshipOptions.find((entry) => entry.key === key);
      for (const personId of option?.personIds ?? []) {
        if (personId !== session.personId) personIds.add(personId);
      }
    }
    return personIds.size;
  }, [relationshipOptions, selectedRelationshipKeys, session.personId]);
  const duplicateSelectedGroup = useMemo(() => {
    const selectedSignature = personSignature([session.personId, ...selectedMemberIds]);
    if (!selectedSignature || selectedMemberIds.length === 0) return null;
    return (
      circles.find((circle) => personSignature(circle.members.map((member) => member.personId)) === selectedSignature) ??
      null
    );
  }, [circles, selectedMemberIds, session.personId]);
  const selectedGroupNameDraft = selectedCircle ? groupNameDrafts[selectedCircle.circleId] ?? selectedCircle.title : "";

  async function reloadCircles(nextSelectedId = selectedCircleId) {
    const body = (await fetchJson("/api/conversations/circles")) as { circles?: ConversationCircle[] };
    const nextCircles = Array.isArray(body.circles) ? body.circles : [];
    setCircles(nextCircles);
    setSelectedCircleId(nextCircles.some((circle) => circle.circleId === nextSelectedId) ? nextSelectedId : nextCircles[0]?.circleId ?? "");
  }

  useEffect(() => {
    let cancelled = false;
    if (!selectedCircleId) {
      setConversations([]);
      setSelectedConversationId("");
      return;
    }
    void (async () => {
      setStatus("");
      try {
        const body = (await fetchJson(
          `/api/conversations/circles/${encodeURIComponent(selectedCircleId)}/conversations`,
        )) as { conversations?: CircleConversation[] };
        if (cancelled) return;
        const nextConversations = Array.isArray(body.conversations) ? body.conversations : [];
        setConversations(nextConversations);
        setSelectedConversationId((current) => {
          const routeMatch =
            selectedCircleId === requestedCircleId &&
            nextConversations.some((conversation) => conversation.conversationId === requestedConversationId);
          if (routeMatch) return requestedConversationId;
          return nextConversations.some((conversation) => conversation.conversationId === current)
            ? current
            : nextConversations[0]?.conversationId ?? "";
        });
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "Failed to load conversations.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestedCircleId, requestedConversationId, selectedCircleId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedCircleId || !selectedConversationId) {
      setPosts([]);
      return;
    }
    void (async () => {
      setStatus("");
      try {
        const body = (await fetchJson(
          `/api/conversations/circles/${encodeURIComponent(selectedCircleId)}/conversations/${encodeURIComponent(selectedConversationId)}/posts`,
        )) as { posts?: ConversationPost[] };
        if (cancelled) return;
        setPosts(Array.isArray(body.posts) ? body.posts : []);
        await fetchJson(
          `/api/conversations/circles/${encodeURIComponent(selectedCircleId)}/conversations/${encodeURIComponent(selectedConversationId)}/read`,
          { method: "POST", body: "{}" },
        ).catch(() => null);
        setConversations((current) => {
          const next = current.map((conversation) =>
            conversation.conversationId === selectedConversationId ? { ...conversation, unreadCount: 0 } : conversation,
          );
          const nextCircleUnread = next.reduce((total, conversation) => total + conversation.unreadCount, 0);
          setCircles((currentCircles) =>
            currentCircles.map((circle) =>
              circle.circleId === selectedCircleId ? { ...circle, unreadCount: nextCircleUnread } : circle,
            ),
          );
          return next;
        });
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "Failed to load posts.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCircleId, selectedConversationId]);

  function toggleMember(personId: string) {
    setSelectedMemberIds((current) =>
      current.includes(personId) ? current.filter((entry) => entry !== personId) : [...current, personId],
    );
  }

  function toggleRelationshipKey(key: string) {
    setSelectedRelationshipKeys((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );
  }

  function addRelationshipMembers() {
    const personIds = new Set<string>();
    for (const key of selectedRelationshipKeys) {
      const option = relationshipOptions.find((entry) => entry.key === key);
      for (const personId of option?.personIds ?? []) {
        if (personId !== session.personId) personIds.add(personId);
      }
    }
    setSelectedMemberIds((current) => uniqueIds([...current, ...personIds]));
    setSelectedRelationshipKeys([]);
    setRelationshipModalOpen(false);
    if (personIds.size) setStatus(`${personIds.size} relationship members added.`);
  }

  function setMemberGroupName(personId: string, value: string) {
    setMemberGroupNames((current) => ({
      ...current,
      [personId]: value,
    }));
  }

  async function createCircle() {
    if (duplicateSelectedGroup) {
      setSelectedCircleId(duplicateSelectedGroup.circleId);
      setStatus(`Group already exists: ${duplicateSelectedGroup.title}`);
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const body = (await fetchJson("/api/conversations/circles", {
        method: "POST",
        body: JSON.stringify({
          title: newCircleTitle,
          description: newCircleDescription,
          memberPersonIds: selectedMemberIds,
          memberGroupNames: Object.fromEntries(
            selectedGroupMembersForNames.map((person) => [
              person.personId,
              normalize(memberGroupNames[person.personId]) || normalize(newCircleTitle) || "Family Group",
            ]),
          ),
        }),
      })) as { circle?: ConversationCircle; duplicate?: boolean };
      const circle = body.circle;
      if (!circle) throw new Error("No group returned.");
      setNewCircleTitle("");
      setNewCircleDescription("");
      setSelectedMemberIds([]);
      setMemberGroupNames({});
      setCircleSearch("");
      await reloadCircles(circle.circleId);
      setSelectedCircleId(circle.circleId);
      setStatus(body.duplicate ? `Group already exists: ${circle.title}` : "Group created.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create group.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelectedGroup() {
    if (!selectedCircle) return;
    const confirmed = window.confirm(`Delete group "${selectedCircle.title}"? Its conversations will be hidden from all members.`);
    if (!confirmed) return;
    setBusy(true);
    setStatus("");
    try {
      await fetchJson(`/api/conversations/circles/${encodeURIComponent(selectedCircle.circleId)}`, {
        method: "DELETE",
      });
      setConversations([]);
      setPosts([]);
      await reloadCircles("");
      setStatus("Group deleted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to delete group.");
    } finally {
      setBusy(false);
    }
  }

  async function saveMyGroupName() {
    if (!selectedCircle) return;
    const title = normalize(selectedGroupNameDraft);
    if (!title || title === selectedCircle.title) return;
    setGroupNameBusy(true);
    setStatus("");
    try {
      const body = (await fetchJson(`/api/conversations/circles/${encodeURIComponent(selectedCircle.circleId)}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      })) as { circle?: ConversationCircle };
      const circle = body.circle;
      if (!circle) throw new Error("No group returned.");
      setCircles((current) => current.map((entry) => (entry.circleId === circle.circleId ? circle : entry)));
      setGroupNameDrafts((current) => ({ ...current, [circle.circleId]: circle.title }));
      setStatus("Group name saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save group name.");
    } finally {
      setGroupNameBusy(false);
    }
  }

  async function createConversation() {
    if (!selectedCircleId) return;
    setBusy(true);
    setStatus("");
    try {
      const body = (await fetchJson(
        `/api/conversations/circles/${encodeURIComponent(selectedCircleId)}/conversations`,
        {
          method: "POST",
          body: JSON.stringify({
            title: newConversationTitle,
            initialMessage,
          }),
        },
      )) as { conversation?: CircleConversation };
      const conversation = body.conversation;
      if (!conversation) throw new Error("No conversation returned.");
      setNewConversationTitle("");
      setInitialMessage("");
      const refreshed = (await fetchJson(
        `/api/conversations/circles/${encodeURIComponent(selectedCircleId)}/conversations`,
      )) as { conversations?: CircleConversation[] };
      const nextConversations = Array.isArray(refreshed.conversations) ? refreshed.conversations : [];
      setConversations(nextConversations);
      setSelectedConversationId(conversation.conversationId);
      await reloadCircles(selectedCircleId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create conversation.");
    } finally {
      setBusy(false);
    }
  }

  async function createPost() {
    if (!selectedCircleId || !selectedConversationId) return;
    setBusy(true);
    setStatus("");
    try {
      await fetchJson(
        `/api/conversations/circles/${encodeURIComponent(selectedCircleId)}/conversations/${encodeURIComponent(selectedConversationId)}/posts`,
        {
          method: "POST",
          body: JSON.stringify({ caption: postDraft }),
        },
      );
      setPostDraft("");
      const body = (await fetchJson(
        `/api/conversations/circles/${encodeURIComponent(selectedCircleId)}/conversations/${encodeURIComponent(selectedConversationId)}/posts`,
      )) as { posts?: ConversationPost[] };
      setPosts(Array.isArray(body.posts) ? body.posts : []);
      await reloadCircles(selectedCircleId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to post message.");
    } finally {
      setBusy(false);
    }
  }

  async function createComment(postId: string) {
    if (!selectedCircleId || !selectedConversationId) return;
    const commentText = normalize(commentDrafts[postId]);
    if (!commentText) return;
    setBusy(true);
    setStatus("");
    try {
      await fetchJson(
        `/api/conversations/circles/${encodeURIComponent(selectedCircleId)}/conversations/${encodeURIComponent(selectedConversationId)}/posts/${encodeURIComponent(postId)}/comments`,
        {
          method: "POST",
          body: JSON.stringify({ commentText }),
        },
      );
      setCommentDrafts((current) => ({ ...current, [postId]: "" }));
      const body = (await fetchJson(
        `/api/conversations/circles/${encodeURIComponent(selectedCircleId)}/conversations/${encodeURIComponent(selectedConversationId)}/posts`,
      )) as { posts?: ConversationPost[] };
      setPosts(Array.isArray(body.posts) ? body.posts : []);
      await reloadCircles(selectedCircleId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to add comment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <FamailinkChrome active="conversations" username={session.username} personId={session.personId} />

      <section className="conversations-shell">
        <div className="conversation-column circles-column">
          <div className="conversation-column-head">
            <div>
              <p className="eyebrow">Family Groups</p>
              <h1 className="conversation-title">Groups</h1>
            </div>
          </div>

          <div className="conversation-create-panel">
            <label className="field">
              <span className="field-label">Group name</span>
              <input
                className="input"
                value={newCircleTitle}
                onChange={(event) => setNewCircleTitle(event.target.value)}
                placeholder="Example: Siblings"
              />
            </label>
            <label className="field">
              <span className="field-label">Group description (optional)</span>
              <textarea
                className="input conversation-description-input"
                value={newCircleDescription}
                onChange={(event) => setNewCircleDescription(event.target.value)}
                placeholder="What this group is for"
              />
            </label>
            <button className="secondary-button" type="button" onClick={() => setRelationshipModalOpen(true)}>
              Add by Relationship
            </button>
            <label className="field">
              <span className="field-label">Add people</span>
              <input
                className="input"
                type="search"
                value={circleSearch}
                onChange={(event) => setCircleSearch(event.target.value)}
                placeholder="Search relatives"
              />
            </label>
            <div className="conversation-person-picker">
              {filteredPeople.map((person) => (
                <label key={person.personId} className="conversation-person-option">
                  <input
                    type="checkbox"
                    checked={selectedMemberIds.includes(person.personId)}
                    onChange={() => toggleMember(person.personId)}
                  />
                  <span>{person.displayName}</span>
                </label>
              ))}
            </div>
            {selectedMemberIds.length > 0 ? (
              <div className="conversation-member-name-list">
                <span className="field-label">Group name by member</span>
                {selectedGroupMembersForNames.map((person) => (
                  <label key={person.personId} className="conversation-member-name-row">
                    <span>{person.personId === session.personId ? "You" : person.displayName}</span>
                    <input
                      className="input"
                      value={memberGroupNames[person.personId] ?? ""}
                      onChange={(event) => setMemberGroupName(person.personId, event.target.value)}
                      placeholder={newCircleTitle || "Family Group"}
                    />
                  </label>
                ))}
              </div>
            ) : null}
            {duplicateSelectedGroup ? (
              <p className="conversation-inline-note">Group already exists: {duplicateSelectedGroup.title}</p>
            ) : null}
            <button
              className="primary-button"
              type="button"
              disabled={busy || selectedMemberIds.length === 0 || Boolean(duplicateSelectedGroup)}
              onClick={() => void createCircle()}
            >
              Create Group
            </button>
          </div>

          <div className="conversation-list" aria-label="Family groups">
            {circles.length === 0 ? <p className="empty-state">No groups yet.</p> : null}
            {circles.map((circle) => (
              <button
                key={circle.circleId}
                type="button"
                className={`conversation-list-item${circle.circleId === selectedCircleId ? " is-active" : ""}`}
                onClick={() => setSelectedCircleId(circle.circleId)}
              >
                <span className="conversation-list-main">
                  <strong>{circle.title}</strong>
                  {circle.description ? <small className="conversation-list-description">{circle.description}</small> : null}
                  <small>{memberNames(circle.members)}</small>
                </span>
                {unreadBadge(circle.unreadCount)}
              </button>
            ))}
          </div>
        </div>

        <div className="conversation-column topics-column">
          <div className="conversation-column-head">
            <div>
              <p className="eyebrow">Named Conversations</p>
              <h2>{selectedCircle?.title ?? "Select a group"}</h2>
              {selectedCircle?.description ? <p className="conversation-group-description">{selectedCircle.description}</p> : null}
            </div>
            {selectedCircle ? (
              <div className="conversation-head-actions">
                <p className="conversation-meta">{selectedCircle.members.length} members</p>
                <label className="conversation-my-group-name">
                  <span className="field-label">My group name</span>
                  <span>
                    <input
                      className="input"
                      value={selectedGroupNameDraft}
                      onChange={(event) =>
                        setGroupNameDrafts((current) => ({
                          ...current,
                          [selectedCircle.circleId]: event.target.value,
                        }))
                      }
                    />
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={groupNameBusy || !normalize(selectedGroupNameDraft) || selectedGroupNameDraft === selectedCircle.title}
                      onClick={() => void saveMyGroupName()}
                    >
                      Save
                    </button>
                  </span>
                </label>
                {selectedCircle.canDelete ? (
                  <button className="secondary-button danger-button" type="button" disabled={busy} onClick={() => void deleteSelectedGroup()}>
                    Delete Group
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {selectedCircle ? (
            <div className="conversation-create-panel">
              <label className="field">
                <span className="field-label">Conversation title</span>
                <input
                  className="input"
                  value={newConversationTitle}
                  onChange={(event) => setNewConversationTitle(event.target.value)}
                  placeholder="Example: Reunion plans"
                />
              </label>
              <label className="field">
                <span className="field-label">Initial message</span>
                <textarea
                  className="input conversation-textarea"
                  value={initialMessage}
                  onChange={(event) => setInitialMessage(event.target.value)}
                  placeholder="Optional"
                />
              </label>
              <button
                className="primary-button"
                type="button"
                disabled={busy || !newConversationTitle.trim()}
                onClick={() => void createConversation()}
              >
                Start Conversation
              </button>
            </div>
          ) : null}

          <div className="conversation-list" aria-label="Named conversations">
            {selectedCircle && conversations.length === 0 ? <p className="empty-state">No conversations in this group yet.</p> : null}
            {conversations.map((conversation) => (
              <button
                key={conversation.conversationId}
                type="button"
                className={`conversation-list-item${conversation.conversationId === selectedConversationId ? " is-active" : ""}`}
                onClick={() => setSelectedConversationId(conversation.conversationId)}
              >
                <span className="conversation-list-main">
                  <strong>{conversation.title}</strong>
                  <small>{formatDate(conversation.lastActivityAt)}</small>
                </span>
                {unreadBadge(conversation.unreadCount)}
              </button>
            ))}
          </div>
        </div>

        <div className="conversation-column thread-column">
          <div className="conversation-column-head">
            <div>
              <p className="eyebrow">Thread</p>
              <h2>{selectedConversation?.title ?? "Select a conversation"}</h2>
            </div>
          </div>

          {status ? <p className="error-text conversation-status">{status}</p> : null}

          {selectedConversation ? (
            <div className="conversation-compose">
              <textarea
                className="input conversation-textarea"
                value={postDraft}
                onChange={(event) => setPostDraft(event.target.value)}
                placeholder="Add a thought or memory"
              />
              <button
                className="primary-button"
                type="button"
                disabled={busy || !postDraft.trim()}
                onClick={() => void createPost()}
              >
                Post
              </button>
            </div>
          ) : null}

          <div className="conversation-posts" aria-label="Conversation posts">
            {selectedConversation && posts.length === 0 ? <p className="empty-state">No posts yet.</p> : null}
            {posts.map((post) => {
              const ownPost = post.authorPersonId === session.personId;
              return (
                <article key={post.postId} className={`conversation-post${ownPost ? " is-mine" : ""}`}>
                  <div className="conversation-post-bubble">
                    <div className="conversation-post-head">
                      <strong>{post.authorDisplayName || post.authorPersonId}</strong>
                      <span>{formatDate(post.createdAt)}</span>
                    </div>
                    <p>{post.caption}</p>
                  </div>
                  <div className="conversation-comments">
                    {post.comments.map((comment) => (
                      <div key={comment.commentId} className="conversation-comment">
                        <strong>{comment.authorDisplayName || comment.authorPersonId}</strong>
                        <span>{comment.commentText}</span>
                      </div>
                    ))}
                    <div className="conversation-comment-form">
                      <input
                        className="input"
                        value={commentDrafts[post.postId] ?? ""}
                        onChange={(event) =>
                          setCommentDrafts((current) => ({
                            ...current,
                            [post.postId]: event.target.value,
                          }))
                        }
                        placeholder="Comment"
                      />
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={busy || !normalize(commentDrafts[post.postId])}
                        onClick={() => void createComment(post.postId)}
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>
      {relationshipModalOpen ? (
        <div className="conversation-modal-backdrop" role="presentation">
          <div className="conversation-modal" role="dialog" aria-modal="true" aria-label="Add members by relationship">
            <div className="conversation-modal-head">
              <h2>Add by Relationship</h2>
              <button
                type="button"
                className="account-close"
                aria-label="Close relationship selector"
                onClick={() => setRelationshipModalOpen(false)}
              >
                x
              </button>
            </div>
            <div className="conversation-relationship-grid">
              {relationshipOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`conversation-relationship-option${selectedRelationshipKeys.includes(option.key) ? " is-selected" : ""}`}
                  onClick={() => toggleRelationshipKey(option.key)}
                >
                  <strong>{option.label}</strong>
                  <span>{option.personIds.length}</span>
                </button>
              ))}
            </div>
            <div className="conversation-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setRelationshipModalOpen(false)}>
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={selectedRelationshipKeys.length === 0}
                onClick={() => addRelationshipMembers()}
              >
                Add {selectedRelationshipPeopleCount}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
