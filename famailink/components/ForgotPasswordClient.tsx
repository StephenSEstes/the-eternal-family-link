"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export function ForgotPasswordClient() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus("Sending reset email...");
    try {
      const response = await fetch("/api/password-reset/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      setStatus(
        String(payload.message ?? "If that email matches an active user, a password reset email has been sent."),
      );
    } catch {
      setStatus("If that email matches an active user, a password reset email has been sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <p className="eyebrow">Famailink</p>
        <h1 className="title">Forgot Password</h1>
        <p className="lead">
          Enter the email address associated with your active local account. If it matches exactly one active user, we
          will email a reset link.
        </p>
        <form className="login-form" onSubmit={onSubmit}>
          <label className="field">
            <span className="field-label">Email Address</span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Sending..." : "Email Reset Link"}
          </button>
        </form>
        {status ? <p className="login-note">{status}</p> : null}
        <p className="login-note">
          <Link href="/login">Back to sign in</Link>
        </p>
      </section>
    </main>
  );
}
