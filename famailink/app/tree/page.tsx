import Link from "next/link";
import { redirect } from "next/navigation";
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

function PersonCard({ person, category }: { person: FamilyBucketPerson; category: RelationshipCategory }) {
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
      </div>
    </article>
  );
}

function Bucket({
  category,
  people,
}: {
  category: RelationshipCategory;
  people: FamilyBucketPerson[];
}) {
  return (
    <section className="bucket">
      <div className="bucket-header">
        <h2 className="bucket-title">{CATEGORY_LABELS[category]}</h2>
        <span className="bucket-count">{people.length}</span>
      </div>
      <div className="bucket-people">
        {people.length ? (
          people.map((person) => <PersonCard key={`${category}:${person.personId}`} person={person} category={category} />)
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

  const snapshot = await buildTreeLabSnapshot(session.personId);

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Famailink</p>
          <h1 className="title">Tree Lab</h1>
          <p className="lead">
            This first slice proves local login and relationship reads. The tree is grouped by family relationship
            buckets around you so we can validate the model before wiring subscriptions and sharing.
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
        </div>
      </section>

      <section className="tree-layout">
        {TREE_COLUMNS.map((column) => (
          <div key={column.title} className="tree-column">
            <h2 className="tree-column-title">{column.title}</h2>
            {column.categories.map((category) => (
              <Bucket key={category} category={category} people={snapshot.buckets[category]} />
            ))}
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>What This Slice Proves</h2>
        <p className="muted">
          The clean Famailink app can sign in locally, read OCI people and relationship rows, and derive the agreed
          relationship buckets without relying on the mixed-auth EFL2 drift.
        </p>
        <p className="muted">
          The new preferences lab now adds subscription defaults, person exceptions, sharing defaults, and a live
          preview that keeps tree visibility separate from notifications and content sharing.
        </p>
      </section>
    </main>
  );
}
