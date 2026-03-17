"use client";

import { FormEvent, useEffect, useState } from "react";
import { signIn } from "next-auth/react";

type LoginPageClientProps = {
  defaultTenantKey: string;
  callbackUrl: string;
};

export function LoginPageClient({ defaultTenantKey, callbackUrl }: LoginPageClientProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setAuthError(params.get("error") ?? "");
  }, []);

  const onCredentialsLogin = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("Signing in...");
    const response = await signIn("credentials", {
      redirect: false,
      tenantKey: defaultTenantKey,
      username,
      password,
      callbackUrl,
    });
    if (!response?.ok) {
      setStatus("Sign in failed. Check username and password.");
      return;
    }
    window.location.href = response.url ?? callbackUrl;
  };

  return (
    <main className="section" style={{ maxWidth: "540px", marginTop: "8vh" }}>
      <section className="card">
        <h1 className="page-title">Sign In</h1>
        <p className="page-subtitle">Use Google or username/password.</p>

        <button type="button" className="button tap-button" onClick={() => signIn("google", { callbackUrl })}>
          Continue with Google
        </button>

        <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "1rem 0" }} />
        <form onSubmit={onCredentialsLogin}>
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
        {authError ? <p>Google sign-in failed: {authError}</p> : null}
      </section>
    </main>
  );
}
