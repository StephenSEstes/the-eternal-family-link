"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  EDITABLE_CATEGORIES,
  defaultInclusiveLineageSelectionForCategory,
  isSideSpecificCategory,
  mergeWithSystemShareDefaults,
  mergeWithSystemSubscriptionDefaults,
} from "@/lib/access/defaults";
import type {
  DefaultLineageSelection,
  ShareDefaultRule,
  SubscriptionDefaultRule,
} from "@/lib/access/types";
import { DEFAULT_LINEAGE_SELECTION_LABELS } from "@/lib/access/types";
import type { RelationshipCategory } from "@/lib/model/relationships";
import { RELATIONSHIP_LABELS } from "@/lib/model/relationships";

type SessionInfo = {
  username: string;
  personId: string;
};

type SubscriptionDefaultDraft = Pick<SubscriptionDefaultRule, "relationshipCategory" | "lineageSelection">;
type ShareDefaultDraft = Pick<
  ShareDefaultRule,
  | "relationshipCategory"
  | "lineageSelection"
  | "shareVitals"
  | "shareStories"
  | "shareMedia"
  | "shareConversations"
>;

type RuleEditorState = {
  category: RelationshipCategory;
  subscription: SubscriptionDefaultDraft;
  share: ShareDefaultDraft;
};

type RuleNode =
  | { kind: "anchor"; id: string; label: string; detail: string }
  | { kind: "placeholder"; id: string; label: string; detail: string }
  | { kind: "relationship"; category: RelationshipCategory };

const RULE_TEMPLATES = EDITABLE_CATEGORIES.map((relationshipCategory) => ({
  relationshipCategory,
  lineageSelection: defaultInclusiveLineageSelectionForCategory(relationshipCategory),
}));

const RULE_TREE_LEVELS: Array<{ title: string; nodes: RuleNode[] }> = [
  {
    title: "Grandparents",
    nodes: [
      { kind: "relationship", category: "grandparents" },
      { kind: "placeholder", id: "grandparents-in-law", label: "Grandparents-In-Law", detail: "Not yet modeled" },
    ],
  },
  {
    title: "Parents",
    nodes: [
      { kind: "relationship", category: "parents" },
      { kind: "relationship", category: "parents_in_law" },
    ],
  },
  {
    title: "Center",
    nodes: [
      { kind: "relationship", category: "siblings" },
      { kind: "anchor", id: "self", label: "You", detail: "Family rules center" },
      { kind: "relationship", category: "spouse" },
      { kind: "relationship", category: "siblings_in_law" },
    ],
  },
  {
    title: "Descendants",
    nodes: [
      { kind: "relationship", category: "children" },
      { kind: "relationship", category: "children_in_law" },
      { kind: "relationship", category: "grandchildren" },
    ],
  },
  {
    title: "Extended Family",
    nodes: [
      { kind: "relationship", category: "aunts_uncles" },
      { kind: "relationship", category: "aunts_uncles_in_law" },
      { kind: "relationship", category: "cousins" },
      { kind: "relationship", category: "cousins_in_law" },
      { kind: "relationship", category: "nieces_nephews" },
      { kind: "relationship", category: "nieces_nephews_in_law" },
      { kind: "relationship", category: "cousins_children" },
    ],
  },
];

const SHARE_SCOPE_FIELDS = ["shareVitals", "shareStories", "shareMedia", "shareConversations"] as const;

const SHARE_SCOPE_LABELS: Record<(typeof SHARE_SCOPE_FIELDS)[number], string> = {
  shareVitals: "Vitals",
  shareStories: "Stories",
  shareMedia: "Media",
  shareConversations: "Conversations",
};

function ruleKey(relationshipCategory: RelationshipCategory) {
  return relationshipCategory;
}

function lineageSelectionOptions(relationshipCategory: RelationshipCategory): DefaultLineageSelection[] {
  return isSideSpecificCategory(relationshipCategory)
    ? ["none", "both", "maternal", "paternal"]
    : ["none", "not_applicable"];
}

function buildSubscriptionDefaults(rows: SubscriptionDefaultRule[]): SubscriptionDefaultDraft[] {
  const byKey = new Map(
    mergeWithSystemSubscriptionDefaults("", rows).map((row) => [ruleKey(row.relationshipCategory), row]),
  );
  return RULE_TEMPLATES.map((template) => {
    const existing = byKey.get(ruleKey(template.relationshipCategory));
    return {
      relationshipCategory: template.relationshipCategory,
      lineageSelection: existing?.lineageSelection ?? template.lineageSelection,
    };
  });
}

function buildShareDefaults(rows: ShareDefaultRule[]): ShareDefaultDraft[] {
  const byKey = new Map(
    mergeWithSystemShareDefaults("", rows).map((row) => [ruleKey(row.relationshipCategory), row]),
  );
  return RULE_TEMPLATES.map((template) => {
    const existing = byKey.get(ruleKey(template.relationshipCategory));
    return {
      relationshipCategory: template.relationshipCategory,
      lineageSelection: existing?.lineageSelection ?? template.lineageSelection,
      shareVitals: existing?.shareVitals ?? true,
      shareStories: existing?.shareStories ?? true,
      shareMedia: existing?.shareMedia ?? true,
      shareConversations: existing?.shareConversations ?? true,
    };
  });
}

function enabledScopeLabels(row: ShareDefaultDraft) {
  return SHARE_SCOPE_FIELDS.filter((field) => row[field]).map((field) => SHARE_SCOPE_LABELS[field]);
}

function sharingSummary(row: ShareDefaultDraft) {
  if (row.lineageSelection === "none") {
    return {
      headline: "No sharing",
      detail: "Name and relationship only",
    };
  }

  const labels = enabledScopeLabels(row);
  if (labels.length === 0) {
    return {
      headline: DEFAULT_LINEAGE_SELECTION_LABELS[row.lineageSelection],
      detail: "Name and relationship only",
    };
  }

  if (labels.length === SHARE_SCOPE_FIELDS.length) {
    return {
      headline: DEFAULT_LINEAGE_SELECTION_LABELS[row.lineageSelection],
      detail: "All content",
    };
  }

  return {
    headline: DEFAULT_LINEAGE_SELECTION_LABELS[row.lineageSelection],
    detail: labels.join(", "),
  };
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
    throw new Error(String(payload.error ?? payload.message ?? `Request failed: ${response.status}`));
  }
  return payload;
}

export function RulesTreeClient({ session }: { session: SessionInfo }) {
  const [subscriptionDefaults, setSubscriptionDefaults] = useState<SubscriptionDefaultDraft[]>(buildSubscriptionDefaults([]));
  const [shareDefaults, setShareDefaults] = useState<ShareDefaultDraft[]>(buildShareDefaults([]));
  const [editor, setEditor] = useState<RuleEditorState | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasDraftChanges, setHasDraftChanges] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let isActive = true;

    void (async () => {
      setLoading(true);
      setError("");
      try {
        const [subscriptionPayload, sharingPayload] = await Promise.all([
          fetchJson("/api/access/subscription/defaults"),
          fetchJson("/api/access/sharing/defaults"),
        ]);
        if (!isActive) return;

        setSubscriptionDefaults(
          buildSubscriptionDefaults((subscriptionPayload.rows as SubscriptionDefaultRule[] | undefined) ?? []),
        );
        setShareDefaults(buildShareDefaults((sharingPayload.rows as ShareDefaultRule[] | undefined) ?? []));
        setEditor(null);
        setHasDraftChanges(false);
      } catch (loadError) {
        if (isActive) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load rules tree.");
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    })();

    return () => {
      isActive = false;
    };
  }, [loadVersion]);

  function subscriptionRowFor(category: RelationshipCategory) {
    return subscriptionDefaults.find((row) => row.relationshipCategory === category) ?? null;
  }

  function shareRowFor(category: RelationshipCategory) {
    return shareDefaults.find((row) => row.relationshipCategory === category) ?? null;
  }

  function openEditor(category: RelationshipCategory) {
    const subscription = subscriptionRowFor(category);
    const share = shareRowFor(category);
    if (!subscription || !share) return;

    setEditor({
      category,
      subscription: { ...subscription },
      share: { ...share },
    });
  }

  function applyEditorChanges() {
    if (!editor) return;

    setSubscriptionDefaults((current) =>
      current.map((row) =>
        row.relationshipCategory === editor.category ? { ...row, ...editor.subscription } : row,
      ),
    );
    setShareDefaults((current) =>
      current.map((row) => (row.relationshipCategory === editor.category ? { ...row, ...editor.share } : row)),
    );
    setHasDraftChanges(true);
    setMessage("");
    setEditor(null);
  }

  async function saveAllDefaults() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await Promise.all([
        fetchJson("/api/access/subscription/defaults", {
          method: "PUT",
          body: JSON.stringify(subscriptionDefaults),
        }),
        fetchJson("/api/access/sharing/defaults", {
          method: "PUT",
          body: JSON.stringify(shareDefaults),
        }),
      ]);
      setMessage("Relationship defaults saved and applied.");
      setHasDraftChanges(false);
      setLoadVersion((current) => current + 1);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save relationship defaults.");
      setSaving(false);
    }
  }

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Famailink</p>
          <h1 className="title">Rules Tree</h1>
          <p className="lead">
            Use this relationship tree for broad defaults. Tap a relationship group to adjust subscription and sharing,
            then save when the whole tree looks right.
          </p>
          <p className="muted">
            Signed in as <strong>{session.username}</strong> on <code>{session.personId}</code>.
          </p>
          {hasDraftChanges ? <p className="muted rules-tree-draft-note">Draft changes are ready to save.</p> : null}
        </div>
        <div className="masthead-actions">
          <Link className="secondary-button" href="/tree">
            Person Tree
          </Link>
          <Link className="secondary-button" href="/preferences">
            Full Preferences
          </Link>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setLoadVersion((current) => current + 1)}
            disabled={loading || saving}
          >
            Reload
          </button>
          <button className="primary-button" type="button" onClick={() => void saveAllDefaults()} disabled={loading || saving}>
            {saving ? "Saving..." : "Save Defaults"}
          </button>
        </div>
      </header>

      {error ? <section className="panel error-panel">{error}</section> : null}
      {message ? <section className="panel ok-panel">{message}</section> : null}

      <section className="panel">
        <h2>How To Use This View</h2>
        <p className="muted">
          This route is for broad relationship defaults only. Open a relationship group, adjust its rule in the popout,
          and save when you are ready to apply the current draft.
        </p>
        <p className="muted">
          Unsupported future categories stay visible only as placeholders. <strong>Grandparents-In-Law</strong> is shown
          for structure, but it is not modeled or editable yet.
        </p>
      </section>

      <section className="rules-tree">
        {RULE_TREE_LEVELS.map((level, levelIndex) => (
          <div key={level.title} className="rules-tree-level">
            {levelIndex > 0 ? <div className="rules-tree-connector" aria-hidden="true" /> : null}
            <p className="rules-tree-title">{level.title}</p>
            <div className={`rules-tree-row${level.title === "Center" ? " rules-tree-row-center" : ""}`}>
              {level.nodes.map((node) => {
                if (node.kind === "anchor") {
                  return (
                    <article key={node.id} className="rules-node rules-node-anchor">
                      <p className="person-name">{node.label}</p>
                      <p className="muted rules-node-note">{node.detail}</p>
                    </article>
                  );
                }

                if (node.kind === "placeholder") {
                  return (
                    <article key={node.id} className="rules-node rules-node-placeholder">
                      <p className="person-name">{node.label}</p>
                      <p className="muted rules-node-note">{node.detail}</p>
                    </article>
                  );
                }

                const subscriptionRow = subscriptionRowFor(node.category);
                const shareRow = shareRowFor(node.category);
                if (!subscriptionRow || !shareRow) return null;

                const sharing = sharingSummary(shareRow);

                return (
                  <button
                    key={node.category}
                    type="button"
                    className="rules-node rules-node-button"
                    onClick={() => openEditor(node.category)}
                    disabled={loading || saving}
                  >
                    <span className="rules-node-kicker">Tap to edit</span>
                    <span className="person-name">{RELATIONSHIP_LABELS[node.category]}</span>
                    <span className="rules-node-summary">
                      <span className="badge state subscribed">
                        Subscribe: {DEFAULT_LINEAGE_SELECTION_LABELS[subscriptionRow.lineageSelection]}
                      </span>
                      <span className="badge state shared">Share: {sharing.headline}</span>
                    </span>
                    <span className="muted rules-node-note">{sharing.detail}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {editor ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card rules-modal-card" role="dialog" aria-modal="true" aria-labelledby="rules-editor-title">
            <div className="modal-head">
              <div>
                <p className="eyebrow">Relationship Default</p>
                <h2 id="rules-editor-title">{RELATIONSHIP_LABELS[editor.category]}</h2>
                <p className="muted">
                  Change the broad default for this relationship group. Person-by-person exceptions still belong on the
                  person tree.
                </p>
              </div>
              <button className="secondary-button" type="button" onClick={() => setEditor(null)} disabled={saving}>
                Cancel
              </button>
            </div>

            <div className="modal-sections">
              <section className="modal-section">
                <div className="modal-section-head">
                  <h3>Subscription</h3>
                  <p className="muted">This controls whether you subscribe to updates from this relationship group.</p>
                </div>
                <label className="field">
                  <span className="field-label">Default subscription</span>
                  <select
                    className="input"
                    value={editor.subscription.lineageSelection}
                    onChange={(event) =>
                      setEditor((current) =>
                        current
                          ? {
                              ...current,
                              subscription: {
                                ...current.subscription,
                                lineageSelection: event.target.value as DefaultLineageSelection,
                              },
                            }
                          : current,
                      )
                    }
                  >
                    {lineageSelectionOptions(editor.category).map((option) => (
                      <option key={option} value={option}>
                        {DEFAULT_LINEAGE_SELECTION_LABELS[option]}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              <section className="modal-section">
                <div className="modal-section-head">
                  <h3>Sharing</h3>
                  <p className="muted">This controls what content is broadly shared with this relationship group.</p>
                </div>
                <div className="modal-grid">
                  <label className="field">
                    <span className="field-label">Sharing side</span>
                    <select
                      className="input"
                      value={editor.share.lineageSelection}
                      onChange={(event) =>
                        setEditor((current) =>
                          current
                            ? {
                                ...current,
                                share: {
                                  ...current.share,
                                  lineageSelection: event.target.value as DefaultLineageSelection,
                                  ...(event.target.value === "none"
                                    ? {
                                        shareVitals: false,
                                        shareStories: false,
                                        shareMedia: false,
                                        shareConversations: false,
                                      }
                                    : {}),
                                },
                              }
                            : current,
                        )
                      }
                    >
                      {lineageSelectionOptions(editor.category).map((option) => (
                        <option key={option} value={option}>
                          {DEFAULT_LINEAGE_SELECTION_LABELS[option]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="modal-scope-block">
                    <p className="field-label">Shared content</p>
                    <div className="rules-scope-grid">
                      {SHARE_SCOPE_FIELDS.map((field) => (
                        <label key={field} className="rules-scope-pill">
                          <input
                            type="checkbox"
                            checked={editor.share[field]}
                            disabled={editor.share.lineageSelection === "none"}
                            onChange={(event) =>
                              setEditor((current) =>
                                current
                                  ? {
                                      ...current,
                                      share: {
                                        ...current.share,
                                        [field]: event.target.checked,
                                      },
                                    }
                                  : current,
                              )
                            }
                          />
                          {SHARE_SCOPE_LABELS[field]}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setEditor(null)} disabled={saving}>
                Cancel
              </button>
              <button className="primary-button" type="button" onClick={applyEditorChanges} disabled={saving}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
