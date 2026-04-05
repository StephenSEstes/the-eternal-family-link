"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isIosDevice() {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isSafari() {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /safari/i.test(navigator.userAgent) && !/chrome|crios|android/i.test(navigator.userAgent);
}

function isStandaloneMode() {
  if (typeof window === "undefined") {
    return false;
  }
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

type UserMenuProps = {
  displayName: string;
  email: string;
  role: "ADMIN" | "USER";
  loginType: string;
  appVersion: string;
  avatarInitials: string;
  basePath: string;
  isAdmin: boolean;
};

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 4.4 1.6c-.9 1-1.9 1.6-1.9 3" />
      <circle cx="12" cy="17.2" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function UserMenu({
  displayName,
  email,
  role,
  loginType,
  appVersion,
  avatarInitials,
  basePath,
  isAdmin,
}: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installMessage, setInstallMessage] = useState("");
  const [isInstalled, setIsInstalled] = useState(false);
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

  useEffect(() => {
    setIsInstalled(isStandaloneMode());
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
      setInstallMessage("App installed on this device.");
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setInstallMessage("");
    }
  }, [open]);

  const installHint = useMemo(() => {
    if (!isIosDevice()) {
      return "Use your browser menu to install or add this app to your home screen if the install button does not open a prompt.";
    }
    if (isSafari()) {
      return "In Safari, tap Share and choose Add to Home Screen.";
    }
    return "Open this app in Safari, then tap Share and choose Add to Home Screen.";
  }, []);

  const canShowInstallAction = !isInstalled && (Boolean(installPrompt) || isIosDevice());

  const openHelpInWindow = () => {
    const href = `${basePath}/help`;
    if (typeof window === "undefined") {
      return;
    }
    const popup = window.open(
      href,
      "efl_help",
      "popup=yes,width=1120,height=820,resizable=yes,scrollbars=yes",
    );
    if (popup) {
      popup.focus();
      return;
    }
    const tab = window.open(href, "_blank", "noopener,noreferrer");
    if (tab) {
      tab.focus();
      return;
    }
    window.location.assign(href);
  };

  const onInstall = async () => {
    if (installPrompt) {
      setInstallMessage("");
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice.catch(() => null);
      if (choice?.outcome === "accepted") {
        setInstallMessage("Install started on this device.");
      } else if (choice?.outcome === "dismissed") {
        setInstallMessage("Install prompt dismissed.");
      }
      setInstallPrompt(null);
      return;
    }
    setInstallMessage(installHint);
  };

  return (
    <div className="user-menu">
      <div className="user-menu-inline">
        <button
          type="button"
          className="user-menu-help-trigger"
          onClick={openHelpInWindow}
          aria-label="Open help"
          title="Help"
        >
          <HelpIcon />
        </button>
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
      </div>
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
            {isInstalled ? (
              <p className="user-menu-meta">Installed: <strong>This device</strong></p>
            ) : null}
            <div className="user-menu-actions">
              {canShowInstallAction ? (
                <button type="button" className="user-menu-install" onClick={() => void onInstall()}>
                  Install App
                </button>
              ) : null}
              {isAdmin ? (
                <Link href={`${basePath}/settings`} prefetch={false} className="user-menu-admin" role="menuitem">
                  Admin
                </Link>
              ) : null}
              <Link href="/api/auth/signout" prefetch={false} className="user-menu-signout" role="menuitem">
                Sign out
              </Link>
            </div>
            {installMessage ? <p className="user-menu-help">{installMessage}</p> : null}
            {!isInstalled && !installMessage && canShowInstallAction ? <p className="user-menu-help">{installHint}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
