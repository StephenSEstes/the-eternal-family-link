import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { FamilyGroupSwitcher } from "@/components/FamilyGroupSwitcher";
import { getFamilyGroupBasePath, getRequestFamilyGroupContext } from "@/lib/family-group/context";

export async function AppHeader() {
  const session = await getAppSession();
  const tenant = await getRequestFamilyGroupContext(session);
  const basePath = getFamilyGroupBasePath(tenant.tenantKey);

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="app-header-top">
          <Link href={basePath || "/"} className="app-brand">
            The Eternal Family Link
          </Link>

          <div className="app-meta">
            <span>Family group:</span>
            <span className="tenant-chip">{tenant.tenantName}</span>
            <FamilyGroupSwitcher
              activeFamilyGroupKey={tenant.tenantKey}
              familyGroups={tenant.tenants.map((item) => ({
                familyGroupKey: item.tenantKey,
                familyGroupName: item.tenantName,
                role: item.role,
              }))}
            />
            <span>{session?.user?.email ? `${session.user.email} (${session.user.role ?? "USER"})` : "Not signed in"}</span>
          </div>
        </div>

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
      </div>
    </header>
  );
}
