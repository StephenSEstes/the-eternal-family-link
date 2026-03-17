import { NextResponse } from "next/server";
import { getAuditLogEntries } from "@/lib/data/runtime";
import { requireTenantAdmin } from "@/lib/family-group/guard";

function normalizeDateParam(raw: string, endOfDay = false) {
  const value = raw.trim();
  if (!value) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}${endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z"}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  if (!endOfDay) {
    return parsed.toISOString();
  }
  const date = new Date(parsed);
  date.setUTCHours(23, 59, 59, 999);
  return date.toISOString();
}

export async function GET(request: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const searchParams = new URL(request.url).searchParams;
  const actorEmail = String(searchParams.get("actorEmail") ?? "").trim().toLowerCase();
  const actorUsername = String(searchParams.get("actorUsername") ?? "").trim().toLowerCase();
  const actorPersonId = String(searchParams.get("actorPersonId") ?? "").trim();
  const action = String(searchParams.get("action") ?? "").trim().toUpperCase();
  const entityType = String(searchParams.get("entityType") ?? "").trim().toUpperCase();
  const status = String(searchParams.get("status") ?? "").trim().toUpperCase();
  const fromTimestamp = normalizeDateParam(String(searchParams.get("from") ?? ""));
  const toTimestamp = normalizeDateParam(String(searchParams.get("to") ?? ""), true);
  const limitRaw = Number.parseInt(String(searchParams.get("limit") ?? "200"), 10);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 200;

  const entries = await getAuditLogEntries({
    familyGroupKey: resolved.tenant.tenantKey,
    actorEmail,
    actorUsername,
    actorPersonId,
    action,
    entityType,
    status,
    fromTimestamp,
    toTimestamp,
    limit,
  });

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    entries,
    filters: {
      actorEmail,
      actorUsername,
      actorPersonId,
      action,
      entityType,
      status,
      from: fromTimestamp,
      to: toTimestamp,
      limit,
    },
  });
}
