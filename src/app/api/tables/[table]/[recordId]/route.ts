import { z } from "zod";
import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { deleteTableRecordById, getTableRecordById, updateTableRecordById } from "@/lib/google/sheets";
import { getTenantContext } from "@/lib/tenant/context";

const tableNameSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9 _-]+$/);
const idSchema = z.string().trim().min(1).max(200);
const idColumnSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9 _-]+$/).optional();
const recordSchema = z.record(z.string(), z.string().or(z.number()).or(z.boolean()).or(z.null())).transform((obj) => {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [key, value == null ? "" : String(value)]),
  );
});

type RecordRouteProps = {
  params: Promise<{ table: string; recordId: string }>;
};

function requireAdminRole(session: Awaited<ReturnType<typeof getAppSession>>) {
  return session?.user?.role === "ADMIN";
}

function parseTableAndId(input: { table: string; recordId: string }) {
  const table = tableNameSchema.safeParse(decodeURIComponent(input.table));
  const recordId = idSchema.safeParse(decodeURIComponent(input.recordId));

  if (!table.success || !recordId.success) {
    return null;
  }

  return { table: table.data, recordId: recordId.data };
}

function parseIdColumn(request: Request) {
  const idColumn = new URL(request.url).searchParams.get("idColumn") ?? undefined;
  const parsed = idColumnSchema.safeParse(idColumn);
  if (!parsed.success) {
    return { ok: false as const };
  }
  return { ok: true as const, idColumn: parsed.data };
}

export async function GET(request: Request, { params }: RecordRouteProps) {
  const session = await getAppSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const tenant = getTenantContext(session);

  const parsed = parseTableAndId(await params);
  if (!parsed) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  const idColumn = parseIdColumn(request);
  if (!idColumn.ok) {
    return NextResponse.json({ error: "invalid_id_column" }, { status: 400 });
  }

  try {
    const record = await getTableRecordById(parsed.table, parsed.recordId, idColumn.idColumn, tenant.tenantKey);
    if (!record) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({ table: parsed.table, record });
  } catch (error) {
    const message = error instanceof Error ? error.message : "read_failed";
    return NextResponse.json({ error: "read_failed", message }, { status: 400 });
  }
}

export async function PATCH(request: Request, { params }: RecordRouteProps) {
  const session = await getAppSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const tenant = getTenantContext(session);

  if (!requireAdminRole(session)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = parseTableAndId(await params);
  if (!parsed) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  const idColumn = parseIdColumn(request);
  if (!idColumn.ok) {
    return NextResponse.json({ error: "invalid_id_column" }, { status: 400 });
  }

  const payload = await request.json().catch(() => null);
  const parsedRecord = recordSchema.safeParse(payload?.record);
  if (!parsedRecord.success) {
    return NextResponse.json({ error: "invalid_record", issues: parsedRecord.error.flatten() }, { status: 400 });
  }

  try {
    const record = await updateTableRecordById(
      parsed.table,
      parsed.recordId,
      parsedRecord.data,
      idColumn.idColumn,
      tenant.tenantKey,
    );
    if (!record) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({ table: parsed.table, record });
  } catch (error) {
    const message = error instanceof Error ? error.message : "update_failed";
    return NextResponse.json({ error: "update_failed", message }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: RecordRouteProps) {
  const session = await getAppSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const tenant = getTenantContext(session);

  if (!requireAdminRole(session)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = parseTableAndId(await params);
  if (!parsed) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  const idColumn = parseIdColumn(request);
  if (!idColumn.ok) {
    return NextResponse.json({ error: "invalid_id_column" }, { status: 400 });
  }

  try {
    const deleted = await deleteTableRecordById(parsed.table, parsed.recordId, idColumn.idColumn, tenant.tenantKey);
    if (!deleted) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({ table: parsed.table, deleted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "delete_failed";
    return NextResponse.json({ error: "delete_failed", message }, { status: 400 });
  }
}
