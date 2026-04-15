"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { FamailinkChrome } from "@/components/FamailinkChrome";
import { isSideSpecificCategory } from "@/lib/access/defaults";
import { DEFAULT_LINEAGE_SELECTION_LABELS } from "@/lib/access/types";
import type {
  AccessRecomputeStatus,
  DefaultLineageSelection,
  ProfileSubscriptionMapRow,
  ProfileVisibilityMapRow,
  ShareDefaultRule,
  SharePersonException,
  SubscriptionDefaultRule,
  SubscriptionPersonException,
} from "@/lib/access/types";
import type { LineageSide, RelationshipCategory } from "@/lib/model/relationships";
import { RELATIONSHIP_LABELS } from "@/lib/model/relationships";

const TREE_COLUMNS: Array<{ title: string; categories: RelationshipCategory[] }> = [
  { title: "Roots", categories: ["grandparents", "parents"] },
  { title: "Center", categories: ["siblings", "self", "spouse"] },
  { title: "Branches", categories: ["children", "grandchildren"] },
  { title: "Extended", categories: ["aunts_uncles", "cousins", "cousins_children", "nieces_nephews"] },
  {
    title: "In-Laws",
    categories: [
      "grandparents_in_law",
      "parents_in_law",
      "siblings_in_law",
      "children_in_law",
      "nieces_nephews_in_law",
    ],
  },
];

const TREE_GENERATIONS: Array<{ id: string; label: string; categories: RelationshipCategory[] }> = [
  { id: "grandparents", label: "Grandparents", categories: ["grandparents", "grandparents_in_law"] },
  { id: "parents", label: "Parents", categories: ["aunts_uncles", "parents", "parents_in_law"] },
  { id: "center", label: "Your Generation", categories: ["cousins", "siblings", "self", "spouse", "siblings_in_law"] },
  { id: "children", label: "Children", categories: ["nieces_nephews", "children", "children_in_law", "nieces_nephews_in_law"] },
  { id: "grandchildren", label: "Grandchildren", categories: ["cousins_children", "grandchildren"] },
];

type SessionInfo = {
  username: string;
  personId: string;
};

type SelectedRelative = {
  person: TreeBucketPerson;
  category: RelationshipCategory;
  visibilityRow?: ProfileVisibilityMapRow;
  subscriptionRow?: ProfileSubscriptionMapRow;
};

type TreeBucketPerson = {
  personId: string;
  displayName: string;
  lineageSides: LineageSide[];
};

type TreeSnapshot = {
  viewer: {
    personId: string;
    displayName: string;
  };
  buckets: Record<RelationshipCategory, TreeBucketPerson[]>;
  peopleCount: number;
  relationshipCount: number;
  relatedCount: number;
};

type SharingOverrideMode = "follow_default" | "always_share" | "name_only" | "custom_scopes";
type SubscriptionOverrideMode = "follow_default" | "always_subscribe" | "do_not_subscribe";

type ModalSettings = {
  subscriptionDefaults: SubscriptionDefaultRule[];
  shareDefaults: ShareDefaultRule[];
  subscriptionExceptions: SubscriptionPersonException[];
  shareExceptions: SharePersonException[];
  subscriptionDefaultLineage: DefaultLineageSelection;
  shareDefaultLineage: DefaultLineageSelection;
  shareDefaultScopes: {
    shareVitals: boolean;
    shareStories: boolean;
    shareMedia: boolean;
    shareConversations: boolean;
  };
  subscriptionOverride: SubscriptionOverrideMode;
  sharingOverride: SharingOverrideMode;
  customSharingSummary: string;
};

function readSideLabel(side: LineageSide) {
  if (side === "maternal") return "Maternal";
  if (side === "paternal") return "Paternal";
  if (side === "both") return "Both Sides";
  return "";
}

function formatTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Not yet recomputed";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Denver",
  }).format(new Date(timestamp));
}

function shareSummary(row: ProfileVisibilityMapRow | undefined) {
  if (!row) return { label: "Sharing Pending", badgeClass: "pending" };
  if (row.placeholderOnly) return { label: "Name Only", badgeClass: "placeholder" };
  if (row.canVitals || row.canStories || row.canMedia || row.canConversations) {
    return { label: "Shared", badgeClass: "shared" };
  }
  return { label: "No Content", badgeClass: "closed" };
}

function subscriptionSummary(row: ProfileSubscriptionMapRow | undefined) {
  if (!row) return { label: "Subscription Pending", badgeClass: "pending" };
  return row.isSubscribed
    ? { label: "Subscribed", badgeClass: "subscribed" }
    : { label: "Not Subscribed", badgeClass: "closed" };
}

function scopeList(row: ProfileVisibilityMapRow | undefined) {
  if (!row || row.placeholderOnly) return "";
  const allowed = [
    row.canVitals ? "Vitals" : "",
    row.canStories ? "Stories" : "",
    row.canMedia ? "Media" : "",
    row.canConversations ? "Conversations" : "",
  ].filter(Boolean);
  return allowed.join(", ");
}

function lineageSelectionOptions(relationshipCategory: RelationshipCategory): DefaultLineageSelection[] {
  return isSideSpecificCategory(relationshipCategory)
    ? ["none", "both", "maternal", "paternal"]
    : ["none", "not_applicable"];
}

function buildSharePayloadRows(rows: SharePersonException[]) {
  return rows
    .map((row) => ({
      targetPersonId: row.targetPersonId,
      effect: row.effect,
      shareVitals: row.shareVitals,
      shareStories: row.shareStories,
      shareMedia: row.shareMedia,
      shareConversations: row.shareConversations,
    }))
    .sort((left, right) => left.targetPersonId.localeCompare(right.targetPersonId));
}

function buildSubscriptionExceptionPayloadRows(rows: SubscriptionPersonException[]) {
  return rows
    .map((row) => ({
      targetPersonId: row.targetPersonId,
      effect: row.effect,
    }))
    .sort((left, right) => left.targetPersonId.localeCompare(right.targetPersonId));
}

function buildSubscriptionDefaultPayloadRows(rows: SubscriptionDefaultRule[]) {
  return rows
    .map((row) => ({
      relationshipCategory: row.relationshipCategory,
      lineageSelection: row.lineageSelection,
    }))
    .sort((left, right) => left.relationshipCategory.localeCompare(right.relationshipCategory));
}

function buildShareDefaultPayloadRows(rows: ShareDefaultRule[]) {
  return rows
    .map((row) => ({
      relationshipCategory: row.relationshipCategory,
      lineageSelection: row.lineageSelection,
      shareVitals: row.shareVitals,
      shareStories: row.shareStories,
      shareMedia: row.shareMedia,
      shareConversations: row.shareConversations,
    }))
    .sort((left, right) => left.relationshipCategory.localeCompare(right.relationshipCategory));
}

function buildCustomSharingSummary(row: SharePersonException | undefined) {
  if (!row) return "";
  const activeScopes = [
    row.shareVitals ? "Vitals" : "",
    row.shareStories ? "Stories" : "",
    row.shareMedia ? "Media" : "",
    row.shareConversations ? "Conversations" : "",
  ].filter(Boolean);
  if (!activeScopes.length) {
    return "A detailed sharing rule exists for this person. Use Preferences for scope-level editing.";
  }
  return row.effect === "deny"
    ? `Currently hides: ${activeScopes.join(", ")}. Use Preferences for scope-level editing.`
    : `Currently allows: ${activeScopes.join(", ")}. Use Preferences for scope-level editing.`;
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    credentials: "same-origin",
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(payload.error ?? payload.message ?? `Request failed (${response.status}).`));
  }
  return payload;
}

function RelativeModal({
  selected,
  settings,
  onClose,
  onSave,
  settingsLoading,
  saveBusy,
  modalError,
  setSettings,
}: {
  selected: SelectedRelative;
  settings: ModalSettings | null;
  onClose: () => void;
  onSave: () => Promise<void>;
  settingsLoading: boolean;
  saveBusy: boolean;
  modalError: string;
  setSettings: Dispatch<SetStateAction<ModalSettings | null>>;
}) {
  const [activeTab, setActiveTab] = useState<"details" | "rules">("details");
  const sharing = shareSummary(selected.visibilityRow);
  const subscription = subscriptionSummary(selected.subscriptionRow);
  const scopes = scopeList(selected.visibilityRow);
  const canEditRelationshipDefaults = selected.category !== "self";

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="relative-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">Tree Preferences</p>
            <h2 id="relative-settings-title" className="bucket-title">
              {selected.person.displayName}
            </h2>
            <div className="person-meta modal-meta">
              <span className={`badge ${selected.category === "self" ? "self" : "side"}`}>
                {RELATIONSHIP_LABELS[selected.category]}
              </span>
              {selected.person.lineageSides
                .filter((side) => side !== "not_applicable")
                .map((side) => (
                  <span key={`${selected.person.personId}:${side}`} className="badge side">
                    {readSideLabel(side)}
                  </span>
                ))}
              <span className={`badge state ${subscription.badgeClass}`}>{subscription.label}</span>
              <span className={`badge state ${sharing.badgeClass}`}>{sharing.label}</span>
            </div>
            {scopes ? <p className="person-detail muted">Saved scopes: {scopes}</p> : null}
          </div>
          <button className="secondary-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        {modalError ? <p className="error-text modal-error">{modalError}</p> : null}
        {settingsLoading ? <p className="muted">Loading relationship and person settings...</p> : null}

        {!settingsLoading && settings ? (
          <>
            <div className="person-detail-tabs" role="tablist" aria-label="Person detail tabs">
              <button
                type="button"
                className={`person-detail-tab${activeTab === "details" ? " is-active" : ""}`}
                onClick={() => setActiveTab("details")}
              >
                Details
              </button>
              <button
                type="button"
                className={`person-detail-tab${activeTab === "rules" ? " is-active" : ""}`}
                onClick={() => setActiveTab("rules")}
              >
                Inclusion Rules
              </button>
            </div>

            {activeTab === "details" ? (
              <div className="modal-sections">
                <section className="modal-section">
                  <div className="modal-section-head">
                    <h3>Person Details</h3>
                    <p className="muted">This MVP detail view shows the identity and saved access readback available in Famailink.</p>
                  </div>
                  <div className="person-detail-grid">
                    <article className="stat-card">
                      <p className="stat-label">Person</p>
                      <p className="stat-value recompute-value">{selected.person.displayName}</p>
                    </article>
                    <article className="stat-card">
                      <p className="stat-label">Relationship</p>
                      <p className="stat-value recompute-value">{RELATIONSHIP_LABELS[selected.category]}</p>
                    </article>
                    <article className="stat-card">
                      <p className="stat-label">Subscription</p>
                      <p className="stat-value recompute-value">{subscription.label}</p>
                    </article>
                    <article className="stat-card">
                      <p className="stat-label">Sharing</p>
                      <p className="stat-value recompute-value">{sharing.label}</p>
                    </article>
                  </div>
                </section>
              </div>
            ) : (
              <div className="modal-sections">
                <section className="modal-section">
              <div className="section-head modal-section-head">
                <div>
                  <h3>This Relationship Group</h3>
                  <p className="muted">
                    Use these defaults when you want all <strong>{RELATIONSHIP_LABELS[selected.category]}</strong> to
                    be treated the same way.
                  </p>
                </div>
              </div>

              {canEditRelationshipDefaults ? (
                <div className="modal-grid">
                  <label className="field">
                    <span className="field-label">Subscription Default</span>
                    <select
                      className="input"
                      value={settings.subscriptionDefaultLineage}
                      onChange={(event) =>
                        setSettings((current) =>
                          current
                            ? {
                                ...current,
                                subscriptionDefaultLineage: event.target.value as DefaultLineageSelection,
                              }
                            : current,
                        )
                      }
                    >
                      {lineageSelectionOptions(selected.category).map((option) => (
                        <option key={option} value={option}>
                          {DEFAULT_LINEAGE_SELECTION_LABELS[option]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span className="field-label">Sharing Default</span>
                    <select
                      className="input"
                      value={settings.shareDefaultLineage}
                      onChange={(event) =>
                        setSettings((current) =>
                          current
                            ? {
                                ...current,
                                shareDefaultLineage: event.target.value as DefaultLineageSelection,
                                shareDefaultScopes:
                                  event.target.value === "none"
                                    ? {
                                        shareVitals: false,
                                        shareStories: false,
                                        shareMedia: false,
                                        shareConversations: false,
                                      }
                                    : current.shareDefaultScopes,
                              }
                            : current,
                        )
                      }
                    >
                      {lineageSelectionOptions(selected.category).map((option) => (
                        <option key={option} value={option}>
                          {DEFAULT_LINEAGE_SELECTION_LABELS[option]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="modal-scope-block">
                    <p className="field-label">Default Shared Content</p>
                    <div className="scope-grid">
                      {(["shareVitals", "shareStories", "shareMedia", "shareConversations"] as const).map((field) => (
                        <label key={field} className="scope-option">
                          <input
                            type="checkbox"
                            checked={settings.shareDefaultScopes[field]}
                            disabled={settings.shareDefaultLineage === "none"}
                            onChange={(event) =>
                              setSettings((current) =>
                                current
                                  ? {
                                      ...current,
                                      shareDefaultScopes: {
                                        ...current.shareDefaultScopes,
                                        [field]: event.target.checked,
                                      },
                                    }
                                  : current,
                              )
                            }
                          />
                          {field.replace("share", "")}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="muted">
                  Your own card is shown here for readback only. Relationship-wide defaults start with your relatives,
                  not with <strong>You</strong>.
                </p>
              )}
            </section>

            <section className="modal-section">
              <div className="section-head modal-section-head">
                <div>
                  <h3>This Person Only</h3>
                  <p className="muted">
                    Use this when one relative should be treated differently without changing the whole relationship
                    group.
                  </p>
                </div>
              </div>

              {selected.category === "self" ? (
                <p className="muted">Self is always visible and always available to you.</p>
              ) : (
                <div className="modal-grid">
                  <label className="field">
                    <span className="field-label">Subscription Override</span>
                    <select
                      className="input"
                      value={settings.subscriptionOverride}
                      onChange={(event) =>
                        setSettings((current) =>
                          current
                            ? {
                                ...current,
                                subscriptionOverride: event.target.value as SubscriptionOverrideMode,
                              }
                            : current,
                        )
                      }
                    >
                      <option value="follow_default">Follow relationship default</option>
                      <option value="always_subscribe">Always subscribe</option>
                      <option value="do_not_subscribe">Do not subscribe</option>
                    </select>
                  </label>

                  <label className="field">
                    <span className="field-label">Sharing Override</span>
                    <select
                      className="input"
                      value={settings.sharingOverride}
                      onChange={(event) =>
                        setSettings((current) =>
                          current
                            ? {
                                ...current,
                                sharingOverride: event.target.value as SharingOverrideMode,
                              }
                            : current,
                        )
                      }
                    >
                      <option value="follow_default">Follow relationship default</option>
                      <option value="always_share">Share all content</option>
                      <option value="name_only">Name only</option>
                      {settings.sharingOverride === "custom_scopes" ? (
                        <option value="custom_scopes">Custom scopes (existing)</option>
                      ) : null}
                    </select>
                  </label>

                  <div className="modal-note">
                    <p className="muted">
                      Person overrides are the simple path here. Use relationship defaults above when you want the same
                      rule to apply to future relatives in this group too.
                    </p>
                    {settings.sharingOverride === "custom_scopes" ? (
                      <p className="muted">{settings.customSharingSummary}</p>
                    ) : null}
                  </div>
                </div>
              )}
            </section>

            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={onClose} disabled={saveBusy}>
                Cancel
              </button>
              <button className="primary-button" type="button" onClick={() => void onSave()} disabled={saveBusy}>
                {saveBusy ? "Saving..." : "Save and Apply"}
              </button>
            </div>
          </div>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}

function PersonCard({
  person,
  category,
  visibilityRow,
  subscriptionRow,
  onSelect,
}: {
  person: TreeBucketPerson;
  category: RelationshipCategory;
  visibilityRow?: ProfileVisibilityMapRow;
  subscriptionRow?: ProfileSubscriptionMapRow;
  onSelect: (selected: SelectedRelative) => void;
}) {
  const sharing = shareSummary(visibilityRow);
  const subscription = subscriptionSummary(subscriptionRow);
  const scopes = scopeList(visibilityRow);
  const clickable = category !== "self";

  const content = (
    <>
      <p className="person-name">{person.displayName}</p>
      <div className="person-meta">
        <span className={`badge ${category === "self" ? "self" : "side"}`}>{RELATIONSHIP_LABELS[category]}</span>
        {person.lineageSides
          .filter((side) => side !== "not_applicable")
          .map((side) => (
            <span key={`${person.personId}:${side}`} className="badge side">
              {readSideLabel(side)}
            </span>
          ))}
        <span className={`badge state ${subscription.badgeClass}`}>{subscription.label}</span>
        <span className={`badge state ${sharing.badgeClass}`}>{sharing.label}</span>
      </div>
      {scopes ? <p className="person-detail muted">Shared scopes: {scopes}</p> : null}
      {clickable ? <p className="person-detail muted">Click to manage this relative.</p> : null}
    </>
  );

  if (!clickable) {
    return <article className="person-card">{content}</article>;
  }

  return (
    <button
      className="person-card person-card-button"
      type="button"
      onClick={() => onSelect({ person, category, visibilityRow, subscriptionRow })}
    >
      {content}
    </button>
  );
}

function Bucket({
  category,
  people,
  visibilityByTarget,
  subscriptionByTarget,
  onSelect,
}: {
  category: RelationshipCategory;
  people: TreeBucketPerson[];
  visibilityByTarget: Map<string, ProfileVisibilityMapRow>;
  subscriptionByTarget: Map<string, ProfileSubscriptionMapRow>;
  onSelect: (selected: SelectedRelative) => void;
}) {
  return (
    <section className="bucket">
      <div className="bucket-header">
        <h2 className="bucket-title">{RELATIONSHIP_LABELS[category]}</h2>
        <span className="bucket-count">{people.length}</span>
      </div>
      <div className="bucket-people">
        {people.length ? (
          people.map((person) => (
            <PersonCard
              key={`${category}:${person.personId}`}
              person={person}
              category={category}
              visibilityRow={visibilityByTarget.get(person.personId)}
              subscriptionRow={subscriptionByTarget.get(person.personId)}
              onSelect={onSelect}
            />
          ))
        ) : (
          <p className="empty-state">No matched relatives in this bucket yet.</p>
        )}
      </div>
    </section>
  );
}

export function TreeClient({
  session,
  snapshot,
  recomputeStatus,
  visibilityRows,
  subscriptionRows,
}: {
  session: SessionInfo;
  snapshot: TreeSnapshot;
  recomputeStatus: AccessRecomputeStatus;
  visibilityRows: ProfileVisibilityMapRow[];
  subscriptionRows: ProfileSubscriptionMapRow[];
}) {
  const router = useRouter();
  const [focused, setFocused] = useState<SelectedRelative | null>(null);
  const [selected, setSelected] = useState<SelectedRelative | null>(null);
  const [settings, setSettings] = useState<ModalSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [modalError, setModalError] = useState("");

  const visibilityByTarget = useMemo(
    () => new Map(visibilityRows.map((row) => [row.targetPersonId, row])),
    [visibilityRows],
  );
  const subscriptionByTarget = useMemo(
    () => new Map(subscriptionRows.map((row) => [row.targetPersonId, row])),
    [subscriptionRows],
  );
  const hasPersistedMaps = Boolean(recomputeStatus.summary);

  const treeGenerations = useMemo(
    () =>
      TREE_GENERATIONS.map((generation) => ({
        ...generation,
        entries: generation.categories.flatMap((category) =>
          (snapshot.buckets[category] ?? []).map((person) => ({
            person,
            category,
            visibilityRow: visibilityByTarget.get(person.personId),
            subscriptionRow: subscriptionByTarget.get(person.personId),
          })),
        ),
      })),
    [snapshot.buckets, subscriptionByTarget, visibilityByTarget],
  );

  function firstEntryFor(categories: RelationshipCategory[]) {
    for (const category of categories) {
      const person = snapshot.buckets[category]?.[0];
      if (person) {
        return {
          person,
          category,
          visibilityRow: visibilityByTarget.get(person.personId),
          subscriptionRow: subscriptionByTarget.get(person.personId),
        };
      }
    }
    return null;
  }

  function focusFirst(categories: RelationshipCategory[]) {
    const next = firstEntryFor(categories);
    if (next) {
      setFocused(next);
    }
  }

  async function openRelative(selectedPerson: SelectedRelative) {
    setSelected(selectedPerson);
    setSettings(null);
    setModalError("");
    setSettingsLoading(true);

    try {
      const [subscriptionDefaultsPayload, shareDefaultsPayload, subscriptionExceptionsPayload, shareExceptionsPayload] =
        await Promise.all([
          fetchJson("/api/access/subscription/defaults"),
          fetchJson("/api/access/sharing/defaults"),
          fetchJson("/api/access/subscription/exceptions/people"),
          fetchJson("/api/access/sharing/exceptions/people"),
        ]);

      const subscriptionDefaults = (subscriptionDefaultsPayload.rows as SubscriptionDefaultRule[] | undefined) ?? [];
      const shareDefaults = (shareDefaultsPayload.rows as ShareDefaultRule[] | undefined) ?? [];
      const subscriptionExceptions =
        (subscriptionExceptionsPayload.rows as SubscriptionPersonException[] | undefined) ?? [];
      const shareExceptions = (shareExceptionsPayload.rows as SharePersonException[] | undefined) ?? [];

      const subscriptionDefaultRow =
        subscriptionDefaults.find((row) => row.relationshipCategory === selectedPerson.category) ?? null;
      const shareDefaultRow = shareDefaults.find((row) => row.relationshipCategory === selectedPerson.category) ?? null;
      const subscriptionException =
        subscriptionExceptions.find((row) => row.targetPersonId === selectedPerson.person.personId) ?? null;
      const shareException = shareExceptions.find((row) => row.targetPersonId === selectedPerson.person.personId) ?? null;

      setSettings({
        subscriptionDefaults,
        shareDefaults,
        subscriptionExceptions,
        shareExceptions,
        subscriptionDefaultLineage: subscriptionDefaultRow?.lineageSelection ?? "none",
        shareDefaultLineage: shareDefaultRow?.lineageSelection ?? "none",
        shareDefaultScopes: {
          shareVitals: shareDefaultRow?.shareVitals ?? false,
          shareStories: shareDefaultRow?.shareStories ?? false,
          shareMedia: shareDefaultRow?.shareMedia ?? false,
          shareConversations: shareDefaultRow?.shareConversations ?? false,
        },
        subscriptionOverride:
          subscriptionException?.effect === "allow"
            ? "always_subscribe"
            : subscriptionException?.effect === "deny"
              ? "do_not_subscribe"
              : "follow_default",
        sharingOverride:
          !shareException
            ? "follow_default"
            : shareException.shareVitals === null &&
                shareException.shareStories === null &&
                shareException.shareMedia === null &&
                shareException.shareConversations === null
              ? shareException.effect === "allow"
                ? "always_share"
                : "name_only"
              : "custom_scopes",
        customSharingSummary: buildCustomSharingSummary(shareException ?? undefined),
      });
    } catch (error) {
      setModalError(error instanceof Error ? error.message : "Failed to load settings.");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function saveSelectedRelative() {
    if (!selected || !settings) return;

    const targetPersonId = selected.person.personId;

    const nextSubscriptionDefaults = settings.subscriptionDefaults.map((row) =>
      row.relationshipCategory === selected.category
        ? { ...row, lineageSelection: settings.subscriptionDefaultLineage }
        : row,
    );

    const nextShareDefaults = settings.shareDefaults.map((row) =>
      row.relationshipCategory === selected.category
        ? {
            ...row,
            lineageSelection: settings.shareDefaultLineage,
            shareVitals: settings.shareDefaultScopes.shareVitals,
            shareStories: settings.shareDefaultScopes.shareStories,
            shareMedia: settings.shareDefaultScopes.shareMedia,
            shareConversations: settings.shareDefaultScopes.shareConversations,
          }
        : row,
    );

    const nextSubscriptionExceptions = settings.subscriptionExceptions
      .filter((row) => row.targetPersonId !== targetPersonId)
      .concat(
        settings.subscriptionOverride === "always_subscribe"
          ? [
              {
                exceptionId: "",
                viewerPersonId: "",
                targetPersonId,
                effect: "allow" as const,
                createdAt: "",
                updatedAt: "",
              },
            ]
          : settings.subscriptionOverride === "do_not_subscribe"
            ? [
                {
                  exceptionId: "",
                  viewerPersonId: "",
                  targetPersonId,
                  effect: "deny" as const,
                  createdAt: "",
                  updatedAt: "",
                },
              ]
            : [],
      );

    const existingShareException = settings.shareExceptions.find((row) => row.targetPersonId === targetPersonId);
    const nextShareExceptions = settings.shareExceptions
      .filter((row) => row.targetPersonId !== targetPersonId)
      .concat(
        settings.sharingOverride === "always_share"
          ? [
              {
                exceptionId: "",
                ownerPersonId: "",
                targetPersonId,
                effect: "allow" as const,
                shareVitals: null,
                shareStories: null,
                shareMedia: null,
                shareConversations: null,
                createdAt: "",
                updatedAt: "",
              },
            ]
          : settings.sharingOverride === "name_only"
            ? [
                {
                  exceptionId: "",
                  ownerPersonId: "",
                  targetPersonId,
                  effect: "deny" as const,
                  shareVitals: null,
                  shareStories: null,
                  shareMedia: null,
                  shareConversations: null,
                  createdAt: "",
                  updatedAt: "",
                },
              ]
            : settings.sharingOverride === "custom_scopes" && existingShareException
              ? [existingShareException]
              : [],
      );

    const originalSubscriptionDefaultsPayload = buildSubscriptionDefaultPayloadRows(settings.subscriptionDefaults);
    const nextSubscriptionDefaultsPayload = buildSubscriptionDefaultPayloadRows(nextSubscriptionDefaults);
    const originalShareDefaultsPayload = buildShareDefaultPayloadRows(settings.shareDefaults);
    const nextShareDefaultsPayload = buildShareDefaultPayloadRows(nextShareDefaults);
    const originalSubscriptionExceptionsPayload = buildSubscriptionExceptionPayloadRows(settings.subscriptionExceptions);
    const nextSubscriptionExceptionsPayload = buildSubscriptionExceptionPayloadRows(nextSubscriptionExceptions);
    const originalShareExceptionsPayload = buildSharePayloadRows(settings.shareExceptions);
    const nextShareExceptionsPayload = buildSharePayloadRows(nextShareExceptions);

    const requests: Array<Promise<unknown>> = [];
    if (JSON.stringify(originalSubscriptionDefaultsPayload) !== JSON.stringify(nextSubscriptionDefaultsPayload)) {
      requests.push(
        fetchJson("/api/access/subscription/defaults", {
          method: "PUT",
          body: JSON.stringify(nextSubscriptionDefaultsPayload),
        }),
      );
    }
    if (JSON.stringify(originalShareDefaultsPayload) !== JSON.stringify(nextShareDefaultsPayload)) {
      requests.push(
        fetchJson("/api/access/sharing/defaults", {
          method: "PUT",
          body: JSON.stringify(nextShareDefaultsPayload),
        }),
      );
    }
    if (
      JSON.stringify(originalSubscriptionExceptionsPayload) !== JSON.stringify(nextSubscriptionExceptionsPayload)
    ) {
      requests.push(
        fetchJson("/api/access/subscription/exceptions/people", {
          method: "PUT",
          body: JSON.stringify(nextSubscriptionExceptionsPayload),
        }),
      );
    }
    if (JSON.stringify(originalShareExceptionsPayload) !== JSON.stringify(nextShareExceptionsPayload)) {
      requests.push(
        fetchJson("/api/access/sharing/exceptions/people", {
          method: "PUT",
          body: JSON.stringify(nextShareExceptionsPayload),
        }),
      );
    }

    if (!requests.length) {
      setSelected(null);
      setSettings(null);
      setModalError("");
      return;
    }

    setSaveBusy(true);
    setModalError("");
    try {
      await Promise.all(requests);
      setSelected(null);
      setSettings(null);
      router.refresh();
    } catch (error) {
      setModalError(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <main className="shell">
      <FamailinkChrome active="tree" username={session.username} personId={session.personId} />
      <header className="masthead">
        <div>
          <p className="eyebrow">Famailink</p>
          <h1 className="title">Family Tree</h1>
          <p className="lead">
            Select a person to navigate the family relationship map. Open details to view saved sharing/subscription
            readback and manage inclusion rules for that relative.
          </p>
        </div>
      </header>

      <section className="summary-strip">
        <div className="stat-grid">
          <article className="stat-card">
            <p className="stat-label">Signed In Person</p>
            <p className="stat-value">{snapshot.viewer.displayName}</p>
          </article>
          <article className="stat-card">
            <p className="stat-label">People Loaded</p>
            <p className="stat-value">{snapshot.peopleCount}</p>
          </article>
          <article className="stat-card">
            <p className="stat-label">Graph Relationship Rows</p>
            <p className="stat-value">{snapshot.relationshipCount}</p>
          </article>
          <article className="stat-card">
            <p className="stat-label">Relatives In Your Tree</p>
            <p className="stat-value">{snapshot.relatedCount}</p>
          </article>
          <article className="stat-card">
            <p className="stat-label">Saved Readback</p>
            <p className="stat-value">{hasPersistedMaps ? "Ready" : "Pending"}</p>
          </article>
          <article className="stat-card">
            <p className="stat-label">Last Recompute</p>
            <p className="stat-value recompute-value">{formatTimestamp(recomputeStatus.summary?.lastComputedAt ?? "")}</p>
          </article>
        </div>
      </section>

      <section className="efl-tree-shell">
        <div className="efl-tree-canvas">
          {treeGenerations.map((generation) => (
            <section key={generation.id} className="efl-tree-generation">
              <p className="efl-tree-generation-label">{generation.label}</p>
              <div className="efl-tree-row">
                {generation.entries.length ? (
                  generation.entries.map((entry) => {
                    const sharing = shareSummary(entry.visibilityRow);
                    const subscription = subscriptionSummary(entry.subscriptionRow);
                    const isFocused =
                      focused?.person.personId === entry.person.personId && focused.category === entry.category;

                    return (
                      <button
                        key={`${entry.category}:${entry.person.personId}`}
                        type="button"
                        className={`efl-tree-person${isFocused ? " is-selected" : ""}`}
                        onClick={() => setFocused(entry)}
                        onDoubleClick={() => void openRelative(entry)}
                      >
                        <span className="efl-tree-avatar" aria-hidden="true">
                          {entry.person.displayName.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="efl-tree-person-copy">
                          <span className="efl-tree-person-name">{entry.person.displayName}</span>
                          <span className="efl-tree-person-relation">{RELATIONSHIP_LABELS[entry.category]}</span>
                        </span>
                        <span className="efl-tree-person-states">
                          <span className={`badge state ${subscription.badgeClass}`}>{subscription.label}</span>
                          <span className={`badge state ${sharing.badgeClass}`}>{sharing.label}</span>
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <p className="efl-tree-empty">No matched relatives.</p>
                )}
              </div>
            </section>
          ))}
        </div>

        {focused ? (
          <aside className="efl-focus-panel">
            <div className="efl-focus-head">
              <span className="efl-tree-avatar large" aria-hidden="true">
                {focused.person.displayName.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <h2>{focused.person.displayName}</h2>
                <p>{RELATIONSHIP_LABELS[focused.category]}</p>
              </div>
            </div>
            <div className="efl-focus-actions">
              <button
                type="button"
                className="tree-focus-action-chip"
                onClick={() => focusFirst(["parents", "parents_in_law", "grandparents"])}
                disabled={!firstEntryFor(["parents", "parents_in_law", "grandparents"])}
              >
                Parents
              </button>
              <button
                type="button"
                className="tree-focus-action-chip"
                onClick={() => focusFirst(["spouse"])}
                disabled={!firstEntryFor(["spouse"])}
              >
                Spouse
              </button>
              <button
                type="button"
                className="tree-focus-action-chip"
                onClick={() => focusFirst(["siblings", "siblings_in_law"])}
                disabled={!firstEntryFor(["siblings", "siblings_in_law"])}
              >
                Siblings
              </button>
              <button
                type="button"
                className="tree-focus-action-chip"
                onClick={() => focusFirst(["children", "children_in_law", "grandchildren"])}
                disabled={!firstEntryFor(["children", "children_in_law", "grandchildren"])}
              >
                Children
              </button>
            </div>
            <button className="primary-button" type="button" onClick={() => void openRelative(focused)}>
              Open Person Details
            </button>
          </aside>
        ) : null}
      </section>

      {selected ? (
        <RelativeModal
          selected={selected}
          settings={settings}
          onClose={() => {
            if (saveBusy) return;
            setSelected(null);
            setSettings(null);
            setModalError("");
          }}
          onSave={saveSelectedRelative}
          settingsLoading={settingsLoading}
          saveBusy={saveBusy}
          modalError={modalError}
          setSettings={setSettings}
        />
      ) : null}
    </main>
  );
}
