"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FamailinkChrome } from "@/components/FamailinkChrome";
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
  | { kind: "relationship"; category: RelationshipCategory; orb: string };

const RULE_TEMPLATES = EDITABLE_CATEGORIES.map((relationshipCategory) => ({
  relationshipCategory,
  lineageSelection: defaultInclusiveLineageSelectionForCategory(relationshipCategory),
}));

const RULE_TREE_GENERATIONS: Array<{ id: string; label: string; description: string; nodes: RuleNode[] }> = [
  {
    id: "grandparents",
    label: "Grandparents",
    description: "Oldest generation in the default tree",
    nodes: [
      { kind: "relationship", category: "grandparents", orb: "GP" },
      { kind: "relationship", category: "grandparents_in_law", orb: "GI" },
    ],
  },
  {
    id: "parents",
    label: "Parents Generation",
    description: "Parents and same-generation branches above you",
    nodes: [
      { kind: "relationship", category: "aunts_uncles", orb: "AU" },
      { kind: "relationship", category: "parents", orb: "P" },
      { kind: "relationship", category: "parents_in_law", orb: "PI" },
    ],
  },
  {
    id: "self",
    label: "Your Generation",
    description: "You, spouse, siblings, and cousins",
    nodes: [
      { kind: "relationship", category: "cousins", orb: "C" },
      { kind: "relationship", category: "siblings", orb: "S" },
      { kind: "anchor", id: "self", label: "You", detail: "Exceptions stay on the real family tree." },
      { kind: "relationship", category: "spouse", orb: "SP" },
      { kind: "relationship", category: "siblings_in_law", orb: "SI" },
    ],
  },
  {
    id: "children",
    label: "Children Generation",
    description: "Children and same-generation branches below you",
    nodes: [
      { kind: "relationship", category: "nieces_nephews", orb: "NN" },
      { kind: "relationship", category: "children", orb: "CH" },
      { kind: "relationship", category: "children_in_law", orb: "CL" },
      { kind: "relationship", category: "nieces_nephews_in_law", orb: "NI" },
    ],
  },
  {
    id: "grandchildren",
    label: "Grandchildren",
    description: "Youngest generation in the current model",
    nodes: [
      { kind: "relationship", category: "cousins_children", orb: "CC" },
      { kind: "relationship", category: "grandchildren", orb: "GC" },
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

function subscriptionCode(selection: DefaultLineageSelection) {
  if (selection === "none") return "-";
  if (selection === "maternal") return "M";
  if (selection === "paternal") return "P";
  return "B";
}

function shareScopeCode(row: ShareDefaultDraft) {
  if (row.lineageSelection === "none") return "-";

  const codes = [
    row.shareVitals ? "V" : "",
    row.shareStories ? "S" : "",
    row.shareMedia ? "M" : "",
    row.shareConversations ? "C" : "",
  ].filter(Boolean);

  return codes.length ? codes.join(" ") : "-";
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
  const [collapsedGenerations, setCollapsedGenerations] = useState<Set<string>>(new Set());
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

  function toggleGeneration(generationId: string) {
    setCollapsedGenerations((current) => {
      const next = new Set(current);
      if (next.has(generationId)) {
        next.delete(generationId);
      } else {
        next.add(generationId);
      }
      return next;
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
    <main className="shell rules-tree-shell">
      <FamailinkChrome active="administration" username={session.username} personId={session.personId} />
      <header className="masthead">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 className="title">Rules Tree</h1>
          <p className="lead">
            This is the compact defaults tree. Each card is a relationship group. Keep the broad rules simple here,
            then use the real family tree for one-person exceptions and edge cases.
          </p>
          {hasDraftChanges ? <p className="muted rules-tree-draft-note">Draft changes are ready to save.</p> : null}
        </div>
        <div className="masthead-actions">
          <Link className="secondary-button" href="/administration">
            Administration
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

      <section className="panel rules-tree-panel">
        <h2>How To Use This View</h2>
        <p className="muted">
          This route is for broad relationship defaults only. It is organized by generation so the older branches stay
          above you, peers stay in the center, and younger branches stay below.
        </p>
        <p className="muted">
          `Subs` shows the branch shorthand for subscriptions. `Share` shows the content scope letters. Person-specific
          exceptions still belong on the real family tree.
        </p>
      </section>

      <section className="rules-tree-graph-wrap">
        <div className="rules-tree-cloud-overlay" />
        <div className="rules-tree-graph">
          {RULE_TREE_GENERATIONS.map((generation, generationIndex) => (
            <div key={generation.id} className="rules-generation">
              <div className="rules-generation-header">
                <button
                  type="button"
                  className="rules-generation-toggle"
                  onClick={() => toggleGeneration(generation.id)}
                  aria-expanded={!collapsedGenerations.has(generation.id)}
                >
                  <span>{generation.label}</span>
                  <span>{collapsedGenerations.has(generation.id) ? "+" : "-"}</span>
                </button>
                <p className="rules-generation-note">{generation.description}</p>
              </div>
              {!collapsedGenerations.has(generation.id) ? <div className="rules-generation-row">
                {generation.nodes.map((node) => {
                  if (node.kind === "anchor") {
                    return (
                      <article key={node.id} className="rules-node rules-node-anchor">
                        <p className="person-name">{node.label}</p>
                        <p className="muted rules-node-note">{node.detail}</p>
                      </article>
                    );
                  }

                  const subscriptionRow = subscriptionRowFor(node.category);
                  const shareRow = shareRowFor(node.category);
                  if (!subscriptionRow || !shareRow) return null;

                  return (
                    <button
                      key={node.category}
                      type="button"
                      className={`rules-node rules-node-button${node.category === "spouse" ? " rules-node-spouse" : ""}`}
                      onClick={() => openEditor(node.category)}
                      disabled={loading || saving}
                    >
                      <span className="person-name">{RELATIONSHIP_LABELS[node.category]}</span>
                      <span className="rules-node-summary-head">
                        <span className="rules-node-metric-label">Subs</span>
                        <span className="rules-node-metric-label">Share</span>
                      </span>
                      <span className="rules-node-summary-values">
                        <strong>{subscriptionCode(subscriptionRow.lineageSelection)}</strong>
                        <strong>{shareScopeCode(shareRow)}</strong>
                      </span>
                    </button>
                  );
                })}
              </div> : null}
              {generationIndex < RULE_TREE_GENERATIONS.length - 1 && !collapsedGenerations.has(generation.id) ? (
                <div className="rules-generation-link" />
              ) : null}
            </div>
          ))}
        </div>
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
                  <span className="field-label">Default subscription branch</span>
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
                    <span className="field-label">Sharing branch</span>
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
