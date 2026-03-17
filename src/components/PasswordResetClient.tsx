"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import type { PasswordResetPresentation } from "@/lib/auth/password-reset-types";
import { AsyncActionButton, ModalStatusBanner, inferStatusTone } from "@/components/ui/primitives";
import { DEFAULT_FAMILY_GROUP_KEY } from "@/lib/family-group/constants";

type PasswordResetClientProps = {
  token: string;
  initialReset: PasswordResetPresentation | null;
};

function getResetCallbackPath(tenantKey?: string) {
  const normalized = String(tenantKey ?? "").trim().toLowerCase();
  if (!normalized || normalized === DEFAULT_FAMILY_GROUP_KEY) {
    return "/";
  }
  return `/t/${encodeURIComponent(normalized)}`;
}

export function PasswordResetClient({ token, initialReset }: PasswordResetClientProps) {
  const [reset, setReset] = useState(initialReset);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  const callbackUrl = useMemo(
    () => (reset ? getResetCallbackPath(reset.tenantKey) : "/"),
    [reset],
  );

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!reset) {
      return;
    }
    if (password !== confirmPassword) {
      setStatus("Passwords do not match.");
      return;
    }
    setPending(true);
    setStatus("Saving new password...");
    const response = await fetch(`/api/password-reset/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) {
      setStatus(body?.message ? String(body.message) : `Password reset failed (${response.status}).`);
      setPending(false);
      return;
    }

    const nextReset = body.reset as PasswordResetPresentation | undefined;
    if (nextReset) {
      setReset(nextReset);
    }
    const signInResponse = await signIn("credentials", {
      redirect: false,
      tenantKey: String(body.tenantKey ?? reset.tenantKey),
      username: String(body.username ?? reset.username),
      password,
      callbackUrl: String(body.callbackUrl ?? callbackUrl),
    });
    if (!signInResponse?.ok) {
      setStatus("Password updated. Sign in from the login page if automatic sign-in did not complete.");
      setPending(false);
      return;
    }
    window.location.href = signInResponse.url ?? String(body.callbackUrl ?? callbackUrl);
  };

  if (!reset || reset.status !== "pending") {
    return (
      <section className="card" style={{ maxWidth: "640px", margin: "0 auto" }}>
        <h1 className="page-title" style={{ marginTop: 0 }}>Reset Link Not Available</h1>
        <p className="page-subtitle" style={{ marginTop: 0 }}>
          This password reset link is missing, expired, or no longer active.
        </p>
        <p className="page-subtitle">
          <Link href="/forgot-password">Request a new password reset email</Link>
        </p>
      </section>
    );
  }

  return (
    <section className="card" style={{ maxWidth: "640px", margin: "0 auto" }}>
      <h1 className="page-title" style={{ marginTop: 0 }}>Reset Password</h1>
      <p className="page-subtitle">
        Choose a new password for username <strong>{reset.username}</strong> in {reset.tenantName}.
      </p>
      <form onSubmit={onSubmit}>
        <label className="label">New Password</label>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <label className="label">Confirm New Password</label>
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
          pending={pending}
          pendingLabel="Saving..."
          disabled={pending}
        >
          Save New Password
        </AsyncActionButton>
      </form>
      <p className="page-subtitle" style={{ marginTop: "1rem" }}>
        After reset, the app will try to sign you in automatically.
      </p>
      {status ? <ModalStatusBanner tone={inferStatusTone(status)}>{status}</ModalStatusBanner> : null}
    </section>
  );
}
