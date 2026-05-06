"use client";

import { FormEvent, useMemo, useState } from "react";
import type { AppRole, InviteDirectoryPerson, InviteEmailDeliveryResult, InvitePresentation } from "@/lib/invite/types";

type InviteAdminClientProps = {
  people: InviteDirectoryPerson[];
  canSendEmail: boolean;
};

type InviteCreationResult = {
  invite: InvitePresentation;
  inviteUrl: string;
  inviteMessage: string;
  emailDelivery?: InviteEmailDeliveryResult;
};

type StatusTone = "info" | "success" | "error";

const DEFAULT_EXPIRY_DAYS = "14";

function normalize(value?: string) {
  return String(value ?? "").trim();
}

function parseSearchTokens(value: string) {
  return normalize(value)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function statusClassName(tone: StatusTone) {
  return `invite-status invite-status-${tone}`;
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export function InviteAdminClient({ people, canSendEmail }: InviteAdminClientProps) {
  const [query, setQuery] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [localUsername, setLocalUsername] = useState("");
  const [role, setRole] = useState<AppRole>("USER");
  const [expiresInDays, setExpiresInDays] = useState(DEFAULT_EXPIRY_DAYS);
  const [sendEmail, setSendEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: StatusTone; message: string } | null>(null);
  const [result, setResult] = useState<InviteCreationResult | null>(null);

  const selectedPerson = useMemo(
    () => people.find((person) => person.personId === selectedPersonId) ?? null,
    [people, selectedPersonId],
  );
  const filteredPeople = useMemo(() => {
    const tokens = parseSearchTokens(query);
    if (!tokens.length) return people;
    return people.filter((person) => {
      const haystack = [
        person.displayName,
        person.email,
        person.localUsername,
        person.personId,
      ]
        .map((value) => normalize(value).toLowerCase())
        .join(" ");
      return tokens.every((token) => haystack.includes(token));
    });
  }, [people, query]);

  function resetOutput() {
    setStatus(null);
    setResult(null);
  }

  function selectPerson(person: InviteDirectoryPerson) {
    setSelectedPersonId(person.personId);
    setInviteEmail(person.email);
    setLocalUsername(person.localUsername);
    setRole(person.localRole || "USER");
    setExpiresInDays(DEFAULT_EXPIRY_DAYS);
    setSendEmail(Boolean(canSendEmail && person.email));
    resetOutput();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPerson) {
      setStatus({ tone: "error", message: "Choose a person before creating an invite." });
      return;
    }

    setBusy(true);
    setStatus({ tone: "info", message: "Creating invite..." });
    setResult(null);
    try {
      const response = await fetch("/api/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          personId: selectedPerson.personId,
          inviteEmail,
          role,
          localUsername,
          expiresInDays,
          sendEmail,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as Partial<InviteCreationResult> & {
        ok?: boolean;
        message?: string;
        emailDelivery?: InviteEmailDeliveryResult;
      };
      if (!response.ok || !payload.ok || !payload.invite || !payload.inviteUrl || !payload.inviteMessage) {
        setStatus({
          tone: "error",
          message: String(payload.message ?? `Invite creation failed (${response.status}).`),
        });
        return;
      }

      const nextResult: InviteCreationResult = {
        invite: payload.invite,
        inviteUrl: payload.inviteUrl,
        inviteMessage: payload.inviteMessage,
        emailDelivery: payload.emailDelivery,
      };
      setResult(nextResult);

      if (payload.emailDelivery?.attempted && !payload.emailDelivery.sent) {
        setStatus({
          tone: "error",
          message: payload.emailDelivery.errorMessage
            ? `Invite created, but email was not sent: ${payload.emailDelivery.errorMessage}`
            : "Invite created, but email was not sent.",
        });
        return;
      }

      setStatus({
        tone: "success",
        message: payload.emailDelivery?.sent
          ? "Invite created and email sent."
          : "Invite created. Copy the link or message below.",
      });
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "Invite creation failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function onCopy(label: string, value: string) {
    try {
      await copyText(value);
      setStatus({ tone: "success", message: `${label} copied.` });
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : `Could not copy ${label.toLowerCase()}.`,
      });
    }
  }

  return (
    <section className="invite-admin-grid">
      <section className="panel invite-directory-panel">
        <div className="section-head">
          <div>
            <h2>Choose Person</h2>
            <p className="lead">
              Only people who share one of your enabled family groups appear here.
            </p>
          </div>
        </div>

        <label className="field">
          <span className="field-label">Search</span>
          <input
            className="input"
            placeholder="Name, email, username, or person id"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <div className="invite-directory-list">
          {filteredPeople.length ? (
            filteredPeople.map((person) => (
              <button
                key={person.personId}
                type="button"
                className={`invite-person-button${person.personId === selectedPersonId ? " is-active" : ""}`}
                onClick={() => selectPerson(person)}
              >
                <span className="invite-person-copy">
                  <strong>{person.displayName}</strong>
                  <small>{person.email || "No email on file"}</small>
                  <small>{person.personId}</small>
                </span>
                <span className="invite-person-tags">
                  {person.localUsername ? <span className="badge subscribed">User: {person.localUsername}</span> : null}
                  <span className="badge side">{person.familyGroupCount} groups</span>
                </span>
              </button>
            ))
          ) : (
            <p className="empty-state">No people match this search.</p>
          )}
        </div>
      </section>

      <section className="panel invite-editor-panel">
        <div className="section-head">
          <div>
            <h2>Invite User</h2>
            <p className="lead">Create a copyable invite link or send the invite email directly.</p>
          </div>
        </div>

        {selectedPerson ? (
          <>
            <div className="invite-person-summary">
              <strong>{selectedPerson.displayName}</strong>
              <p className="muted">
                {selectedPerson.localUsername
                  ? `Existing local username: ${selectedPerson.localUsername}`
                  : "No local username is set yet. Famailink will suggest one if left blank."}
              </p>
            </div>

            <form className="invite-form" onSubmit={onSubmit}>
              <div className="invite-form-grid">
                <label className="field">
                  <span className="field-label">Invite Email</span>
                  <input
                    className="input"
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                  />
                </label>

                <label className="field">
                  <span className="field-label">Local Username</span>
                  <input
                    className="input"
                    value={localUsername}
                    onChange={(event) => setLocalUsername(event.target.value)}
                    placeholder="Leave blank to use the suggested username"
                  />
                </label>

                <label className="field">
                  <span className="field-label">Role</span>
                  <select className="input" value={role} onChange={(event) => setRole(event.target.value === "ADMIN" ? "ADMIN" : "USER")}>
                    <option value="USER">User</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </label>

                <label className="field">
                  <span className="field-label">Expire In Days</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={60}
                    value={expiresInDays}
                    onChange={(event) => setExpiresInDays(event.target.value)}
                  />
                </label>
              </div>

              <label className="scope-toggle invite-checkbox">
                <input
                  type="checkbox"
                  checked={sendEmail}
                  disabled={!canSendEmail || !normalize(inviteEmail)}
                  onChange={(event) => setSendEmail(event.target.checked)}
                />
                Send invite email now
              </label>
              {!canSendEmail ? (
                <p className="empty-state">
                  Gmail sending is not configured in this environment. You can still create and copy the invite.
                </p>
              ) : null}

              <div className="row-actions">
                <button className="primary-button" type="submit" disabled={busy}>
                  {busy ? "Creating..." : sendEmail ? "Create And Send Invite" : "Create Invite"}
                </button>
              </div>
            </form>
          </>
        ) : (
          <p className="empty-state">Choose a person on the left to prepare an invite.</p>
        )}

        {status ? <div className={statusClassName(status.tone)}>{status.message}</div> : null}

        {result ? (
          <div className="invite-result">
            <div className="invite-result-head">
              <h3>Invite Ready</h3>
              <div className="row-actions">
                <button type="button" className="secondary-button" onClick={() => void onCopy("Invite URL", result.inviteUrl)}>
                  Copy Link
                </button>
                <button type="button" className="secondary-button" onClick={() => void onCopy("Invite Message", result.inviteMessage)}>
                  Copy Message
                </button>
                <a className="secondary-button" href={result.inviteUrl} target="_blank" rel="noreferrer">
                  Open Invite
                </a>
              </div>
            </div>

            <label className="field">
              <span className="field-label">Invite URL</span>
              <input className="input" readOnly value={result.inviteUrl} />
            </label>

            <label className="field">
              <span className="field-label">Invite Message</span>
              <textarea className="input invite-textarea" readOnly value={result.inviteMessage} />
            </label>
          </div>
        ) : null}
      </section>
    </section>
  );
}
