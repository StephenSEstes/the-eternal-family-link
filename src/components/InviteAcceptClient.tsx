"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import type { InvitePresentation } from "@/lib/invite/types";

type InviteAcceptClientProps = {
  token: string;
  initialInvite: InvitePresentation;
  sessionEmail: string;
};

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

export function InviteAcceptClient({ token, initialInvite, sessionEmail }: InviteAcceptClientProps) {
  const [invite, setInvite] = useState(initialInvite);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [localUsername, setLocalUsername] = useState(initialInvite.localUsername);
  const [localPassword, setLocalPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [autoAcceptedGoogle, setAutoAcceptedGoogle] = useState(false);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  useEffect(() => {
    if (invite.status !== "pending" || !invite.canUseGoogle || !sessionEmail || autoAcceptedGoogle) {
      return;
    }
    if (!invite.sessionEmailMatches) {
      setStatus(`This invite is for ${invite.inviteEmail}. Sign in with that Google account.`);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setBusy(true);
      const res = await fetch(`/api/invite/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept_google" }),
      });
      const body = await res.json().catch(() => null);
      if (cancelled) {
        return;
      }
      if (!res.ok || !body?.ok || !body.invite) {
        setStatus(body?.message ? String(body.message) : `Google acceptance failed (${res.status}).`);
        setBusy(false);
        setAutoAcceptedGoogle(true);
        return;
      }
      setInvite(body.invite as InvitePresentation);
      setStatus("Invite accepted. Open the app or install it on this device.");
      setBusy(false);
      setAutoAcceptedGoogle(true);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [autoAcceptedGoogle, invite.canUseGoogle, invite.inviteEmail, invite.sessionEmailMatches, invite.status, sessionEmail, token]);

  const installHint = useMemo(() => {
    if (!isIosDevice()) {
      return "Use your browser menu to install or add this app to your home screen if the install button is not shown.";
    }
    if (isSafari()) {
      return "In Safari, tap Share and choose Add to Home Screen.";
    }
    return "Open this link in Safari, then tap Share and choose Add to Home Screen.";
  }, []);

  const onGoogleContinue = async () => {
    setStatus("");
    await signIn("google", { callbackUrl: `/invite/${encodeURIComponent(token)}` });
  };

  const onLocalAccept = async (event: FormEvent) => {
    event.preventDefault();
    if (localPassword !== confirmPassword) {
      setStatus("Passwords do not match.");
      return;
    }

    setBusy(true);
    setStatus("Activating your local sign-in...");
    const res = await fetch(`/api/invite/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "accept_local",
        username: localUsername,
        password: localPassword,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok || !body.invite) {
      setStatus(body?.message ? String(body.message) : `Local setup failed (${res.status}).`);
      setBusy(false);
      return;
    }

    setInvite(body.invite as InvitePresentation);
    const response = await signIn("credentials", {
      redirect: false,
      tenantKey: String(body.primaryTenantKey ?? invite.familyGroupKey),
      username: localUsername,
      password: localPassword,
      callbackUrl: `/invite/${encodeURIComponent(token)}`,
    });
    if (!response?.ok) {
      setStatus("Account created. Sign in from the login page if automatic sign-in did not complete.");
      setBusy(false);
      return;
    }
    window.location.href = response.url ?? `/invite/${encodeURIComponent(token)}`;
  };

  const onInstall = async () => {
    if (!installPrompt) {
      return;
    }
    await installPrompt.prompt();
    await installPrompt.userChoice.catch(() => undefined);
    setInstallPrompt(null);
  };

  if (invite.status === "accepted") {
    return (
      <section className="card" style={{ maxWidth: "640px", margin: "0 auto" }}>
        <h1 className="page-title" style={{ marginTop: 0 }}>Access Ready</h1>
        <p className="page-subtitle">
          {invite.personDisplayName} now has access to {invite.familyGroupName}.
        </p>
        <div className="settings-chip-list" style={{ marginBottom: "0.75rem" }}>
          <Link className="button tap-button" href={invite.openAppPath}>Open App</Link>
          {installPrompt ? (
            <button type="button" className="button secondary tap-button" onClick={() => void onInstall()}>
              Install App
            </button>
          ) : null}
        </div>
        <p className="page-subtitle" style={{ marginTop: 0 }}>{installHint}</p>
        <p className="page-subtitle" style={{ marginTop: "0.75rem" }}>
          Sign-in method used: <strong>{invite.acceptedAuthMode || invite.authMode}</strong>
        </p>
        {status ? <p>{status}</p> : null}
      </section>
    );
  }

  return (
    <section className="card" style={{ maxWidth: "640px", margin: "0 auto" }}>
      <h1 className="page-title" style={{ marginTop: 0 }}>Join {invite.familyGroupName}</h1>
      <p className="page-subtitle">
        This invite is for {invite.personDisplayName} and grants access to {invite.familyGroups.length} family group{invite.familyGroups.length === 1 ? "" : "s"}.
      </p>
      <p className="page-subtitle" style={{ marginTop: 0 }}>
        Invite email: <strong>{invite.inviteEmail}</strong>
      </p>

      {invite.canUseGoogle ? (
        <div style={{ marginTop: "1rem" }}>
          <button type="button" className="button tap-button" disabled={busy} onClick={() => void onGoogleContinue()}>
            Continue with Google
          </button>
          <p className="page-subtitle" style={{ marginTop: "0.5rem" }}>
            Use the invited Google account. After sign-in, this page will finish setup automatically.
          </p>
        </div>
      ) : null}

      {invite.canUseLocal ? (
        <form onSubmit={onLocalAccept} style={{ marginTop: invite.canUseGoogle ? "1.25rem" : "0.75rem" }}>
          <h2 style={{ marginBottom: "0.5rem" }}>Use Username And Password</h2>
          <p className="page-subtitle" style={{ marginTop: 0 }}>
            If your invite message included a temporary password, you can use it here or enter a new password to replace it during activation.
          </p>
          <label className="label">Username</label>
          <input
            className="input"
            autoComplete="username"
            value={localUsername}
            onChange={(event) => setLocalUsername(event.target.value)}
          />
          <label className="label">Password</label>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={localPassword}
            onChange={(event) => setLocalPassword(event.target.value)}
          />
          <label className="label">Confirm Password</label>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          <button type="submit" className="button tap-button" disabled={busy}>
            Activate Local Sign-In
          </button>
        </form>
      ) : null}

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0, marginBottom: "0.5rem" }}>Included Access</h2>
        <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
          {invite.familyGroups.map((family) => (
            <li key={family.tenantKey}>
              {family.tenantName} ({family.role})
            </li>
          ))}
        </ul>
      </div>

      <p className="page-subtitle" style={{ marginTop: "1rem" }}>{installHint}</p>
      {status ? <p>{status}</p> : null}
    </section>
  );
}
