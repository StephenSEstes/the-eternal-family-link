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
      { kind: "anchor", id: "self", label: "You", detail: "Anchor for the relationship rules tree" },
      { kind: "relationship", category: "spouse" },
    ],
  },
  {
    title: "Peers",
    nodes: [
      { kind: "relationship", category: "siblings" },
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
  const [loadVersion, setLoadVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let isActive = true;

    void (async () => {
      setBusy(true);
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
      } catch (loadError) {
        if (isActive) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load rules tree.");
        }
      } finally {
        if (isActive) {
          setBusy(false);
        }
      }
    })();

    return () => {
      isActive = false;
    };
  }, [loadVersion]);

  async function saveAllDefaults() {
    setBusy(true);
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
      setLoadVersion((current) => current + 1);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save relationship defaults.");
      setBusy(false);
    }
  }

  function subscriptionRowFor(category: RelationshipCategory) {
    return subscriptionDefaults.find((row) => row.relationshipCategory === category) ?? null;
  }

  function shareRowFor(category: RelationshipCategory) {
    return shareDefaults.find((row) => row.relationshipCategory === category) ?? null;
  }

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Famailink</p>
          <h1 className="title">Rules Tree</h1>
          <p className="lead">
            This is the generic relationship rules tree for broad defaults. Use it to decide how whole relationship
            groups should be subscribed and shared before you narrow anything at the person level.
          </p>
          <p className="muted">
            Signed in as <strong>{session.username}</strong> on <code>{session.personId}</code>.
          </p>
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
            disabled={busy}
          >
            Reload
          </button>
          <button className="primary-button" type="button" onClick={() => void saveAllDefaults()} disabled={busy}>
            {busy ? "Saving..." : "Save Defaults"}
          </button>
        </div>
      </header>

      {error ? <section className="panel error-panel">{error}</section> : null}
      {message ? <section className="panel ok-panel">{message}</section> : null}

      <section className="panel">
        <h2>How To Use This View</h2>
        <p className="muted">
          This route edits relationship defaults only. It is the broad-rules surface. Use the person tree when one
          specific relative needs to be handled differently.
        </p>
        <p className="muted">
          Unsupported future categories are shown only as placeholders. For example, <strong>Grandparents-In-Law</strong>
          is not editable yet because it is not modeled in Famailink today.
        </p>
      </section>

      <section className="rules-tree">
        {RULE_TREE_LEVELS.map((level, levelIndex) => (
          <div key={level.title} className="rules-tree-level">
            {levelIndex > 0 ? <div className="rules-tree-connector" aria-hidden="true" /> : null}
            <p className="rules-tree-title">{level.title}</p>
            <div className="rules-tree-row">
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

                return (
                  <article key={node.category} className="rules-node">
                    <p className="person-name">{RELATIONSHIP_LABELS[node.category]}</p>
                    <div className="rules-node-section">
                      <label className="field">
                        <span className="field-label">Subscription</span>
                        <select
                          className="input"
                          value={subscriptionRow.lineageSelection}
                          onChange={(event) =>
                            setSubscriptionDefaults((current) =>
                              current.map((row) =>
                                row.relationshipCategory === node.category
                                  ? { ...row, lineageSelection: event.target.value as DefaultLineageSelection }
                                  : row,
                              ),
                            )
                          }
                        >
                          {lineageSelectionOptions(node.category).map((option) => (
                            <option key={option} value={option}>
                              {DEFAULT_LINEAGE_SELECTION_LABELS[option]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="rules-node-section">
                      <label className="field">
                        <span className="field-label">Sharing Side</span>
                        <select
                          className="input"
                          value={shareRow.lineageSelection}
                          onChange={(event) =>
                            setShareDefaults((current) =>
                              current.map((row) =>
                                row.relationshipCategory === node.category
                                  ? {
                                      ...row,
                                      lineageSelection: event.target.value as DefaultLineageSelection,
                                      ...(event.target.value === "none"
                                        ? {
                                            shareVitals: false,
                                            shareStories: false,
                                            shareMedia: false,
                                            shareConversations: false,
                                          }
                                        : {}),
                                    }
                                  : row,
                              ),
                            )
                          }
                        >
                          {lineageSelectionOptions(node.category).map((option) => (
                            <option key={option} value={option}>
                              {DEFAULT_LINEAGE_SELECTION_LABELS[option]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="rules-scope-grid">
                        {(["shareVitals", "shareStories", "shareMedia", "shareConversations"] as const).map((field) => (
                          <label key={field} className="rules-scope-pill">
                            <input
                              type="checkbox"
                              checked={shareRow[field]}
                              disabled={shareRow.lineageSelection === "none"}
                              onChange={(event) =>
                                setShareDefaults((current) =>
                                  current.map((row) =>
                                    row.relationshipCategory === node.category
                                      ? { ...row, [field]: event.target.checked }
                                      : row,
                                  ),
                                )
                              }
                            />
                            {field.replace("share", "")}
                          </label>
                        ))}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
