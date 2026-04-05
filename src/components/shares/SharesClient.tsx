"use client";

import { useEffect, useMemo, useState } from "react";
import { ModalCloseButton } from "@/components/ui/primitives";

type SharesClientProps = { tenantKey: string };
type QuickAudienceType = "siblings" | "household" | "entire_family" | "family_group";

type FamilyGroupOption = { familyGroupKey: string; familyGroupName: string };
type PersonOption = { personId: string; displayName: string };
type ThreadMember = { personId: string; displayName: string };

type ShareThread = {
  threadId: string;
  familyGroupKey: string;
  audienceType: "siblings" | "household" | "entire_family" | "family_group" | "custom_group";
  audienceLabel: string;
  createdAt: string;
  lastPostAt: string;
  unreadCount: number;
  latestPost: { caption: string; authorDisplayName: string } | null;
};

type SharePost = {
  postId: string;
  fileId: string;
  caption: string;
  authorPersonId: string;
  authorDisplayName: string;
  authorEmail: string;
  createdAt: string;
  media: { previewUrl?: string; originalUrl?: string; label?: string };
};

type ShareComment = {
  commentId: string;
  postId: string;
  commentText: string;
  createdAt: string;
  author: { personId: string; displayName: string };
};

type MemberColor = {
  chipBg: string;
  chipBorder: string;
  chipText: string;
  bubbleBg: string;
  bubbleBorder: string;
};

const MEMBER_COLORS: MemberColor[] = [
  { chipBg: "#FEF3C7", chipBorder: "#F59E0B", chipText: "#7C2D12", bubbleBg: "#FFFBEB", bubbleBorder: "#FCD34D" },
  { chipBg: "#DBEAFE", chipBorder: "#3B82F6", chipText: "#1E3A8A", bubbleBg: "#EFF6FF", bubbleBorder: "#93C5FD" },
  { chipBg: "#DCFCE7", chipBorder: "#22C55E", chipText: "#14532D", bubbleBg: "#F0FDF4", bubbleBorder: "#86EFAC" },
  { chipBg: "#FCE7F3", chipBorder: "#EC4899", chipText: "#831843", bubbleBg: "#FDF2F8", bubbleBorder: "#F9A8D4" },
  { chipBg: "#F3E8FF", chipBorder: "#A855F7", chipText: "#581C87", bubbleBg: "#FAF5FF", bubbleBorder: "#D8B4FE" },
  { chipBg: "#E0F2FE", chipBorder: "#06B6D4", chipText: "#164E63", bubbleBg: "#ECFEFF", bubbleBorder: "#67E8F9" },
  { chipBg: "#FEE2E2", chipBorder: "#EF4444", chipText: "#7F1D1D", bubbleBg: "#FEF2F2", bubbleBorder: "#FCA5A5" },
  { chipBg: "#E5E7EB", chipBorder: "#6B7280", chipText: "#111827", bubbleBg: "#F9FAFB", bubbleBorder: "#D1D5DB" },
];

function ts(value: string) {
  const parsed = Date.parse(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function dt(value: string) {
  const parsed = ts(value);
  return parsed ? new Date(parsed).toLocaleString() : "";
}

function previewFallback(tenantKey: string, fileId: string) {
  return `/t/${encodeURIComponent(tenantKey)}/viewer/photo/${encodeURIComponent(fileId)}?variant=preview`;
}

async function assertOkWithAuth(res: Response, fallbackMessage: string) {
  if (res.ok) return;
  if (res.status === 401 || res.status === 403) throw new Error("Session expired. Please refresh and sign in again.");
  const body = await res.json().catch(() => null);
  throw new Error(String(body?.message || body?.error || fallbackMessage));
}

export function SharesClient({ tenantKey }: SharesClientProps) {
  const [threads, setThreads] = useState<ShareThread[]>([]);
  const [availableFamilyGroups, setAvailableFamilyGroups] = useState<FamilyGroupOption[]>([]);
  const [peopleOptions, setPeopleOptions] = useState<PersonOption[]>([]);

  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsStatus, setThreadsStatus] = useState("");
  const [threadsRefreshKey, setThreadsRefreshKey] = useState(0);

  const [quickAudienceType, setQuickAudienceType] = useState<QuickAudienceType>("siblings");
  const [quickFamilyGroupKey, setQuickFamilyGroupKey] = useState("");
  const [quickOpenBusy, setQuickOpenBusy] = useState(false);

  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [threadModalOpen, setThreadModalOpen] = useState(false);

  const [createGroupModalOpen, setCreateGroupModalOpen] = useState(false);
  const [customFamilyGroupKey, setCustomFamilyGroupKey] = useState("");
  const [customGroupLabel, setCustomGroupLabel] = useState("");
  const [customMemberPersonIds, setCustomMemberPersonIds] = useState<string[]>([]);
  const [createGroupBusy, setCreateGroupBusy] = useState(false);
  const [createGroupStatus, setCreateGroupStatus] = useState("");

  const [posts, setPosts] = useState<SharePost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsStatus, setPostsStatus] = useState("");
  const [postsRefreshKey, setPostsRefreshKey] = useState(0);
  const [threadMembers, setThreadMembers] = useState<ThreadMember[]>([]);
  const [commentsByPostId, setCommentsByPostId] = useState<Record<string, ShareComment[]>>({});
  const [commentDraftByPostId, setCommentDraftByPostId] = useState<Record<string, string>>({});
  const [commentBusyIds, setCommentBusyIds] = useState<Set<string>>(new Set());
  const [failedPreviewFileIds, setFailedPreviewFileIds] = useState<Set<string>>(new Set());

  const [captionDraft, setCaptionDraft] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedTaggedPersonIds, setSelectedTaggedPersonIds] = useState<string[]>([]);
  const [composeBusy, setComposeBusy] = useState(false);
  const [composeStatus, setComposeStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setThreadsLoading(true);
      setThreadsStatus("");
      try {
        const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/shares/threads?limit=80`, { cache: "no-store" });
        await assertOkWithAuth(res, "Failed to load share threads.");
        const body = (await res.json()) as { threads?: ShareThread[]; availableFamilyGroups?: FamilyGroupOption[] };
        if (cancelled) return;
        const incomingThreads = Array.isArray(body.threads) ? body.threads : [];
        const familyGroups = Array.isArray(body.availableFamilyGroups) ? body.availableFamilyGroups : [];
        setThreads(incomingThreads);
        setAvailableFamilyGroups(familyGroups);
        const defaultFg = String(familyGroups[0]?.familyGroupKey ?? "").trim();
        if (defaultFg) {
          setQuickFamilyGroupKey((current) => current || defaultFg);
          setCustomFamilyGroupKey((current) => current || defaultFg);
        }
        setSelectedThreadId((current) => (incomingThreads.some((entry) => entry.threadId === current) ? current : incomingThreads[0]?.threadId ?? ""));
      } catch (error) {
        if (!cancelled) {
          setThreads([]);
          setThreadsStatus(error instanceof Error ? error.message : "Failed to load share threads.");
        }
      } finally {
        if (!cancelled) setThreadsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantKey, threadsRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/people`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || cancelled) return;
      const items = Array.isArray(body?.items) ? body.items : [];
      setPeopleOptions(
        items
          .map((entry: { personId?: string; displayName?: string }) => ({
            personId: String(entry.personId ?? "").trim(),
            displayName: String(entry.displayName ?? "").trim(),
          }))
          .filter((entry: PersonOption) => entry.personId && entry.displayName)
          .sort((a: PersonOption, b: PersonOption) => a.displayName.localeCompare(b.displayName)),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantKey]);

  useEffect(() => {
    if (!selectedThreadId) {
      setThreadModalOpen(false);
      setPosts([]);
      setCommentsByPostId({});
      setThreadMembers([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      setPostsLoading(true);
      setPostsStatus("");
      try {
        const res = await fetch(
          `/api/t/${encodeURIComponent(tenantKey)}/shares/threads/${encodeURIComponent(selectedThreadId)}/posts?limit=80`,
          { cache: "no-store" },
        );
        await assertOkWithAuth(res, "Failed to load thread posts.");
        const body = (await res.json()) as { posts?: SharePost[]; members?: ThreadMember[] };
        if (cancelled) return;
        const incomingPosts = Array.isArray(body.posts) ? body.posts : [];
        const incomingMembers = Array.isArray(body.members) ? body.members : [];
        setPosts(incomingPosts);
        setThreadMembers(incomingMembers);
        setFailedPreviewFileIds(new Set());
        const commentEntries = await Promise.all(
          incomingPosts.map(async (post) => {
            const commentsRes = await fetch(
              `/api/t/${encodeURIComponent(tenantKey)}/shares/threads/${encodeURIComponent(selectedThreadId)}/posts/${encodeURIComponent(post.postId)}/comments`,
              { cache: "no-store" },
            );
            if (!commentsRes.ok) return [post.postId, []] as const;
            const commentsBody = (await commentsRes.json().catch(() => null)) as { comments?: ShareComment[] } | null;
            const comments = Array.isArray(commentsBody?.comments) ? commentsBody.comments : [];
            comments.sort((a, b) => ts(a.createdAt) - ts(b.createdAt));
            return [post.postId, comments] as const;
          }),
        );
        if (!cancelled) setCommentsByPostId(Object.fromEntries(commentEntries));
      } catch (error) {
        if (!cancelled) {
          setPosts([]);
          setCommentsByPostId({});
          setThreadMembers([]);
          setPostsStatus(error instanceof Error ? error.message : "Failed to load thread posts.");
        }
      } finally {
        if (!cancelled) setPostsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantKey, selectedThreadId, postsRefreshKey]);

  const selectedThread = useMemo(() => threads.find((thread) => thread.threadId === selectedThreadId) ?? null, [threads, selectedThreadId]);
  const orderedThreads = useMemo(
    () => threads.slice().sort((a, b) => ts(b.lastPostAt || b.createdAt) - ts(a.lastPostAt || a.createdAt)),
    [threads],
  );
  const orderedPosts = useMemo(() => posts.slice().sort((a, b) => ts(a.createdAt) - ts(b.createdAt)), [posts]);

  const memberColorByPersonId = useMemo(() => {
    const map = new Map<string, MemberColor>();
    threadMembers.forEach((member, index) => map.set(member.personId, MEMBER_COLORS[index % MEMBER_COLORS.length]));
    return map;
  }, [threadMembers]);

  const getMemberColor = (personId: string) => memberColorByPersonId.get(String(personId ?? "").trim()) ?? MEMBER_COLORS[MEMBER_COLORS.length - 1];

  const openThread = (threadId: string) => {
    setSelectedThreadId(threadId);
    setThreadModalOpen(true);
    setPostsStatus("");
    setComposeStatus("");
  };

  const openQuickAudienceThread = async (audienceType: QuickAudienceType, targetFamilyGroupKey: string) => {
    setQuickOpenBusy(true);
    setThreadsStatus("");
    try {
      const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/shares/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audienceType, targetFamilyGroupKey: audienceType === "family_group" ? targetFamilyGroupKey : "" }),
      });
      await assertOkWithAuth(res, "Failed to open thread.");
      const body = (await res.json()) as { thread?: ShareThread; recipientCount?: number; existingThread?: boolean };
      if (body.thread?.threadId) {
        setSelectedThreadId(body.thread.threadId);
        setThreadModalOpen(true);
      }
      setThreadsStatus(`${body.existingThread ? "Opened existing thread" : "Thread ready"}${typeof body.recipientCount === "number" ? ` (${body.recipientCount} recipients)` : ""}.`);
      setThreadsRefreshKey((current) => current + 1);
      setPostsRefreshKey((current) => current + 1);
    } catch (error) {
      setThreadsStatus(error instanceof Error ? error.message : "Failed to open thread.");
    } finally {
      setQuickOpenBusy(false);
    }
  };

  const createCustomGroupThread = async () => {
    setCreateGroupBusy(true);
    setCreateGroupStatus("");
    try {
      const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/shares/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audienceType: "custom_group",
          targetFamilyGroupKey: customFamilyGroupKey,
          customLabel: customGroupLabel.trim(),
          memberPersonIds: customMemberPersonIds,
        }),
      });
      await assertOkWithAuth(res, "Failed to create group thread.");
      const body = (await res.json()) as { thread?: ShareThread; recipientCount?: number; existingThread?: boolean };
      if (body.thread?.threadId) {
        setSelectedThreadId(body.thread.threadId);
        setThreadModalOpen(true);
      }
      setCreateGroupStatus(
        body.existingThread ? "Group with the same members already exists. Opened existing thread." : `Created group thread${typeof body.recipientCount === "number" ? ` (${body.recipientCount} members)` : ""}.`,
      );
      if (!body.existingThread) setCustomGroupLabel("");
      setCreateGroupModalOpen(false);
      setThreadsRefreshKey((current) => current + 1);
      setPostsRefreshKey((current) => current + 1);
    } catch (error) {
      setCreateGroupStatus(error instanceof Error ? error.message : "Failed to create group thread.");
    } finally {
      setCreateGroupBusy(false);
    }
  };

  const postTextOnly = async () => {
    if (!selectedThreadId || !captionDraft.trim()) return;
    setComposeBusy(true);
    setComposeStatus("");
    try {
      const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/shares/threads/${encodeURIComponent(selectedThreadId)}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: captionDraft.trim() }),
      });
      await assertOkWithAuth(res, "Failed to post message.");
      setCaptionDraft("");
      setComposeStatus("Posted.");
      setThreadsRefreshKey((current) => current + 1);
      setPostsRefreshKey((current) => current + 1);
    } catch (error) {
      setComposeStatus(error instanceof Error ? error.message : "Failed to post message.");
    } finally {
      setComposeBusy(false);
    }
  };

  const uploadMediaPost = async () => {
    if (!selectedThreadId || !selectedFile) return;
    setComposeBusy(true);
    setComposeStatus("");
    try {
      const formData = new FormData();
      formData.set("file", selectedFile);
      formData.set("caption", captionDraft.trim());
      formData.set("taggedPersonIds", JSON.stringify(selectedTaggedPersonIds));
      const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/shares/threads/${encodeURIComponent(selectedThreadId)}/posts/upload`, { method: "POST", body: formData });
      await assertOkWithAuth(res, "Failed to upload media post.");
      setSelectedFile(null);
      setSelectedTaggedPersonIds([]);
      setCaptionDraft("");
      setComposeStatus("Media shared.");
      setThreadsRefreshKey((current) => current + 1);
      setPostsRefreshKey((current) => current + 1);
    } catch (error) {
      setComposeStatus(error instanceof Error ? error.message : "Failed to upload media post.");
    } finally {
      setComposeBusy(false);
    }
  };

  const createComment = async (postId: string) => {
    if (!selectedThreadId) return;
    const draft = String(commentDraftByPostId[postId] ?? "").trim();
    if (!draft) return;
    setCommentBusyIds((current) => new Set(current).add(postId));
    try {
      const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/shares/threads/${encodeURIComponent(selectedThreadId)}/posts/${encodeURIComponent(postId)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentText: draft }),
      });
      await assertOkWithAuth(res, "Failed to post comment.");
      const body = (await res.json()) as { comment?: ShareComment };
      if (body.comment) {
        setCommentsByPostId((current) => {
          const existing = Array.isArray(current[postId]) ? current[postId] : [];
          return { ...current, [postId]: [...existing, body.comment!].sort((a, b) => ts(a.createdAt) - ts(b.createdAt)) };
        });
      }
      setCommentDraftByPostId((current) => ({ ...current, [postId]: "" }));
      setThreadsRefreshKey((current) => current + 1);
    } catch (error) {
      setPostsStatus(error instanceof Error ? error.message : "Failed to post comment.");
    } finally {
      setCommentBusyIds((current) => {
        const next = new Set(current);
        next.delete(postId);
        return next;
      });
    }
  };

  return (
    <main className="section">
      <h1 className="page-title">Family Share</h1>
      <p className="page-subtitle">Share media in ongoing family threads by audience.</p>

      <div style={{ marginTop: "1rem", maxWidth: "480px" }}>
        <section className="card" style={{ display: "grid", gap: "0.75rem", alignContent: "start" }}>
          <h2 style={{ margin: 0 }}>Quick Audience</h2>
          <div>
            <label className="label">Select Audience</label>
            <select
              className="input"
              value={quickAudienceType}
              onChange={(event) => {
                const nextType = event.target.value as QuickAudienceType;
                setQuickAudienceType(nextType);
                if (nextType !== "family_group") {
                  void openQuickAudienceThread(nextType, "");
                } else if (quickFamilyGroupKey) {
                  void openQuickAudienceThread("family_group", quickFamilyGroupKey);
                }
              }}
              disabled={quickOpenBusy}
            >
              <option value="siblings">My Siblings</option>
              <option value="household">Immediate Family</option>
              <option value="entire_family">Entire Family</option>
              <option value="family_group">Specific Family Group</option>
            </select>
          </div>
          {quickAudienceType === "family_group" ? (
            <div>
              <label className="label">Family Group</label>
              <select
                className="input"
                value={quickFamilyGroupKey}
                onChange={(event) => {
                  const nextGroup = event.target.value;
                  setQuickFamilyGroupKey(nextGroup);
                  if (nextGroup) {
                    void openQuickAudienceThread("family_group", nextGroup);
                  }
                }}
                disabled={quickOpenBusy}
              >
                {availableFamilyGroups.map((item) => (
                  <option key={`quick-family-group-${item.familyGroupKey}`} value={item.familyGroupKey}>
                    {item.familyGroupName || item.familyGroupKey}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {threadsStatus ? <p className="page-subtitle" style={{ margin: 0 }}>{threadsStatus}</p> : null}

          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "0.25rem 0" }} />

          <h3 style={{ margin: 0 }}>Threads</h3>
          {threadsLoading ? <p className="page-subtitle" style={{ margin: 0 }}>Loading...</p> : null}
          {!threadsLoading && orderedThreads.length === 0 ? (
            <p className="page-subtitle" style={{ margin: 0 }}>No threads yet. Pick an audience or create a group.</p>
          ) : null}
          <div style={{ display: "grid", gap: "0.5rem", maxHeight: "55vh", overflow: "auto" }}>
            {orderedThreads.map((thread) => {
              const active = thread.threadId === selectedThreadId;
              return (
                <button
                  key={thread.threadId}
                  type="button"
                  className="button secondary tap-button"
                  onClick={() => openThread(thread.threadId)}
                  style={{
                    textAlign: "left",
                    background: active ? "var(--accent-soft)" : undefined,
                    borderColor: active ? "var(--accent)" : undefined,
                    display: "grid",
                    gap: "0.2rem",
                  }}
                >
                  <strong>{thread.audienceLabel || thread.audienceType}</strong>
                  <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                    {thread.latestPost?.authorDisplayName
                      ? `${thread.latestPost.authorDisplayName}: ${thread.latestPost.caption || "Media"}`
                      : "No posts yet"}
                  </span>
                  <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                    {thread.unreadCount > 0 ? `${thread.unreadCount} unread` : "Up to date"}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="button tap-button"
            onClick={() => {
              setCreateGroupStatus("");
              setCreateGroupModalOpen(true);
            }}
          >
            Create New Group
          </button>
          {createGroupStatus ? <p className="page-subtitle" style={{ margin: 0 }}>{createGroupStatus}</p> : null}
        </section>
      </div>

      {createGroupModalOpen ? (
        <div className="person-modal-backdrop" onClick={() => setCreateGroupModalOpen(false)}>
          <div
            className="person-modal-panel"
            style={{ maxWidth: "680px", width: "min(680px, 96vw)", height: "auto", maxHeight: "90vh" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="person-modal-sticky-head">
              <div className="person-modal-header" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", paddingRight: 0 }}>
                <div className="person-modal-header-copy">
                  <h3 className="person-modal-title">Create New Group</h3>
                  <p className="person-modal-meta">Create a custom share group by selecting family members.</p>
                </div>
                <ModalCloseButton className="modal-close-button--floating" onClick={() => setCreateGroupModalOpen(false)} />
              </div>
            </div>
            <div className="person-modal-content">
              <div>
                <label className="label">Group Label</label>
                <input
                  className="input"
                  value={customGroupLabel}
                  onChange={(event) => setCustomGroupLabel(event.target.value)}
                  placeholder="Family Group Chat"
                  disabled={createGroupBusy}
                />
              </div>
              <div>
                <label className="label">Family Group</label>
                <select
                  className="input"
                  value={customFamilyGroupKey}
                  onChange={(event) => setCustomFamilyGroupKey(event.target.value)}
                  disabled={createGroupBusy}
                >
                  {availableFamilyGroups.map((item) => (
                    <option key={`custom-family-group-${item.familyGroupKey}`} value={item.familyGroupKey}>
                      {item.familyGroupName || item.familyGroupKey}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Members</label>
                <select
                  className="input"
                  multiple
                  value={customMemberPersonIds}
                  onChange={(event) => setCustomMemberPersonIds(Array.from(event.target.selectedOptions).map((option) => option.value))}
                  disabled={createGroupBusy}
                  style={{ minHeight: "180px" }}
                >
                  {peopleOptions.map((person) => (
                    <option key={`group-member-${person.personId}`} value={person.personId}>
                      {person.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", flexWrap: "wrap" }}>
                <button type="button" className="button secondary tap-button" onClick={() => setCreateGroupModalOpen(false)} style={{ width: "auto" }}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="button tap-button"
                  onClick={() => void createCustomGroupThread()}
                  disabled={createGroupBusy || !customFamilyGroupKey || customMemberPersonIds.length < 1}
                  style={{ width: "auto" }}
                >
                  {createGroupBusy ? "Creating..." : "Create New Group"}
                </button>
              </div>
              {createGroupStatus ? <p className="page-subtitle" style={{ margin: 0 }}>{createGroupStatus}</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      {threadModalOpen && selectedThread ? (
        <div className="person-modal-backdrop" onClick={() => setThreadModalOpen(false)}>
          <div
            className="person-modal-panel"
            style={{ width: "min(1120px, 98vw)", height: "min(96vh, 980px)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="person-modal-sticky-head">
              <div className="person-modal-header" style={{ gridTemplateColumns: "minmax(0, 1fr) auto auto", paddingRight: 0 }}>
                <div className="person-modal-header-copy">
                  <h3 className="person-modal-title">{selectedThread.audienceLabel || "Thread"}</h3>
                  <p className="person-modal-meta">{selectedThread.familyGroupKey} · {selectedThread.audienceType}</p>
                </div>
                <button
                  type="button"
                  className="button secondary tap-button"
                  onClick={() => setPostsRefreshKey((current) => current + 1)}
                  disabled={postsLoading}
                  style={{ width: "auto" }}
                >
                  {postsLoading ? "Refreshing..." : "Refresh"}
                </button>
                <ModalCloseButton className="modal-close-button--floating" onClick={() => setThreadModalOpen(false)} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", marginTop: "0.75rem" }}>
                {threadMembers.map((member) => {
                  const color = getMemberColor(member.personId);
                  return (
                    <span
                      key={`member-chip-${member.personId}`}
                      style={{
                        border: `1px solid ${color.chipBorder}`,
                        borderRadius: "999px",
                        padding: "0.22rem 0.6rem",
                        fontSize: "0.82rem",
                        background: color.chipBg,
                        color: color.chipText,
                        fontWeight: 700,
                      }}
                    >
                      {member.displayName}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="person-modal-content">
              <div className="card" style={{ margin: 0, display: "grid", gap: "0.55rem" }}>
                <label className="label">Post Message</label>
                <textarea
                  className="input"
                  rows={2}
                  value={captionDraft}
                  onChange={(event) => setCaptionDraft(event.target.value)}
                  placeholder="Share a memory, context, or update..."
                  style={{ resize: "vertical" }}
                  disabled={composeBusy}
                />
                <label className="label">Attach Media (optional)</label>
                <input className="input" type="file" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} disabled={composeBusy} />
                {selectedFile ? (
                  <div>
                    <label className="label">Tag People On This Media</label>
                    <select
                      className="input"
                      multiple
                      value={selectedTaggedPersonIds}
                      onChange={(event) => setSelectedTaggedPersonIds(Array.from(event.target.selectedOptions).map((option) => option.value))}
                      disabled={composeBusy}
                      style={{ minHeight: "120px" }}
                    >
                      {peopleOptions.map((person) => (
                        <option key={`tag-person-${person.personId}`} value={person.personId}>
                          {person.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button type="button" className="button tap-button" onClick={() => void postTextOnly()} disabled={composeBusy || !captionDraft.trim()} style={{ width: "auto" }}>
                    {composeBusy ? "Posting..." : "Post Text"}
                  </button>
                  <button type="button" className="button secondary tap-button" onClick={() => void uploadMediaPost()} disabled={composeBusy || !selectedFile} style={{ width: "auto" }}>
                    {composeBusy ? "Uploading..." : "Upload Media"}
                  </button>
                </div>
                {composeStatus ? <p className="page-subtitle" style={{ margin: 0 }}>{composeStatus}</p> : null}
              </div>

              {postsStatus ? <p className="page-subtitle" style={{ margin: 0 }}>{postsStatus}</p> : null}
              {postsLoading ? <p className="page-subtitle" style={{ margin: 0 }}>Loading posts...</p> : null}
              {!postsLoading && orderedPosts.length === 0 ? (
                <p className="page-subtitle" style={{ margin: 0 }}>No posts in this thread yet.</p>
              ) : null}

              <div style={{ display: "grid", gap: "0.75rem" }}>
                {orderedPosts.map((post) => {
                  const directPreviewUrl = String(post.media?.previewUrl ?? "").trim();
                  const directOriginalUrl = String(post.media?.originalUrl ?? "").trim();
                  const fallback = previewFallback(tenantKey, post.fileId);
                  const previewSrc = (() => {
                    if (!post.fileId) return "";
                    if (!failedPreviewFileIds.has(post.fileId) && directPreviewUrl) return directPreviewUrl;
                    if (!failedPreviewFileIds.has(post.fileId) && directOriginalUrl) return directOriginalUrl;
                    return fallback;
                  })();
                  const postColor = getMemberColor(post.authorPersonId);
                  const comments = Array.isArray(commentsByPostId[post.postId]) ? commentsByPostId[post.postId] : [];
                  return (
                    <article
                      key={post.postId}
                      style={{
                        display: "grid",
                        gap: "0.65rem",
                        borderRadius: "14px",
                        border: `1px solid ${postColor.bubbleBorder}`,
                        background: postColor.bubbleBg,
                        padding: "0.75rem",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", flexWrap: "wrap" }}>
                        <strong>{post.authorDisplayName || post.authorEmail || "Unknown"}</strong>
                        <span className="page-subtitle" style={{ margin: 0, fontSize: "0.83rem" }}>{dt(post.createdAt)}</span>
                      </div>
                      {post.fileId ? (
                        <img
                          src={previewSrc}
                          alt={post.caption || post.media?.label || "Shared media"}
                          style={{
                            width: "100%",
                            maxHeight: "380px",
                            objectFit: "cover",
                            borderRadius: "12px",
                            border: "1px solid var(--line)",
                            background: "#fff",
                          }}
                          onError={() => {
                            if ((directPreviewUrl || directOriginalUrl) && post.fileId) {
                              setFailedPreviewFileIds((current) => {
                                const next = new Set(current);
                                next.add(post.fileId);
                                return next;
                              });
                            }
                          }}
                        />
                      ) : null}
                      {post.caption ? <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{post.caption}</p> : null}

                      <div className="card" style={{ margin: 0, display: "grid", gap: "0.5rem", padding: "0.75rem", background: "#fff" }}>
                        <strong style={{ fontSize: "0.92rem" }}>Comments</strong>
                        {comments.length === 0 ? (
                          <p className="page-subtitle" style={{ margin: 0 }}>No comments yet.</p>
                        ) : (
                          <div style={{ display: "grid", gap: "0.45rem" }}>
                            {comments.map((comment) => {
                              const commentColor = getMemberColor(comment.author.personId);
                              return (
                                <div
                                  key={`comment-${comment.commentId}`}
                                  style={{
                                    border: `1px solid ${commentColor.bubbleBorder}`,
                                    background: commentColor.bubbleBg,
                                    borderRadius: "12px",
                                    padding: "0.45rem 0.55rem",
                                    display: "grid",
                                    gap: "0.2rem",
                                  }}
                                >
                                  <strong style={{ fontSize: "0.85rem" }}>{comment.author.displayName}</strong>
                                  <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{dt(comment.createdAt)}</span>
                                  <span style={{ fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{comment.commentText}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <div style={{ display: "grid", gap: "0.45rem" }}>
                          <textarea
                            className="input"
                            rows={2}
                            value={commentDraftByPostId[post.postId] ?? ""}
                            onChange={(event) => setCommentDraftByPostId((current) => ({ ...current, [post.postId]: event.target.value }))}
                            placeholder="Add a comment..."
                            disabled={commentBusyIds.has(post.postId)}
                            style={{ resize: "vertical" }}
                          />
                          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              className="button tap-button"
                              onClick={() => void createComment(post.postId)}
                              disabled={commentBusyIds.has(post.postId) || !String(commentDraftByPostId[post.postId] ?? "").trim()}
                              style={{ width: "auto" }}
                            >
                              {commentBusyIds.has(post.postId) ? "Posting..." : "Post Comment"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
