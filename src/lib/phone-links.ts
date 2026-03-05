export type PhoneLinkItem = {
  raw: string;
  telHref: string;
  smsHref: string;
};

function normalizeDialTarget(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const hasLeadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return "";
  return hasLeadingPlus ? `+${digits}` : digits;
}

export function extractPhoneLinkItems(value: string | undefined): PhoneLinkItem[] {
  const text = String(value ?? "").trim();
  if (!text) return [];
  const tokens = text
    .split(/[\n,;|/]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: PhoneLinkItem[] = [];
  for (const token of tokens) {
    const target = normalizeDialTarget(token);
    if (!target || seen.has(target)) continue;
    seen.add(target);
    out.push({
      raw: token,
      telHref: `tel:${target}`,
      smsHref: `sms:${target}`,
    });
  }
  return out;
}
