"use client";

import Link from "next/link";
import { useState } from "react";

type FamailinkChromeProps = {
  active: "tree" | "administration";
  username: string;
  personId: string;
};

const APP_VERSION = "0.1.0";
const BUILD_LABEL = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local";

function initialsFromUsername(username: string) {
  const parts = username
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
  return initials || "FL";
}

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span className="brand-arch" />
      <span className="brand-tree">EFL</span>
    </span>
  );
}

export function FamailinkChrome({ active, username, personId }: FamailinkChromeProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="app-chrome">
      <Link className="app-brand" href="/tree">
        <BrandMark />
        <span>
          <strong>Famailink</strong>
          <small>Eternal Family Link</small>
        </span>
      </Link>

      <nav className="app-tabs" aria-label="Famailink navigation">
        <Link className={`app-tab${active === "tree" ? " is-active" : ""}`} href="/tree">
          Family Tree
        </Link>
        <Link className={`app-tab${active === "administration" ? " is-active" : ""}`} href="/administration">
          Administration
        </Link>
      </nav>

      <div className="account-menu">
        <button
          type="button"
          className="account-trigger"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((current) => !current)}
        >
          {initialsFromUsername(username)}
        </button>
        {menuOpen ? (
          <div className="account-popout" role="dialog" aria-label="Account and build information">
            <div className="account-popout-head">
              <div>
                <p className="account-name">{username}</p>
                <p className="account-meta">{personId}</p>
              </div>
              <button type="button" className="account-close" aria-label="Close account menu" onClick={() => setMenuOpen(false)}>
                x
              </button>
            </div>
            <p className="account-meta">
              App Version: <strong>{APP_VERSION}</strong>
            </p>
            <p className="account-meta">
              Build: <strong>{BUILD_LABEL}</strong>
            </p>
            <div className="account-actions">
              <Link className="secondary-button" href="/administration" onClick={() => setMenuOpen(false)}>
                Administration
              </Link>
              <form action="/api/auth/logout" method="post">
                <button className="secondary-button" type="submit">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}
