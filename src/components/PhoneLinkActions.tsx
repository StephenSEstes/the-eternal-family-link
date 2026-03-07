"use client";

import { extractPhoneLinkItems } from "@/lib/phone-links";

type PhoneLinkActionsProps = {
  value?: string;
  emptyText?: string;
  showNumber?: boolean;
};

export function PhoneLinkActions({ value, emptyText = "-", showNumber = true }: PhoneLinkActionsProps) {
  const items = extractPhoneLinkItems(value);
  if (items.length === 0) {
    return <span>{emptyText}</span>;
  }
  return (
    <span style={{ display: "inline-flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
      {items.map((item) => (
        <span key={item.smsHref} style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center" }}>
          {showNumber ? <span>{item.raw}</span> : null}
          <a href={item.telHref} className="button secondary tap-button" style={{ padding: "0.2rem 0.45rem", minHeight: "auto" }}>
            Call
          </a>
          <a href={item.smsHref} className="button secondary tap-button" style={{ padding: "0.2rem 0.45rem", minHeight: "auto" }}>
            Text
          </a>
        </span>
      ))}
    </span>
  );
}
