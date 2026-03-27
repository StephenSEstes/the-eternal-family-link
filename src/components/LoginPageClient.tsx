"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";
import { AsyncActionButton, ModalStatusBanner, inferStatusTone } from "@/components/ui/primitives";

type LoginPageClientProps = {
  defaultTenantKey: string;
  callbackUrl: string;
};

export function LoginPageClient({ defaultTenantKey, callbackUrl }: LoginPageClientProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [pendingGoogle, setPendingGoogle] = useState(false);

  const onCredentialsLogin = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
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
      setPending(false);
      return;
    }
    window.location.href = response.url ?? callbackUrl;
  };

  return (
    <main className="section" style={{ maxWidth: "540px", marginTop: "8vh" }}>
      <section className="card">
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "0.75rem" }}>
          <Image
            src="/brand/logo-arch-tree.png"
            alt="The Eternal Family Link logo"
            width={200}
            height={290}
            priority
            style={{ width: "150px", height: "auto" }}
          />
        </div>
        <h1 className="page-title">Sign In</h1>
        <p className="page-subtitle">Use your username and password for this family group.</p>
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h2 style={{ marginTop: 0, marginBottom: "0.5rem" }}>First Time Here?</h2>
          <ol style={{ margin: 0, paddingLeft: "1.1rem" }}>
            <li>Open your invite link first.</li>
            <li>Then sign in here with your username and password.</li>
          </ol>
        </div>
        <form onSubmit={onCredentialsLogin}>
          <label className="label">Username</label>
          <input
            className="input"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <label className="label">Password</label>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <AsyncActionButton
            type="submit"
            className="tap-button"
            pending={pending}
            pendingLabel="Signing In..."
            disabled={pending}
          >
            Sign In
          </AsyncActionButton>
        </form>
        {username.trim().toLowerCase() === "stephen estes" ? (
          <div style={{ marginTop: "0.75rem" }}>
            <AsyncActionButton
              type="button"
              className="tap-button secondary"
              pending={pendingGoogle}
              pendingLabel="Opening Google..."
              disabled={pendingGoogle}
              onClick={async () => {
                setPendingGoogle(true);
                setStatus("Opening Google sign-in...");
                await signIn("google", { callbackUrl });
              }}
            >
              Continue with Google
            </AsyncActionButton>
            <p className="page-subtitle" style={{ marginTop: "0.35rem" }}>Google sign-in unlocked.</p>
          </div>
        ) : null}
        <p className="page-subtitle" style={{ marginTop: "0.85rem" }}>
          <Link href="/forgot-password" className="button secondary tap-button" style={{ textDecoration: "none" }}>
            Forgot Password?
          </Link>
        </p>
        <p className="page-subtitle" style={{ marginTop: "1rem" }}>
          On iPhone or iPad, install the app from Safari using Share &gt; Add to Home Screen after you sign in.
        </p>
        {status ? <ModalStatusBanner tone={inferStatusTone(status)}>{status}</ModalStatusBanner> : null}
      </section>
    </main>
  );
}
