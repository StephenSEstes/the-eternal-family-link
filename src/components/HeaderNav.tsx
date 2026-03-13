"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

type HeaderNavProps = {
  basePath: string;
  isAdmin: boolean;
};

type NavItem = {
  label: string;
  href: string;
  match: (pathname: string) => boolean;
  icon: ReactNode;
};

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 10.5L12 3l9 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-9z" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <circle cx="16.5" cy="9" r="2.5" />
      <path d="M2.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M12.5 19a4 4 0 0 1 8 0" />
    </svg>
  );
}

function TreeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="6.5" r="2.5" />
      <circle cx="6.5" cy="12.5" r="2.5" />
      <circle cx="17.5" cy="12.5" r="2.5" />
      <path d="M12 9v3M9 13l2-1M15 13l-2-1M12 15v5" />
    </svg>
  );
}

function TodayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
      <circle cx="12" cy="15" r="2.5" />
    </svg>
  );
}

function GameIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="8" width="18" height="10" rx="4" />
      <path d="M8 11v4M6 13h4M16.5 12h.01M18.5 14h.01" />
    </svg>
  );
}

function MediaIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8" cy="10" r="1.8" />
      <path d="M6 17l4-4 2.5 2.5 2.5-3 3 4.5" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 4.4 1.6c-.9 1-1.9 1.6-1.9 3" />
      <circle cx="12" cy="17.2" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" />
      <path d="M19.4 15a7.9 7.9 0 0 0 .1-1 7.9 7.9 0 0 0-.1-1l2-1.6-2-3.4-2.5 1a8.2 8.2 0 0 0-1.7-1L14.8 4h-5.6l-.4 2.9a8.2 8.2 0 0 0-1.7 1l-2.5-1-2 3.4 2 1.6a7.9 7.9 0 0 0-.1 1 7.9 7.9 0 0 0 .1 1l-2 1.6 2 3.4 2.5-1a8.2 8.2 0 0 0 1.7 1l.4 2.9h5.6l.4-2.9a8.2 8.2 0 0 0 1.7-1l2.5 1 2-3.4-2-1.6z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

export function HeaderNav({ basePath, isAdmin }: HeaderNavProps) {
  const router = useRouter();
  const pathname = usePathname() || "/";

  const sectionItems: NavItem[] = [
    {
      label: "Home",
      href: basePath || "/",
      match: (path) => path === (basePath || "/"),
      icon: <HomeIcon />,
    },
    {
      label: "Calendar",
      href: `${basePath}/today`,
      match: (path) => path.startsWith(`${basePath}/today`),
      icon: <TodayIcon />,
    },
    {
      label: "People",
      href: `${basePath}/people`,
      match: (path) => path.startsWith(`${basePath}/people`),
      icon: <PeopleIcon />,
    },
    {
      label: "Family Tree",
      href: `${basePath}/tree`,
      match: (path) => path.startsWith(`${basePath}/tree`),
      icon: <TreeIcon />,
    },
    {
      label: "Games",
      href: `${basePath}/games`,
      match: (path) => path.startsWith(`${basePath}/games`),
      icon: <GameIcon />,
    },
    {
      label: "Media",
      href: `${basePath}/media`,
      match: (path) => path.startsWith(`${basePath}/media`),
      icon: <MediaIcon />,
    },
    {
      label: "Help",
      href: `${basePath}/help`,
      match: (path) => path.startsWith(`${basePath}/help`),
      icon: <HelpIcon />,
    },
  ];

  if (isAdmin) {
    sectionItems.push({
      label: "Admin",
      href: `${basePath}/settings`,
      match: (path) => path.startsWith(`${basePath}/settings`),
      icon: <SettingsIcon />,
    });
  }

  const items: NavItem[] = [...sectionItems];
  items.push({
    label: "Sign out",
    href: "/api/auth/signout",
    match: () => false,
    icon: <LogoutIcon />,
  });

  const activeSection = sectionItems.find((item) => item.match(pathname)) ?? sectionItems[0];

  return (
    <nav className="app-nav-row">
      <div className="app-nav-mobile">
        <select
          className="app-nav-mobile-select"
          aria-label="Select page"
          value={activeSection?.href ?? sectionItems[0]?.href}
          onChange={(event) => router.push(event.target.value)}
        >
          {sectionItems.map((item) => (
            <option key={`mobile-nav-${item.label}`} value={item.href}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <div className="app-nav">
        {items.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.label}
              href={item.href}
              prefetch={false}
              className={active ? "nav-pill nav-pill-active" : "nav-pill"}
            >
              <span className="nav-pill-icon">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
