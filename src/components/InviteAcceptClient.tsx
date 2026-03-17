"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { AsyncActionButton, ModalStatusBanner, inferStatusTone } from "@/components/ui/primitives";
import type { InvitePresentation } from "@/lib/invite/types";

type InviteAcceptClientProps = {
  token: string;
  initialInvite: InvitePresentation;
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

export function InviteAcceptClient({ token, initialInvite }: InviteAcceptClientProps) {
  const [invite, setInvite] = useState(initialInvite);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<"" | "local" | "install">("");
  const [localUsername, setLocalUsername] = useState(initialInvite.localUsername);
  const [localPassword, setLocalPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  const installHint = useMemo(() => {
    if (!isIosDevice()) {
      return "Install from your browser menu if the app prompt is not shown automatically after sign-in.";
    }
    if (isSafari()) {
      return "On iPhone or iPad in Safari, tap Share and choose Add to Home Screen.";
    }
    return "On iPhone or iPad, open this link in Safari, then tap Share and choose Add to Home Screen.";
  }, []);

  const onLocalAccept = async (event: FormEvent) => {
    event.preventDefault();
    if (localPassword !== confirmPassword) {
      setStatus("Passwords do not match.");
      return;
    }

    setBusy(true);
    setBusyAction("local");
    setStatus("Saving your password and activating access...");
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
      setBusyAction("");
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
      setStatus("Access is ready. Use your username and password on the login page if automatic sign-in did not complete.");
      setBusy(false);
      setBusyAction("");
      return;
    }
    window.location.href = response.url ?? `/invite/${encodeURIComponent(token)}`;
  };

  const onInstall = async () => {
    if (!installPrompt) {
      return;
    }
    setBusyAction("install");
    await installPrompt.prompt();
    await installPrompt.userChoice.catch(() => undefined);
    setInstallPrompt(null);
    setBusyAction("");
  };

  if (invite.status === "accepted") {
    return (
      <section className="card" style={{ maxWidth: "640px", margin: "0 auto" }}>
        <h1 className="page-title" style={{ marginTop: 0 }}>Access Ready</h1>
        <p className="page-subtitle">
          {invite.personDisplayName} now has access to {invite.familyGroupName}.
        </p>
        <div className="card" style={{ marginTop: "0.75rem" }}>
          <h2 style={{ marginTop: 0, marginBottom: "0.5rem" }}>How To Sign In</h2>
          <ol style={{ margin: 0, paddingLeft: "1.1rem" }}>
            <li>Open the app.</li>
            <li>Choose the family group {invite.familyGroupName} if asked.</li>
            <li>Sign in with username <strong>{invite.localUsername}</strong> and the password you just chose.</li>
          </ol>
        </div>
        <div className="settings-chip-list" style={{ marginTop: "0.75rem", marginBottom: "0.75rem" }}>
          <Link className="button tap-button" href={invite.openAppPath}>Open App</Link>
          {installPrompt ? (
            <AsyncActionButton
              type="button"
              tone="secondary"
              className="tap-button"
              pending={busyAction === "install"}
              pendingLabel="Installing..."
              onClick={() => void onInstall()}
            >
              Install App
            </AsyncActionButton>
          ) : null}
        </div>
        <p className="page-subtitle" style={{ marginTop: 0 }}>{installHint}</p>
        {status ? <ModalStatusBanner tone={inferStatusTone(status)}>{status}</ModalStatusBanner> : null}
      </section>
    );
  }

  return (
    <section className="card" style={{ maxWidth: "640px", margin: "0 auto" }}>
      <h1 className="page-title" style={{ marginTop: 0 }}>Join {invite.familyGroupName}</h1>
      <p className="page-subtitle">
        This invite is for {invite.personDisplayName}. Choose your username and password below to activate access.
      </p>
      <p className="page-subtitle" style={{ marginTop: 0 }}>
        Invite email: <strong>{invite.inviteEmail}</strong>
      </p>

      <div className="card" style={{ marginTop: "0.75rem" }}>
        <h2 style={{ marginTop: 0, marginBottom: "0.5rem" }}>What To Do</h2>
        <ol style={{ margin: 0, paddingLeft: "1.1rem" }}>
          <li>Confirm or adjust your username.</li>
          <li>Choose a password and enter it twice.</li>
          <li>Tap <strong>Save Password and Open App</strong>.</li>
          <li>After setup, sign in with your username and password on this family group.</li>
        </ol>
      </div>

      <form onSubmit={onLocalAccept} style={{ marginTop: "0.75rem" }}>
        <label className="label">Username</label>
        <input
          className="input"
          autoComplete="username"
          value={localUsername}
          onChange={(event) => setLocalUsername(event.target.value)}
        />
        <label className="label">Choose Password</label>
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
        <AsyncActionButton
          type="submit"
          className="tap-button"
          pending={busy && busyAction === "local"}
          pendingLabel="Saving..."
          disabled={busy}
        >
          Save Password and Open App
        </AsyncActionButton>
      </form>

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

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0, marginBottom: "0.5rem" }}>Install On iPhone Or iPad</h2>
        <p className="page-subtitle" style={{ marginTop: 0 }}>
          Open this invite in Safari, then tap <strong>Share</strong> and choose <strong>Add to Home Screen</strong>.
        </p>
      </div>

      <p className="page-subtitle" style={{ marginTop: "1rem" }}>{installHint}</p>
      {status ? <ModalStatusBanner tone={inferStatusTone(status)}>{status}</ModalStatusBanner> : null}
    </section>
  );
}
