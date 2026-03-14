import Link from "next/link";
import Image from "next/image";
import { getAppSession } from "@/lib/auth/session";
import { FamilyGroupSwitcher } from "@/components/FamilyGroupSwitcher";
import { getFamilyGroupBasePath, getFamilyGroupContext, getRequestFamilyGroupContext } from "@/lib/family-group/context";
import { HeaderNav } from "@/components/HeaderNav";
import { UserMenu } from "@/components/UserMenu";

type AppHeaderProps = {
  tenantKey?: string;
};

export async function AppHeader({ tenantKey }: AppHeaderProps = {}) {
  const session = await getAppSession();
  const tenant = tenantKey ? getFamilyGroupContext(session, tenantKey) : await getRequestFamilyGroupContext(session);
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
  const role = session?.user?.role === "ADMIN" ? "ADMIN" : "USER";
  const loginType = (session?.user?.email ?? "").endsWith("@local") ? "Local" : "Google";
  const appVersion =
    process.env.NEXT_PUBLIC_APP_VERSION?.trim() ||
    (process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : "") ||
    "dev";

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

          <div className="app-family-switch-inline">
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

          <UserMenu
            displayName={displayName}
            email={session?.user?.email ?? ""}
            role={role}
            loginType={loginType}
            appVersion={appVersion}
            avatarInitials={avatarInitials}
          />
        </div>

        <HeaderNav basePath={basePath} isAdmin={tenant.role === "ADMIN"} />
      </div>
    </header>
  );
}
