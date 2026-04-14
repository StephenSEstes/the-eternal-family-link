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
  AccessCatalogPayload,
  AccessPreview,
  AccessRecomputeStatus,
  DefaultLineageSelection,
  ShareDefaultRule,
  SharePersonException,
  SubscriptionDefaultRule,
  SubscriptionPersonException,
} from "@/lib/access/types";
import { DEFAULT_LINEAGE_SELECTION_LABELS } from "@/lib/access/types";
import {
  LINEAGE_LABELS,
  RELATIONSHIP_LABELS,
  type EffectType,
  type RelationshipCategory,
  type RelationshipHit,
} from "@/lib/model/relationships";

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

type ShareExceptionDraft = {
  targetPersonId: string;
  effect: EffectType;
  allScopes: boolean;
  shareVitals: boolean;
  shareStories: boolean;
  shareMedia: boolean;
  shareConversations: boolean;
};

const EFFECT_OPTIONS: EffectType[] = ["deny", "allow"];
const EFFECT_LABELS: Record<EffectType, string> = {
  deny: "Exclude",
  allow: "Include",
};

function ruleKey(relationshipCategory: RelationshipCategory) {
  return relationshipCategory;
}

const RULE_TEMPLATES = EDITABLE_CATEGORIES.map((relationshipCategory) => ({
  relationshipCategory,
  lineageSelection: defaultInclusiveLineageSelectionForCategory(relationshipCategory),
}));

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

function buildShareExceptionDrafts(rows: SharePersonException[]): ShareExceptionDraft[] {
  return rows.map((row) => ({
    targetPersonId: row.targetPersonId,
    effect: row.effect,
    allScopes:
      row.shareVitals === null &&
      row.shareStories === null &&
      row.shareMedia === null &&
      row.shareConversations === null,
    shareVitals: row.shareVitals === true,
    shareStories: row.shareStories === true,
    shareMedia: row.shareMedia === true,
    shareConversations: row.shareConversations === true,
  }));
}

function dedupeByTarget<T extends { targetPersonId: string }>(rows: T[]) {
  const map = new Map<string, T>();
  for (const row of rows) {
    const targetPersonId = row.targetPersonId.trim();
    if (!targetPersonId) continue;
    map.set(targetPersonId, { ...row, targetPersonId } as T);
  }
  return Array.from(map.values());
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
    throw new Error(String(payload.error ?? `Request failed: ${response.status}`));
  }
  return payload;
}

function renderRelationshipHit(hit: RelationshipHit) {
  const sideLabel = hit.lineageSides.map((lineageSide) => LINEAGE_LABELS[lineageSide]).join(" / ");
  return `${RELATIONSHIP_LABELS[hit.category]}${sideLabel === LINEAGE_LABELS.not_applicable ? "" : ` - ${sideLabel}`}`;
}

function RelationshipList({ hits }: { hits: RelationshipHit[] }) {
  if (!hits.length) {
    return <p className="empty-state">No supported relationship hit.</p>;
  }

  return (
    <div className="chip-wrap">
      {hits.map((hit) => (
        <span key={`${hit.category}:${hit.lineageSides.join("-")}`} className="badge side">
          {renderRelationshipHit(hit)}
        </span>
      ))}
    </div>
  );
}

export function AccessPreferencesClient({ session }: { session: SessionInfo }) {
  const [catalog, setCatalog] = useState<AccessCatalogPayload | null>(null);
  const [subscriptionDefaults, setSubscriptionDefaults] = useState<SubscriptionDefaultDraft[]>(buildSubscriptionDefaults([]));
  const [subscriptionExceptions, setSubscriptionExceptions] = useState<SubscriptionPersonException[]>([]);
  const [shareDefaults, setShareDefaults] = useState<ShareDefaultDraft[]>(buildShareDefaults([]));
  const [shareExceptions, setShareExceptions] = useState<ShareExceptionDraft[]>([]);
  const [previewTarget, setPreviewTarget] = useState("");
  const [preview, setPreview] = useState<AccessPreview | null>(null);
  const [recomputeStatus, setRecomputeStatus] = useState<AccessRecomputeStatus | null>(null);
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
        const [catalogPayload, subDefaultsPayload, subExceptionsPayload, shareDefaultsPayload, shareExceptionsPayload, statusPayload] =
          await Promise.all([
            fetchJson("/api/access/catalog"),
            fetchJson("/api/access/subscription/defaults"),
            fetchJson("/api/access/subscription/exceptions/people"),
            fetchJson("/api/access/sharing/defaults"),
            fetchJson("/api/access/sharing/exceptions/people"),
            fetchJson("/api/access/recompute/status"),
          ]);

        if (!isActive) return;

        const nextCatalog = catalogPayload as AccessCatalogPayload;
        setCatalog(nextCatalog);
        setSubscriptionDefaults(
          buildSubscriptionDefaults((subDefaultsPayload.rows as SubscriptionDefaultRule[] | undefined) ?? []),
        );
        setSubscriptionExceptions(
          ((subExceptionsPayload.rows as SubscriptionPersonException[] | undefined) ?? []).map((row) => ({
            ...row,
            targetPersonId: row.targetPersonId.trim(),
          })),
        );
        setShareDefaults(buildShareDefaults((shareDefaultsPayload.rows as ShareDefaultRule[] | undefined) ?? []));
        setShareExceptions(
          buildShareExceptionDrafts((shareExceptionsPayload.rows as SharePersonException[] | undefined) ?? []),
        );
        setRecomputeStatus((statusPayload.status as AccessRecomputeStatus | undefined) ?? null);
        setPreviewTarget((current) => current || nextCatalog.people[0]?.personId || "");
      } catch (loadError) {
        if (isActive) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load preferences.");
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

  async function saveSubscriptionDefaults() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fetchJson("/api/access/subscription/defaults", {
        method: "PUT",
        body: JSON.stringify(subscriptionDefaults),
      });
      setMessage("Subscription defaults saved and applied.");
      setLoadVersion((current) => current + 1);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save subscription defaults.");
      setBusy(false);
    }
  }

  async function saveSubscriptionExceptions() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fetchJson("/api/access/subscription/exceptions/people", {
        method: "PUT",
        body: JSON.stringify(dedupeByTarget(subscriptionExceptions)),
      });
      setMessage("Subscription person exceptions saved and applied.");
      setLoadVersion((current) => current + 1);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save subscription exceptions.");
      setBusy(false);
    }
  }

  async function saveShareDefaults() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fetchJson("/api/access/sharing/defaults", {
        method: "PUT",
        body: JSON.stringify(shareDefaults),
      });
      setMessage("Sharing defaults saved and applied.");
      setLoadVersion((current) => current + 1);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save sharing defaults.");
      setBusy(false);
    }
  }

  async function saveShareExceptions() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fetchJson("/api/access/sharing/exceptions/people", {
        method: "PUT",
        body: JSON.stringify(
          dedupeByTarget(shareExceptions).map((row) => ({
            targetPersonId: row.targetPersonId,
            effect: row.effect,
            shareVitals: row.allScopes ? null : row.shareVitals,
            shareStories: row.allScopes ? null : row.shareStories,
            shareMedia: row.allScopes ? null : row.shareMedia,
            shareConversations: row.allScopes ? null : row.shareConversations,
          })),
        ),
      });
      setMessage("Sharing person exceptions saved and applied.");
      setLoadVersion((current) => current + 1);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save sharing exceptions.");
      setBusy(false);
    }
  }

  async function runPreview() {
    if (!previewTarget.trim()) {
      setError("Choose a family member first.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const payload = await fetchJson("/api/access/preview", {
        method: "POST",
        body: JSON.stringify({ targetPersonId: previewTarget }),
      });
      setPreview((payload.preview as AccessPreview | undefined) ?? null);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Preview failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runRecompute() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fetchJson("/api/access/recompute", {
        method: "POST",
        body: JSON.stringify({ reason: "manual" }),
      });
      setMessage("Recompute completed.");
      setLoadVersion((current) => current + 1);
    } catch (recomputeError) {
      setError(recomputeError instanceof Error ? recomputeError.message : "Recompute failed.");
      setBusy(false);
    }
  }

  function addSubscriptionException() {
    const targetPersonId = catalog?.people.find(
      (person) => !subscriptionExceptions.some((row) => row.targetPersonId === person.personId),
    )?.personId;
    if (!targetPersonId) return;

    setSubscriptionExceptions((current) => [
      ...current,
      {
        exceptionId: "",
        viewerPersonId: session.personId,
        targetPersonId,
        effect: "deny",
        createdAt: "",
        updatedAt: "",
      },
    ]);
  }

  function addShareException() {
    const targetPersonId = catalog?.people.find(
      (person) => !shareExceptions.some((row) => row.targetPersonId === person.personId),
    )?.personId;
    if (!targetPersonId) return;

    setShareExceptions((current) => [
      ...current,
      {
        targetPersonId,
        effect: "deny",
        allScopes: true,
        shareVitals: false,
        shareStories: false,
        shareMedia: false,
        shareConversations: false,
      },
    ]);
  }

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Famailink</p>
          <h1 className="title">Preferences</h1>
          <p className="lead">
            Use this page to control update subscriptions and profile sharing by relationship without changing who
            appears in your tree.
          </p>
          <p className="muted">
            Signed in as <strong>{session.username}</strong> on <code>{session.personId}</code>.
          </p>
        </div>
        <div className="masthead-actions">
          <Link className="secondary-button" href="/tree">
            Back to Tree
          </Link>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setLoadVersion((current) => current + 1)}
            disabled={busy}
          >
            Reload
          </button>
          <button className="secondary-button" type="button" onClick={() => (window.location.href = "/api/auth/logout")}>
            Sign out
          </button>
        </div>
      </header>

      {error ? <section className="panel error-panel">{error}</section> : null}
      {message ? <section className="panel ok-panel">{message}</section> : null}

      <section className="preferences-grid">
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Family Members</h2>
              <p className="muted">
                These relatives are derived from your family graph. Their presence in the tree does not depend on your
                subscription choices.
              </p>
            </div>
          </div>
          <div className="catalog-list">
            {catalog?.people.length ? (
              catalog.people.map((person) => (
                <article key={person.personId} className="catalog-card">
                  <div>
                    <p className="person-name">{person.displayName}</p>
                    <p className="catalog-id">{person.personId}</p>
                  </div>
                  <RelationshipList hits={person.relationships} />
                </article>
              ))
            ) : (
              <p className="empty-state">No supported relatives have been derived yet.</p>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Subscription Defaults</h2>
              <p className="muted">
                These start broad so you stay connected by default. Use person exceptions below when you want to mute
                one specific relative without narrowing the whole relationship group.
              </p>
            </div>
            <button className="primary-button" type="button" onClick={() => void saveSubscriptionDefaults()} disabled={busy}>
              Save
            </button>
          </div>
          <div className="table-wrap">
            <table className="prefs-table">
              <thead>
                <tr>
                  <th>Relationship</th>
                  <th>Default</th>
                </tr>
              </thead>
              <tbody>
                {subscriptionDefaults.map((row, index) => (
                  <tr key={ruleKey(row.relationshipCategory)}>
                    <td>{RELATIONSHIP_LABELS[row.relationshipCategory]}</td>
                    <td>
                      <select
                        className="input"
                        value={row.lineageSelection}
                        onChange={(event) =>
                          setSubscriptionDefaults((current) =>
                            current.map((entry, entryIndex) =>
                              entryIndex === index
                                ? { ...entry, lineageSelection: event.target.value as DefaultLineageSelection }
                                : entry,
                            ),
                          )
                        }
                      >
                        {lineageSelectionOptions(row.relationshipCategory).map((option) => (
                          <option key={option} value={option}>
                            {DEFAULT_LINEAGE_SELECTION_LABELS[option]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Sharing Defaults</h2>
              <p className="muted">
                These start broad in the MVP so family can see your profile content by relationship group. Use person
                exceptions below when you need to narrow one specific relative.
              </p>
            </div>
            <button className="primary-button" type="button" onClick={() => void saveShareDefaults()} disabled={busy}>
              Save
            </button>
          </div>
          <div className="table-wrap">
            <table className="prefs-table prefs-table-wide">
              <thead>
                <tr>
                  <th>Relationship</th>
                  <th>Family Side</th>
                  <th>Vitals</th>
                  <th>Stories</th>
                  <th>Media</th>
                  <th>Conversations</th>
                </tr>
              </thead>
              <tbody>
                {shareDefaults.map((row, index) => (
                  <tr key={ruleKey(row.relationshipCategory)}>
                    <td>{RELATIONSHIP_LABELS[row.relationshipCategory]}</td>
                    <td>
                      <select
                        className="input"
                        value={row.lineageSelection}
                        onChange={(event) =>
                          setShareDefaults((current) =>
                            current.map((entry, entryIndex) =>
                              entryIndex === index
                                ? {
                                    ...entry,
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
                                : entry,
                            ),
                          )
                        }
                      >
                        {lineageSelectionOptions(row.relationshipCategory).map((option) => (
                          <option key={option} value={option}>
                            {DEFAULT_LINEAGE_SELECTION_LABELS[option]}
                          </option>
                        ))}
                      </select>
                    </td>
                    {(["shareVitals", "shareStories", "shareMedia", "shareConversations"] as const).map((field) => (
                      <td key={field}>
                        <input
                          type="checkbox"
                          checked={row[field]}
                          disabled={row.lineageSelection === "none"}
                          onChange={(event) =>
                            setShareDefaults((current) =>
                              current.map((entry, entryIndex) =>
                                entryIndex === index ? { ...entry, [field]: event.target.checked } : entry,
                              ),
                            )
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Subscription Person Exceptions</h2>
              <p className="muted">
                Use this when you want to exclude one person from an otherwise broad subscription default.
              </p>
            </div>
            <div className="row-actions">
              <button className="secondary-button" type="button" onClick={addSubscriptionException} disabled={busy}>
                Add Person
              </button>
              <button className="primary-button" type="button" onClick={() => void saveSubscriptionExceptions()} disabled={busy}>
                Save
              </button>
            </div>
          </div>
          <div className="stack-list">
            {subscriptionExceptions.length ? (
              subscriptionExceptions.map((row, index) => (
                <div key={`${row.targetPersonId}:${index}`} className="exception-row">
                  <select
                    className="input"
                    value={row.targetPersonId}
                    onChange={(event) =>
                      setSubscriptionExceptions((current) =>
                        current.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, targetPersonId: event.target.value } : entry,
                        ),
                      )
                    }
                  >
                    {catalog?.people.map((person) => (
                      <option key={person.personId} value={person.personId}>
                        {person.displayName}
                      </option>
                    ))}
                  </select>
                  <select
                    className="input narrow-input"
                    value={row.effect}
                    onChange={(event) =>
                      setSubscriptionExceptions((current) =>
                        current.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, effect: event.target.value as EffectType } : entry,
                        ),
                      )
                    }
                  >
                    {EFFECT_OPTIONS.map((effect) => (
                      <option key={effect} value={effect}>
                        {EFFECT_LABELS[effect]}
                      </option>
                    ))}
                  </select>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() =>
                      setSubscriptionExceptions((current) => current.filter((_, entryIndex) => entryIndex !== index))
                    }
                  >
                    Remove
                  </button>
                </div>
              ))
            ) : (
              <p className="empty-state">
                Broad defaults are active. Add an exception only when one person should be treated differently.
              </p>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Sharing Person Exceptions</h2>
              <p className="muted">
                Use this when you want to narrow sharing for one person without changing the broader relationship
                default.
              </p>
            </div>
            <div className="row-actions">
              <button className="secondary-button" type="button" onClick={addShareException} disabled={busy}>
                Add Person
              </button>
              <button className="primary-button" type="button" onClick={() => void saveShareExceptions()} disabled={busy}>
                Save
              </button>
            </div>
          </div>
          <div className="stack-list">
            {shareExceptions.length ? (
              shareExceptions.map((row, index) => (
                <div key={`${row.targetPersonId}:${index}`} className="share-exception-card">
                  <div className="exception-row">
                    <select
                      className="input"
                      value={row.targetPersonId}
                      onChange={(event) =>
                        setShareExceptions((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, targetPersonId: event.target.value } : entry,
                          ),
                        )
                      }
                    >
                      {catalog?.people.map((person) => (
                        <option key={person.personId} value={person.personId}>
                          {person.displayName}
                        </option>
                      ))}
                    </select>
                    <select
                      className="input narrow-input"
                      value={row.effect}
                      onChange={(event) =>
                        setShareExceptions((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, effect: event.target.value as EffectType } : entry,
                          ),
                        )
                      }
                    >
                      {EFFECT_OPTIONS.map((effect) => (
                        <option key={effect} value={effect}>
                          {EFFECT_LABELS[effect]}
                        </option>
                      ))}
                    </select>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setShareExceptions((current) => current.filter((_, entryIndex) => entryIndex !== index))}
                    >
                      Remove
                    </button>
                  </div>
                  <label className="scope-toggle">
                    <input
                      type="checkbox"
                      checked={row.allScopes}
                      onChange={(event) =>
                        setShareExceptions((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, allScopes: event.target.checked } : entry,
                          ),
                        )
                      }
                    />
                    Apply to all content scopes
                  </label>
                  <div className="scope-grid">
                    {(["shareVitals", "shareStories", "shareMedia", "shareConversations"] as const).map((field) => (
                      <label key={field} className="scope-option">
                        <input
                          type="checkbox"
                          checked={row[field]}
                          disabled={row.allScopes}
                          onChange={(event) =>
                            setShareExceptions((current) =>
                              current.map((entry, entryIndex) =>
                                entryIndex === index ? { ...entry, [field]: event.target.checked } : entry,
                              ),
                            )
                          }
                        />
                        {field.replace("share", "")}
                      </label>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="empty-state">
                Broad defaults are active. Add an exception only when one person should be treated differently.
              </p>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Recompute Status</h2>
              <p className="muted">
                Saving now applies automatically, but you can still run a full recompute to refresh every saved
                subscription and sharing row for this signed-in viewer.
              </p>
            </div>
            <div className="row-actions">
              <button className="secondary-button" type="button" onClick={() => setLoadVersion((current) => current + 1)} disabled={busy}>
                Refresh Status
              </button>
              <button className="primary-button" type="button" onClick={() => void runRecompute()} disabled={busy}>
                Run Recompute
              </button>
            </div>
          </div>

          <div className="preview-grid">
            <article className="stat-card">
              <p className="stat-label">Latest Job</p>
              <p className="stat-value">{recomputeStatus?.latestJob?.status ?? "Not Run"}</p>
              <p className="muted">{recomputeStatus?.latestJob?.requestedAt || "No recompute job recorded yet."}</p>
            </article>
            <article className="stat-card">
              <p className="stat-label">Latest Run</p>
              <p className="stat-value">{recomputeStatus?.latestRun?.status ?? "Not Run"}</p>
              <p className="muted">{recomputeStatus?.latestRun?.completedAt || "No recompute run completed yet."}</p>
            </article>
            <article className="stat-card">
              <p className="stat-label">Processed Targets</p>
              <p className="stat-value">{recomputeStatus?.latestRun?.processedCount ?? 0}</p>
              <p className="muted">Changed targets: {recomputeStatus?.latestRun?.changedCount ?? 0}</p>
            </article>
            <article className="stat-card">
              <p className="stat-label">Latest Map Version</p>
              <p className="stat-value recompute-version">
                {recomputeStatus?.summary?.mapVersion ? recomputeStatus.summary.mapVersion.slice(0, 12) : "None"}
              </p>
              <p className="muted">{recomputeStatus?.summary?.lastComputedAt || "No derived map written yet."}</p>
            </article>
          </div>

          {recomputeStatus?.summary ? (
            <div className="summary-strip recompute-summary">
              <div className="stat-grid">
                <article className="stat-card">
                  <p className="stat-label">Visibility Rows</p>
                  <p className="stat-value">{recomputeStatus.summary.visibilityRowCount}</p>
                </article>
                <article className="stat-card">
                  <p className="stat-label">Subscription Rows</p>
                  <p className="stat-value">{recomputeStatus.summary.subscriptionRowCount}</p>
                </article>
                <article className="stat-card">
                  <p className="stat-label">Subscribed</p>
                  <p className="stat-value">{recomputeStatus.summary.subscribedCount}</p>
                </article>
                <article className="stat-card">
                  <p className="stat-label">Shared Content</p>
                  <p className="stat-value">{recomputeStatus.summary.sharedCount}</p>
                </article>
                <article className="stat-card">
                  <p className="stat-label">Name Only</p>
                  <p className="stat-value">{recomputeStatus.summary.placeholderOnlyCount}</p>
                </article>
              </div>
            </div>
          ) : (
            <p className="empty-state">No persisted derived map has been written yet.</p>
          )}
        </section>

        <section className="panel preview-panel">
          <div className="section-head">
            <div>
              <h2>Preview One Relative</h2>
              <p className="muted">
                Preview shows how one relative is treated by the current relationship, subscription, and sharing rules.
              </p>
            </div>
            <div className="row-actions">
              <select className="input" value={previewTarget} onChange={(event) => setPreviewTarget(event.target.value)}>
                <option value="">Choose family member</option>
                {catalog?.people.map((person) => (
                  <option key={person.personId} value={person.personId}>
                    {person.displayName}
                  </option>
                ))}
              </select>
              <button className="primary-button" type="button" onClick={() => void runPreview()} disabled={busy}>
                Preview
              </button>
            </div>
          </div>

          {preview ? (
            <div className="preview-grid">
              <article className="stat-card">
                <p className="stat-label">Target Person</p>
                <p className="stat-value">{preview.targetDisplayName}</p>
                <p className="catalog-id">{preview.targetPersonId}</p>
              </article>
              <article className="stat-card">
                <p className="stat-label">Tree Visibility</p>
                <p className="stat-value">{preview.tree.visibleByNameAndRelationship ? "Visible" : "Hidden"}</p>
                <p className="muted">Source: {preview.tree.source}</p>
              </article>
              <article className="stat-card">
                <p className="stat-label">Subscription</p>
                <p className="stat-value">{preview.subscription.isSubscribed ? "Subscribed" : "Not Subscribed"}</p>
                <p className="muted">Source: {preview.subscription.source}</p>
              </article>
              <article className="stat-card">
                <p className="stat-label">Content Visibility</p>
                <p className="stat-value">
                  {preview.sharing.placeholderOnly ? "Name Only" : preview.sharing.anyShared ? "Shared" : "No Content"}
                </p>
                <p className="muted">Placeholder only: {preview.sharing.placeholderOnly ? "Yes" : "No"}</p>
              </article>

              <article className="panel inset-panel">
                <h3>Viewer to Target</h3>
                <RelationshipList hits={preview.viewerToTargetRelationships} />
              </article>
              <article className="panel inset-panel">
                <h3>Target to Viewer</h3>
                <RelationshipList hits={preview.targetToViewerRelationships} />
              </article>

              <article className="panel inset-panel scope-results">
                <h3>Sharing Scope Results</h3>
                <div className="scope-results-grid">
                  {(Object.entries(preview.sharing.scopes) as Array<[string, { allowed: boolean; source: string }]>).map(
                    ([scope, result]) => (
                      <div key={scope} className="scope-result-card">
                        <p className="scope-name">{scope}</p>
                        <p className="scope-value">{result.allowed ? "Visible" : "Hidden"}</p>
                        <p className="muted">{result.source}</p>
                      </div>
                    ),
                  )}
                </div>
              </article>
            </div>
          ) : (
            <p className="empty-state">Choose a supported family member and run preview.</p>
          )}
        </section>
      </section>
    </main>
  );
}
