import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { TenantSwitcher } from "@/components/TenantSwitcher";
import { getRequestTenantContext, getTenantBasePath } from "@/lib/tenant/context";

export async function AppHeader() {
  const session = await getAppSession();
  const tenant = await getRequestTenantContext(session);
  const basePath = getTenantBasePath(tenant.tenantKey);

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link href={basePath || "/"} className="app-brand">
          The Eternal Family Link
        </Link>

        <nav className="app-nav">
          <Link href={basePath || "/"} className="pill-link">
            Home
          </Link>
          <Link href={`${basePath}/people`} className="pill-link">
            People
          </Link>
          <Link href={`${basePath}/tree`} className="pill-link">
            Family Tree
          </Link>
          <Link href={`${basePath}/today`} className="pill-link">
            Today
          </Link>
          <Link href={`${basePath}/games`} className="pill-link">
            Games
          </Link>
          {tenant.role === "ADMIN" ? (
            <Link href={`${basePath}/settings`} className="pill-link">
              Settings
            </Link>
          ) : null}
          <Link href="/api/auth/signout" className="pill-link">
            Sign out
          </Link>
        </nav>

        <div className="app-meta">
          <span className="tenant-chip">{tenant.tenantName}</span>
          <TenantSwitcher
            activeTenantKey={tenant.tenantKey}
            tenants={tenant.tenants.map((item) => ({
              tenantKey: item.tenantKey,
              tenantName: item.tenantName,
              role: item.role,
            }))}
          />
          <span>{session?.user?.email ? `${session.user.email} (${session.user.role ?? "USER"})` : "Not signed in"}</span>
        </div>
      </div>
    </header>
  );
}
