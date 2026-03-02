"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type UserMenuProps = {
  displayName: string;
  email: string;
  role: "ADMIN" | "USER";
  loginType: string;
  appVersion: string;
  avatarInitials: string;
};

export function UserMenu({ displayName, email, role, loginType, appVersion, avatarInitials }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="user-menu">
      <button
        type="button"
        className="user-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open user menu"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="user-avatar" aria-hidden="true">
          {avatarInitials || "FM"}
        </span>
      </button>
      {open ? (
        <div className="user-menu-modal-root" role="dialog" aria-modal="true" aria-label="Account menu">
          <button
            type="button"
            className="user-menu-backdrop"
            aria-label="Close account menu"
            onClick={() => setOpen(false)}
          />
          <div className="user-menu-modal" ref={panelRef}>
            <div className="user-menu-header">
              <p className="user-menu-name">{displayName}</p>
              <button type="button" className="user-menu-close" aria-label="Close" onClick={() => setOpen(false)}>
                x
              </button>
            </div>
            <p className="user-menu-meta">{email || "No email"}</p>
            <p className="user-menu-meta">
              Role: <strong>{role}</strong>
            </p>
            <p className="user-menu-meta">
              Login: <strong>{loginType}</strong>
            </p>
            <p className="user-menu-meta">
              App: <strong>{appVersion}</strong>
            </p>
            <Link href="/api/auth/signout" prefetch={false} className="user-menu-signout" role="menuitem">
              Sign out
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
