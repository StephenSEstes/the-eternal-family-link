import { cookies } from "next/headers";
import { ViewerPeopleGrid } from "@/components/ViewerPeopleGrid";
import { getPeople, getTenantConfig } from "@/lib/google/sheets";
import { normalizeTenantRouteKey } from "@/lib/tenant/context";

type TenantViewerPageProps = {
  params: Promise<{ tenantKey: string }>;
  searchParams: Promise<{ error?: string }>;
};

function cookieNameForTenant(tenantKey: string) {
  return `viewer_access_${tenantKey}`;
}

export default async function TenantViewerPage({ params, searchParams }: TenantViewerPageProps) {
  const { tenantKey } = await params;
  const normalizedTenantKey = normalizeTenantRouteKey(tenantKey);
  const accessCookieName = cookieNameForTenant(normalizedTenantKey);
  await getTenantConfig(normalizedTenantKey);

  const paramsObj = await searchParams;
  const cookieStore = await cookies();
  const unlocked = cookieStore.get(accessCookieName)?.value === "granted";

  if (!unlocked) {
    return (
      <main className="section">
        <section className="card" style={{ maxWidth: "560px", margin: "8vh auto" }}>
          <h1 className="page-title" style={{ fontSize: "2rem" }}>
            Family Viewer
          </h1>
          <p className="page-subtitle">Tenant: {normalizedTenantKey}</p>
          <form method="POST" action={`/api/t/${encodeURIComponent(normalizedTenantKey)}/viewer/unlock`}>
            <label className="label" htmlFor="pin">
              PIN
            </label>
            <input id="pin" name="pin" className="input" type="password" inputMode="numeric" required />
            <button className="button" type="submit">
              Unlock Viewer
            </button>
          </form>
          {paramsObj.error ? <p className="status-warn">Incorrect PIN. Please try again.</p> : null}
        </section>
      </main>
    );
  }

  const people = await getPeople(normalizedTenantKey);
  const pinned = people.filter((person) => person.isPinned);

  return (
    <main className="section">
      <h1 className="page-title">Family Viewer</h1>
      <p className="page-subtitle">Tenant-scoped read-only mode.</p>
      <ViewerPeopleGrid people={pinned.length > 0 ? pinned : people.slice(0, 24)} tenantKey={normalizedTenantKey} />
    </main>
  );
}
