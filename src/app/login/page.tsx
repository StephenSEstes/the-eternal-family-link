"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const [tenantKey, setTenantKey] = useState("default");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");

  const onCredentialsLogin = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("Signing in...");
    const response = await signIn("credentials", {
      redirect: false,
      tenantKey,
      username,
      password,
      callbackUrl: `/t/${encodeURIComponent((tenantKey || "default").toLowerCase())}`,
    });
    if (!response?.ok) {
      setStatus("Sign in failed. Check username, password, and tenant.");
      return;
    }
    window.location.href = response.url ?? `/t/${encodeURIComponent((tenantKey || "default").toLowerCase())}`;
  };

  return (
    <main className="section" style={{ maxWidth: "540px", marginTop: "8vh" }}>
      <section className="card">
        <h1 className="page-title">Sign In</h1>
        <p className="page-subtitle">Use Google or tenant username/password.</p>

        <button type="button" className="button tap-button" onClick={() => signIn("google")}>
          Continue with Google
        </button>

        <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "1rem 0" }} />
        <form onSubmit={onCredentialsLogin}>
          <label className="label">Tenant Key</label>
          <input className="input" value={tenantKey} onChange={(e) => setTenantKey(e.target.value)} />
          <label className="label">Username</label>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
          <label className="label">Password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" className="button tap-button">
            Sign In with Username
          </button>
        </form>

        {status ? <p>{status}</p> : null}
      </section>
    </main>
  );
}
