"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { AsyncActionButton, ModalStatusBanner, inferStatusTone } from "@/components/ui/primitives";

type ForgotPasswordPageClientProps = {
  defaultTenantKey: string;
};

export function ForgotPasswordPageClient({ defaultTenantKey }: ForgotPasswordPageClientProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setStatus("Sending reset email...");
    const response = await fetch("/api/password-reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantKey: defaultTenantKey,
        email,
      }),
    });
    const body = await response.json().catch(() => null);
    setStatus(body?.message ? String(body.message) : "If that email matches an active user, a password reset email has been sent.");
    setPending(false);
  };

  return (
    <main className="section" style={{ maxWidth: "540px", marginTop: "8vh" }}>
      <section className="card">
        <h1 className="page-title">Forgot Password</h1>
        <p className="page-subtitle">
          Enter the email address associated with your active account in this family group. If it matches an active local user, we will email a password reset link.
        </p>
        <form onSubmit={onSubmit}>
          <label className="label">Email Address</label>
          <input
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <AsyncActionButton
            type="submit"
            className="tap-button"
            pending={pending}
            pendingLabel="Sending..."
            disabled={pending}
          >
            Email Reset Link
          </AsyncActionButton>
        </form>
        <p className="page-subtitle" style={{ marginTop: "1rem" }}>
          <Link href="/login">Back to sign in</Link>
        </p>
        {status ? <ModalStatusBanner tone={inferStatusTone(status)}>{status}</ModalStatusBanner> : null}
      </section>
    </main>
  );
}
