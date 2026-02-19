import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  createSheetsClient,
  createTableRecord,
  deleteTableRecordById,
  getTableRecordById,
  listTabs,
  readTabWithClient,
  updateTableRecordById,
} from "@/lib/google/sheets";
import { getTenantContext } from "@/lib/tenant/context";

const ID_COLUMN_CANDIDATES = ["id", "person_id", "record_id", "user_email"];

type TabReport = {
  tab: string;
  idColumn: string | null;
  create: { ok: boolean; recordId?: string; rowNumber?: number; error?: string };
  read: { ok: boolean; found?: boolean; error?: string };
  update: { ok: boolean; updated?: boolean; error?: string };
  delete: { ok: boolean; deleted?: boolean; cleanupConfirmed?: boolean; error?: string };
};

function detectIdColumn(headers: string[]): string | null {
  const normalized = headers.map((header) => ({ raw: header, key: header.trim().toLowerCase() }));

  for (const candidate of ID_COLUMN_CANDIDATES) {
    const match = normalized.find((item) => item.key === candidate);
    if (match) {
      return match.raw;
    }
  }

  return headers[0] ?? null;
}

function buildCreatePayload(headers: string[], idColumn: string, token: string): Record<string, string> {
  const payload = Object.fromEntries(headers.map((header) => [header, ""])) as Record<string, string>;

  payload[idColumn] = token;

  for (const header of headers) {
    const key = header.trim().toLowerCase();

    if (key === "user_email") payload[header] = `smoketest+${token}@example.com`;
    if (key === "display_name") payload[header] = `Smoke ${token}`;
    if (key === "name") payload[header] = `Smoke ${token}`;
    if (key === "role") payload[header] = "USER";
    if (key === "is_enabled") payload[header] = "FALSE";
    if (key === "created_at" || key === "updated_at") payload[header] = new Date().toISOString();
    if (key === "notes") payload[header] = `smoke-create-${token}`;
  }

  return payload;
}

function buildUpdatePayload(headers: string[], token: string): Record<string, string> {
  const payload: Record<string, string> = {};
  const updatedAt = new Date().toISOString();

  const notesHeader = headers.find((header) => header.trim().toLowerCase() === "notes");
  if (notesHeader) {
    payload[notesHeader] = `smoke-update-${token}`;
  }

  const updatedAtHeader = headers.find((header) => header.trim().toLowerCase() === "updated_at");
  if (updatedAtHeader) {
    payload[updatedAtHeader] = updatedAt;
  }

  if (Object.keys(payload).length === 0 && headers.length > 1) {
    payload[headers[1]] = `smoke-update-${token}`;
  }

  return payload;
}

function isProductionLikeRuntime() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL_URL);
}

export async function POST() {
  if (!isProductionLikeRuntime()) {
    return NextResponse.json(
      { error: "deployed_only", message: "Run this endpoint only on deployed environments." },
      { status: 403 },
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const tenant = getTenantContext(session);

  const tabs = await listTabs();
  const client = await createSheetsClient();
  const reports: TabReport[] = [];

  for (const tab of tabs) {
    const report: TabReport = {
      tab,
      idColumn: null,
      create: { ok: false },
      read: { ok: false },
      update: { ok: false },
      delete: { ok: false },
    };

    try {
      const matrix = await readTabWithClient(client, tab, 7000);
      if (matrix.headers.length === 0) {
        report.create = { ok: false, error: "missing_header_row" };
        report.read = { ok: false, error: "skipped" };
        report.update = { ok: false, error: "skipped" };
        report.delete = { ok: false, error: "skipped" };
        reports.push(report);
        continue;
      }

      const idColumn = detectIdColumn(matrix.headers);
      report.idColumn = idColumn;
      if (!idColumn) {
        report.create = { ok: false, error: "no_id_column_detected" };
        report.read = { ok: false, error: "skipped" };
        report.update = { ok: false, error: "skipped" };
        report.delete = { ok: false, error: "skipped" };
        reports.push(report);
        continue;
      }

      const token = `smoke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const createPayload = buildCreatePayload(matrix.headers, idColumn, token);
      const created = await createTableRecord(tab, createPayload, tenant.tenantKey);
      report.create = { ok: true, recordId: token, rowNumber: created.rowNumber };

      const readBack = await getTableRecordById(tab, token, idColumn, tenant.tenantKey);
      report.read = { ok: true, found: Boolean(readBack) };

      const updatePayload = buildUpdatePayload(matrix.headers, token);
      const updated = await updateTableRecordById(tab, token, updatePayload, idColumn, tenant.tenantKey);
      report.update = { ok: true, updated: Boolean(updated) };

      const deleted = await deleteTableRecordById(tab, token, idColumn, tenant.tenantKey);
      const afterDelete = await getTableRecordById(tab, token, idColumn, tenant.tenantKey);
      report.delete = { ok: true, deleted, cleanupConfirmed: afterDelete === null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!report.create.ok) {
        report.create.error = message;
        report.read = { ok: false, error: "skipped" };
        report.update = { ok: false, error: "skipped" };
        report.delete = { ok: false, error: "skipped" };
      } else if (!report.read.ok) {
        report.read.error = message;
        report.update = { ok: false, error: "skipped" };
        report.delete = { ok: false, error: "skipped" };
      } else if (!report.update.ok) {
        report.update.error = message;
        report.delete = { ok: false, error: "skipped" };
      } else {
        report.delete.error = message;
      }
    }

    reports.push(report);
  }

  return NextResponse.json({
    ok: reports.every((tab) => tab.create.ok && tab.read.ok && tab.update.ok && tab.delete.ok && tab.delete.cleanupConfirmed),
    workbook: process.env.SHEET_ID ?? null,
    tabCount: reports.length,
    reports,
  });
}
