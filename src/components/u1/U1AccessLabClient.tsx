"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AsyncActionButton, ModalStatusBanner, inferStatusTone } from "@/components/ui/primitives";
import type { U1PersonLite, U1PreviewRow, U1RecomputeJob, U1RecomputeRun } from "@/lib/u1/types";

type U1AccessLabClientProps = { actorPersonId: string };
type CatalogResponse = { people: U1PersonLite[] };
type StatusResponse = { latestJob: U1RecomputeJob | null; latestRun: U1RecomputeRun | null };
type PreviewResponse = { preview: U1PreviewRow };

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function prettyJson(value: unknown) {
  return JSON.stringify(value ?? [], null, 2);
}

function parseJsonArray(text: string) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("payload_must_be_array");
  return parsed;
}

function formatIso(value: string) {
  const raw = normalize(value);
  if (!raw) return "n/a";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleString();
}

function buildErrorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object") {
    if ("error" in payload && typeof payload.error === "string" && payload.error.trim()) return payload.error.trim();
    if ("message" in payload && typeof payload.message === "string" && payload.message.trim()) return payload.message.trim();
  }
  return `request_failed_${status}`;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { ...(init?.headers ?? {}), ...(init?.body ? { "content-type": "application/json" } : {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(buildErrorMessage(payload, response.status));
  return payload as T;
}

type JsonEditorProps = {
  title: string;
  subtitle: string;
  value: string;
  onChange: (value: string) => void;
  pending: boolean;
  onSave: () => void;
  saveLabel: string;
};

function JsonEditorCard({ title, subtitle, value, onChange, pending, onSave, saveLabel }: JsonEditorProps) {
  return (
    <section className="card">
      <h2 className="ui-section-title">{title}</h2>
      <p className="ui-section-subtitle">{subtitle}</p>
      <textarea className="textarea" style={{ minHeight: 220 }} value={value} onChange={(event) => onChange(event.target.value)} />
      <AsyncActionButton pending={pending} pendingLabel="Saving..." onClick={onSave}>
        {saveLabel}
      </AsyncActionButton>
    </section>
  );
}

export function U1AccessLabClient({ actorPersonId }: U1AccessLabClientProps) {
  const [people, setPeople] = useState<U1PersonLite[]>([]);
  const [subDefaultsText, setSubDefaultsText] = useState("[]");
  const [subPeopleText, setSubPeopleText] = useState("[]");
  const [subHouseholdsText, setSubHouseholdsText] = useState("[]");
  const [shareDefaultsText, setShareDefaultsText] = useState("[]");
  const [sharePeopleText, setSharePeopleText] = useState("[]");
  const [shareHouseholdsText, setShareHouseholdsText] = useState("[]");
  const [recomputeStatus, setRecomputeStatus] = useState<StatusResponse | null>(null);
  const [previewTargetPersonId, setPreviewTargetPersonId] = useState("");
  const [previewRow, setPreviewRow] = useState<U1PreviewRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState("");
  const [statusMessage, setStatusMessage] = useState("Loading Unit 1 access settings...");

  const defaultPreviewTarget = useMemo(
    () => people.find((person) => person.personId !== actorPersonId)?.personId ?? people[0]?.personId ?? "",
    [people, actorPersonId],
  );

  const loadStatus = useCallback(async (silent = false) => {
    const payload = await requestJson<StatusResponse>("/api/u1/access/resync/status");
    setRecomputeStatus(payload);
    if (!silent) setStatusMessage(`Loaded recompute status: ${normalize(payload.latestJob?.status) || "none"}.`);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [catalog, subDefaults, subPeople, subHouseholds, shareDefaults, sharePeople, shareHouseholds, status] = await Promise.all([
        requestJson<CatalogResponse>("/api/u1/access/catalog"),
        requestJson<{ rules: unknown[] }>("/api/u1/access/subscription/defaults"),
        requestJson<{ exceptions: unknown[] }>("/api/u1/access/subscription/exceptions/people"),
        requestJson<{ exceptions: unknown[] }>("/api/u1/access/subscription/exceptions/households"),
        requestJson<{ rules: unknown[] }>("/api/u1/access/sharing/defaults"),
        requestJson<{ exceptions: unknown[] }>("/api/u1/access/sharing/exceptions/people"),
        requestJson<{ exceptions: unknown[] }>("/api/u1/access/sharing/exceptions/households"),
        requestJson<StatusResponse>("/api/u1/access/resync/status"),
      ]);
      setPeople(catalog.people);
      setSubDefaultsText(prettyJson(subDefaults.rules));
      setSubPeopleText(prettyJson(subPeople.exceptions));
      setSubHouseholdsText(prettyJson(subHouseholds.exceptions));
      setShareDefaultsText(prettyJson(shareDefaults.rules));
      setSharePeopleText(prettyJson(sharePeople.exceptions));
      setShareHouseholdsText(prettyJson(shareHouseholds.exceptions));
      setRecomputeStatus(status);
      setPreviewTargetPersonId((current) => {
        const normalizedCurrent = normalize(current);
        if (normalizedCurrent && catalog.people.some((person) => person.personId === normalizedCurrent)) {
          return normalizedCurrent;
        }
        return catalog.people.find((person) => person.personId !== actorPersonId)?.personId ?? catalog.people[0]?.personId ?? "";
      });
      setStatusMessage("Unit 1 access settings loaded.");
    } catch (error) {
      setStatusMessage(`Failed to load Unit 1 data: ${error instanceof Error ? error.message : "unknown_error"}`);
    } finally {
      setLoading(false);
    }
  }, [actorPersonId]);

  useEffect(() => { void loadAll(); }, [loadAll]);
  useEffect(() => {
    const status = normalize(recomputeStatus?.latestJob?.status).toLowerCase();
    if (status !== "queued" && status !== "running") return;
    const timer = window.setInterval(() => { void loadStatus(true); }, 3500);
    return () => window.clearInterval(timer);
  }, [recomputeStatus?.latestJob?.status, loadStatus]);

  const runAction = useCallback(async (key: string, action: () => Promise<void>) => {
    setPendingAction(key);
    try { await action(); } finally { setPendingAction(""); }
  }, []);

  const saveJsonEditor = useCallback(async (key: string, endpoint: string, bodyKey: "rules" | "exceptions", text: string, successLabel: string) => {
    await runAction(key, async () => {
      const payload = parseJsonArray(text);
      await requestJson(endpoint, { method: "PUT", body: JSON.stringify({ [bodyKey]: payload }) });
      setStatusMessage(`${successLabel} saved. Recompute scheduled.`);
      await loadStatus(true);
    });
  }, [runAction, loadStatus]);

  const runResync = useCallback(async (runAudit: boolean) => {
    await runAction(runAudit ? "run-audit" : "run-resync", async () => {
      await requestJson("/api/u1/access/resync", { method: "POST", body: JSON.stringify({ reason: runAudit ? "manual_resync_audit" : "manual_resync", runAudit }) });
      await loadStatus(true);
      setStatusMessage(runAudit ? "Resync + audit started/completed." : "Resync started/completed.");
    });
  }, [runAction, loadStatus]);

  const runPreview = useCallback(async () => {
    const targetPersonId = normalize(previewTargetPersonId);
    if (!targetPersonId) { setStatusMessage("Pick a person to preview."); return; }
    await runAction("run-preview", async () => {
      const payload = await requestJson<PreviewResponse>("/api/u1/access/preview", { method: "POST", body: JSON.stringify({ targetPersonId }) });
      setPreviewRow(payload.preview);
      setStatusMessage(`Preview loaded for ${payload.preview.targetDisplayName}.`);
    });
  }, [previewTargetPersonId, runAction]);

  if (loading) return <section className="card"><p>Loading Unit 1 access settings...</p></section>;

  return (
    <div className="settings-stack">
      <ModalStatusBanner tone={inferStatusTone(statusMessage)}>{statusMessage}</ModalStatusBanner>
      <section className="card">
        <h2 className="ui-section-title">Session + Recompute</h2>
        <p className="ui-section-subtitle">Actor person id: <strong>{actorPersonId}</strong></p>
        <div style={{ display: "flex", gap: "0.55rem", flexWrap: "wrap", marginBottom: "0.8rem" }}>
          <AsyncActionButton tone="secondary" pending={pendingAction === "reload-all"} onClick={() => { void runAction("reload-all", loadAll); }}>Reload Data</AsyncActionButton>
          <AsyncActionButton pending={pendingAction === "run-resync"} pendingLabel="Running Resync..." onClick={() => { void runResync(false); }}>Resync Access</AsyncActionButton>
          <AsyncActionButton tone="secondary" pending={pendingAction === "run-audit"} pendingLabel="Running Audit..." onClick={() => { void runResync(true); }}>Resync + Audit</AsyncActionButton>
        </div>
        <p style={{ margin: 0 }}>Latest job: <strong>{normalize(recomputeStatus?.latestJob?.status) || "none"}</strong> | Requested: {formatIso(recomputeStatus?.latestJob?.requestedAt ?? "")} | Last run: <strong>{normalize(recomputeStatus?.latestRun?.status) || "none"}</strong></p>
      </section>

      <JsonEditorCard title="Subscription Defaults" subtitle="Edit JSON array of subscription default rules." value={subDefaultsText} onChange={setSubDefaultsText} pending={pendingAction === "save-sub-defaults"} onSave={() => { void saveJsonEditor("save-sub-defaults", "/api/u1/access/subscription/defaults", "rules", subDefaultsText, "Subscription defaults"); }} saveLabel="Save Subscription Defaults" />
      <JsonEditorCard title="Subscription Person Exceptions" subtitle="Edit JSON array of person subscription exceptions." value={subPeopleText} onChange={setSubPeopleText} pending={pendingAction === "save-sub-people"} onSave={() => { void saveJsonEditor("save-sub-people", "/api/u1/access/subscription/exceptions/people", "exceptions", subPeopleText, "Subscription person exceptions"); }} saveLabel="Save Person Exceptions" />
      <JsonEditorCard title="Subscription Household Exceptions" subtitle="Edit JSON array of household subscription exceptions." value={subHouseholdsText} onChange={setSubHouseholdsText} pending={pendingAction === "save-sub-households"} onSave={() => { void saveJsonEditor("save-sub-households", "/api/u1/access/subscription/exceptions/households", "exceptions", subHouseholdsText, "Subscription household exceptions"); }} saveLabel="Save Household Exceptions" />
      <JsonEditorCard title="Sharing Defaults" subtitle="Edit JSON array of owner sharing default rules." value={shareDefaultsText} onChange={setShareDefaultsText} pending={pendingAction === "save-share-defaults"} onSave={() => { void saveJsonEditor("save-share-defaults", "/api/u1/access/sharing/defaults", "rules", shareDefaultsText, "Sharing defaults"); }} saveLabel="Save Sharing Defaults" />
      <JsonEditorCard title="Sharing Person Exceptions" subtitle="Edit JSON array of person sharing exceptions." value={sharePeopleText} onChange={setSharePeopleText} pending={pendingAction === "save-share-people"} onSave={() => { void saveJsonEditor("save-share-people", "/api/u1/access/sharing/exceptions/people", "exceptions", sharePeopleText, "Sharing person exceptions"); }} saveLabel="Save Person Sharing Exceptions" />
      <JsonEditorCard title="Sharing Household Exceptions" subtitle="Edit JSON array of household sharing exceptions." value={shareHouseholdsText} onChange={setShareHouseholdsText} pending={pendingAction === "save-share-households"} onSave={() => { void saveJsonEditor("save-share-households", "/api/u1/access/sharing/exceptions/households", "exceptions", shareHouseholdsText, "Sharing household exceptions"); }} saveLabel="Save Household Sharing Exceptions" />

      <section className="card">
        <h2 className="ui-section-title">Preview</h2>
        <p className="ui-section-subtitle">Preview one target person with current settings.</p>
        <div style={{ display: "flex", gap: "0.55rem", flexWrap: "wrap", alignItems: "center" }}>
          <select className="input" style={{ marginBottom: 0, minWidth: 280 }} value={previewTargetPersonId} onChange={(event) => setPreviewTargetPersonId(normalize(event.target.value))}>
            <option value="">Select person</option>
            {people.map((person) => <option key={person.personId} value={person.personId}>{person.displayName}</option>)}
          </select>
          <AsyncActionButton pending={pendingAction === "run-preview"} pendingLabel="Loading Preview..." onClick={() => { void runPreview(); }}>Preview Access</AsyncActionButton>
        </div>
        {!previewTargetPersonId && defaultPreviewTarget ? <p style={{ marginTop: "0.65rem", marginBottom: 0 }}>Tip: choose {people.find((person) => person.personId === defaultPreviewTarget)?.displayName || defaultPreviewTarget} to start.</p> : null}
        {previewRow ? (
          <div style={{ marginTop: "0.8rem" }}>
            <p style={{ margin: "0 0 0.4rem", fontWeight: 700 }}>{previewRow.targetDisplayName}</p>
            <p style={{ margin: "0 0 0.2rem" }}>Subscribed: <strong>{previewRow.isSubscribed ? "Yes" : "No"}</strong> | Shared: <strong>{previewRow.isShared ? "Yes" : "No"}</strong> | Placeholder: <strong>{previewRow.placeholderOnly ? "Yes" : "No"}</strong></p>
            <p style={{ margin: "0 0 0.2rem" }}>Scopes: vitals=<strong>{previewRow.canVitals ? "Y" : "N"}</strong> stories=<strong>{previewRow.canStories ? "Y" : "N"}</strong> media=<strong>{previewRow.canMedia ? "Y" : "N"}</strong> conversations=<strong>{previewRow.canConversations ? "Y" : "N"}</strong></p>
            <p style={{ margin: 0 }}>Reason: <code>{previewRow.reasonCode}</code></p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
