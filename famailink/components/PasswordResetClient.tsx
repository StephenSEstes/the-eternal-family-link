"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import type { PasswordResetPresentation } from "@/lib/auth/password-reset";

export function PasswordResetClient({
  token,
  initialReset,
}: {
  token: string;
  initialReset: PasswordResetPresentation | null;
}) {
  const [reset, setReset] = useState(initialReset);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reset || reset.status !== "pending") return;
    if (password !== confirmPassword) {
      setStatus("Passwords do not match.");
      return;
    }

    setBusy(true);
    setStatus("Saving new password...");
    try {
      const response = await fetch(`/api/password-reset/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || payload.ok !== true) {
        setStatus(String(payload.message ?? `Password reset failed (${response.status}).`));
        return;
      }

      const nextReset = (payload.reset as PasswordResetPresentation | undefined) ?? null;
      if (nextReset) {
        setReset(nextReset);
      }

      const loginResponse = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: String(payload.username ?? reset.username),
          password,
        }),
      });
      if (!loginResponse.ok) {
        setStatus("Password updated. Sign in from the login page if automatic sign-in did not complete.");
        return;
      }

      window.location.href = String(payload.callbackUrl ?? "/tree");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Password reset failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!reset || reset.status !== "pending") {
    return (
      <main className="login-shell">
        <section className="login-card">
          <p className="eyebrow">Famailink</p>
          <h1 className="title">Reset Link Not Available</h1>
          <p className="lead">This password reset link is missing, expired, or no longer active.</p>
          <p className="login-note">
            <Link href="/forgot-password">Request a new password reset email</Link>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <p className="eyebrow">Famailink</p>
        <h1 className="title">Reset Password</h1>
        <p className="lead">
          Choose a new password for <strong>{reset.username}</strong>.
        </p>
        <form className="login-form" onSubmit={onSubmit}>
          <label className="field">
            <span className="field-label">New Password</span>
            <input
              className="input"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Confirm New Password</span>
            <input
              className="input"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
          <label className="scope-toggle">
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(event) => setShowPassword(event.target.checked)}
            />
            Show password
          </label>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Saving..." : "Save New Password"}
          </button>
        </form>
        {status ? <p className="login-note">{status}</p> : null}
      </section>
    </main>
  );
}
