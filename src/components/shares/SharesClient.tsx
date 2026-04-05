"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ModalCloseButton } from "@/components/ui/primitives";
import { MediaAttachWizard, formatMediaAttachUserSummary } from "@/components/media/MediaAttachWizard";
import type { MediaAttachExecutionSummary } from "@/lib/media/attach-orchestrator";

type SharesClientProps = { tenantKey: string };

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
  conversationId: string;
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

type ShareConversation = {
  conversationId: string;
  threadId: string;
  familyGroupKey: string;
  title: string;
  conversationKind: string;
  ownerPersonId: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  unreadCount: number;
  latestPost: { caption: string; authorDisplayName: string } | null;
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

function sumConversationUnread(conversations: ShareConversation[]) {
  return conversations.reduce((total, entry) => total + Math.max(0, Number(entry.unreadCount ?? 0)), 0);
}

async function assertOkWithAuth(res: Response, fallbackMessage: string) {
  if (res.ok) return;
  if (res.status === 401 || res.status === 403) throw new Error("Session expired. Please refresh and sign in again.");
  const body = await res.json().catch(() => null);
  throw new Error(String(body?.message || body?.error || fallbackMessage));
}

export function SharesClient({ tenantKey }: SharesClientProps) {
  const searchParams = useSearchParams();
  const requestedThreadId = String(searchParams?.get("threadId") ?? "").trim();
  const requestedConversationId = String(searchParams?.get("conversationId") ?? "").trim();
  const [threads, setThreads] = useState<ShareThread[]>([]);
  const [availableFamilyGroups, setAvailableFamilyGroups] = useState<FamilyGroupOption[]>([]);
  const [peopleOptions, setPeopleOptions] = useState<PersonOption[]>([]);
  const [actorPersonId, setActorPersonId] = useState("");
  const [defaultThreadsEnsured, setDefaultThreadsEnsured] = useState(false);

  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsStatus, setThreadsStatus] = useState("");
  const [threadsRefreshKey, setThreadsRefreshKey] = useState(0);
  const [routeSelectionApplied, setRouteSelectionApplied] = useState(false);

  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [threadModalOpen, setThreadModalOpen] = useState(false);
  const [conversations, setConversations] = useState<ShareConversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [conversationsStatus, setConversationsStatus] = useState("");
  const [conversationsRefreshKey, setConversationsRefreshKey] = useState(0);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [conversationModalOpen, setConversationModalOpen] = useState(false);
  const [createConversationModalOpen, setCreateConversationModalOpen] = useState(false);
  const [newConversationTitle, setNewConversationTitle] = useState("");
  const [newConversationMessage, setNewConversationMessage] = useState("");
  const [newConversationFileIds, setNewConversationFileIds] = useState<string[]>([]);
  const [newConversationAttachSummary, setNewConversationAttachSummary] = useState("");
  const [createConversationBusy, setCreateConversationBusy] = useState(false);
  const [createConversationStatus, setCreateConversationStatus] = useState("");
  const [createConversationAttachOpen, setCreateConversationAttachOpen] = useState(false);

  const [createGroupModalOpen, setCreateGroupModalOpen] = useState(false);
  const [customFamilyGroupKey, setCustomFamilyGroupKey] = useState("");
  const [customGroupLabel, setCustomGroupLabel] = useState("");
  const [customMemberPersonIds, setCustomMemberPersonIds] = useState<string[]>([]);
  const [memberSearchDraft, setMemberSearchDraft] = useState("");
  const [seedThreadId, setSeedThreadId] = useState("");
  const [seedLoadBusy, setSeedLoadBusy] = useState(false);
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
  const [shareAttachOpen, setShareAttachOpen] = useState(false);
  const [composeBusy, setComposeBusy] = useState(false);
  const [composeStatus, setComposeStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setThreadsLoading(true);
      setThreadsStatus("");
      try {
        const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/shares/threads?limit=200`, { cache: "no-store" });
        await assertOkWithAuth(res, "Failed to load share threads.");
        const body = (await res.json()) as {
          actorPersonId?: string;
          threads?: ShareThread[];
          availableFamilyGroups?: FamilyGroupOption[];
        };
        if (cancelled) return;
        setActorPersonId(String(body.actorPersonId ?? "").trim());
        const incomingThreads = Array.isArray(body.threads) ? body.threads : [];
        const familyGroups = Array.isArray(body.availableFamilyGroups) ? body.availableFamilyGroups : [];
        setThreads(incomingThreads);
        setAvailableFamilyGroups(familyGroups);
        const defaultFg = String(familyGroups[0]?.familyGroupKey ?? "").trim();
        if (defaultFg) {
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
    setDefaultThreadsEnsured(false);
    setRouteSelectionApplied(false);
  }, [tenantKey]);

  useEffect(() => {
    if (defaultThreadsEnsured) return;
    if (threadsLoading) return;
    if (availableFamilyGroups.length === 0) return;

    let cancelled = false;
    void (async () => {
      setDefaultThreadsEnsured(true);
      const requests: Array<{ audienceType: "siblings" | "household" | "entire_family" | "family_group"; targetFamilyGroupKey?: string }> = [
        { audienceType: "siblings" },
        { audienceType: "household" },
        { audienceType: "entire_family" },
        ...availableFamilyGroups.map((entry) => ({
          audienceType: "family_group" as const,
          targetFamilyGroupKey: String(entry.familyGroupKey ?? "").trim().toLowerCase(),
        })),
      ];
      let createdCount = 0;
      for (const request of requests) {
        try {
          const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/shares/threads`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              audienceType: request.audienceType,
              targetFamilyGroupKey: request.audienceType === "family_group" ? request.targetFamilyGroupKey ?? "" : "",
            }),
          });
          if (!res.ok) continue;
          const body = (await res.json().catch(() => null)) as { existingThread?: boolean } | null;
          if (!body?.existingThread) {
            createdCount += 1;
          }
        } catch {
          // Skip failed default thread seeds and keep rendering existing threads.
        }
      }
      if (!cancelled && createdCount > 0) {
        setThreadsRefreshKey((current) => current + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [defaultThreadsEnsured, threadsLoading, availableFamilyGroups, tenantKey]);

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
    if (routeSelectionApplied || threadsLoading) {
      return;
    }
    if (threads.length === 0) {
      setRouteSelectionApplied(true);
      return;
    }
    setRouteSelectionApplied(true);
    if (!requestedThreadId) {
      return;
    }
    const requestedThread = threads.find((entry) => entry.threadId === requestedThreadId);
    if (!requestedThread) {
      return;
    }
    setSelectedThreadId(requestedThread.threadId);
    setSelectedConversationId(requestedConversationId);
    setThreadModalOpen(true);
    setConversationModalOpen(Boolean(requestedConversationId));
    setConversationsRefreshKey((current) => current + 1);
    setPostsRefreshKey((current) => current + 1);
  }, [requestedConversationId, requestedThreadId, routeSelectionApplied, threads, threadsLoading]);

  useEffect(() => {
    if (!selectedThreadId) {
      setConversations([]);
      setThreadMembers([]);
      setSelectedConversationId("");
      setConversationModalOpen(false);
      setConversationsStatus("");
      setPosts([]);
      setCommentsByPostId({});
      return;
    }
    let cancelled = false;
    void (async () => {
      setConversationsLoading(true);
      setConversationsStatus("");
      try {
        const [conversationRes, membersRes] = await Promise.all([
          fetch(
            `/api/t/${encodeURIComponent(tenantKey)}/shares/threads/${encodeURIComponent(selectedThreadId)}/conversations`,
            { cache: "no-store" },
          ),
          fetch(
            `/api/t/${encodeURIComponent(tenantKey)}/shares/threads/${encodeURIComponent(selectedThreadId)}/posts?limit=1`,
            { cache: "no-store" },
          ),
        ]);
        await assertOkWithAuth(conversationRes, "Failed to load conversations.");
        await assertOkWithAuth(membersRes, "Failed to load thread members.");
        const conversationBody = (await conversationRes.json()) as {
          conversations?: ShareConversation[];
          defaultConversationId?: string;
        };
        const membersBody = (await membersRes.json()) as {
          members?: ThreadMember[];
        };
        if (cancelled) return;
        const incomingConversations = Array.isArray(conversationBody.conversations) ? conversationBody.conversations : [];
        const incomingMembers = Array.isArray(membersBody.members) ? membersBody.members : [];
        const requestedId =
          selectedThreadId === requestedThreadId
            ? requestedConversationId
            : "";

        setConversations(incomingConversations);
        setThreadMembers(incomingMembers);
        setThreads((current) =>
          current.map((thread) =>
            thread.threadId === selectedThreadId
              ? { ...thread, unreadCount: sumConversationUnread(incomingConversations) }
              : thread,
          ),
        );
        setSelectedConversationId((current) => {
          const choices = [
            current,
            requestedId,
          ].map((entry) => String(entry ?? "").trim()).filter(Boolean);
          const next = choices.find((candidate) =>
            incomingConversations.some((conversation) => conversation.conversationId === candidate),
          );
          return next ?? "";
        });
      } catch (error) {
        if (!cancelled) {
          setConversations([]);
          setThreadMembers([]);
          setSelectedConversationId("");
          setConversationsStatus(error instanceof Error ? error.message : "Failed to load conversations.");
        }
      } finally {
        if (!cancelled) setConversationsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationsRefreshKey, requestedConversationId, requestedThreadId, selectedThreadId, tenantKey]);

  const selectedConversationKnown = conversations.some(
    (entry) => entry.conversationId === selectedConversationId,
  );

  useEffect(() => {
    if (!selectedThreadId || !selectedConversationId || !selectedConversationKnown) {
      setPosts([]);
      setCommentsByPostId({});
      setPostsStatus("");
      return;
    }
    let cancelled = false;
    void (async () => {
      setPostsLoading(true);
      setPostsStatus("");
      try {
        const postsRes = await fetch(
          `/api/t/${encodeURIComponent(tenantKey)}/shares/threads/${encodeURIComponent(selectedThreadId)}/posts?limit=120&conversationId=${encodeURIComponent(selectedConversationId)}`,
          { cache: "no-store" },
        );
        await assertOkWithAuth(postsRes, "Failed to load conversation posts.");
        const body = (await postsRes.json()) as { posts?: SharePost[]; members?: ThreadMember[] };
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
        if (!cancelled) {
          setCommentsByPostId(Object.fromEntries(commentEntries));
        }
        const markReadRes = await fetch(
          `/api/t/${encodeURIComponent(tenantKey)}/shares/threads/${encodeURIComponent(selectedThreadId)}/conversations/${encodeURIComponent(selectedConversationId)}/read`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
        );
        if (!markReadRes.ok || cancelled) {
          return;
        }
        setConversations((current) => {
          const next = current.map((entry) =>
            entry.conversationId === selectedConversationId ? { ...entry, unreadCount: 0 } : entry,
          );
          setThreads((threadsCurrent) =>
            threadsCurrent.map((thread) =>
              thread.threadId === selectedThreadId
                ? { ...thread, unreadCount: sumConversationUnread(next) }
                : thread,
            ),
          );
          return next;
        });
      } catch (error) {
        if (!cancelled) {
          setPosts([]);
          setCommentsByPostId({});
          setPostsStatus(error instanceof Error ? error.message : "Failed to load conversation posts.");
        }
      } finally {
        if (!cancelled) setPostsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postsRefreshKey, selectedConversationId, selectedConversationKnown, selectedThreadId, tenantKey]);

  const selectedThread = useMemo(() => threads.find((thread) => thread.threadId === selectedThreadId) ?? null, [threads, selectedThreadId]);
  const orderedThreads = useMemo(
    () => threads.slice().sort((a, b) => ts(b.lastPostAt || b.createdAt) - ts(a.lastPostAt || a.createdAt)),
    [threads],
  );
  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.conversationId === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );
  const orderedConversations = useMemo(
    () =>
      conversations
        .slice()
        .sort((a, b) => ts(b.lastActivityAt || b.createdAt) - ts(a.lastActivityAt || a.createdAt)),
    [conversations],
  );
  const orderedPosts = useMemo(() => posts.slice().sort((a, b) => ts(a.createdAt) - ts(b.createdAt)), [posts]);
  const attachPreselectedPersonIds = useMemo(
    () =>
      Array.from(
        new Set(
          threadMembers
            .map((member) => String(member.personId ?? "").trim())
            .filter(Boolean),
        ),
      ),
    [threadMembers],
  );

  const memberColorByPersonId = useMemo(() => {
    const map = new Map<string, MemberColor>();
    threadMembers.forEach((member, index) => map.set(member.personId, MEMBER_COLORS[index % MEMBER_COLORS.length]));
    return map;
  }, [threadMembers]);

  const getMemberColor = (personId: string) => memberColorByPersonId.get(String(personId ?? "").trim()) ?? MEMBER_COLORS[MEMBER_COLORS.length - 1];
  const peopleById = useMemo(() => {
    return new Map(peopleOptions.map((entry) => [entry.personId, entry.displayName] as const));
  }, [peopleOptions]);
  const filteredMemberSearchResults = useMemo(() => {
    const query = memberSearchDraft.trim().toLowerCase();
    if (!query) return [] as PersonOption[];
    const selected = new Set(customMemberPersonIds);
    return peopleOptions
      .filter((person) => !selected.has(person.personId))
      .filter((person) => person.displayName.toLowerCase().includes(query))
      .slice(0, 12);
  }, [peopleOptions, customMemberPersonIds, memberSearchDraft]);

  const openThread = (threadId: string, conversationId = "") => {
    setSelectedThreadId(threadId);
    setSelectedConversationId(conversationId.trim());
    setThreadModalOpen(true);
    setConversationModalOpen(Boolean(conversationId.trim()));
    setConversationsStatus("");
    setPostsStatus("");
    setComposeStatus("");
    setCreateConversationStatus("");
    setConversationsRefreshKey((current) => current + 1);
    setPostsRefreshKey((current) => current + 1);
  };

  const openCreateConversationModal = () => {
    setCreateConversationStatus("");
    setNewConversationTitle("");
    setNewConversationMessage("");
    setNewConversationFileIds([]);
    setNewConversationAttachSummary("");
    setCreateConversationModalOpen(true);
  };

  const selectConversation = (conversationId: string) => {
    const normalized = conversationId.trim();
    if (!normalized) return;
    setSelectedConversationId(normalized);
    setConversationModalOpen(true);
    setComposeStatus("");
    setPostsStatus("");
    setPostsRefreshKey((current) => current + 1);
  };

  const addPersonToCustomGroup = (personId: string) => {
    const normalized = String(personId ?? "").trim();
    if (!normalized) return;
    setCustomMemberPersonIds((current) => {
      if (current.includes(normalized)) return current;
      return [...current, normalized];
    });
    setMemberSearchDraft("");
  };

  const removePersonFromCustomGroup = (personId: string) => {
    setCustomMemberPersonIds((current) => current.filter((entry) => entry !== personId));
  };

  const loadSeedShareGroupMembers = async () => {
    if (!seedThreadId) return;
    setSeedLoadBusy(true);
    setCreateGroupStatus("");
    try {
      const selectedSeedThread = orderedThreads.find((entry) => entry.threadId === seedThreadId) ?? null;
      if (!selectedSeedThread) {
        throw new Error("Select a valid share group.");
      }
      const res = await fetch(
        `/api/t/${encodeURIComponent(tenantKey)}/shares/threads/${encodeURIComponent(seedThreadId)}/posts?limit=1`,
        { cache: "no-store" },
      );
      await assertOkWithAuth(res, "Failed to load share group members.");
      const body = (await res.json()) as {
        members?: Array<{ personId?: string }>;
      };
      const nextMembers = Array.isArray(body.members)
        ? Array.from(
            new Set(
              body.members
                .map((entry) => String(entry.personId ?? "").trim())
                .filter(Boolean),
            ),
          )
        : [];
      if (nextMembers.length > 0) {
        setCustomMemberPersonIds(nextMembers);
      }
      setCustomFamilyGroupKey(selectedSeedThread.familyGroupKey);
      setCreateGroupStatus(
        `Loaded ${nextMembers.length} members from share group "${selectedSeedThread.audienceLabel || selectedSeedThread.audienceType}".`,
      );
    } catch (error) {
      setCreateGroupStatus(error instanceof Error ? error.message : "Failed to load share group members.");
    } finally {
      setSeedLoadBusy(false);
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
        openThread(body.thread.threadId);
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

  const createConversationWithOptionalContent = async () => {
    if (!selectedThreadId) return;
    const title = newConversationTitle.trim();
    if (!title) {
      setCreateConversationStatus("Conversation title is required.");
      return;
    }
    setCreateConversationBusy(true);
    setCreateConversationStatus("");
    try {
      const createRes = await fetch(
        `/api/t/${encodeURIComponent(tenantKey)}/shares/threads/${encodeURIComponent(selectedThreadId)}/conversations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        },
      );
      await assertOkWithAuth(createRes, "Failed to create conversation.");
      const createBody = (await createRes.json()) as {
        conversation?: { conversationId?: string; title?: string };
      };
      const conversationId = String(createBody.conversation?.conversationId ?? "").trim();
      if (!conversationId) {
        throw new Error("Conversation was created but no conversation ID was returned.");
      }

      const message = newConversationMessage.trim();
      if (message) {
        const postRes = await fetch(
          `/api/t/${encodeURIComponent(tenantKey)}/shares/threads/${encodeURIComponent(selectedThreadId)}/posts`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId, caption: message }),
          },
        );
        await assertOkWithAuth(postRes, "Failed to add initial conversation message.");
      }

      for (const fileId of newConversationFileIds) {
        const postRes = await fetch(
          `/api/t/${encodeURIComponent(tenantKey)}/shares/threads/${encodeURIComponent(selectedThreadId)}/posts`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId, fileId, caption: "" }),
          },
        );
        await assertOkWithAuth(postRes, "Failed to add initial conversation media.");
      }

      setCreateConversationModalOpen(false);
      setNewConversationTitle("");
      setNewConversationMessage("");
      setNewConversationFileIds([]);
      setNewConversationAttachSummary("");
      setSelectedConversationId(conversationId);
      setConversationModalOpen(true);
      setThreadModalOpen(true);
      setThreadsRefreshKey((current) => current + 1);
      setConversationsRefreshKey((current) => current + 1);
      setPostsRefreshKey((current) => current + 1);
      setComposeStatus("Conversation created.");
    } catch (error) {
      setCreateConversationStatus(error instanceof Error ? error.message : "Failed to create conversation.");
    } finally {
      setCreateConversationBusy(false);
    }
  };

  const handleNewConversationAttachComplete = (summary: MediaAttachExecutionSummary) => {
    setCreateConversationAttachOpen(false);
    const uploadedFileIds = Array.isArray(summary.fileIds)
      ? summary.fileIds.map((entry) => String(entry ?? "").trim()).filter(Boolean)
      : [];
    if (uploadedFileIds.length > 0) {
      setNewConversationFileIds((current) => {
        const next = new Set(current);
        for (const fileId of uploadedFileIds) {
          next.add(fileId);
        }
        return Array.from(next);
      });
    }
    setNewConversationAttachSummary(formatMediaAttachUserSummary(summary));
  };

  const postTextOnly = async () => {
    if (!selectedThreadId || !selectedConversationId || !captionDraft.trim()) return;
    setComposeBusy(true);
    setComposeStatus("");
    try {
      const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/shares/threads/${encodeURIComponent(selectedThreadId)}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: selectedConversationId,
          caption: captionDraft.trim(),
        }),
      });
      await assertOkWithAuth(res, "Failed to post message.");
      setCaptionDraft("");
      setComposeStatus("Posted.");
      setThreadsRefreshKey((current) => current + 1);
      setConversationsRefreshKey((current) => current + 1);
      setPostsRefreshKey((current) => current + 1);
    } catch (error) {
      setComposeStatus(error instanceof Error ? error.message : "Failed to post message.");
    } finally {
      setComposeBusy(false);
    }
  };

  const handleShareAttachComplete = async (summary: MediaAttachExecutionSummary) => {
    setShareAttachOpen(false);
    const uploadedFileIds = Array.isArray(summary.fileIds) ? summary.fileIds : [];
    if (!selectedThreadId || !selectedConversationId || uploadedFileIds.length === 0) {
      setComposeStatus(formatMediaAttachUserSummary(summary));
      return;
    }
    setComposeBusy(true);
    setComposeStatus("Posting shared media...");
    try {
      const caption = captionDraft.trim();
      for (let index = 0; index < uploadedFileIds.length; index += 1) {
        const fileId = uploadedFileIds[index];
        const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/shares/threads/${encodeURIComponent(selectedThreadId)}/posts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: selectedConversationId,
            fileId,
            caption: index === 0 ? caption : "",
          }),
        });
        await assertOkWithAuth(res, "Failed to post attached media.");
      }
      setCaptionDraft("");
      setComposeStatus(`Media shared (${uploadedFileIds.length}).`);
      setThreadsRefreshKey((current) => current + 1);
      setConversationsRefreshKey((current) => current + 1);
      setPostsRefreshKey((current) => current + 1);
    } catch (error) {
      setComposeStatus(error instanceof Error ? error.message : "Failed to share attached media.");
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
        const activityAt = String(body.comment.createdAt ?? "").trim() || new Date().toISOString();
        setCommentsByPostId((current) => {
          const existing = Array.isArray(current[postId]) ? current[postId] : [];
          return { ...current, [postId]: [...existing, body.comment!].sort((a, b) => ts(a.createdAt) - ts(b.createdAt)) };
        });
        setConversations((current) => {
          const next = current.map((entry) =>
            entry.conversationId === selectedConversationId
              ? {
                  ...entry,
                  lastActivityAt: activityAt,
                  unreadCount: 0,
                }
              : entry,
          );
          setThreads((threadsCurrent) =>
            threadsCurrent.map((thread) =>
              thread.threadId === selectedThreadId
                ? {
                    ...thread,
                    lastPostAt: activityAt,
                    unreadCount: sumConversationUnread(next),
                  }
                : thread,
            ),
          );
          return next;
        });
      }
      setCommentDraftByPostId((current) => ({ ...current, [postId]: "" }));
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
      <p className="page-subtitle">Share media in ongoing groups with distinct conversation topics.</p>

      <div style={{ marginTop: "1rem", maxWidth: "480px" }}>
        <section className="card" style={{ display: "grid", gap: "0.75rem", alignContent: "start" }}>
          <h2 style={{ margin: 0 }}>Share Groups</h2>
          <p className="page-subtitle" style={{ margin: 0 }}>
            All threads you belong to.
          </p>
          {threadsStatus ? <p className="page-subtitle" style={{ margin: 0 }}>{threadsStatus}</p> : null}
          {threadsLoading ? <p className="page-subtitle" style={{ margin: 0 }}>Loading...</p> : null}
          {!threadsLoading && orderedThreads.length === 0 ? (
            <p className="page-subtitle" style={{ margin: 0 }}>No threads yet.</p>
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
                    gap: "0.3rem",
                  }}
                >
                  <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
                    <strong>{thread.audienceLabel || thread.audienceType}</strong>
                    <span
                      style={{
                        minWidth: "1.7rem",
                        height: "1.4rem",
                        borderRadius: "999px",
                        border: "1px solid var(--line)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.76rem",
                        fontWeight: 700,
                        background: thread.unreadCount > 0 ? "var(--accent-soft)" : "var(--surface-muted)",
                        color: thread.unreadCount > 0 ? "var(--accent-strong)" : "var(--text-muted)",
                      }}
                    >
                      {thread.unreadCount}
                    </span>
                  </span>
                  <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                    {thread.latestPost?.authorDisplayName
                      ? `${thread.latestPost.authorDisplayName}: ${thread.latestPost.caption || "Media"}`
                      : "No posts yet"}
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
              setMemberSearchDraft("");
              setSeedThreadId(selectedThreadId || orderedThreads[0]?.threadId || "");
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
                <label className="label">Start From Share Group (Optional)</label>
                <div style={{ display: "grid", gap: "0.45rem" }}>
                  <select
                    className="input"
                    value={seedThreadId}
                    onChange={(event) => setSeedThreadId(event.target.value)}
                    disabled={createGroupBusy || seedLoadBusy}
                  >
                    <option value="">Select thread</option>
                    {orderedThreads.map((thread) => (
                      <option key={`seed-thread-${thread.threadId}`} value={thread.threadId}>
                        {(thread.audienceLabel || thread.audienceType) + " - " + thread.familyGroupKey}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="button secondary tap-button"
                    onClick={() => void loadSeedShareGroupMembers()}
                    disabled={createGroupBusy || seedLoadBusy || !seedThreadId}
                    style={{ width: "auto" }}
                  >
                    {seedLoadBusy ? "Loading..." : "Load Share Group"}
                  </button>
                </div>
              </div>
              <div>
                <label className="label">Members</label>
                <input
                  className="input"
                  value={memberSearchDraft}
                  onChange={(event) => setMemberSearchDraft(event.target.value)}
                  placeholder="Search people to add..."
                  disabled={createGroupBusy}
                />
                {filteredMemberSearchResults.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.45rem" }}>
                    {filteredMemberSearchResults.map((person) => (
                      <button
                        key={`add-member-${person.personId}`}
                        type="button"
                        className="button secondary tap-button"
                        onClick={() => addPersonToCustomGroup(person.personId)}
                        disabled={createGroupBusy}
                        style={{ width: "auto", minHeight: "30px", padding: "0 0.55rem", fontSize: "0.82rem" }}
                      >
                        + {person.displayName}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div
                  style={{
                    marginTop: "0.6rem",
                    border: "1px solid var(--line)",
                    borderRadius: "12px",
                    minHeight: "72px",
                    padding: "0.45rem",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.35rem",
                    background: "var(--surface-muted)",
                  }}
                >
                  {customMemberPersonIds.length === 0 ? (
                    <span className="page-subtitle" style={{ margin: 0, alignSelf: "center" }}>
                      No members selected.
                    </span>
                  ) : (
                    customMemberPersonIds.map((personId) => (
                      <span
                        key={`selected-member-${personId}`}
                        style={{
                          border: "1px solid var(--line)",
                          borderRadius: "999px",
                          background: "#fff",
                          padding: "0.15rem 0.25rem 0.15rem 0.55rem",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.35rem",
                          fontSize: "0.82rem",
                          fontWeight: 600,
                        }}
                      >
                        <span>{peopleById.get(personId) ?? personId}</span>
                        <button
                          type="button"
                          className="button secondary tap-button"
                          onClick={() => removePersonFromCustomGroup(personId)}
                          disabled={createGroupBusy}
                          style={{ width: "auto", minHeight: "24px", padding: "0 0.35rem", fontSize: "0.72rem" }}
                          aria-label={`Remove ${peopleById.get(personId) ?? personId}`}
                        >
                          X
                        </button>
                      </span>
                    ))
                  )}
                </div>
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

      {createConversationModalOpen && selectedThread ? (
        <div className="person-modal-backdrop" onClick={() => setCreateConversationModalOpen(false)}>
          <div
            className="person-modal-panel"
            style={{ maxWidth: "760px", width: "min(760px, 96vw)", height: "auto", maxHeight: "90vh" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="person-modal-sticky-head">
              <div className="person-modal-header" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", paddingRight: 0 }}>
                <div className="person-modal-header-copy">
                  <h3 className="person-modal-title">New Conversation</h3>
                  <p className="person-modal-meta">{selectedThread.audienceLabel || selectedThread.audienceType}</p>
                </div>
                <ModalCloseButton className="modal-close-button--floating" onClick={() => setCreateConversationModalOpen(false)} />
              </div>
            </div>
            <div className="person-modal-content">
              <div style={{ display: "grid", gap: "0.65rem" }}>
                <div>
                  <label className="label">Title (required)</label>
                  <input
                    className="input"
                    value={newConversationTitle}
                    onChange={(event) => setNewConversationTitle(event.target.value)}
                    placeholder="Sunday Memories"
                    disabled={createConversationBusy}
                  />
                </div>
                <div>
                  <label className="label">Initial Message (optional)</label>
                  <textarea
                    className="input"
                    rows={3}
                    value={newConversationMessage}
                    onChange={(event) => setNewConversationMessage(event.target.value)}
                    placeholder="Add context or a note for this conversation..."
                    style={{ resize: "vertical" }}
                    disabled={createConversationBusy}
                  />
                </div>
                <div style={{ display: "grid", gap: "0.45rem" }}>
                  <label className="label">Initial Media (optional)</label>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      type="button"
                      className="button secondary tap-button"
                      onClick={() => setCreateConversationAttachOpen(true)}
                      disabled={createConversationBusy}
                      style={{ width: "auto" }}
                    >
                      Choose File
                    </button>
                    <span className="page-subtitle" style={{ margin: 0 }}>
                      {newConversationFileIds.length > 0
                        ? `${newConversationFileIds.length} file(s) selected`
                        : "No files selected"}
                    </span>
                  </div>
                  {newConversationAttachSummary ? (
                    <p className="page-subtitle" style={{ margin: 0 }}>{newConversationAttachSummary}</p>
                  ) : null}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                <button
                  type="button"
                  className="button secondary tap-button"
                  onClick={() => setCreateConversationModalOpen(false)}
                  style={{ width: "auto" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="button tap-button"
                  onClick={() => void createConversationWithOptionalContent()}
                  disabled={createConversationBusy || !newConversationTitle.trim()}
                  style={{ width: "auto" }}
                >
                  {createConversationBusy ? "Creating..." : "Create Conversation"}
                </button>
              </div>
              {createConversationStatus ? <p className="page-subtitle" style={{ margin: 0 }}>{createConversationStatus}</p> : null}
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
                  <h3 className="person-modal-title">{selectedThread.audienceLabel || "Share Group"}</h3>
                  <p className="person-modal-meta">{selectedThread.familyGroupKey} - {selectedThread.audienceType}</p>
                </div>
                <button
                  type="button"
                  className="button secondary tap-button"
                  onClick={() => {
                    setConversationsRefreshKey((current) => current + 1);
                    setPostsRefreshKey((current) => current + 1);
                  }}
                  disabled={postsLoading || conversationsLoading}
                  style={{ width: "auto" }}
                >
                  {postsLoading || conversationsLoading ? "Refreshing..." : "Refresh"}
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
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                  <label className="label" style={{ marginBottom: 0 }}>Conversations</label>
                  <button
                    type="button"
                    className="button secondary tap-button"
                    onClick={openCreateConversationModal}
                    disabled={!selectedThreadId}
                    style={{ width: "auto" }}
                  >
                    New Conversation
                  </button>
                </div>
                {conversationsStatus ? <p className="page-subtitle" style={{ margin: 0 }}>{conversationsStatus}</p> : null}
                {conversationsLoading ? <p className="page-subtitle" style={{ margin: 0 }}>Loading conversations...</p> : null}
                {!conversationsLoading && orderedConversations.length === 0 ? (
                  <p className="page-subtitle" style={{ margin: 0 }}>No conversations in this share group yet.</p>
                ) : null}
                <div style={{ display: "grid", gap: "0.45rem", maxHeight: "240px", overflow: "auto" }}>
                  {orderedConversations.map((conversation) => {
                    const active = conversation.conversationId === selectedConversationId;
                    return (
                      <button
                        key={`conversation-${conversation.conversationId}`}
                        type="button"
                        className="button secondary tap-button"
                        onClick={() => selectConversation(conversation.conversationId)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          display: "grid",
                          gap: "0.28rem",
                          background: active ? "var(--accent-soft)" : undefined,
                          borderColor: active ? "var(--accent)" : undefined,
                        }}
                      >
                        <span style={{ display: "flex", justifyContent: "space-between", gap: "0.45rem", alignItems: "center" }}>
                          <strong>{conversation.title || "Conversation"}</strong>
                          <span
                            style={{
                              minWidth: "1.7rem",
                              height: "1.35rem",
                              borderRadius: "999px",
                              border: "1px solid var(--line)",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "0.74rem",
                              fontWeight: 700,
                              background: conversation.unreadCount > 0 ? "var(--accent-soft)" : "var(--surface-muted)",
                              color: conversation.unreadCount > 0 ? "var(--accent-strong)" : "var(--text-muted)",
                            }}
                          >
                            {conversation.unreadCount}
                          </span>
                        </span>
                        <span className="page-subtitle" style={{ margin: 0, fontSize: "0.8rem" }}>
                          {conversation.latestPost?.authorDisplayName
                            ? `${conversation.latestPost.authorDisplayName}: ${conversation.latestPost.caption || "Media"}`
                            : "No posts yet"}
                        </span>
                        <span className="page-subtitle" style={{ margin: 0, fontSize: "0.78rem" }}>
                          {dt(conversation.lastActivityAt || conversation.createdAt)}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="page-subtitle" style={{ margin: 0 }}>
                  Select a conversation to open it in its own window.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {conversationModalOpen && threadModalOpen && selectedThread ? (
        <div className="person-modal-backdrop" onClick={() => setConversationModalOpen(false)}>
          <div
            className="person-modal-panel"
            style={{ width: "min(1120px, 98vw)", height: "min(96vh, 980px)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="person-modal-sticky-head">
              <div className="person-modal-header" style={{ gridTemplateColumns: "minmax(0, 1fr) auto auto", paddingRight: 0 }}>
                <div className="person-modal-header-copy">
                  <h3 className="person-modal-title">
                    {selectedConversation?.title || "Conversation"}
                  </h3>
                  <p className="person-modal-meta">
                    {selectedThread.audienceLabel || selectedThread.audienceType}
                  </p>
                </div>
                <button
                  type="button"
                  className="button secondary tap-button"
                  onClick={() => setConversationModalOpen(false)}
                  style={{ width: "auto" }}
                >
                  Back to Conversations
                </button>
                <ModalCloseButton className="modal-close-button--floating" onClick={() => setConversationModalOpen(false)} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", marginTop: "0.75rem" }}>
                {threadMembers.map((member) => {
                  const color = getMemberColor(member.personId);
                  return (
                    <span
                      key={`conversation-member-chip-${member.personId}`}
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
                <label className="label">
                  {selectedConversation ? `Post in "${selectedConversation.title || "Conversation"}"` : "Post Message"}
                </label>
                <textarea
                  className="input"
                  rows={2}
                  value={captionDraft}
                  onChange={(event) => setCaptionDraft(event.target.value)}
                  placeholder="Share a memory, context, or update..."
                  style={{ resize: "vertical" }}
                  disabled={composeBusy}
                />
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="button tap-button"
                    onClick={() => void postTextOnly()}
                    disabled={composeBusy || !selectedConversationId || !captionDraft.trim()}
                    style={{ width: "auto" }}
                  >
                    {composeBusy ? "Posting..." : "Post Text"}
                  </button>
                  <button
                    type="button"
                    className="button secondary tap-button"
                    onClick={() => setShareAttachOpen(true)}
                    disabled={composeBusy || !selectedThreadId || !selectedConversationId}
                    style={{ width: "auto" }}
                  >
                    Choose File
                  </button>
                </div>
                {composeStatus ? <p className="page-subtitle" style={{ margin: 0 }}>{composeStatus}</p> : null}
              </div>

              {postsStatus ? <p className="page-subtitle" style={{ margin: 0 }}>{postsStatus}</p> : null}
              {selectedConversationId && postsLoading ? <p className="page-subtitle" style={{ margin: 0 }}>Loading posts...</p> : null}
              {!selectedConversationId ? (
                <p className="page-subtitle" style={{ margin: 0 }}>Select a conversation to view posts and comments.</p>
              ) : null}
              {!postsLoading && orderedPosts.length === 0 ? (
                <p className="page-subtitle" style={{ margin: 0 }}>
                  {selectedConversationId ? "No posts in this conversation yet." : ""}
                </p>
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
                  const isMyPost = Boolean(actorPersonId) && post.authorPersonId === actorPersonId;
                  const postColor = getMemberColor(post.authorPersonId);
                  const comments = Array.isArray(commentsByPostId[post.postId]) ? commentsByPostId[post.postId] : [];
                  return (
                    <div key={post.postId} style={{ display: "flex", justifyContent: isMyPost ? "flex-end" : "flex-start" }}>
                      <article
                        style={{
                          width: "min(820px, 100%)",
                          display: "grid",
                          gap: "0.65rem",
                          borderRadius: "14px",
                          border: `1px solid ${postColor.bubbleBorder}`,
                          background: postColor.bubbleBg,
                          padding: "0.75rem",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", flexWrap: "wrap" }}>
                          <strong>{isMyPost ? "You" : post.authorDisplayName || post.authorEmail || "Unknown"}</strong>
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
                                const isMyComment = Boolean(actorPersonId) && comment.author.personId === actorPersonId;
                                return (
                                  <div
                                    key={`comment-${comment.commentId}`}
                                    style={{ display: "flex", justifyContent: isMyComment ? "flex-end" : "flex-start" }}
                                  >
                                    <div
                                      style={{
                                        width: "min(560px, 100%)",
                                        border: `1px solid ${commentColor.bubbleBorder}`,
                                        background: commentColor.bubbleBg,
                                        borderRadius: "12px",
                                        padding: "0.45rem 0.55rem",
                                        display: "grid",
                                        gap: "0.2rem",
                                      }}
                                    >
                                      <strong style={{ fontSize: "0.85rem" }}>{isMyComment ? "You" : comment.author.displayName}</strong>
                                      <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{dt(comment.createdAt)}</span>
                                      <span style={{ fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{comment.commentText}</span>
                                    </div>
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
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <MediaAttachWizard
        open={shareAttachOpen}
        context={{
          tenantKey,
          source: "library",
          canManage: true,
          allowHouseholdLinks: false,
          defaultAttributeType: "media",
          preselectedPersonIds: attachPreselectedPersonIds,
          preselectedHouseholdIds: [],
          peopleOptions,
          householdOptions: [],
        }}
        onClose={() => setShareAttachOpen(false)}
        onComplete={(summary) => void handleShareAttachComplete(summary)}
      />
      <MediaAttachWizard
        open={createConversationAttachOpen}
        context={{
          tenantKey,
          source: "library",
          canManage: true,
          allowHouseholdLinks: false,
          defaultAttributeType: "media",
          preselectedPersonIds: attachPreselectedPersonIds,
          preselectedHouseholdIds: [],
          peopleOptions,
          householdOptions: [],
        }}
        onClose={() => setCreateConversationAttachOpen(false)}
        onComplete={(summary) => handleNewConversationAttachComplete(summary)}
      />
    </main>
  );
}
