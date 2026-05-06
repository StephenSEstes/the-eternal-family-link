"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/FamailinkChrome";
import type { InvitePresentation } from "@/lib/invite/types";

type InviteAcceptClientProps = {
  token: string;
  initialInvite: InvitePresentation;
};

function formatExpiry(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(parsed));
}

export function InviteAcceptClient({ token, initialInvite }: InviteAcceptClientProps) {
  const [invite, setInvite] = useState(initialInvite);
  const [username, setUsername] = useState(initialInvite.localUsername);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const inviteHeadline = useMemo(() => {
    if (invite.status === "accepted") return "Invite Already Used";
    if (invite.status === "expired") return "Invite Expired";
    if (invite.status === "revoked") return "Invite Not Available";
    return `Join ${invite.familyGroupName}`;
  }, [invite.familyGroupName, invite.status]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/invite/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "accept_local",
          username,
          password,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        invite?: InvitePresentation;
        redirectPath?: string;
      };
      if (!response.ok || !payload.ok || !payload.redirectPath) {
        setError(String(payload.message ?? `Invite acceptance failed (${response.status}).`));
        if (payload.invite) setInvite(payload.invite);
        return;
      }
      if (payload.invite) setInvite(payload.invite);
      window.location.href = payload.redirectPath;
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Invite acceptance failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="login-card invite-accept-card">
      <div className="login-brand">
        <BrandMark />
        <span>
          <strong>The Eternal Family Link</strong>
          <small>Famailink Invite</small>
        </span>
      </div>

      <h1 className="title">{inviteHeadline}</h1>

      {invite.status === "pending" ? (
        <>
          <p className="lead">
            This invite is for <strong>{invite.personDisplayName}</strong>. Choose a username and password to activate
            Famailink access.
          </p>

          <div className="invite-summary-list">
            <div className="invite-summary-row">
              <span>Invite Email</span>
              <strong>{invite.inviteEmail}</strong>
            </div>
            <div className="invite-summary-row">
              <span>Expires</span>
              <strong>{formatExpiry(invite.expiresAt)}</strong>
            </div>
          </div>

          <form className="login-form invite-accept-form" onSubmit={onSubmit}>
            <label className="field">
              <span className="field-label">Username</span>
              <input
                className="input"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Choose Password</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Confirm Password</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "Activating..." : "Activate And Open Famailink"}
            </button>
          </form>

          <div className="invite-access-list">
            <h2>Included Access</h2>
            <ul>
              {invite.familyGroups.map((family) => (
                <li key={family.tenantKey}>
                  {family.tenantName} ({family.role})
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : invite.status === "accepted" ? (
        <>
          <p className="lead">
            This invite has already been accepted for <strong>{invite.personDisplayName}</strong>.
          </p>
          <div className="invite-summary-list">
            <div className="invite-summary-row">
              <span>Username</span>
              <strong>{invite.localUsername}</strong>
            </div>
            <div className="invite-summary-row">
              <span>Accepted</span>
              <strong>{invite.acceptedAt ? formatExpiry(invite.acceptedAt) : "Already accepted"}</strong>
            </div>
          </div>
          <div className="invite-action-row">
            <Link className="primary-button" href="/login">
              Sign In
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="lead">
            This invite is no longer active. Ask the family administrator to create a new Famailink invite.
          </p>
          <div className="invite-summary-list">
            <div className="invite-summary-row">
              <span>Status</span>
              <strong>{invite.status}</strong>
            </div>
            <div className="invite-summary-row">
              <span>Invite Email</span>
              <strong>{invite.inviteEmail}</strong>
            </div>
          </div>
          <div className="invite-action-row">
            <Link className="secondary-button" href="/login">
              Go To Sign In
            </Link>
          </div>
        </>
      )}

      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}
