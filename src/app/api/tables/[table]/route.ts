import { z } from "zod";
import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { createTableRecord, getTableRecords } from "@/lib/google/sheets";
import { getRequestTenantContext } from "@/lib/tenant/context";

const tableNameSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9 _-]+$/);
const recordSchema = z.record(z.string(), z.string().or(z.number()).or(z.boolean()).or(z.null())).transform((obj) => {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [key, value == null ? "" : String(value)]),
  );
});

function requireAdminRole(tenantRole: "ADMIN" | "USER") {
  return tenantRole === "ADMIN";
}

type TableRouteProps = {
  params: Promise<{ table: string }>;
};

export async function GET(_: Request, { params }: TableRouteProps) {
  const session = await getAppSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const tenant = await getRequestTenantContext(session);

  const { table } = await params;
  const parsedTable = tableNameSchema.safeParse(decodeURIComponent(table));
  if (!parsedTable.success) {
    return NextResponse.json({ error: "invalid_table" }, { status: 400 });
  }

  const records = await getTableRecords(parsedTable.data, tenant.tenantKey);
  return NextResponse.json({ table: parsedTable.data, records });
}

export async function POST(request: Request, { params }: TableRouteProps) {
  const session = await getAppSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const tenant = await getRequestTenantContext(session);

  if (!requireAdminRole(tenant.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { table } = await params;
  const parsedTable = tableNameSchema.safeParse(decodeURIComponent(table));
  if (!parsedTable.success) {
    return NextResponse.json({ error: "invalid_table" }, { status: 400 });
  }

  const payload = await request.json().catch(() => null);
  const parsedRecord = recordSchema.safeParse(payload?.record);
  if (!parsedRecord.success) {
    return NextResponse.json({ error: "invalid_record", issues: parsedRecord.error.flatten() }, { status: 400 });
  }

  const created = await createTableRecord(parsedTable.data, parsedRecord.data, tenant.tenantKey);
  return NextResponse.json({ table: parsedTable.data, record: created }, { status: 201 });
}
