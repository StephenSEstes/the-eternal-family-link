export type RouteStatus = "start" | "ok" | "error";

export type RouteLogInput = {
  requestId: string;
  step?: string;
  status: RouteStatus;
  durationMs?: number;
  message?: string;
  errorCode?: string;
  tenantKey?: string;
  userEmailMasked?: string;
};

function compact(input: Record<string, string | number | undefined>) {
  return Object.entries(input).filter(([, value]) => value !== undefined && value !== "");
}

export function createRequestId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function maskEmail(email?: string) {
  const value = (email ?? "").trim().toLowerCase();
  if (!value || !value.includes("@")) {
    return "";
  }
  const [name, domain] = value.split("@");
  if (!name || !domain) {
    return "";
  }
  if (name.length <= 2) {
    return `${name[0] ?? "*"}*@${domain}`;
  }
  return `${name.slice(0, 2)}***@${domain}`;
}

export function logRoute(route: string, input: RouteLogInput) {
  const line = compact({
    route,
    requestId: input.requestId,
    step: input.step,
    status: input.status,
    durationMs: input.durationMs,
    errorCode: input.errorCode,
    tenantKey: input.tenantKey,
    user: input.userEmailMasked,
    message: input.message,
  })
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");

  if (input.status === "error") {
    console.error(line);
    return;
  }
  console.log(line);
}

export function classifyOperationalError(error: unknown): { errorCode: string; status: number; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const raw = message.toLowerCase();

  if (raw.includes("timeout") || raw.includes("aborted")) {
    return { errorCode: "upstream_timeout", status: 504, message };
  }
  if (
    raw.includes("quota") ||
    raw.includes("rate limit") ||
    raw.includes("too many requests") ||
    raw.includes("429")
  ) {
    return { errorCode: "google_quota_exceeded", status: 429, message };
  }
  if (raw.includes("forbidden") || raw.includes("permission")) {
    return { errorCode: "upstream_forbidden", status: 403, message };
  }
  if (raw.includes("unauthorized") || raw.includes("invalid credentials")) {
    return { errorCode: "upstream_unauthorized", status: 401, message };
  }

  return { errorCode: "internal_error", status: 500, message };
}
