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
      window.location.href = "/u1";
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="u1-shell">
      <section className="u1-card u1-grid" style={{ maxWidth: 420, margin: "72px auto 0" }}>
        <h2>EFL2 Login</h2>
        <p className="u1-muted">Local username/password only.</p>
        <form className="u1-grid" onSubmit={onSubmit}>
          <label>
            Username
            <input className="u1-input" value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            Password
            <input
              className="u1-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="u1-button" type="submit" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>
        {error ? <div className="u1-error">{error}</div> : null}
      </section>
    </main>
  );
}

