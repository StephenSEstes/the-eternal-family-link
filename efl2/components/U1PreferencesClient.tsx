"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type SessionInfo = {
  username: string;
  personId: string;
};

type ApiData = {
  rows?: unknown;
  status?: unknown;
  categories?: string[];
  people?: Array<{ personId: string; displayName: string }>;
};

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    credentials: "same-origin",
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(payload.error ?? `Request failed: ${response.status}`));
  }
  return payload;
}

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function U1PreferencesClient({ session }: { session: SessionInfo }) {
  const [catalog, setCatalog] = useState<ApiData>({});
  const [subDefaults, setSubDefaults] = useState("[]");
  const [subPeople, setSubPeople] = useState("[]");
  const [shareDefaults, setShareDefaults] = useState("[]");
  const [sharePeople, setSharePeople] = useState("[]");
  const [statusJson, setStatusJson] = useState("{}");
  const [previewTarget, setPreviewTarget] = useState("");
  const [previewJson, setPreviewJson] = useState("{}");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const clearFeedback = useCallback(() => {
    setError("");
    setMessage("");
  }, []);

  const loadAll = useCallback(async () => {
    clearFeedback();
    setLoading(true);
    try {
      const [catalogPayload, a, b, c, d, statusPayload] = await Promise.all([
        fetchJson("/api/u1/access/catalog"),
        fetchJson("/api/u1/access/subscription/defaults"),
        fetchJson("/api/u1/access/subscription/exceptions/people"),
        fetchJson("/api/u1/access/sharing/defaults"),
        fetchJson("/api/u1/access/sharing/exceptions/people"),
        fetchJson("/api/u1/access/resync/status"),
      ]);
      setCatalog(catalogPayload as ApiData);
      setSubDefaults(pretty(a.rows ?? []));
      setSubPeople(pretty(b.rows ?? []));
      setShareDefaults(pretty(c.rows ?? []));
      setSharePeople(pretty(d.rows ?? []));
      setStatusJson(pretty(statusPayload.status ?? {}));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load data.");
    } finally {
      setLoading(false);
    }
  }, [clearFeedback]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const saveRows = useCallback(async (url: string, source: string, successMessage: string) => {
    clearFeedback();
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Invalid JSON.");
      return;
    }
    try {
      setLoading(true);
      await fetchJson(url, { method: "PUT", body: JSON.stringify(parsed) });
      setMessage(successMessage);
      await loadAll();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed.");
    } finally {
      setLoading(false);
    }
  }, [clearFeedback, loadAll]);

  const runResync = useCallback(async () => {
    clearFeedback();
    try {
      setLoading(true);
      const payload = await fetchJson("/api/u1/access/resync", { method: "POST", body: "{}" });
      setMessage("Resync completed.");
      setStatusJson(pretty(payload.result ?? {}));
      await loadAll();
    } catch (resyncError) {
      setError(resyncError instanceof Error ? resyncError.message : "Resync failed.");
    } finally {
      setLoading(false);
    }
  }, [clearFeedback, loadAll]);

  const runPreview = useCallback(async () => {
    clearFeedback();
    const target = previewTarget.trim();
    if (!target) {
      setError("Target person ID is required.");
      return;
    }
    try {
      setLoading(true);
      const payload = await fetchJson("/api/u1/access/preview", {
        method: "POST",
        body: JSON.stringify({ targetPersonId: target }),
      });
      setPreviewJson(pretty(payload.preview ?? null));
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Preview failed.");
    } finally {
      setLoading(false);
    }
  }, [clearFeedback, previewTarget]);

  const logout = useCallback(async () => {
    await fetchJson("/api/auth/logout", { method: "POST", body: "{}" });
    window.location.href = "/login";
  }, []);

  const peopleSummary = useMemo(() => {
    const people = (catalog.people ?? []).slice(0, 10);
    return people.map((person) => `${person.personId}: ${person.displayName}`).join("\n");
  }, [catalog.people]);

  return (
    <main className="u1-shell u1-grid">
      <section className="u1-card u1-grid">
        <div className="u1-toolbar">
          <strong>EFL2</strong>
          <span className="u1-muted">Signed in as `{session.username}`</span>
          <span className="u1-muted">person_id `{session.personId}`</span>
        </div>
        <div className="u1-toolbar">
          <button className="u1-button secondary" onClick={() => void loadAll()} disabled={loading}>
            Reload
          </button>
          <button className="u1-button secondary" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
        {error ? <div className="u1-error">{error}</div> : null}
        {message ? <div className="u1-ok">{message}</div> : null}
      </section>

      <section className="u1-card u1-grid">
        <h3>Catalog</h3>
        <div className="u1-muted">Use `personId` values below for exceptions and preview.</div>
        <textarea className="u1-textarea" value={peopleSummary} readOnly />
      </section>

      <section className="u1-card u1-grid">
        <h3>Subscription Defaults</h3>
        <textarea className="u1-textarea" value={subDefaults} onChange={(event) => setSubDefaults(event.target.value)} />
        <div className="u1-toolbar">
          <button
            className="u1-button"
            onClick={() =>
              void saveRows(
                "/api/u1/access/subscription/defaults",
                subDefaults,
                "Subscription defaults saved.",
              )
            }
            disabled={loading}
          >
            Save Subscription Defaults
          </button>
        </div>
      </section>

      <section className="u1-card u1-grid">
        <h3>Subscription Person Exceptions</h3>
        <textarea className="u1-textarea" value={subPeople} onChange={(event) => setSubPeople(event.target.value)} />
        <div className="u1-toolbar">
          <button
            className="u1-button"
            onClick={() =>
              void saveRows(
                "/api/u1/access/subscription/exceptions/people",
                subPeople,
                "Subscription person exceptions saved.",
              )
            }
            disabled={loading}
          >
            Save Subscription Exceptions
          </button>
        </div>
      </section>

      <section className="u1-card u1-grid">
        <h3>Sharing Defaults</h3>
        <textarea className="u1-textarea" value={shareDefaults} onChange={(event) => setShareDefaults(event.target.value)} />
        <div className="u1-toolbar">
          <button
            className="u1-button"
            onClick={() =>
              void saveRows(
                "/api/u1/access/sharing/defaults",
                shareDefaults,
                "Sharing defaults saved.",
              )
            }
            disabled={loading}
          >
            Save Sharing Defaults
          </button>
        </div>
      </section>

      <section className="u1-card u1-grid">
        <h3>Sharing Person Exceptions</h3>
        <textarea className="u1-textarea" value={sharePeople} onChange={(event) => setSharePeople(event.target.value)} />
        <div className="u1-toolbar">
          <button
            className="u1-button"
            onClick={() =>
              void saveRows(
                "/api/u1/access/sharing/exceptions/people",
                sharePeople,
                "Sharing person exceptions saved.",
              )
            }
            disabled={loading}
          >
            Save Sharing Exceptions
          </button>
        </div>
      </section>

      <section className="u1-card u1-grid">
        <h3>Resync + Status</h3>
        <div className="u1-toolbar">
          <button className="u1-button" onClick={() => void runResync()} disabled={loading}>
            Run Resync
          </button>
          <button className="u1-button secondary" onClick={() => void loadAll()} disabled={loading}>
            Refresh Status
          </button>
        </div>
        <textarea className="u1-textarea" value={statusJson} readOnly />
      </section>

      <section className="u1-card u1-grid">
        <h3>Preview</h3>
        <label>
          Target person ID
          <input className="u1-input" value={previewTarget} onChange={(event) => setPreviewTarget(event.target.value)} />
        </label>
        <div className="u1-toolbar">
          <button className="u1-button" onClick={() => void runPreview()} disabled={loading}>
            Preview Access
          </button>
        </div>
        <textarea className="u1-textarea" value={previewJson} readOnly />
      </section>
    </main>
  );
}

