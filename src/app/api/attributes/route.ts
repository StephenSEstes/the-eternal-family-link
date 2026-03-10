import { NextResponse } from "next/server";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { getAppSession } from "@/lib/auth/session";
import { getRequestTenantContext } from "@/lib/family-group/context";
import { getPersonById } from "@/lib/data/runtime";
import { createAttribute, getAttributeMediaLinks, getAttributesForEntity } from "@/lib/attributes/store";
import { attributeCreateSchema } from "@/lib/validation/attributes";

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export async function GET(request: Request) {
  const session = await getAppSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const tenant = await getRequestTenantContext(session);
  const params = new URL(request.url).searchParams;
  const entityType = normalize(params.get("entity_type") ?? "") as "person" | "household";
  const entityId = String(params.get("entity_id") ?? "").trim();
  if (!entityType || !entityId) {
    return NextResponse.json({ error: "invalid_payload", message: "entity_type and entity_id are required" }, { status: 400 });
  }

  const attributes = await getAttributesForEntity(tenant.tenantKey, entityType, entityId);
  const withMedia = await Promise.all(
    attributes.map(async (item) => ({
      ...item,
      media: await getAttributeMediaLinks(tenant.tenantKey, item.attributeId),
    })),
  );
  return NextResponse.json({
    tenantKey: tenant.tenantKey,
    entityType,
    entityId,
    attributes: withMedia,
  });
}

export async function POST(request: Request) {
  const session = await getAppSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const tenant = await getRequestTenantContext(session);
  const parsed = attributeCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.entityType === "person") {
    const person = await getPersonById(parsed.data.entityId, tenant.tenantKey);
    if (!person) {
      return NextResponse.json({ error: "not_found", message: "person not found" }, { status: 404 });
    }
  }

  const created = await createAttribute(tenant.tenantKey, {
    entityType: parsed.data.entityType,
    entityId: parsed.data.entityId,
    category: parsed.data.category,
    attributeType: parsed.data.attributeType || parsed.data.typeKey,
    attributeTypeCategory: parsed.data.attributeTypeCategory ?? "",
    attributeDate: parsed.data.attributeDate || parsed.data.dateStart,
    dateIsEstimated: Boolean(parsed.data.dateIsEstimated),
    estimatedTo: parsed.data.estimatedTo ?? "",
    attributeDetail: parsed.data.attributeDetail || parsed.data.valueText,
    attributeNotes: parsed.data.attributeNotes || parsed.data.notes,
    endDate: parsed.data.endDate || parsed.data.dateEnd,
    typeKey: parsed.data.typeKey,
    label: parsed.data.label,
    valueText: parsed.data.valueText,
    dateStart: parsed.data.dateStart,
    dateEnd: parsed.data.dateEnd,
    location: parsed.data.location,
    notes: parsed.data.notes,
  });

  await appendSessionAuditLog(session, {
    action: "CREATE",
    entityType: "ATTRIBUTE",
    entityId: created.attributeId,
    familyGroupKey: tenant.tenantKey,
    status: "SUCCESS",
    details: `Created ${parsed.data.entityType} attribute type=${created.attributeType || parsed.data.attributeType || parsed.data.typeKey} for entity=${parsed.data.entityId}.`,
  });

  return NextResponse.json({ tenantKey: tenant.tenantKey, attribute: created }, { status: 201 });
}
