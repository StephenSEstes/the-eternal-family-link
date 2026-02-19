import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ViewerPeopleGrid } from "@/components/ViewerPeopleGrid";
import { getEnv } from "@/lib/env";
import { getPeople } from "@/lib/google/sheets";
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
  const routeBase = `/t/${encodeURIComponent(normalizedTenantKey)}/viewer`;
  const accessCookieName = cookieNameForTenant(normalizedTenantKey);

  async function unlockViewer(formData: FormData) {
    "use server";

    const submittedPin = String(formData.get("pin") ?? "").trim();
    const env = getEnv();
    if (submittedPin !== env.VIEWER_PIN) {
      redirect(`${routeBase}?error=1`);
    }

    const cookieStore = await cookies();
    cookieStore.set(accessCookieName, "granted", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });

    redirect(routeBase);
  }

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
          <form action={unlockViewer}>
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
