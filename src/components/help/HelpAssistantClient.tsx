"use client";

import { useMemo, useState } from "react";
import { AI_HELP_SUGGESTIONS } from "@/lib/ai/help-guide";

type HelpAssistantClientProps = {
  tenantKey: string;
  tenantName: string;
};

type HelpMessage = {
  role: "user" | "assistant";
  content: string;
};

const INITIAL_MESSAGE =
  "Ask how to use the app. I can help with navigation, invites, media, attributes, installation, and admin tools.";

export function HelpAssistantClient({ tenantKey, tenantName }: HelpAssistantClientProps) {
  const [messages, setMessages] = useState<HelpMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [isSending, setIsSending] = useState(false);

  const canSend = draft.trim().length > 0 && !isSending;
  const visibleSuggestions = useMemo(() => AI_HELP_SUGGESTIONS.slice(0, 6), []);

  const sendQuestion = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) {
      return;
    }

    const nextMessages = [...messages, { role: "user" as const, content: trimmed }];
    const requestMessages = nextMessages.slice(-12);
    setMessages(nextMessages);
    setDraft("");
    setIsSending(true);
    setStatus("Thinking...");

    try {
      const res = await fetch(`/api/t/${encodeURIComponent(tenantKey)}/ai/help`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: requestMessages }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.answer) {
        setStatus(body?.message ? String(body.message) : `Help request failed (${res.status}).`);
        return;
      }

      setMessages((current) => [...current, { role: "assistant", content: String(body.answer) }]);
      setStatus("");
    } catch {
      setStatus("Help request failed before the server returned a response.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <main className="section">
      <h1 className="page-title">Help</h1>
      <p className="page-subtitle">AI help for using {tenantName}. Answers are grounded on the current app features and labels.</p>

      <div className="help-layout">
        <section className="card help-panel">
          <h2 style={{ marginTop: 0 }}>Ask A Question</h2>
          <p className="page-subtitle" style={{ marginTop: 0 }}>
            This assistant explains how to use the product. It does not make changes or send messages for you.
          </p>
          <div className="help-suggestions">
            {visibleSuggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="button secondary tap-button"
                onClick={() => void sendQuestion(suggestion)}
                disabled={isSending}
              >
                {suggestion}
              </button>
            ))}
          </div>
          <label className="label" htmlFor="help-question">Your Question</label>
          <textarea
            id="help-question"
            className="textarea"
            rows={4}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="How do I invite someone? How do I add a story? How do I install the app?"
          />
          <div className="settings-chip-list">
            <button type="button" className="button tap-button" onClick={() => void sendQuestion(draft)} disabled={!canSend}>
              Ask Help Assistant
            </button>
            <button
              type="button"
              className="button secondary tap-button"
              onClick={() => {
                setMessages([]);
                setDraft("");
                setStatus("");
              }}
              disabled={isSending}
            >
              New Conversation
            </button>
          </div>
          {status ? <p className="page-subtitle" style={{ marginTop: "0.75rem" }}>{status}</p> : null}
        </section>

        <section className="card help-panel">
          <h2 style={{ marginTop: 0 }}>Conversation</h2>
          <div className="help-thread">
            {messages.length === 0 ? (
              <article className="help-bubble help-bubble-assistant">
                <strong>Help Assistant</strong>
                <p>{INITIAL_MESSAGE}</p>
              </article>
            ) : null}
            {messages.map((message, index) => (
              <article
                key={`${message.role}-${index}`}
                className={message.role === "assistant" ? "help-bubble help-bubble-assistant" : "help-bubble help-bubble-user"}
              >
                <strong>{message.role === "assistant" ? "Help Assistant" : "You"}</strong>
                <p>{message.content}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
