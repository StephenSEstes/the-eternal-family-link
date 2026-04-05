"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type HeaderNavProps = {
  basePath: string;
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

function SharesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v6A2.5 2.5 0 0 1 17.5 15H11l-4.3 4v-4H6.5A2.5 2.5 0 0 1 4 12.5z" />
      <circle cx="9" cy="9.5" r="1.1" />
      <path d="M8 13l2.2-2.2 1.4 1.4 1.4-1.6 2 2.4" />
    </svg>
  );
}
export function HeaderNav({ basePath }: HeaderNavProps) {
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
      label: "Share",
      href: `${basePath}/shares`,
      match: (path) => path.startsWith(`${basePath}/shares`),
      icon: <SharesIcon />,
    },
  ];

  const activeSection = sectionItems.find((item) => item.match(pathname)) ?? sectionItems[0];

  return (
    <nav className="app-nav-row">
      <div className="app-nav-mobile">
        <select
          className="app-nav-mobile-select"
          aria-label="Select page"
          value={activeSection?.href ?? sectionItems[0]?.href}
          onChange={(event) => {
            const nextHref = event.target.value.trim();
            if (!nextHref) return;
            window.location.assign(nextHref);
          }}
        >
          {sectionItems.map((item) => (
            <option key={`mobile-nav-${item.label}`} value={item.href}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <div className="app-nav">
        {sectionItems.map((item) => {
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
