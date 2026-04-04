"use client";

import { useEffect, useMemo, useState } from "react";

type SharesClientProps = {
  tenantKey: string;
};

type FamilyGroupOption = {
  familyGroupKey: string;
  familyGroupName: string;
};

type ShareThread = {
  threadId: string;
  familyGroupKey: string;
  audienceType: "siblings" | "household" | "entire_family" | "family_group";
  audienceKey: string;
  audienceLabel: string;
  createdAt: string;
  updatedAt: string;
  lastPostAt: string;
  unreadCount: number;
  latestPost: {
    postId: string;
    fileId: string;
    caption: string;
    createdAt: string;
    authorDisplayName: string;
  } | null;
};

type SharePost = {
  postId: string;
  threadId: string;
  fileId: string;
  caption: string;
  authorPersonId: string;
  authorDisplayName: string;
  authorEmail: string;
  createdAt: string;
  updatedAt: string;
  postStatus: string;
  media: {
    mediaId?: string;
    mediaKind?: string;
    label?: string;
    description?: string;
    photoDate?: string;
    sourceProvider?: string;
    originalObjectKey?: string;
    thumbnailObjectKey?: string;
    previewUrl?: string;
    originalUrl?: string;
  };
};

type ShareComment = {
  commentId: string;
  postId: string;
  threadId: string;
  parentCommentId: string;
  commentText: string;
  createdAt: string;
  updatedAt: string;
  commentStatus: string;
  author: {
    personId: string;
    displayName: string;
    email: string;
  };
};

type ShareCommentNode = ShareComment & { children: ShareCommentNode[] };

type PersonOption = {
  personId: string;
  displayName: string;
};

type AudienceType = "siblings" | "household" | "entire_family" | "family_group";

function parseSortableTimestamp(value: string) {
  const parsed = Date.parse(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateTime(value: string) {
  const parsed = parseSortableTimestamp(value);
  if (!parsed) return "";
  return new Date(parsed).toLocaleString();
}

function viewerPreviewPath(tenantKey: string, fileId: string) {
  return `/t/${encodeURIComponent(tenantKey)}/viewer/photo/${encodeURIComponent(fileId)}?variant=preview`;
}

function authError(res: Response) {
  return res.status === 401 || res.status === 403;
}

async function assertOk(res: Response, fallbackMessage: string) {
  if (res.ok) return;
  const body = await res.json().catch(() => null);
  const message = body?.message || body?.error || fallbackMessage;
  throw new Error(String(message));
}

async function assertOkWithAuth(res: Response, fallbackMessage: string) {
  if (res.ok) return;
  if (authError(res)) {
    throw new Error("Session expired. Please refresh and sign in again.");
  }
  await assertOk(res, fallbackMessage);
}

function buildCommentTree(comments: ShareComment[]): ShareCommentNode[] {
  const byParent = new Map<string, ShareComment[]>();
  for (const comment of comments) {
    const parentId = String(comment.parentCommentId ?? "").trim();
    const key = parentId || "__root__";
    if (!byParent.has(key)) {
      byParent.set(key, []);
    }
    byParent.get(key)!.push(comment);
  }
  for (const rows of byParent.values()) {
    rows.sort((left, right) => parseSortableTimestamp(left.createdAt) - parseSortableTimestamp(right.createdAt));
  }
  const walk = (parentId: string): ShareCommentNode[] => {
    const children = byParent.get(parentId || "__root__") ?? [];
    return children.map((child) => ({ ...child, children: walk(child.commentId) }));
  };
  return walk("");
}

export function SharesClient({ tenantKey }: SharesClientProps) {
  const [threads, setThreads] = useState<ShareThread[]>([]);
  const [availableFamilyGroups, setAvailableFamilyGroups] = useState<FamilyGroupOption[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsStatus, setThreadsStatus] = useState("");
  const [threadsRefreshKey, setThreadsRefreshKey] = useState(0);

  const [audienceType, setAudienceType] = useState<AudienceType>("siblings");
  const [targetFamilyGroupKey, setTargetFamilyGroupKey] = useState("");
  const [createThreadBusy, setCreateThreadBusy] = useState(false);

  const [posts, setPosts] = useState<SharePost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsStatus, setPostsStatus] = useState("");
  const [postsRefreshKey, setPostsRefreshKey] = useState(0);
  const [commentsByPostId, setCommentsByPostId] = useState<Record<string, ShareComment[]>>({});
  const [commentDraftByPostId, setCommentDraftByPostId] = useState<Record<string, string>>({});
  const [commentBusyIds, setCommentBusyIds] = useState<Set<string>>(new Set());

  const [peopleOptions, setPeopleOptions] = useState<PersonOption[]>([]);
  const [selectedTaggedPersonIds, setSelectedTaggedPersonIds] = useState<string[]>([]);

  const [captionDraft, setCaptionDraft] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [composeBusy, setComposeBusy] = useState(false);
  const [composeStatus, setComposeStatus] = useState("");
  const [failedPreviewFileIds, setFailedPreviewFileIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setThreadsLoading(true);
      setThreadsStatus("");
      try {
        const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/shares/threads?limit=80`, { cache: "no-store" });
        await assertOkWithAuth(res, "Failed to load share threads.");
        const body = (await res.json()) as {
          threads?: ShareThread[];
          availableFamilyGroups?: FamilyGroupOption[];
        };
        if (cancelled) return;
        const incomingThreads = Array.isArray(body.threads) ? body.threads : [];
        const familyGroups = Array.isArray(body.availableFamilyGroups) ? body.availableFamilyGroups : [];
        setThreads(incomingThreads);
        setAvailableFamilyGroups(familyGroups);
        if (!targetFamilyGroupKey && familyGroups.length > 0) {
          setTargetFamilyGroupKey(String(familyGroups[0]?.familyGroupKey ?? "").trim().toLowerCase());
        }
        setSelectedThreadId((current) => {
          if (!incomingThreads.some((entry) => entry.threadId === current)) {
            return incomingThreads[0]?.threadId ?? "";
          }
          return current;
        });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Failed to load share threads.";
        setThreadsStatus(message);
        setThreads([]);
      } finally {
        if (!cancelled) {
          setThreadsLoading(false);
        }
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
      const items: Array<{ personId?: string; displayName?: string }> = Array.isArray(body?.items) ? body.items : [];
      setPeopleOptions(
        items
          .map((entry) => ({
            personId: String(entry.personId ?? "").trim(),
            displayName: String(entry.displayName ?? "").trim(),
          }))
          .filter((entry) => entry.personId && entry.displayName)
          .sort((left, right) => left.displayName.localeCompare(right.displayName)),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantKey]);

  useEffect(() => {
    if (!selectedThreadId) {
      setPosts([]);
      setCommentsByPostId({});
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
        const body = (await res.json()) as { posts?: SharePost[] };
        if (cancelled) return;
        const incomingPosts = Array.isArray(body.posts) ? body.posts : [];
        setPosts(incomingPosts);
        setFailedPreviewFileIds(new Set());

        const commentEntries = await Promise.all(
          incomingPosts.map(async (post) => {
            const commentsRes = await fetch(
              `/api/t/${encodeURIComponent(tenantKey)}/shares/threads/${encodeURIComponent(selectedThreadId)}/posts/${encodeURIComponent(post.postId)}/comments`,
              { cache: "no-store" },
            );
            if (!commentsRes.ok) {
              return [post.postId, []] as const;
            }
            const commentsBody = (await commentsRes.json().catch(() => null)) as { comments?: ShareComment[] } | null;
            return [post.postId, Array.isArray(commentsBody?.comments) ? commentsBody!.comments : []] as const;
          }),
        );
        if (!cancelled) {
          setCommentsByPostId(Object.fromEntries(commentEntries));
          void fetch(`/api/t/${encodeURIComponent(tenantKey)}/shares/threads/${encodeURIComponent(selectedThreadId)}/read`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          }).catch(() => undefined);
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Failed to load thread posts.";
        setPostsStatus(message);
        setPosts([]);
        setCommentsByPostId({});
      } finally {
        if (!cancelled) {
          setPostsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantKey, selectedThreadId, postsRefreshKey]);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.threadId === selectedThreadId) ?? null,
    [threads, selectedThreadId],
  );

  const orderedThreads = useMemo(
    () =>
      threads
        .slice()
        .sort((left, right) => parseSortableTimestamp(right.lastPostAt || right.createdAt) - parseSortableTimestamp(left.lastPostAt || left.createdAt)),
    [threads],
  );

  const orderedPosts = useMemo(
    () => posts.slice().sort((left, right) => parseSortableTimestamp(left.createdAt) - parseSortableTimestamp(right.createdAt)),
    [posts],
  );

  const createOrOpenThread = async () => {
    setCreateThreadBusy(true);
    setThreadsStatus("");
    try {
      const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/shares/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audienceType,
          targetFamilyGroupKey: audienceType === "family_group" ? targetFamilyGroupKey : "",
        }),
      });
      await assertOkWithAuth(res, "Failed to open thread.");
      const body = (await res.json()) as { thread?: ShareThread; recipientCount?: number };
      const nextThread = body.thread ?? null;
      if (nextThread?.threadId) {
        setSelectedThreadId(nextThread.threadId);
      }
      setThreadsStatus(
        `Thread ready${typeof body.recipientCount === "number" ? ` (${body.recipientCount} recipients)` : ""}.`,
      );
      setThreadsRefreshKey((current) => current + 1);
      setPostsRefreshKey((current) => current + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open thread.";
      setThreadsStatus(message);
    } finally {
      setCreateThreadBusy(false);
    }
  };

  const postTextOnly = async () => {
    if (!selectedThreadId || !captionDraft.trim()) return;
    setComposeBusy(true);
    setComposeStatus("");
    try {
      const res = await fetch(
        `/api/t/${encodeURIComponent(tenantKey)}/shares/threads/${encodeURIComponent(selectedThreadId)}/posts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caption: captionDraft.trim() }),
        },
      );
      await assertOkWithAuth(res, "Failed to post message.");
      setCaptionDraft("");
      setComposeStatus("Posted.");
      setThreadsRefreshKey((current) => current + 1);
      setPostsRefreshKey((current) => current + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to post message.";
      setComposeStatus(message);
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
      const res = await fetch(
        `/api/t/${encodeURIComponent(tenantKey)}/shares/threads/${encodeURIComponent(selectedThreadId)}/posts/upload`,
        {
          method: "POST",
          body: formData,
        },
      );
      await assertOkWithAuth(res, "Failed to upload media post.");
      setSelectedFile(null);
      setSelectedTaggedPersonIds([]);
      setCaptionDraft("");
      setComposeStatus("Media shared.");
      setThreadsRefreshKey((current) => current + 1);
      setPostsRefreshKey((current) => current + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to upload media post.";
      setComposeStatus(message);
    } finally {
      setComposeBusy(false);
    }
  };

  const createComment = async (postId: string) => {
    if (!selectedThreadId) return;
    const draft = String(commentDraftByPostId[postId] ?? "").trim();
    if (!draft) return;

    setCommentBusyIds((current) => {
      const next = new Set(current);
      next.add(postId);
      return next;
    });
    try {
      const res = await fetch(
        `/api/t/${encodeURIComponent(tenantKey)}/shares/threads/${encodeURIComponent(selectedThreadId)}/posts/${encodeURIComponent(postId)}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commentText: draft }),
        },
      );
      await assertOkWithAuth(res, "Failed to post comment.");
      const body = (await res.json()) as { comment?: ShareComment };
      const nextComment = body.comment ?? null;
      if (nextComment) {
        setCommentsByPostId((current) => {
          const existing = Array.isArray(current[postId]) ? current[postId] : [];
          return { ...current, [postId]: [...existing, nextComment] };
        });
      }
      setCommentDraftByPostId((current) => ({ ...current, [postId]: "" }));
      setThreadsRefreshKey((current) => current + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to post comment.";
      setPostsStatus(message);
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
      <h1 className="page-title">Family Shares</h1>
      <p className="page-subtitle">Share media in ongoing family threads by audience.</p>

      <div className="help-layout" style={{ marginTop: "1rem" }}>
        <section className="card" style={{ display: "grid", gap: "0.75rem", alignContent: "start" }}>
          <h2 style={{ margin: 0 }}>New Thread</h2>
          <div>
            <label className="label">Audience</label>
            <select
              className="input"
              value={audienceType}
              onChange={(event) => setAudienceType(event.target.value as AudienceType)}
              disabled={createThreadBusy}
            >
              <option value="siblings">My Siblings</option>
              <option value="household">My Household</option>
              <option value="entire_family">Entire Family</option>
              <option value="family_group">Specific Family Group</option>
            </select>
          </div>
          {audienceType === "family_group" ? (
            <div>
              <label className="label">Family Group</label>
              <select
                className="input"
                value={targetFamilyGroupKey}
                onChange={(event) => setTargetFamilyGroupKey(event.target.value)}
                disabled={createThreadBusy}
              >
                {availableFamilyGroups.map((item) => (
                  <option key={`family-group-${item.familyGroupKey}`} value={item.familyGroupKey}>
                    {item.familyGroupName || item.familyGroupKey}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <button type="button" className="button tap-button" onClick={() => void createOrOpenThread()} disabled={createThreadBusy}>
            {createThreadBusy ? "Opening..." : "Open Thread"}
          </button>
          {threadsStatus ? <p className="page-subtitle" style={{ margin: 0 }}>{threadsStatus}</p> : null}

          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "0.25rem 0" }} />

          <h3 style={{ margin: 0 }}>Threads</h3>
          {threadsLoading ? <p className="page-subtitle" style={{ margin: 0 }}>Loading...</p> : null}
          {!threadsLoading && orderedThreads.length === 0 ? (
            <p className="page-subtitle" style={{ margin: 0 }}>No threads yet. Open one above.</p>
          ) : null}
          <div style={{ display: "grid", gap: "0.5rem", maxHeight: "55vh", overflow: "auto" }}>
            {orderedThreads.map((thread) => {
              const active = thread.threadId === selectedThreadId;
              return (
                <button
                  key={thread.threadId}
                  type="button"
                  className="button secondary tap-button"
                  onClick={() => setSelectedThreadId(thread.threadId)}
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
        </section>

        <section className="card" style={{ display: "grid", gap: "0.85rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.65rem", flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0 }}>{selectedThread ? selectedThread.audienceLabel || "Thread" : "Select A Thread"}</h2>
              {selectedThread ? (
                <p className="page-subtitle" style={{ margin: "0.3rem 0 0" }}>
                  {selectedThread.familyGroupKey} · {selectedThread.audienceType}
                </p>
              ) : (
                <p className="page-subtitle" style={{ margin: "0.3rem 0 0" }}>Open or pick a thread to post.</p>
              )}
            </div>
            {selectedThread ? (
              <button
                type="button"
                className="button secondary tap-button"
                onClick={() => setPostsRefreshKey((current) => current + 1)}
                disabled={postsLoading}
                style={{ width: "auto" }}
              >
                {postsLoading ? "Refreshing..." : "Refresh"}
              </button>
            ) : null}
          </div>

          {selectedThread ? (
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
              <input
                className="input"
                type="file"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                disabled={composeBusy}
              />
              {selectedFile ? (
                <div>
                  <label className="label">Tag People On This Media</label>
                  <select
                    className="input"
                    multiple
                    value={selectedTaggedPersonIds}
                    onChange={(event) => {
                      const values = Array.from(event.target.selectedOptions).map((option) => option.value);
                      setSelectedTaggedPersonIds(values);
                    }}
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
                <button
                  type="button"
                  className="button tap-button"
                  onClick={() => void postTextOnly()}
                  disabled={composeBusy || !captionDraft.trim()}
                  style={{ width: "auto" }}
                >
                  {composeBusy ? "Posting..." : "Post Text"}
                </button>
                <button
                  type="button"
                  className="button secondary tap-button"
                  onClick={() => void uploadMediaPost()}
                  disabled={composeBusy || !selectedFile}
                  style={{ width: "auto" }}
                >
                  {composeBusy ? "Uploading..." : "Upload Media"}
                </button>
              </div>
              {composeStatus ? <p className="page-subtitle" style={{ margin: 0 }}>{composeStatus}</p> : null}
            </div>
          ) : null}

          {postsStatus ? <p className="page-subtitle" style={{ margin: 0 }}>{postsStatus}</p> : null}
          {postsLoading ? <p className="page-subtitle" style={{ margin: 0 }}>Loading posts...</p> : null}
          {!postsLoading && selectedThread && orderedPosts.length === 0 ? (
            <p className="page-subtitle" style={{ margin: 0 }}>No posts in this thread yet.</p>
          ) : null}

          <div style={{ display: "grid", gap: "0.75rem" }}>
            {orderedPosts.map((post) => {
              const directPreviewUrl = String(post.media?.previewUrl ?? "").trim();
              const directOriginalUrl = String(post.media?.originalUrl ?? "").trim();
              const fallbackPreviewUrl = viewerPreviewPath(tenantKey, post.fileId);
              const previewSrc = (() => {
                if (!post.fileId) return "";
                if (!failedPreviewFileIds.has(post.fileId) && directPreviewUrl) {
                  return directPreviewUrl;
                }
                if (!failedPreviewFileIds.has(post.fileId) && directOriginalUrl) {
                  return directOriginalUrl;
                }
                return fallbackPreviewUrl;
              })();
              const comments = Array.isArray(commentsByPostId[post.postId]) ? commentsByPostId[post.postId] : [];
              const commentTree = buildCommentTree(comments);

              const renderCommentNode = (comment: ShareCommentNode, depth: number) => (
                <div
                  key={`comment-${post.postId}-${comment.commentId}`}
                  style={{
                    marginLeft: depth > 0 ? `${depth * 14}px` : 0,
                    borderLeft: depth > 0 ? "2px solid var(--line)" : "none",
                    paddingLeft: depth > 0 ? "0.55rem" : 0,
                    display: "grid",
                    gap: "0.2rem",
                  }}
                >
                  <strong style={{ fontSize: "0.85rem" }}>{comment.author.displayName}</strong>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{formatDateTime(comment.createdAt)}</span>
                  <span style={{ fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{comment.commentText}</span>
                  {comment.children.length > 0 ? (
                    <div style={{ display: "grid", gap: "0.45rem", marginTop: "0.3rem" }}>
                      {comment.children.map((child) => renderCommentNode(child, depth + 1))}
                    </div>
                  ) : null}
                </div>
              );

              return (
                <article key={post.postId} className="card" style={{ margin: 0, display: "grid", gap: "0.65rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", flexWrap: "wrap" }}>
                    <strong>{post.authorDisplayName || post.authorEmail || "Unknown"}</strong>
                    <span className="page-subtitle" style={{ margin: 0, fontSize: "0.83rem" }}>{formatDateTime(post.createdAt)}</span>
                  </div>
                  {post.fileId ? (
                    <img
                      src={previewSrc}
                      alt={post.caption || post.media?.label || "Shared media"}
                      style={{ width: "100%", maxHeight: "380px", objectFit: "cover", borderRadius: "12px", border: "1px solid var(--line)" }}
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

                  <div className="card" style={{ margin: 0, display: "grid", gap: "0.5rem", padding: "0.75rem" }}>
                    <strong style={{ fontSize: "0.92rem" }}>Comments</strong>
                    {commentTree.length === 0 ? (
                      <p className="page-subtitle" style={{ margin: 0 }}>No comments yet.</p>
                    ) : (
                      <div style={{ display: "grid", gap: "0.5rem" }}>
                        {commentTree.map((comment) => renderCommentNode(comment, 0))}
                      </div>
                    )}
                    <div style={{ display: "grid", gap: "0.45rem" }}>
                      <textarea
                        className="input"
                        rows={2}
                        value={commentDraftByPostId[post.postId] ?? ""}
                        onChange={(event) =>
                          setCommentDraftByPostId((current) => ({ ...current, [post.postId]: event.target.value }))
                        }
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
        </section>
      </div>
    </main>
  );
}
