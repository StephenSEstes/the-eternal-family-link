import Link from "next/link";
import { redirect } from "next/navigation";
import { getRecomputeStatus } from "@/lib/access/recompute";
import { listProfileSubscriptionMap, listProfileVisibilityMap } from "@/lib/access/store";
import type { ProfileSubscriptionMapRow, ProfileVisibilityMapRow } from "@/lib/access/types";
import { getSessionFromCookieStore } from "@/lib/auth/session";
import {
  CATEGORY_LABELS,
  type FamilyBucketPerson,
  type RelationshipCategory,
  buildTreeLabSnapshot,
} from "@/lib/family/store";

const TREE_COLUMNS: Array<{ title: string; categories: RelationshipCategory[] }> = [
  { title: "Roots", categories: ["grandparents", "parents"] },
  { title: "Center", categories: ["siblings", "self", "spouse"] },
  { title: "Branches", categories: ["children", "grandchildren"] },
  { title: "Extended", categories: ["aunts_uncles", "cousins", "cousins_children", "nieces_nephews"] },
];

function readSideLabel(side: string) {
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
  if (!row) {
    return { label: "Pending Recompute", badgeClass: "pending" };
  }
  if (row.placeholderOnly) {
    return { label: "Name Only", badgeClass: "placeholder" };
  }
  if (row.canVitals || row.canStories || row.canMedia || row.canConversations) {
    return { label: "Shared", badgeClass: "shared" };
  }
  return { label: "No Content", badgeClass: "closed" };
}

function subscriptionSummary(row: ProfileSubscriptionMapRow | undefined) {
  if (!row) {
    return { label: "Pending Recompute", badgeClass: "pending" };
  }
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

function PersonCard({
  person,
  category,
  visibilityRow,
  subscriptionRow,
}: {
  person: FamilyBucketPerson;
  category: RelationshipCategory;
  visibilityRow?: ProfileVisibilityMapRow;
  subscriptionRow?: ProfileSubscriptionMapRow;
}) {
  const sharing = shareSummary(visibilityRow);
  const subscription = subscriptionSummary(subscriptionRow);
  const scopes = scopeList(visibilityRow);

  return (
    <article className="person-card">
      <p className="person-name">{person.displayName}</p>
      <div className="person-meta">
        <span className={`badge ${category === "self" ? "self" : "side"}`}>{CATEGORY_LABELS[category]}</span>
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
    </article>
  );
}

function Bucket({
  category,
  people,
  visibilityByTarget,
  subscriptionByTarget,
}: {
  category: RelationshipCategory;
  people: FamilyBucketPerson[];
  visibilityByTarget: Map<string, ProfileVisibilityMapRow>;
  subscriptionByTarget: Map<string, ProfileSubscriptionMapRow>;
}) {
  return (
    <section className="bucket">
      <div className="bucket-header">
        <h2 className="bucket-title">{CATEGORY_LABELS[category]}</h2>
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
            />
          ))
        ) : (
          <p className="empty-state">No matched relatives in this bucket yet.</p>
        )}
      </div>
    </section>
  );
}

export default async function TreePage() {
  const session = await getSessionFromCookieStore();
  if (!session) redirect("/login");

  const [snapshot, recomputeStatus, visibilityRows, subscriptionRows] = await Promise.all([
    buildTreeLabSnapshot(session.personId),
    getRecomputeStatus(session.personId),
    listProfileVisibilityMap(session.personId),
    listProfileSubscriptionMap(session.personId),
  ]);
  const visibilityByTarget = new Map(visibilityRows.map((row) => [row.targetPersonId, row]));
  const subscriptionByTarget = new Map(subscriptionRows.map((row) => [row.targetPersonId, row]));
  const hasPersistedMaps = Boolean(recomputeStatus.summary);

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Famailink</p>
          <h1 className="title">Tree Lab</h1>
          <p className="lead">
            The tree groups relatives by relationship bucket and now reads back the persisted recompute results so you
            can see saved subscription and sharing outcomes directly on the tree.
          </p>
        </div>
        <div className="masthead-actions">
          <Link className="secondary-button" href="/preferences">
            Preferences
          </Link>
          <form action="/api/auth/logout" method="post">
            <button className="secondary-button" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="summary-strip">
        <div className="stat-grid">
          <article className="stat-card">
            <p className="stat-label">Signed In Person</p>
            <p className="stat-value">{snapshot.viewer.displayName}</p>
          </article>
          <article className="stat-card">
            <p className="stat-label">People Read</p>
            <p className="stat-value">{snapshot.peopleCount}</p>
          </article>
          <article className="stat-card">
            <p className="stat-label">Relationship Rows</p>
            <p className="stat-value">{snapshot.relationshipCount}</p>
          </article>
          <article className="stat-card">
            <p className="stat-label">Visible Relatives</p>
            <p className="stat-value">{snapshot.relatedCount}</p>
          </article>
          <article className="stat-card">
            <p className="stat-label">Persisted Readback</p>
            <p className="stat-value">{hasPersistedMaps ? "Ready" : "Pending"}</p>
          </article>
          <article className="stat-card">
            <p className="stat-label">Last Recompute</p>
            <p className="stat-value recompute-value">{formatTimestamp(recomputeStatus.summary?.lastComputedAt ?? "")}</p>
          </article>
        </div>
      </section>

      <section className="panel">
        <h2>Persisted Access Readback</h2>
        {hasPersistedMaps ? (
          <>
            <p className="muted">
              Tree cards below are showing the last saved recompute state, not just the raw relationship graph.
            </p>
            <div className="stat-grid recompute-summary-grid">
              <article className="stat-card">
                <p className="stat-label">Visibility Rows</p>
                <p className="stat-value">{recomputeStatus.summary?.visibilityRowCount ?? 0}</p>
              </article>
              <article className="stat-card">
                <p className="stat-label">Subscription Rows</p>
                <p className="stat-value">{recomputeStatus.summary?.subscriptionRowCount ?? 0}</p>
              </article>
              <article className="stat-card">
                <p className="stat-label">Subscribed Relatives</p>
                <p className="stat-value">{recomputeStatus.summary?.subscribedCount ?? 0}</p>
              </article>
              <article className="stat-card">
                <p className="stat-label">Shared or Name Only</p>
                <p className="stat-value">
                  {(recomputeStatus.summary?.sharedCount ?? 0) + (recomputeStatus.summary?.placeholderOnlyCount ?? 0)}
                </p>
              </article>
            </div>
          </>
        ) : (
          <p className="muted">
            No persisted recompute output exists yet for this viewer. Run recompute from Preferences to populate the
            saved subscription and sharing state that this tree reads back.
          </p>
        )}
      </section>

      <section className="tree-layout">
        {TREE_COLUMNS.map((column) => (
          <div key={column.title} className="tree-column">
            <h2 className="tree-column-title">{column.title}</h2>
            {column.categories.map((category) => (
              <Bucket
                key={category}
                category={category}
                people={snapshot.buckets[category]}
                visibilityByTarget={visibilityByTarget}
                subscriptionByTarget={subscriptionByTarget}
              />
            ))}
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>What This Slice Proves</h2>
        <p className="muted">
          The clean Famailink app can sign in locally, read OCI people and relationship rows, derive the agreed
          relationship buckets, and show the last persisted recompute results on the tree itself.
        </p>
        <p className="muted">
          Preferences remains the edit surface, while the tree is now the readback surface for the stored subscription
          and sharing outputs.
        </p>
      </section>
    </main>
  );
}
