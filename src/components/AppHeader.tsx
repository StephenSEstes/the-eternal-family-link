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
          <Link href={basePath || "/"} className="app-brand-link">
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
              <span className="app-brand">{appTitle}</span>
              <span className="app-brand-subtitle">Keep your family story alive.</span>
            </span>
          </Link>

          <div className="app-user">
            <button type="button" className="icon-chip" aria-label="Notifications">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3a5 5 0 0 0-5 5v2.7c0 .8-.3 1.6-.9 2.2L4.5 14.5A1 1 0 0 0 5.2 16H19a1 1 0 0 0 .7-1.7l-1.6-1.6a3.2 3.2 0 0 1-.9-2.2V8a5 5 0 0 0-5-5z" />
                <path d="M9.5 17a2.5 2.5 0 0 0 5 0" />
              </svg>
            </button>
            <span className="user-avatar" aria-hidden="true">
              {avatarInitials || "FM"}
            </span>
            <div className="app-user-copy">
              <strong>{displayName}</strong>
              <span>{session?.user?.email ? session.user.email : "Not signed in"}</span>
            </div>
          </div>
        </div>

        <div className="app-meta-row">
          <label className="app-meta-label">Family Group</label>
          <FamilyGroupSwitcher
            activeFamilyGroupKey={tenant.tenantKey}
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
