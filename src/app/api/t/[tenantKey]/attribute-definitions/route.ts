import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantAccess, requireTenantAdmin } from "@/lib/family-group/guard";
import {
  defaultAttributeEventDefinitions,
  getAttributeEventDefinitions,
  upsertAttributeEventDefinitions,
} from "@/lib/attributes/event-definitions";

const payloadSchema = z.object({
  version: z.number().int().optional(),
  categories: z
    .array(
      z.object({
        categoryKey: z.string().trim().min(1).max(120),
        categoryLabel: z.string().trim().min(1).max(120),
        categoryColor: z.string().trim().max(16).optional(),
        description: z.string().trim().max(400).optional(),
        sortOrder: z.number().int().optional(),
        isEnabled: z.boolean().optional(),
      }),
    )
    .default([]),
  types: z
    .array(
      z.object({
        typeKey: z.string().trim().min(1).max(120),
        categoryKey: z.string().trim().min(1).max(120),
        typeLabel: z.string().trim().min(1).max(120),
        detailLabel: z.string().trim().max(240).optional(),
        dateMode: z.enum(["single", "range"]).optional(),
        askEndDate: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
        isEnabled: z.boolean().optional(),
      }),
    )
    .default([]),
});

export async function GET(_: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const definitions = await getAttributeEventDefinitions(resolved.tenant.tenantKey).catch(() => defaultAttributeEventDefinitions());
  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    definitions,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const saved = await upsertAttributeEventDefinitions(resolved.tenant.tenantKey, {
    version: 1,
    categories: parsed.data.categories.map((row, index) => ({
      categoryKey: row.categoryKey,
      categoryLabel: row.categoryLabel,
      categoryColor: row.categoryColor ?? "",
      description: row.description ?? "",
      sortOrder: row.sortOrder ?? (index + 1) * 10,
      isEnabled: row.isEnabled ?? true,
    })),
    types: parsed.data.types.map((row, index) => ({
      typeKey: row.typeKey,
      categoryKey: row.categoryKey,
      typeLabel: row.typeLabel,
      detailLabel: row.detailLabel ?? "",
      dateMode: row.dateMode ?? "single",
      askEndDate: row.askEndDate ?? row.dateMode === "range",
      sortOrder: row.sortOrder ?? (index + 1) * 10,
      isEnabled: row.isEnabled ?? true,
    })),
  });

  return NextResponse.json({
    ok: true,
    tenantKey: resolved.tenant.tenantKey,
    definitions: saved,
  });
}
