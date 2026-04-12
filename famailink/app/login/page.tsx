"use client";

import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      setBusy(true);
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setError(String(payload.error ?? "Login failed."));
        return;
      }
      window.location.href = "/tree";
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <p className="eyebrow">Famailink</p>
        <h1 className="title">Local Sign In</h1>
        <p className="lead">
          This clean app track starts with local login only and a relationship-driven tree lab page.
        </p>
        <form className="login-form" onSubmit={onSubmit}>
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
            <span className="field-label">Password</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>
        {error ? <p className="error-text">{error}</p> : null}
        <p className="login-note">
          Stephen’s emergency recovery path will be handled separately. It is not part of this first shell.
        </p>
      </section>
    </main>
  );
}
