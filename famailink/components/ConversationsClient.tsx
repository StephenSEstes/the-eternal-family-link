"use client";

import { type CSSProperties, type ChangeEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { FamailinkChrome } from "@/components/FamailinkChrome";
import { PushNotificationsControl } from "@/components/PushNotificationsControl";

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
type CircleConversation = {
  conversationId: string;
  circleId: string;
  title: string;
  lastActivityAt: string;
  unreadCount: number;
  memberLastReadAt?: string;
  previewText: string;
  previewCreatedAt: string;
  previewMediaKind: string;
  previewThumbnailObjectKey: string;
  previewOriginalObjectKey: string;
  previewImageUrl: string;
  previewOriginalUrl: string;
};
type ConversationPostMedia = {
  mediaId: string;
  fileId: string;
  mediaKind: string;
  label: string;
  description: string;
  photoDate: string;
  sourceProvider: string;
  mimeType: string;
  fileName: string;
  fileSizeBytes: string;
  originalObjectKey: string;
  thumbnailObjectKey: string;
  previewUrl: string;
  originalUrl: string;
  taggedPeople: TaggedPerson[];
};
type ConversationComment = { commentId: string; postId: string; authorPersonId: string; authorDisplayName: string; commentText: string; createdAt: string };
type ConversationPost = { postId: string; authorPersonId: string; authorDisplayName: string; caption: string; createdAt: string; media: ConversationPostMedia | null; comments: ConversationComment[] };
type TaggedPerson = { personId: string; displayName: string };
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
type ThreadDisplayMember = { personId: string; displayName: string };
type PendingAttachment = {
  file: File;
  origin: "camera" | "library" | "files";
  previewUrl: string;
};
type ManagementDialog =
  | { kind: "group-name"; circle: ConversationCircle; value: string }
  | { kind: "conversation-name"; conversation: CircleConversation; value: string }
  | { kind: "delete-conversation"; conversation: CircleConversation };
type TagDialog = { postId: string; selectedPersonIds: string[]; search: string; label: string; photoDate: string; description: string };
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

const SUPPORTED_MEDIA_ACCEPT = "image/*,video/*,audio/*,application/pdf,text/*,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.rtf,.odt,.ods";

function detectMobileDevice() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent.toLowerCase();
  const mobileUserAgent = /android|iphone|ipad|ipod|iemobile|mobile/.test(userAgent);
  const coarsePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const narrowViewport = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 820px)").matches;
  return mobileUserAgent || (coarsePointer && narrowViewport);
}

function pendingAttachmentSourceLabel(origin: PendingAttachment["origin"]) {
  if (origin === "camera") return "Captured from camera";
  if (origin === "library") return "Selected from photo library";
  return "Selected from files";
}

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

function getTimeValue(value?: string) {
  const parsed = Date.parse(normalize(value));
  return Number.isFinite(parsed) ? parsed : 0;
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

function buildShareUrl(circleId: string, conversationId: string) {
  const params = new URLSearchParams();
  if (circleId) params.set("circleId", circleId);
  if (circleId && conversationId) params.set("conversationId", conversationId);
  const query = params.toString();
  return query ? `/conversations?${query}` : "/conversations";
}

function memberChipStyle(color: MemberColor): CSSProperties {
  return {
    "--conversation-member-chip-bg": color.chipBg,
    "--conversation-member-chip-border": color.chipBorder,
    "--conversation-member-chip-text": color.chipText,
  } as CSSProperties;
}

function memberBubbleStyle(color: MemberColor): CSSProperties {
  return {
    "--conversation-bubble-bg": color.bubbleBg,
    "--conversation-bubble-border": color.bubbleBorder,
    "--conversation-bubble-author-color": color.chipText,
  } as CSSProperties;
}

function formatFileSize(value?: string) {
  const bytes = Number.parseInt(normalize(value), 10);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageMimeType(value?: string) {
  return normalize(value).toLowerCase().startsWith("image/");
}

function isVideoMimeType(value?: string) {
  return normalize(value).toLowerCase().startsWith("video/");
}

function attachmentSummary(media: ConversationPostMedia) {
  const kind = normalize(media.mediaKind) || "file";
  const size = formatFileSize(media.fileSizeBytes);
  return [kind.charAt(0).toUpperCase() + kind.slice(1), size].filter(Boolean).join(" • ");
}

function mediaKindLabel(media: ConversationPostMedia) {
  const kind = normalize(media.mediaKind).toLowerCase();
  if (kind === "video") return "Video";
  if (kind === "image") return "Image";
  return "File";
}

function taggedPeopleNames(people: TaggedPerson[]) {
  return people.map((person) => normalize(person.displayName) || person.personId).filter(Boolean).join(", ");
}

function handleRowKeyDown(event: KeyboardEvent, action: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

export function ConversationsClient({
  session,
  initialCircles,
  initialCircleId: requestedCircleId,
  initialConversationId: requestedConversationId,
  people,
  relationshipOptions,
}: ConversationsClientProps) {
  const startCircleId = initialCircles.some((circle) => circle.circleId === requestedCircleId) ? requestedCircleId : "";
  const startConversationId = startCircleId ? requestedConversationId : "";
  const [circles, setCircles] = useState(initialCircles);
  const [selectedCircleId, setSelectedCircleId] = useState(startCircleId);
  const [conversations, setConversations] = useState<CircleConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState(startConversationId);
  const [posts, setPosts] = useState<ConversationPost[]>([]);
  const [status, setStatus] = useState<StatusState>(null);
  const [busy, setBusy] = useState(false);
  const [newTopicOpen, setNewTopicOpen] = useState(false);
  const [newConversationTitle, setNewConversationTitle] = useState("");
  const [initialMessage, setInitialMessage] = useState("");
  const [postDraft, setPostDraft] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerRecipientIds, setComposerRecipientIds] = useState<string[]>([]);
  const [composerSearch, setComposerSearch] = useState("");
  const [composerGroupTitle, setComposerGroupTitle] = useState("");
  const [composerDescription, setComposerDescription] = useState("");
  const [composerAdvancedOpen, setComposerAdvancedOpen] = useState(false);
  const [composerSideFilter, setComposerSideFilter] = useState<FamilySideFilter>("both");
  const [managementDialog, setManagementDialog] = useState<ManagementDialog | null>(null);
  const [tagDialog, setTagDialog] = useState<TagDialog | null>(null);
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  const [mediaSourceMenuOpen, setMediaSourceMenuOpen] = useState(false);
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});
  const pendingUnreadJumpConversationIdRef = useRef("");
  const filePickerRef = useRef<HTMLInputElement | null>(null);
  const libraryPickerRef = useRef<HTMLInputElement | null>(null);
  const cameraPickerRef = useRef<HTMLInputElement | null>(null);

  const peopleById = useMemo(() => new Map(people.map((person) => [person.personId, person])), [people]);
  const selectedCircle = useMemo(() => circles.find((circle) => circle.circleId === selectedCircleId) ?? null, [circles, selectedCircleId]);
  const selectedConversation = useMemo(() => conversations.find((conversation) => conversation.conversationId === selectedConversationId) ?? null, [conversations, selectedConversationId]);
  const threadMembers = useMemo(() => {
    const next: ThreadDisplayMember[] = [];
    const seen = new Set<string>();
    const addMember = (personId?: string, displayName?: string) => {
      const normalizedPersonId = normalize(personId);
      if (!normalizedPersonId || seen.has(normalizedPersonId)) return;
      seen.add(normalizedPersonId);
      next.push({
        personId: normalizedPersonId,
        displayName: normalize(displayName) || peopleById.get(normalizedPersonId)?.displayName || normalizedPersonId,
      });
    };
    selectedCircle?.members.forEach((member) => addMember(member.personId, member.displayName));
    posts.forEach((post) => {
      addMember(post.authorPersonId, post.authorDisplayName);
      post.comments.forEach((comment) => addMember(comment.authorPersonId, comment.authorDisplayName));
    });
    return next;
  }, [peopleById, posts, selectedCircle]);
  const currentView = selectedConversationId ? "thread" : selectedCircleId ? "conversations" : "groups";
  const sortedCircles = useMemo(
    () => [...circles].sort((left, right) => getTimeValue(right.lastActivityAt) - getTimeValue(left.lastActivityAt)),
    [circles],
  );
  const sortedConversations = useMemo(
    () => [...conversations].sort((left, right) => getTimeValue(right.lastActivityAt) - getTimeValue(left.lastActivityAt)),
    [conversations],
  );
  const composerRecipients = useMemo(() => composerRecipientIds.map((personId) => peopleById.get(personId)).filter((person): person is PersonOption => Boolean(person)), [composerRecipientIds, peopleById]);
  const composerAutoGroupTitle = useMemo(() => buildAutoGroupTitle(composerRecipientIds, peopleById), [composerRecipientIds, peopleById]);
  const composerGroupMatch = useMemo(() => {
    if (!composerRecipientIds.length) return null;
    const signature = personSignature([session.personId, ...composerRecipientIds]);
    return circles.find((circle) => personSignature(circle.members.map((member) => member.personId)) === signature) ?? null;
  }, [circles, composerRecipientIds, session.personId]);
  const hasComposerSearch = Boolean(normalize(composerSearch));
  const filteredPeople = useMemo(() => {
    const query = normalize(composerSearch).toLowerCase();
    if (!query) return [];
    return people
      .filter((person) => person.personId !== session.personId)
      .filter((person) => person.displayName.toLowerCase().includes(query) || person.personId.toLowerCase().includes(query))
      .slice(0, 48);
  }, [composerSearch, people, session.personId]);
  const relationshipPills = useMemo(() => relationshipOptions.map((option) => ({
    ...option,
    applicablePersonIds: uniqueIds(optionPersonIds(option, composerSideFilter).filter((personId) => personId !== session.personId)),
  })), [composerSideFilter, relationshipOptions, session.personId]);
  const canCreateGroup = composerRecipientIds.length > 0;
  const canSendPost = Boolean(normalize(postDraft) || pendingAttachment);
  const activeTagPost = useMemo(() => posts.find((post) => post.postId === tagDialog?.postId) ?? null, [posts, tagDialog?.postId]);
  const selectedTagPeople = useMemo(
    () => (tagDialog?.selectedPersonIds ?? []).map((personId) => peopleById.get(personId)).filter((person): person is PersonOption => Boolean(person)),
    [peopleById, tagDialog?.selectedPersonIds],
  );
  const filteredTagPeople = useMemo(() => {
    if (!tagDialog) return [];
    const query = normalize(tagDialog.search).toLowerCase();
    if (!query) return [];
    const selected = new Set(tagDialog.selectedPersonIds);
    return people
      .filter((person) => !selected.has(person.personId))
      .filter((person) => person.displayName.toLowerCase().includes(query) || person.personId.toLowerCase().includes(query))
      .slice(0, 24);
  }, [people, tagDialog]);
  const memberColorByPersonId = useMemo(() => {
    const map = new Map<string, MemberColor>();
    threadMembers.forEach((member, index) => map.set(member.personId, MEMBER_COLORS[index % MEMBER_COLORS.length]));
    return map;
  }, [threadMembers]);

  function getMemberColor(personId: string) {
    return memberColorByPersonId.get(normalize(personId)) ?? MEMBER_COLORS[MEMBER_COLORS.length - 1];
  }

  async function loadCircles() {
    const body = await fetchJson<{ circles?: ConversationCircle[] }>("/api/conversations/circles");
    return Array.isArray(body.circles) ? body.circles : [];
  }

  async function loadCircleConversations(circleId: string) {
    const body = await fetchJson<{ conversations?: CircleConversation[] }>(`/api/conversations/circles/${encodeURIComponent(circleId)}/conversations`);
    return Array.isArray(body.conversations) ? body.conversations : [];
  }

  function applySelection(circleId: string, conversationId: string, options?: { preserveConversations?: boolean }) {
    const nextCircleId = normalize(circleId);
    const nextConversationId = nextCircleId ? normalize(conversationId) : "";
    setSelectedCircleId(nextCircleId);
    setSelectedConversationId(nextConversationId);
    if (!nextCircleId) {
      setConversations([]);
      setPosts([]);
    } else {
      if (!options?.preserveConversations && nextCircleId !== selectedCircleId) {
        setConversations([]);
      }
      if (!nextConversationId) {
        setPosts([]);
      }
    }
    if (nextCircleId && nextConversationId && nextCircleId !== selectedCircleId) {
      setPosts([]);
    }
  }

  function writeShareUrl(circleId: string, conversationId: string, mode: "push" | "replace") {
    if (typeof window === "undefined") return;
    const nextUrl = buildShareUrl(circleId, conversationId);
    if (mode === "replace") {
      window.history.replaceState(null, "", nextUrl);
      return;
    }
    window.history.pushState(null, "", nextUrl);
  }

  function openGroups(mode: "push" | "replace" = "push") {
    applySelection("", "");
    writeShareUrl("", "", mode);
  }

  function openCircle(circleId: string, mode: "push" | "replace" = "push") {
    applySelection(circleId, "");
    writeShareUrl(circleId, "", mode);
  }

  function openConversation(circleId: string, conversationId: string, mode: "push" | "replace" = "push") {
    applySelection(circleId, conversationId);
    writeShareUrl(circleId, conversationId, mode);
  }

  async function syncCircleSelection(circleId: string, preferredConversationId?: string, mode: "push" | "replace" | "none" = "none") {
    const [nextCircles, nextConversations] = await Promise.all([loadCircles(), loadCircleConversations(circleId)]);
    setCircles(nextCircles);
    const nextCircleId = nextCircles.some((circle) => circle.circleId === circleId) ? circleId : "";
    const nextConversationId =
      nextCircleId && preferredConversationId && nextConversations.some((conversation) => conversation.conversationId === preferredConversationId)
        ? normalize(preferredConversationId)
        : "";
    setConversations(nextCircleId ? nextConversations : []);
    applySelection(nextCircleId, nextConversationId, { preserveConversations: true });
    if (mode !== "none") {
      writeShareUrl(nextCircleId, nextConversationId, mode);
    }
  }

  useEffect(() => {
    writeShareUrl(startCircleId, startConversationId, "replace");
  }, [startCircleId, startConversationId]);

  useEffect(() => {
    function handlePopState() {
      const params = new URLSearchParams(window.location.search);
      const nextCircleId = normalize(params.get("circleId") ?? "");
      const nextConversationId = nextCircleId ? normalize(params.get("conversationId") ?? "") : "";
      const validCircleId = circles.some((circle) => circle.circleId === nextCircleId) ? nextCircleId : "";
      setSelectedCircleId(validCircleId);
      setSelectedConversationId(validCircleId ? nextConversationId : "");
      if (!validCircleId) {
        setConversations([]);
        setPosts([]);
        return;
      }
      if (validCircleId !== selectedCircleId) {
        setConversations([]);
        setPosts([]);
        return;
      }
      if (!nextConversationId) {
        setPosts([]);
      }
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [circles, selectedCircleId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedCircleId) {
      setConversations([]);
      setSelectedConversationId("");
      setPosts([]);
      return;
    }
    void (async () => {
      try {
        const nextConversations = await loadCircleConversations(selectedCircleId);
        if (cancelled) return;
        setConversations(nextConversations);
        setSelectedConversationId((current) => {
          return current && nextConversations.some((conversation) => conversation.conversationId === current) ? current : "";
        });
      } catch (error) {
        if (!cancelled) setStatus({ tone: "error", message: error instanceof Error ? error.message : "Failed to load conversations." });
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCircleId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedCircleId || !selectedConversationId || !conversations.some((conversation) => conversation.conversationId === selectedConversationId)) {
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
  }, [conversations, selectedCircleId, selectedConversationId]);

  useEffect(() => {
    setPostDraft("");
    replacePendingAttachment(null);
    setMediaSourceMenuOpen(false);
  }, [selectedConversationId]);
  useEffect(() => {
    return () => {
      if (pendingAttachment?.previewUrl) {
        URL.revokeObjectURL(pendingAttachment.previewUrl);
      }
    };
  }, [pendingAttachment]);
  useEffect(() => { setNewTopicOpen(false); setNewConversationTitle(""); setInitialMessage(""); }, [selectedCircleId]);
  useEffect(() => {
    const update = () => setIsMobileDevice(detectMobileDevice());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  useEffect(() => {
    pendingUnreadJumpConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  const unreadAnchorKey = useMemo(() => {
    const lastReadAt = getTimeValue(selectedConversation?.memberLastReadAt);
    if (!selectedConversation || !lastReadAt) return "";
    for (const post of posts) {
      if (getTimeValue(post.createdAt) > lastReadAt) return `post:${post.postId}`;
      for (const comment of post.comments) {
        if (getTimeValue(comment.createdAt) > lastReadAt) return `comment:${comment.commentId}`;
      }
    }
    return "";
  }, [posts, selectedConversation]);

  useEffect(() => {
    if (!selectedConversationId || pendingUnreadJumpConversationIdRef.current !== selectedConversationId) return;
    const targetKey = unreadAnchorKey || (posts.length ? `post:${posts[posts.length - 1].postId}` : "");
    if (!targetKey) return;
    const target = itemRefs.current[targetKey];
    if (!target) return;
    target.scrollIntoView({ block: "start", behavior: "auto" });
    pendingUnreadJumpConversationIdRef.current = "";
  }, [posts, selectedConversationId, unreadAnchorKey]);

  function replacePendingAttachment(nextAttachment: PendingAttachment | null) {
    setPendingAttachment((current) => {
      if (current?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return nextAttachment;
    });
  }

  function setPendingFile(file: File | null, origin: PendingAttachment["origin"]) {
    if (!file) return;
    const normalizedType = normalize(file.type).toLowerCase();
    const previewUrl = normalizedType.startsWith("image/") || normalizedType.startsWith("video/") ? URL.createObjectURL(file) : "";
    replacePendingAttachment({ file, origin, previewUrl });
  }

  function onFilePickerChange(event: ChangeEvent<HTMLInputElement>, origin: PendingAttachment["origin"]) {
    const file = event.target.files?.[0] ?? null;
    if (file) {
      setPendingFile(file, origin);
    }
    event.target.value = "";
    setMediaSourceMenuOpen(false);
  }

  function openMediaPicker(source: PendingAttachment["origin"]) {
    setMediaSourceMenuOpen(false);
    if (source === "camera") {
      cameraPickerRef.current?.click();
      return;
    }
    if (source === "library") {
      libraryPickerRef.current?.click();
      return;
    }
    filePickerRef.current?.click();
  }

  function handleAddMediaClick() {
    if (isMobileDevice) {
      setMediaSourceMenuOpen((current) => !current);
      return;
    }
    openMediaPicker("files");
  }

  async function uploadMediaPost(circleId: string, conversationId: string, file: File, caption: string) {
    const formData = new FormData();
    formData.set("file", file);
    if (caption) {
      formData.set("caption", caption);
    }
    const response = await fetch(
      `/api/conversations/circles/${encodeURIComponent(circleId)}/conversations/${encodeURIComponent(conversationId)}/posts/upload`,
      {
        method: "POST",
        body: formData,
        credentials: "same-origin",
        cache: "no-store",
      },
    );
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(String(payload.error ?? `Upload failed (${response.status}).`));
    }
    return payload;
  }

  function clearComposer() {
    setComposerRecipientIds([]);
    setComposerSearch("");
    setComposerGroupTitle("");
    setComposerDescription("");
    setComposerAdvancedOpen(false);
    setComposerSideFilter("both");
  }

  function setItemRef(key: string, node: HTMLElement | null) {
    itemRefs.current[key] = node;
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

  async function createGroupFromComposer() {
    if (!canCreateGroup) return;
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

      await syncCircleSelection(circle.circleId, "", "push");
      await closeComposer();
      setStatus({
        tone: "info",
        message: circleBody.duplicate ? `Existing group "${circle.title}" was opened.` : `Group "${circle.title}" created.`,
      });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Failed to create group." });
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
      await syncCircleSelection(selectedCircle.circleId, body.conversation?.conversationId ?? "", "push");
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
    if (!caption && !pendingAttachment) return;
    setBusy(true);
    setStatus(null);
    try {
      if (pendingAttachment) {
        await uploadMediaPost(selectedCircle.circleId, selectedConversation.conversationId, pendingAttachment.file, caption);
      } else {
        await fetchJson<{ post?: ConversationPost }>(`/api/conversations/circles/${encodeURIComponent(selectedCircle.circleId)}/conversations/${encodeURIComponent(selectedConversation.conversationId)}/posts`, {
          method: "POST",
          body: JSON.stringify({ caption }),
        });
      }
      setPostDraft("");
      replacePendingAttachment(null);
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

  async function deletePost(postId: string) {
    if (!selectedCircle || !selectedConversation) return;
    setBusy(true);
    setStatus(null);
    try {
      await fetchJson<{ ok?: boolean }>(
        `/api/conversations/circles/${encodeURIComponent(selectedCircle.circleId)}/conversations/${encodeURIComponent(selectedConversation.conversationId)}/posts/${encodeURIComponent(postId)}`,
        { method: "DELETE" },
      );
      setPosts((current) => current.filter((post) => post.postId !== postId));
      await syncCircleSelection(selectedCircle.circleId, selectedConversation.conversationId);
      setStatus({ tone: "info", message: "Post deleted." });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Failed to delete post." });
    } finally {
      setBusy(false);
    }
  }

  async function deleteComment(postId: string, commentId: string) {
    if (!selectedCircle || !selectedConversation) return;
    setBusy(true);
    setStatus(null);
    try {
      await fetchJson<{ ok?: boolean }>(
        `/api/conversations/circles/${encodeURIComponent(selectedCircle.circleId)}/conversations/${encodeURIComponent(selectedConversation.conversationId)}/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`,
        { method: "DELETE" },
      );
      setPosts((current) => current.map((post) => post.postId === postId ? { ...post, comments: post.comments.filter((comment) => comment.commentId !== commentId) } : post));
      await syncCircleSelection(selectedCircle.circleId, selectedConversation.conversationId);
      setStatus({ tone: "info", message: "Comment deleted." });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Failed to delete comment." });
    } finally {
      setBusy(false);
    }
  }

  function openTagDialog(post: ConversationPost) {
    if (!post.media || post.media.mediaKind !== "image") return;
    setTagDialog({
      postId: post.postId,
      selectedPersonIds: post.media.taggedPeople.map((person) => person.personId),
      search: "",
      label: post.media.label,
      photoDate: post.media.photoDate,
      description: post.media.description,
    });
  }

  function addTagPerson(personId: string) {
    setTagDialog((current) => current && !current.selectedPersonIds.includes(personId)
      ? { ...current, selectedPersonIds: [...current.selectedPersonIds, personId], search: "" }
      : current);
  }

  function removeTagPerson(personId: string) {
    setTagDialog((current) => current
      ? { ...current, selectedPersonIds: current.selectedPersonIds.filter((id) => id !== personId) }
      : current);
  }

  async function savePostTags() {
    if (!selectedCircle || !selectedConversation || !tagDialog) return;
    const postId = tagDialog.postId;
    setBusy(true);
    setStatus(null);
    try {
      const body = await fetchJson<{
        taggedPeople?: TaggedPerson[];
        media?: Pick<ConversationPostMedia, "label" | "description" | "photoDate">;
      }>(
        `/api/conversations/circles/${encodeURIComponent(selectedCircle.circleId)}/conversations/${encodeURIComponent(selectedConversation.conversationId)}/posts/${encodeURIComponent(postId)}/tags`,
        {
          method: "PATCH",
          body: JSON.stringify({
            personIds: tagDialog.selectedPersonIds,
            label: tagDialog.label,
            photoDate: tagDialog.photoDate,
            description: tagDialog.description,
          }),
        },
      );
      const taggedPeople = Array.isArray(body.taggedPeople) ? body.taggedPeople : [];
      setPosts((current) => current.map((post) => post.postId === postId && post.media
        ? {
          ...post,
          media: {
            ...post.media,
            taggedPeople,
            label: body.media?.label ?? post.media.label,
            description: body.media?.description ?? post.media.description,
            photoDate: body.media?.photoDate ?? post.media.photoDate,
          },
        }
        : post));
      setTagDialog(null);
      setStatus({ tone: "info", message: taggedPeople.length ? "Photo tags saved." : "Photo tags cleared." });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Failed to save photo tags." });
    } finally {
      setBusy(false);
    }
  }

  async function saveGroupName() {
    if (!managementDialog || managementDialog.kind !== "group-name") return;
    const title = normalize(managementDialog.value);
    if (!title) return;
    setBusy(true);
    setStatus(null);
    try {
      const body = await fetchJson<{ circle?: ConversationCircle }>(`/api/conversations/circles/${encodeURIComponent(managementDialog.circle.circleId)}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      if (body.circle) {
        setCircles((current) => current.map((circle) => circle.circleId === body.circle?.circleId ? body.circle : circle));
      } else {
        setCircles(await loadCircles());
      }
      setManagementDialog(null);
      setStatus({ tone: "info", message: "Group name updated." });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Failed to update group name." });
    } finally {
      setBusy(false);
    }
  }

  async function saveConversationName() {
    if (!managementDialog || managementDialog.kind !== "conversation-name") return;
    const title = normalize(managementDialog.value);
    if (!title) return;
    setBusy(true);
    setStatus(null);
    try {
      const body = await fetchJson<{ conversation?: CircleConversation }>(
        `/api/conversations/circles/${encodeURIComponent(managementDialog.conversation.circleId)}/conversations/${encodeURIComponent(managementDialog.conversation.conversationId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ title }),
        },
      );
      if (body.conversation) {
        setConversations((current) => current.map((conversation) => conversation.conversationId === body.conversation?.conversationId ? body.conversation : conversation));
      } else if (selectedCircleId) {
        setConversations(await loadCircleConversations(selectedCircleId));
      }
      setManagementDialog(null);
      setStatus({ tone: "info", message: "Thread name updated." });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Failed to update thread name." });
    } finally {
      setBusy(false);
    }
  }

  async function deleteConversation() {
    if (!managementDialog || managementDialog.kind !== "delete-conversation") return;
    const { conversation } = managementDialog;
    setBusy(true);
    setStatus(null);
    try {
      await fetchJson<{ ok?: boolean }>(
        `/api/conversations/circles/${encodeURIComponent(conversation.circleId)}/conversations/${encodeURIComponent(conversation.conversationId)}`,
        { method: "DELETE", body: "{}" },
      );
      const nextConversations = await loadCircleConversations(conversation.circleId);
      setConversations(nextConversations);
      const nextCircles = await loadCircles();
      setCircles(nextCircles);
      if (selectedConversationId === conversation.conversationId) {
        applySelection(conversation.circleId, "", { preserveConversations: true });
        writeShareUrl(conversation.circleId, "", "replace");
      }
      setManagementDialog(null);
      setStatus({ tone: "info", message: "Thread deleted." });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Failed to delete thread." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <FamailinkChrome active="conversations" username={session.username} personId={session.personId} />

      <section className="conversations-shell is-single-pane">
        <div className={`conversation-column conversation-stage${currentView === "thread" ? " thread-column" : ""}`}>
          <div className="conversation-column-head">
            <div className="conversation-stage-head">
              {currentView === "conversations" ? (
                <button className="secondary-button conversation-back-button" type="button" onClick={() => openGroups()}>
                  Back
                </button>
              ) : null}
              {currentView === "thread" && selectedCircle ? (
                <button className="secondary-button conversation-back-button" type="button" onClick={() => openCircle(selectedCircle.circleId)}>
                  Back
                </button>
              ) : null}
              <div>
                <p className="eyebrow">
                  {currentView === "groups" ? "Family Sharing" : currentView === "conversations" ? "Conversations" : "Thread"}
                </p>
                {currentView === "groups" ? <h1 className="conversation-title">Share</h1> : null}
                {currentView === "conversations" ? (
                  <div className="conversation-title-row">
                    <h1 className="conversation-title">{selectedCircle?.title ?? "Group"}</h1>
                    {selectedCircle?.members.length ? (
                      <div className="conversation-header-member-list" aria-label="Group members">
                        {selectedCircle.members.map((member) => (
                          <span
                            key={`group-header-member-${member.personId}`}
                            className="conversation-thread-member-chip"
                            style={memberChipStyle(getMemberColor(member.personId))}
                          >
                            {member.displayName || member.personId}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {currentView === "thread" ? <h1 className="conversation-title">{selectedConversation?.title ?? "Conversation"}</h1> : null}
                {currentView === "groups" ? <p className="conversation-meta">Groups ordered by recent activity.</p> : null}
                {currentView === "conversations" && selectedCircle ? (
                  <p className="conversation-meta">{selectedCircle.members.length} members</p>
                ) : null}
                {currentView === "thread" && selectedCircle ? <p className="conversation-meta">{selectedCircle.title}</p> : null}
              </div>
            </div>

            <div className="conversation-head-actions">
              {currentView === "groups" ? (
                <button className="primary-button" type="button" onClick={() => setComposerOpen(true)}>
                  Add Group
                </button>
              ) : null}
              {currentView === "conversations" ? (
                <>
                  {selectedCircle ? (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setManagementDialog({ kind: "group-name", circle: selectedCircle, value: selectedCircle.title })}
                    >
                      Edit Group
                    </button>
                  ) : null}
                  <button className="secondary-button" type="button" onClick={() => setNewTopicOpen((current) => !current)}>
                    {newTopicOpen ? "Close Topic" : "New Topic"}
                  </button>
                </>
              ) : null}
              {currentView === "thread" && selectedConversation ? (
                <>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setManagementDialog({ kind: "conversation-name", conversation: selectedConversation, value: selectedConversation.title })}
                  >
                    Edit Thread
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => setManagementDialog({ kind: "delete-conversation", conversation: selectedConversation })}
                  >
                    Delete Thread
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {status ? (
            <p className={status.tone === "error" ? "error-text conversation-status" : "conversation-inline-note conversation-status"}>{status.message}</p>
          ) : null}

          {currentView === "groups" ? (
            <div className="conversation-list" aria-label="Family groups">
              <PushNotificationsControl />
              {sortedCircles.length === 0 ? <p className="empty-state">No Groups yet. Use Add Group to create one.</p> : null}
              {sortedCircles.map((circle) => (
                <div
                  key={circle.circleId}
                  className="conversation-list-item"
                  role="button"
                  tabIndex={0}
                  onClick={() => openCircle(circle.circleId)}
                  onKeyDown={(event) => handleRowKeyDown(event, () => openCircle(circle.circleId))}
                >
                  <span className="conversation-list-main">
                    <strong>{circle.title}</strong>
                    <small>{memberNames(circle.members)}</small>
                    <small>{formatDate(circle.lastActivityAt)}</small>
                  </span>
                  <span className="conversation-list-actions">
                    {unreadBadge(circle.unreadCount)}
                    <button
                      className="secondary-button conversation-inline-action"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setManagementDialog({ kind: "group-name", circle, value: circle.title });
                      }}
                    >
                      Edit
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {currentView === "conversations" ? (
            <>
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
                {selectedCircle && conversations.length === 0 ? <p className="empty-state">No named conversations yet. Use New Topic to start one.</p> : null}
                {sortedConversations.map((conversation) => {
                  const previewText = normalize(conversation.previewText);
                  const previewImageUrl = normalize(conversation.previewImageUrl);
                  return (
                    <div
                      key={conversation.conversationId}
                      className="conversation-list-item conversation-thread-row"
                      role="button"
                      tabIndex={0}
                      onClick={() => openConversation(conversation.circleId, conversation.conversationId)}
                      onKeyDown={(event) => handleRowKeyDown(event, () => openConversation(conversation.circleId, conversation.conversationId))}
                    >
                      <span className={`conversation-list-main conversation-thread-summary${previewImageUrl ? " has-thumbnail" : ""}`}>
                        {previewImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={previewImageUrl}
                            alt=""
                            aria-hidden="true"
                            className="conversation-thread-thumbnail"
                          />
                        ) : null}
                        <strong>{previewText || (previewImageUrl ? "" : conversation.title)}</strong>
                        <small>{formatDate(conversation.previewCreatedAt || conversation.lastActivityAt)}</small>
                        <small className="conversation-thread-name">{conversation.title}</small>
                      </span>
                      <span className="conversation-list-actions">
                        {unreadBadge(conversation.unreadCount)}
                        <button
                          className="secondary-button conversation-inline-action"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setManagementDialog({ kind: "conversation-name", conversation, value: conversation.title });
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="danger-button conversation-inline-action"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setManagementDialog({ kind: "delete-conversation", conversation });
                          }}
                        >
                          Delete
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}

          {currentView === "thread" ? (
            <>
              {threadMembers.length ? (
                <div className="conversation-thread-member-list" aria-label="Group members">
                  {threadMembers.map((member) => (
                    <span
                      key={`thread-member-${member.personId}`}
                      className="conversation-thread-member-chip"
                      style={memberChipStyle(getMemberColor(member.personId))}
                    >
                      {member.displayName}
                    </span>
                  ))}
                </div>
              ) : null}

              <input
                ref={filePickerRef}
                type="file"
                className="conversation-hidden-input"
                accept={SUPPORTED_MEDIA_ACCEPT}
                onChange={(event) => onFilePickerChange(event, "files")}
              />
              <input
                ref={libraryPickerRef}
                type="file"
                className="conversation-hidden-input"
                accept="image/*,video/*"
                onChange={(event) => onFilePickerChange(event, "library")}
              />
              <input
                ref={cameraPickerRef}
                type="file"
                className="conversation-hidden-input"
                accept="image/*,video/*"
                capture="environment"
                onChange={(event) => onFilePickerChange(event, "camera")}
              />
              <div className="conversation-compose">
                {pendingAttachment ? (
                  <div className={`conversation-pending-attachment${isImageMimeType(pendingAttachment.file.type) ? " is-image-only" : ""}`}>
                    {pendingAttachment.previewUrl && isImageMimeType(pendingAttachment.file.type) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={pendingAttachment.previewUrl}
                        alt={pendingAttachment.file.name || "Selected image"}
                        className="conversation-pending-image"
                      />
                    ) : pendingAttachment.previewUrl && isVideoMimeType(pendingAttachment.file.type) ? (
                      <video
                        src={pendingAttachment.previewUrl}
                        className="conversation-pending-video"
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <div className="conversation-attachment-icon" aria-hidden="true">
                        {pendingAttachment.file.type.startsWith("video/") ? "VID" : "DOC"}
                      </div>
                    )}
                    {!isImageMimeType(pendingAttachment.file.type) ? (
                      <div className="conversation-pending-copy">
                        <strong>{pendingAttachment.file.type.startsWith("video/") ? "Video" : "File"}</strong>
                        <small>
                          {pendingAttachmentSourceLabel(pendingAttachment.origin)}
                          {pendingAttachment.file.size ? ` • ${formatFileSize(String(pendingAttachment.file.size))}` : ""}
                        </small>
                      </div>
                    ) : null}
                    <button className="secondary-button" type="button" onClick={() => replacePendingAttachment(null)}>
                      Remove
                    </button>
                  </div>
                ) : null}
                <textarea
                  className="input conversation-textarea"
                  value={postDraft}
                  onChange={(event) => setPostDraft(event.target.value)}
                  placeholder={pendingAttachment ? "Add an optional comment" : "Send a message"}
                />
                <div className="conversation-toolbar">
                  <div className="conversation-media-picker">
                    <button
                      className="secondary-button conversation-add-media-button"
                      type="button"
                      aria-label={isMobileDevice ? "Choose media source" : "Add media"}
                      aria-expanded={isMobileDevice ? mediaSourceMenuOpen : undefined}
                      disabled={busy}
                      onClick={handleAddMediaClick}
                    >
                      +
                    </button>
                    {mediaSourceMenuOpen && isMobileDevice ? (
                      <div className="conversation-media-source-menu" role="menu" aria-label="Media source">
                        <button type="button" role="menuitem" onClick={() => openMediaPicker("camera")}>
                          Camera
                        </button>
                        <button type="button" role="menuitem" onClick={() => openMediaPicker("library")}>
                          Photo Library
                        </button>
                        <button type="button" role="menuitem" onClick={() => openMediaPicker("files")}>
                          Files
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <button className="primary-button" type="button" disabled={busy || !canSendPost} onClick={() => void createPost()}>
                    Send
                  </button>
                </div>
              </div>

              <div className="conversation-posts" aria-label="Conversation posts">
                {selectedConversation && posts.length === 0 ? <p className="empty-state">No messages yet.</p> : null}
                {posts.map((post) => {
                  const ownPost = post.authorPersonId === session.personId;
                  const postColor = getMemberColor(post.authorPersonId);
                  const postTaggedPeople = post.media?.taggedPeople ?? [];
                  const postTaggedNames = taggedPeopleNames(postTaggedPeople);
                  return (
                    <article
                      key={post.postId}
                      ref={(node) => setItemRef(`post:${post.postId}`, node)}
                      className={`conversation-post${ownPost ? " is-mine" : ""}${unreadAnchorKey === `post:${post.postId}` ? " is-unread-anchor" : ""}`}
                    >
                      <div className="conversation-post-bubble" style={memberBubbleStyle(postColor)}>
                        <div className="conversation-post-head">
                          <strong>{post.authorDisplayName || post.authorPersonId}</strong>
                          <span>{formatDate(post.createdAt)}</span>
                        </div>
                        {ownPost ? (
                          <button
                            className="danger-button conversation-delete-post"
                            type="button"
                            disabled={busy}
                            onClick={() => void deletePost(post.postId)}
                          >
                            Delete
                          </button>
                        ) : null}
                        {post.media ? (
                          <div className="conversation-media-card">
                            {post.media.mediaKind === "image" && post.media.previewUrl ? (
                              <div className="conversation-image-frame">
                                <a
                                  href={post.media.originalUrl || post.media.previewUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="conversation-media-link"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={post.media.previewUrl}
                                    alt="Shared image"
                                    className="conversation-media-image"
                                  />
                                </a>
                                <button
                                  className={`conversation-media-details-button${postTaggedPeople.length ? " has-tags" : ""}`}
                                  type="button"
                                  disabled={busy}
                                  aria-label={postTaggedPeople.length ? `Edit tagged people: ${postTaggedNames}` : "Add media details and tag people"}
                                  onClick={() => openTagDialog(post)}
                                >
                                  {postTaggedPeople.length ? (
                                    <>
                                      <span className="conversation-media-details-label">Tagged</span>
                                      <span className="conversation-media-tag-names">{postTaggedNames}</span>
                                    </>
                                  ) : (
                                    <>
                                      <span className="conversation-media-details-label">Add media details</span>
                                      <span className="conversation-media-tag-names">Tag people, title, date</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            ) : post.media.mediaKind === "video" && post.media.originalUrl ? (
                              <video
                                className="conversation-media-video"
                                controls
                                playsInline
                                preload="metadata"
                              >
                                <source src={post.media.originalUrl} type={post.media.mimeType || undefined} />
                              </video>
                            ) : (
                              post.media.originalUrl ? (
                                <a
                                  href={post.media.originalUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="conversation-media-file"
                                >
                                  <div className="conversation-attachment-icon" aria-hidden="true">
                                    {post.media.mediaKind === "video" ? "VID" : "DOC"}
                                  </div>
                                  <div className="conversation-media-copy">
                                    <strong>{mediaKindLabel(post.media)}</strong>
                                    <small>{attachmentSummary(post.media)}</small>
                                  </div>
                                </a>
                              ) : (
                                <div className="conversation-media-file">
                                  <div className="conversation-attachment-icon" aria-hidden="true">
                                    {post.media.mediaKind === "video" ? "VID" : "DOC"}
                                  </div>
                                  <div className="conversation-media-copy">
                                    <strong>{mediaKindLabel(post.media)}</strong>
                                    <small>{attachmentSummary(post.media)}</small>
                                  </div>
                                </div>
                              )
                            )}
                            {post.media.mediaKind === "video" ? (
                              <div className="conversation-media-copy">
                                <strong>Video</strong>
                                <small>{attachmentSummary(post.media)}</small>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {post.caption ? <p>{post.caption}</p> : null}
                      </div>
                      <div className="conversation-comments">
                        {post.comments.map((comment) => (
                          <div key={comment.commentId} className={`conversation-comment-row${comment.authorPersonId === session.personId ? " is-mine" : ""}`}>
                            <div
                              ref={(node) => setItemRef(`comment:${comment.commentId}`, node)}
                              className={`conversation-comment${unreadAnchorKey === `comment:${comment.commentId}` ? " is-unread-anchor" : ""}`}
                              style={memberBubbleStyle(getMemberColor(comment.authorPersonId))}
                            >
                              <strong>{comment.authorDisplayName || comment.authorPersonId}</strong>
                              <span>{comment.commentText}</span>
                              {comment.authorPersonId === session.personId ? (
                                <button
                                  className="danger-button conversation-delete-comment"
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void deleteComment(post.postId, comment.commentId)}
                                >
                                  Delete
                                </button>
                              ) : null}
                            </div>
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
            </>
          ) : null}
        </div>
      </section>

      {composerOpen ? (
        <div className="conversation-modal-backdrop" role="presentation">
          <div className="conversation-modal conversation-modal-wide" role="dialog" aria-modal="true" aria-label="Add Group">
            <div className="conversation-modal-head">
              <div>
                <h2>Add Group</h2>
                <p className="conversation-meta">Pick relatives, remove anyone you do not want, then create the Group.</p>
              </div>
              <button type="button" className="account-close" aria-label="Close add group modal" onClick={() => void closeComposer()}>
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
                {!hasComposerSearch ? <p className="empty-state">Type a name to search relatives.</p> : null}
                {hasComposerSearch && filteredPeople.length === 0 ? <p className="empty-state">No relatives match that search.</p> : null}
                {hasComposerSearch ? filteredPeople.map((person) => {
                  const selected = composerRecipientIds.includes(person.personId);
                  return (
                    <div key={person.personId} className={`conversation-person-row${selected ? " is-selected" : ""}`}>
                      <span>{person.displayName}</span>
                      <button className="secondary-button" type="button" onClick={() => toggleRecipient(person.personId)}>
                        {selected ? "Remove" : "Add"}
                      </button>
                    </div>
                  );
                }) : null}
              </div>
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
              <button className="primary-button" type="button" disabled={busy || !canCreateGroup} onClick={() => void createGroupFromComposer()}>
                Add Group
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tagDialog ? (
        <div className="conversation-modal-backdrop" role="presentation">
          <div className="conversation-modal" role="dialog" aria-modal="true" aria-label="Tag people in photo">
            <div className="conversation-modal-head">
              <div>
                <h2>Tag People</h2>
                <p className="conversation-meta">Link this photo to people in the family database.</p>
              </div>
              <button type="button" className="account-close" aria-label="Close tag modal" onClick={() => setTagDialog(null)}>
                x
              </button>
            </div>

            {activeTagPost?.media?.previewUrl ? (
              <div className="conversation-tag-preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={activeTagPost.media.previewUrl} alt="Photo being tagged" />
                <div className="conversation-tag-chip-list">
                  {selectedTagPeople.map((person) => (
                    <span key={person.personId} className="conversation-chip">
                      <span>{person.displayName}</span>
                      <button type="button" aria-label={`Remove ${person.displayName}`} onClick={() => removeTagPerson(person.personId)}>
                        x
                      </button>
                    </span>
                  ))}
                  {selectedTagPeople.length === 0 ? <p className="empty-state">No people tagged yet.</p> : null}
                </div>
              </div>
            ) : null}

            <div className="conversation-tag-fields">
              <label className="field">
                <span className="field-label">Title</span>
                <input
                  className="input"
                  value={tagDialog.label}
                  onChange={(event) => setTagDialog({ ...tagDialog, label: event.target.value })}
                  placeholder="Photo title"
                />
              </label>
              <label className="field">
                <span className="field-label">Date</span>
                <input
                  className="input"
                  type="date"
                  value={tagDialog.photoDate}
                  onChange={(event) => setTagDialog({ ...tagDialog, photoDate: event.target.value })}
                />
              </label>
              <label className="field conversation-tag-description">
                <span className="field-label">Description</span>
                <textarea
                  className="input conversation-description-input"
                  value={tagDialog.description}
                  onChange={(event) => setTagDialog({ ...tagDialog, description: event.target.value })}
                  placeholder="Optional context"
                />
              </label>
            </div>

            <label className="field">
              <span className="field-label">Search people</span>
              <input
                className="input"
                type="search"
                value={tagDialog.search}
                onChange={(event) => setTagDialog({ ...tagDialog, search: event.target.value })}
                placeholder="Type a name"
                autoFocus
              />
            </label>

            <div className="conversation-people-results">
              {!normalize(tagDialog.search) ? <p className="empty-state">Type a name to add tags.</p> : null}
              {normalize(tagDialog.search) && filteredTagPeople.length === 0 ? <p className="empty-state">No untagged people match that search.</p> : null}
              {filteredTagPeople.map((person) => (
                <div key={person.personId} className="conversation-person-row">
                  <span>{person.displayName}</span>
                  <button className="secondary-button" type="button" onClick={() => addTagPerson(person.personId)}>
                    Add
                  </button>
                </div>
              ))}
            </div>

            <div className="conversation-modal-actions">
              <button className="secondary-button" type="button" disabled={busy} onClick={() => setTagDialog(null)}>
                Cancel
              </button>
              <button className="primary-button" type="button" disabled={busy} onClick={() => void savePostTags()}>
                Save Tags
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {managementDialog ? (
        <div className="conversation-modal-backdrop" role="presentation">
          <div className="conversation-modal" role="dialog" aria-modal="true" aria-label="Manage Share item">
            <div className="conversation-modal-head">
              <div>
                <h2>
                  {managementDialog.kind === "group-name"
                    ? "Edit Group"
                    : managementDialog.kind === "conversation-name"
                      ? "Edit Thread"
                      : "Delete Thread"}
                </h2>
                <p className="conversation-meta">
                  {managementDialog.kind === "delete-conversation"
                    ? "This removes the thread from the active list and preserves its history."
                    : "Change the name shown in Share."}
                </p>
              </div>
              <button type="button" className="account-close" aria-label="Close management modal" onClick={() => setManagementDialog(null)}>
                x
              </button>
            </div>

            {managementDialog.kind === "group-name" || managementDialog.kind === "conversation-name" ? (
              <label className="field">
                <span className="field-label">{managementDialog.kind === "group-name" ? "Group name" : "Thread name"}</span>
                <input
                  className="input"
                  value={managementDialog.value}
                  onChange={(event) => setManagementDialog({ ...managementDialog, value: event.target.value })}
                  autoFocus
                />
              </label>
            ) : (
              <p className="conversation-delete-copy">
                Delete &quot;{managementDialog.conversation.title}&quot;?
              </p>
            )}

            <div className="conversation-modal-actions">
              <button className="secondary-button" type="button" disabled={busy} onClick={() => setManagementDialog(null)}>
                Cancel
              </button>
              {managementDialog.kind === "group-name" ? (
                <button className="primary-button" type="button" disabled={busy || !normalize(managementDialog.value)} onClick={() => void saveGroupName()}>
                  Save
                </button>
              ) : managementDialog.kind === "conversation-name" ? (
                <button className="primary-button" type="button" disabled={busy || !normalize(managementDialog.value)} onClick={() => void saveConversationName()}>
                  Save
                </button>
              ) : (
                <button className="danger-button" type="button" disabled={busy} onClick={() => void deleteConversation()}>
                  Delete Thread
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
