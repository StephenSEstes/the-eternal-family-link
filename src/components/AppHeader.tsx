import Link from "next/link";
import Image from "next/image";
import { getAppSession } from "@/lib/auth/session";
import { FamilyGroupSwitcher } from "@/components/FamilyGroupSwitcher";
import { getFamilyGroupBasePath, getRequestFamilyGroupContext } from "@/lib/family-group/context";
import { HeaderNav } from "@/components/HeaderNav";

export async function AppHeader() {
  const session = await getAppSession();
  const tenant = await getRequestFamilyGroupContext(session);
  const basePath = getFamilyGroupBasePath(tenant.tenantKey);
  const formattedFamilyName = (() => {
    const trimmed = tenant.tenantName.trim();
    if (!trimmed) return tenant.tenantName;
    if (trimmed.includes("-") || trimmed.includes(" ")) return trimmed;
    if (!/[a-z][A-Z]/.test(trimmed)) return trimmed;
    return trimmed.replace(/([a-z])([A-Z])/g, "$1-$2");
  })();
  const appTitle = `The Eternal ${formattedFamilyName} Family Link`;
  const displayName = session?.user?.name?.trim() || session?.user?.email?.split("@")[0] || "Family Member";
  const avatarInitials = displayName
    .split(/\s+/g)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="app-header-top">
          <Link href={basePath || "/"} prefetch={false} className="app-brand-link">
            <span className="app-brand-logo-wrap">
              <Image
                src="/brand/logo-arch-tree.png"
                alt="Family Link logo"
                width={3644}
                height={5264}
                className="app-brand-logo"
                priority
              />
            </span>
            <span className="app-brand-copy">
              <span className="app-brand app-brand-desktop">{appTitle}</span>
              <span className="app-brand app-brand-mobile">EFL</span>
              <span className="app-brand-subtitle">Keep your family story alive.</span>
            </span>
          </Link>

          <div className="app-mobile-family-switch">
            <FamilyGroupSwitcher
              activeFamilyGroupKey={tenant.tenantKey}
              showRole={false}
              familyGroups={tenant.tenants.map((item) => ({
                familyGroupKey: item.tenantKey,
                familyGroupName: item.tenantName,
                role: item.role,
              }))}
            />
          </div>

          <div className="app-user">
            <span className="user-avatar" aria-hidden="true">
              {avatarInitials || "FM"}
            </span>
            <div className="app-user-copy">
              <strong>{displayName}</strong>
              <span>
                {session?.user?.email ? `${session.user.email} | ${tenant.role}` : tenant.role}
              </span>
            </div>
          </div>
        </div>

        <div className="app-meta-row app-meta-row-desktop">
          <label className="app-meta-label">Family Group</label>
          <FamilyGroupSwitcher
            activeFamilyGroupKey={tenant.tenantKey}
            showRole={false}
            familyGroups={tenant.tenants.map((item) => ({
              familyGroupKey: item.tenantKey,
              familyGroupName: item.tenantName,
              role: item.role,
            }))}
          />
        </div>

        <HeaderNav basePath={basePath} isAdmin={tenant.role === "ADMIN"} />
      </div>
    </header>
  );
}
