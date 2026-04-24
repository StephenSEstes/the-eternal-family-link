"use client";

import { useEffect, useMemo, useState } from "react";
import { FamailinkChrome } from "@/components/FamailinkChrome";

type SessionInfo = { username: string; personId: string };
type PersonOption = { personId: string; displayName: string };
type ConversationMember = { personId: string; displayName: string; groupDisplayName: string; role: string };
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
type CircleConversation = { conversationId: string; circleId: string; title: string; lastActivityAt: string; unreadCount: number };
type ConversationComment = { commentId: string; postId: string; authorPersonId: string; authorDisplayName: string; commentText: string; createdAt: string };
type ConversationPost = { postId: string; authorPersonId: string; authorDisplayName: string; caption: string; createdAt: string; comments: ConversationComment[] };
type RelationshipOption = {
  key: string;
  label: string;
  personIds: string[];
  maternalPersonIds: string[];
  paternalPersonIds: string[];
  supportsSides: boolean;
};
type ConversationsClientProps = {
  session: SessionInfo;
  initialCircles: ConversationCircle[];
  initialCircleId: string;
  initialConversationId: string;
  people: PersonOption[];
  relationshipOptions: RelationshipOption[];
};
type FamilySideFilter = "both" | "maternal" | "paternal";
type StatusState = { tone: "error" | "info"; message: string } | null;

function normalize(value?: string) {
  return String(value ?? "").trim();
}

function formatDate(value?: string) {
  const raw = normalize(value);
  if (!raw) return "";
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(parsed));
}

function uniqueIds(values: Iterable<string>) {
  return Array.from(new Set(Array.from(values).map(normalize).filter(Boolean)));
}

function personSignature(values: Iterable<string>) {
  return uniqueIds(values).sort((a, b) => a.localeCompare(b)).join("|");
}

function memberNames(members: ConversationMember[]) {
  return members.map((member) => member.displayName || member.personId).join(", ");
}

function buildAutoGroupTitle(recipientIds: string[], peopleById: Map<string, PersonOption>) {
  const names = recipientIds.map((personId) => peopleById.get(personId)?.displayName || personId).filter(Boolean);
  if (names.length === 0) return "Family Group";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]}, ${names[2]}`;
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

function optionPersonIds(option: RelationshipOption, side: FamilySideFilter) {
  if (side === "maternal" && option.supportsSides) return option.maternalPersonIds;
  if (side === "paternal" && option.supportsSides) return option.paternalPersonIds;
  return option.personIds;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    credentials: "same-origin",
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error ?? `Request failed (${response.status}).`));
  return payload as T;
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
  const startCircleId = initialCircles.some((circle) => circle.circleId === requestedCircleId) ? requestedCircleId : initialCircles[0]?.circleId ?? "";
  const [circles, setCircles] = useState(initialCircles);
  const [selectedCircleId, setSelectedCircleId] = useState(startCircleId);
  const [conversations, setConversations] = useState<CircleConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [posts, setPosts] = useState<ConversationPost[]>([]);
  const [status, setStatus] = useState<StatusState>(null);
  const [busy, setBusy] = useState(false);
  const [groupNameDrafts, setGroupNameDrafts] = useState<Record<string, string>>({});
  const [groupNameBusy, setGroupNameBusy] = useState(false);
  const [newTopicOpen, setNewTopicOpen] = useState(false);
  const [newConversationTitle, setNewConversationTitle] = useState("");
  const [initialMessage, setInitialMessage] = useState("");
  const [postDraft, setPostDraft] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [composerOpen, setComposerOpen] = useState(initialCircles.length === 0);
  const [composerRecipientIds, setComposerRecipientIds] = useState<string[]>([]);
  const [composerSearch, setComposerSearch] = useState("");
  const [composerMessage, setComposerMessage] = useState("");
  const [composerGroupTitle, setComposerGroupTitle] = useState("");
  const [composerDescription, setComposerDescription] = useState("");
  const [composerConversationTitle, setComposerConversationTitle] = useState("");
  const [composerAdvancedOpen, setComposerAdvancedOpen] = useState(false);
  const [composerSideFilter, setComposerSideFilter] = useState<FamilySideFilter>("both");

  const peopleById = useMemo(() => new Map(people.map((person) => [person.personId, person])), [people]);
  const selectedCircle = useMemo(() => circles.find((circle) => circle.circleId === selectedCircleId) ?? null, [circles, selectedCircleId]);
  const selectedConversation = useMemo(() => conversations.find((conversation) => conversation.conversationId === selectedConversationId) ?? null, [conversations, selectedConversationId]);
  const selectedGroupNameDraft = selectedCircle ? groupNameDrafts[selectedCircle.circleId] ?? selectedCircle.title : "";
  const composerRecipients = useMemo(() => composerRecipientIds.map((personId) => peopleById.get(personId)).filter((person): person is PersonOption => Boolean(person)), [composerRecipientIds, peopleById]);
  const composerAutoGroupTitle = useMemo(() => buildAutoGroupTitle(composerRecipientIds, peopleById), [composerRecipientIds, peopleById]);
  const composerGroupMatch = useMemo(() => {
    if (!composerRecipientIds.length) return null;
    const signature = personSignature([session.personId, ...composerRecipientIds]);
    return circles.find((circle) => personSignature(circle.members.map((member) => member.personId)) === signature) ?? null;
  }, [circles, composerRecipientIds, session.personId]);
  const filteredPeople = useMemo(() => {
    const query = normalize(composerSearch).toLowerCase();
    return people
      .filter((person) => person.personId !== session.personId)
      .filter((person) => !query || person.displayName.toLowerCase().includes(query) || person.personId.toLowerCase().includes(query))
      .slice(0, 48);
  }, [composerSearch, people, session.personId]);
  const relationshipPills = useMemo(() => relationshipOptions.map((option) => ({
    ...option,
    applicablePersonIds: uniqueIds(optionPersonIds(option, composerSideFilter).filter((personId) => personId !== session.personId)),
  })), [composerSideFilter, relationshipOptions, session.personId]);
  const canSendComposer = composerRecipientIds.length > 0 && Boolean(normalize(composerMessage));

  async function loadCircles() {
    const body = await fetchJson<{ circles?: ConversationCircle[] }>("/api/conversations/circles");
    return Array.isArray(body.circles) ? body.circles : [];
  }

  async function loadCircleConversations(circleId: string) {
    const body = await fetchJson<{ conversations?: CircleConversation[] }>(`/api/conversations/circles/${encodeURIComponent(circleId)}/conversations`);
    return Array.isArray(body.conversations) ? body.conversations : [];
  }

  async function syncCircleSelection(circleId: string, preferredConversationId?: string) {
    const [nextCircles, nextConversations] = await Promise.all([loadCircles(), loadCircleConversations(circleId)]);
    setCircles(nextCircles);
    setConversations(nextConversations);
    setSelectedCircleId(nextCircles.some((circle) => circle.circleId === circleId) ? circleId : nextCircles[0]?.circleId ?? "");
    setSelectedConversationId(nextConversations.some((conversation) => conversation.conversationId === preferredConversationId) ? normalize(preferredConversationId) : nextConversations[0]?.conversationId ?? "");
  }

  useEffect(() => {
    let cancelled = false;
    if (!selectedCircleId) {
      setConversations([]);
      setSelectedConversationId("");
      return;
    }
    void (async () => {
      try {
        const nextConversations = await loadCircleConversations(selectedCircleId);
        if (cancelled) return;
        setConversations(nextConversations);
        setSelectedConversationId((current) => {
          const routeMatch = selectedCircleId === requestedCircleId && nextConversations.some((conversation) => conversation.conversationId === requestedConversationId);
          if (routeMatch) return requestedConversationId;
          return nextConversations.some((conversation) => conversation.conversationId === current) ? current : nextConversations[0]?.conversationId ?? "";
        });
      } catch (error) {
        if (!cancelled) setStatus({ tone: "error", message: error instanceof Error ? error.message : "Failed to load conversations." });
      }
    })();
    return () => { cancelled = true; };
  }, [requestedCircleId, requestedConversationId, selectedCircleId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedCircleId || !selectedConversationId) {
      setPosts([]);
      return;
    }
    void (async () => {
      try {
        const body = await fetchJson<{ posts?: ConversationPost[] }>(`/api/conversations/circles/${encodeURIComponent(selectedCircleId)}/conversations/${encodeURIComponent(selectedConversationId)}/posts`);
        if (cancelled) return;
        setPosts(Array.isArray(body.posts) ? body.posts : []);
        await fetchJson<{ ok?: boolean }>(`/api/conversations/circles/${encodeURIComponent(selectedCircleId)}/conversations/${encodeURIComponent(selectedConversationId)}/read`, { method: "POST", body: "{}" }).catch(() => null);
        setConversations((current) => {
          const next = current.map((conversation) => conversation.conversationId === selectedConversationId ? { ...conversation, unreadCount: 0 } : conversation);
          const nextUnread = next.reduce((total, conversation) => total + conversation.unreadCount, 0);
          setCircles((currentCircles) => currentCircles.map((circle) => circle.circleId === selectedCircleId ? { ...circle, unreadCount: nextUnread } : circle));
          return next;
        });
      } catch (error) {
        if (!cancelled) setStatus({ tone: "error", message: error instanceof Error ? error.message : "Failed to load messages." });
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCircleId, selectedConversationId]);

  useEffect(() => { setPostDraft(""); }, [selectedConversationId]);
  useEffect(() => { setNewTopicOpen(false); setNewConversationTitle(""); setInitialMessage(""); }, [selectedCircleId]);

  function clearComposer() {
    setComposerRecipientIds([]);
    setComposerSearch("");
    setComposerMessage("");
    setComposerGroupTitle("");
    setComposerDescription("");
    setComposerConversationTitle("");
    setComposerAdvancedOpen(false);
    setComposerSideFilter("both");
  }

  function toggleRecipient(personId: string) {
    setComposerRecipientIds((current) => current.includes(personId) ? current.filter((entry) => entry !== personId) : uniqueIds([...current, personId]));
  }

  function removeRecipient(personId: string) {
    setComposerRecipientIds((current) => current.filter((entry) => entry !== personId));
  }

  function applyRelationship(personIds: string[], label: string) {
    if (!personIds.length) return;
    setComposerRecipientIds((current) => uniqueIds([...current, ...personIds]));
    setStatus({ tone: "info", message: `${label} added.` });
  }

  async function closeComposer() {
    setComposerOpen(false);
    clearComposer();
  }

  async function sendNewMessage() {
    if (!canSendComposer) return;
    setBusy(true);
    setStatus(null);
    try {
      const title = normalize(composerGroupTitle) || composerAutoGroupTitle || "Family Group";
      const circleBody = await fetchJson<{ circle?: ConversationCircle; duplicate?: boolean }>("/api/conversations/circles", {
        method: "POST",
        body: JSON.stringify({
          title,
          description: normalize(composerDescription),
          memberPersonIds: composerRecipientIds,
        }),
      });
      const circle = circleBody.circle;
      if (!circle) throw new Error("No group returned.");

      const conversationTitle = normalize(composerConversationTitle);
      let targetConversationId = "";

      if (conversationTitle) {
        const body = await fetchJson<{ conversation?: CircleConversation }>(`/api/conversations/circles/${encodeURIComponent(circle.circleId)}/conversations`, {
          method: "POST",
          body: JSON.stringify({
            title: conversationTitle,
            initialMessage: normalize(composerMessage),
          }),
        });
        targetConversationId = body.conversation?.conversationId ?? "";
      } else {
        const nextConversations = await loadCircleConversations(circle.circleId);
        const latestConversation = nextConversations[0] ?? null;
        if (latestConversation) {
          await fetchJson<{ post?: ConversationPost }>(`/api/conversations/circles/${encodeURIComponent(circle.circleId)}/conversations/${encodeURIComponent(latestConversation.conversationId)}/posts`, {
            method: "POST",
            body: JSON.stringify({ caption: normalize(composerMessage) }),
          });
          targetConversationId = latestConversation.conversationId;
        } else {
          const body = await fetchJson<{ conversation?: CircleConversation }>(`/api/conversations/circles/${encodeURIComponent(circle.circleId)}/conversations`, {
            method: "POST",
            body: JSON.stringify({
              title: "",
              initialMessage: normalize(composerMessage),
            }),
          });
          targetConversationId = body.conversation?.conversationId ?? "";
        }
      }

      await syncCircleSelection(circle.circleId, targetConversationId);
      await closeComposer();
      setStatus({
        tone: "info",
        message: circleBody.duplicate ? `Message sent. Existing group "${circle.title}" was reused.` : `Message sent to "${circle.title}".`,
      });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Failed to send message." });
    } finally {
      setBusy(false);
    }
  }

  async function saveMyGroupName() {
    if (!selectedCircle) return;
    const title = normalize(selectedGroupNameDraft);
    if (!title || title === selectedCircle.title) return;
    setGroupNameBusy(true);
    setStatus(null);
    try {
      const body = await fetchJson<{ circle?: ConversationCircle }>(`/api/conversations/circles/${encodeURIComponent(selectedCircle.circleId)}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      const circle = body.circle;
      if (!circle) throw new Error("No group returned.");
      setCircles((current) => current.map((entry) => entry.circleId === circle.circleId ? circle : entry));
      setGroupNameDrafts((current) => ({ ...current, [circle.circleId]: circle.title }));
      setStatus({ tone: "info", message: "Your group name was saved." });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Failed to save your group name." });
    } finally {
      setGroupNameBusy(false);
    }
  }

  async function deleteSelectedGroup() {
    if (!selectedCircle) return;
    if (!window.confirm(`Delete group "${selectedCircle.title}"? Its conversations will be archived.`)) return;
    setBusy(true);
    setStatus(null);
    try {
      await fetchJson<{ ok?: boolean }>(`/api/conversations/circles/${encodeURIComponent(selectedCircle.circleId)}`, { method: "DELETE" });
      const nextCircles = await loadCircles();
      setCircles(nextCircles);
      setConversations([]);
      setPosts([]);
      setSelectedCircleId(nextCircles[0]?.circleId ?? "");
      setSelectedConversationId("");
      setStatus({ tone: "info", message: "Group deleted." });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Failed to delete group." });
    } finally {
      setBusy(false);
    }
  }

  async function createConversation() {
    if (!selectedCircle) return;
    const title = normalize(newConversationTitle);
    if (!title) return;
    setBusy(true);
    setStatus(null);
    try {
      const body = await fetchJson<{ conversation?: CircleConversation }>(`/api/conversations/circles/${encodeURIComponent(selectedCircle.circleId)}/conversations`, {
        method: "POST",
        body: JSON.stringify({
          title,
          initialMessage: normalize(initialMessage),
        }),
      });
      await syncCircleSelection(selectedCircle.circleId, body.conversation?.conversationId ?? "");
      setNewTopicOpen(false);
      setNewConversationTitle("");
      setInitialMessage("");
      setStatus({ tone: "info", message: "Topic created." });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Failed to create topic." });
    } finally {
      setBusy(false);
    }
  }

  async function createPost() {
    if (!selectedCircle || !selectedConversation) return;
    const caption = normalize(postDraft);
    if (!caption) return;
    setBusy(true);
    setStatus(null);
    try {
      await fetchJson<{ post?: ConversationPost }>(`/api/conversations/circles/${encodeURIComponent(selectedCircle.circleId)}/conversations/${encodeURIComponent(selectedConversation.conversationId)}/posts`, {
        method: "POST",
        body: JSON.stringify({ caption }),
      });
      setPostDraft("");
      await syncCircleSelection(selectedCircle.circleId, selectedConversation.conversationId);
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Failed to send message." });
    } finally {
      setBusy(false);
    }
  }

  async function createComment(postId: string) {
    if (!selectedCircle || !selectedConversation) return;
    const commentText = normalize(commentDrafts[postId]);
    if (!commentText) return;
    setBusy(true);
    setStatus(null);
    try {
      await fetchJson<{ comment?: ConversationComment }>(`/api/conversations/circles/${encodeURIComponent(selectedCircle.circleId)}/conversations/${encodeURIComponent(selectedConversation.conversationId)}/posts/${encodeURIComponent(postId)}/comments`, {
        method: "POST",
        body: JSON.stringify({ commentText }),
      });
      setCommentDrafts((current) => ({ ...current, [postId]: "" }));
      await syncCircleSelection(selectedCircle.circleId, selectedConversation.conversationId);
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Failed to add comment." });
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
              <p className="conversation-meta">Choose a Group or start a new message.</p>
            </div>
            <button className="primary-button" type="button" onClick={() => setComposerOpen(true)}>
              New Message
            </button>
          </div>

          <div className="conversation-list" aria-label="Family groups">
            {circles.length === 0 ? <p className="empty-state">No Groups yet. Start with New Message.</p> : null}
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
              <h2>{selectedCircle?.title ?? "Select a Group"}</h2>
              {selectedCircle ? (
                <p className="conversation-meta">
                  {selectedCircle.members.length} members
                  {selectedCircle.defaultTitle && selectedCircle.defaultTitle !== selectedCircle.title ? ` | Default: ${selectedCircle.defaultTitle}` : ""}
                </p>
              ) : null}
            </div>
            {selectedCircle ? (
              <button className="secondary-button" type="button" onClick={() => setNewTopicOpen((current) => !current)}>
                {newTopicOpen ? "Close Topic" : "New Topic"}
              </button>
            ) : null}
          </div>

          {selectedCircle ? (
            <div className="conversation-create-panel">
              <label className="conversation-my-group-name">
                <span className="field-label">My name for this Group</span>
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
                    placeholder={selectedCircle.defaultTitle || "Family Group"}
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
              {selectedCircle.description ? <p className="conversation-group-description">{selectedCircle.description}</p> : null}
              <div className="conversation-chip-list" aria-label="Group members">
                {selectedCircle.members.map((member) => (
                  <span key={member.personId} className="conversation-chip conversation-chip-static">
                    {member.personId === session.personId ? "You" : member.displayName || member.personId}
                  </span>
                ))}
              </div>
              {selectedCircle.canDelete ? (
                <div className="conversation-toolbar">
                  <button className="secondary-button danger-button" type="button" disabled={busy} onClick={() => void deleteSelectedGroup()}>
                    Delete Group
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {selectedCircle && newTopicOpen ? (
            <div className="conversation-create-panel">
              <label className="field">
                <span className="field-label">Topic name</span>
                <input
                  className="input"
                  value={newConversationTitle}
                  onChange={(event) => setNewConversationTitle(event.target.value)}
                  placeholder="Example: Reunion planning"
                />
              </label>
              <label className="field">
                <span className="field-label">Opening message (optional)</span>
                <textarea
                  className="input conversation-textarea"
                  value={initialMessage}
                  onChange={(event) => setInitialMessage(event.target.value)}
                  placeholder="Start the conversation"
                />
              </label>
              <div className="conversation-toolbar">
                <button className="primary-button" type="button" disabled={busy || !normalize(newConversationTitle)} onClick={() => void createConversation()}>
                  Start Topic
                </button>
              </div>
            </div>
          ) : null}

          <div className="conversation-list" aria-label="Named conversations">
            {selectedCircle && conversations.length === 0 ? <p className="empty-state">No named conversations yet. Use New Topic when you want a separate thread.</p> : null}
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
              {selectedCircle ? <p className="conversation-meta">{selectedCircle.title}</p> : null}
            </div>
          </div>

          {status ? (
            <p className={status.tone === "error" ? "error-text conversation-status" : "conversation-inline-note conversation-status"}>{status.message}</p>
          ) : null}

          {selectedConversation ? (
            <div className="conversation-compose">
              <textarea
                className="input conversation-textarea"
                value={postDraft}
                onChange={(event) => setPostDraft(event.target.value)}
                placeholder="Send a message"
              />
              <div className="conversation-toolbar">
                <button className="primary-button" type="button" disabled={busy || !normalize(postDraft)} onClick={() => void createPost()}>
                  Send
                </button>
              </div>
            </div>
          ) : selectedCircle ? (
            <p className="empty-state">Choose a conversation, or start a new topic in this Group.</p>
          ) : (
            <p className="empty-state">Select a Group to see conversations and messages.</p>
          )}

          <div className="conversation-posts" aria-label="Conversation posts">
            {selectedConversation && posts.length === 0 ? <p className="empty-state">No messages yet.</p> : null}
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
                        onChange={(event) => setCommentDrafts((current) => ({ ...current, [post.postId]: event.target.value }))}
                        placeholder="Reply"
                      />
                      <button className="secondary-button" type="button" disabled={busy || !normalize(commentDrafts[post.postId])} onClick={() => void createComment(post.postId)}>
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

      {composerOpen ? (
        <div className="conversation-modal-backdrop" role="presentation">
          <div className="conversation-modal conversation-modal-wide" role="dialog" aria-modal="true" aria-label="Create a new Group message">
            <div className="conversation-modal-head">
              <div>
                <h2>New Message</h2>
                <p className="conversation-meta">Pick relatives, remove anyone you do not want, then send.</p>
              </div>
              <button type="button" className="account-close" aria-label="Close new message composer" onClick={() => void closeComposer()}>
                x
              </button>
            </div>

            <div className="conversation-modal-section">
              <span className="field-label">Recipients</span>
              <div className="conversation-chip-list">
                <span className="conversation-chip conversation-chip-static">You</span>
                {composerRecipients.map((person) => (
                  <span key={person.personId} className="conversation-chip">
                    <span>{person.displayName}</span>
                    <button type="button" aria-label={`Remove ${person.displayName}`} onClick={() => removeRecipient(person.personId)}>
                      x
                    </button>
                  </span>
                ))}
              </div>
              {composerGroupMatch ? <p className="conversation-inline-note">This exact member set already exists as &quot;{composerGroupMatch.title}&quot;. Send will reuse that Group.</p> : null}
            </div>

            <div className="conversation-modal-section">
              <div className="conversation-relationship-toolbar">
                <span className="field-label">Add by relationship</span>
                <div className="conversation-side-toggle" role="tablist" aria-label="Family side">
                  {(["both", "maternal", "paternal"] as FamilySideFilter[]).map((side) => (
                    <button
                      key={side}
                      type="button"
                      className={`conversation-side-button${composerSideFilter === side ? " is-active" : ""}`}
                      onClick={() => setComposerSideFilter(side)}
                    >
                      {side === "both" ? "Both" : side === "maternal" ? "Maternal" : "Paternal"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="conversation-relationship-pills">
                {relationshipPills.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className="conversation-preset-pill"
                    disabled={option.applicablePersonIds.length === 0}
                    onClick={() => applyRelationship(option.applicablePersonIds, option.label)}
                  >
                    <span>{option.label}</span>
                    <strong>{option.applicablePersonIds.length}</strong>
                  </button>
                ))}
              </div>
            </div>

            <div className="conversation-modal-section">
              <label className="field">
                <span className="field-label">Add people individually</span>
                <input
                  className="input"
                  type="search"
                  value={composerSearch}
                  onChange={(event) => setComposerSearch(event.target.value)}
                  placeholder="Search relatives"
                />
              </label>
              <div className="conversation-people-results">
                {filteredPeople.map((person) => {
                  const selected = composerRecipientIds.includes(person.personId);
                  return (
                    <div key={person.personId} className={`conversation-person-row${selected ? " is-selected" : ""}`}>
                      <span>{person.displayName}</span>
                      <button className="secondary-button" type="button" onClick={() => toggleRecipient(person.personId)}>
                        {selected ? "Remove" : "Add"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="conversation-modal-section">
              <label className="field">
                <span className="field-label">Message</span>
                <textarea
                  className="input conversation-textarea"
                  value={composerMessage}
                  onChange={(event) => setComposerMessage(event.target.value)}
                  placeholder="Write a message"
                />
              </label>
            </div>

            <div className="conversation-modal-section">
              <button type="button" className="secondary-button conversation-advanced-toggle" onClick={() => setComposerAdvancedOpen((current) => !current)}>
                {composerAdvancedOpen ? "Hide options" : "More options"}
              </button>
              {composerAdvancedOpen ? (
                <div className="conversation-advanced-grid">
                  <label className="field">
                    <span className="field-label">Group name (optional)</span>
                    <input className="input" value={composerGroupTitle} onChange={(event) => setComposerGroupTitle(event.target.value)} placeholder={composerAutoGroupTitle || "Family Group"} />
                  </label>
                  <label className="field">
                    <span className="field-label">Conversation name (optional)</span>
                    <input className="input" value={composerConversationTitle} onChange={(event) => setComposerConversationTitle(event.target.value)} placeholder="Only use when you want a separate named conversation" />
                  </label>
                  <label className="field">
                    <span className="field-label">Description (optional)</span>
                    <textarea className="input conversation-description-input" value={composerDescription} onChange={(event) => setComposerDescription(event.target.value)} placeholder="Optional Group description" />
                  </label>
                </div>
              ) : null}
            </div>

            <div className="conversation-modal-actions">
              <button className="secondary-button" type="button" onClick={() => void closeComposer()}>
                Cancel
              </button>
              <button className="primary-button" type="button" disabled={busy || !canSendComposer} onClick={() => void sendNewMessage()}>
                Send
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
