import { NextResponse } from "next/server";
import { getAttributesForEntity, getAttributeMediaLinks } from "@/lib/attributes/store";
import { getPersonById } from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export async function GET(request: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const searchParams = new URL(request.url).searchParams;
  const entityType = normalize(searchParams.get("entity_type") ?? "") as "person" | "household";
  const entityId = String(searchParams.get("entity_id") ?? "").trim();
  if (!entityType || !entityId) {
    return NextResponse.json(
      { error: "invalid_payload", message: "entity_type and entity_id are required" },
      { status: 400 },
    );
  }

  let person = null as Awaited<ReturnType<typeof getPersonById>>;
  if (entityType === "person") {
    person = await getPersonById(entityId, resolved.tenant.tenantKey);
    if (!person) {
      return NextResponse.json({ error: "not_found", message: "person not found" }, { status: 404 });
    }
  }

  const attributes = await getAttributesForEntity(resolved.tenant.tenantKey, entityType, entityId);
  const canonicalPrimaryPhotoFileId = entityType === "person" ? person?.photoFileId.trim() ?? "" : "";
  const withMedia = await Promise.all(
    attributes.map(async (item) => ({
      ...item,
      media: (await getAttributeMediaLinks(resolved.tenant.tenantKey, item.attributeId)).map((media) => ({
        ...media,
        isPrimary: Boolean(canonicalPrimaryPhotoFileId) && media.fileId.trim() === canonicalPrimaryPhotoFileId,
      })),
    })),
  );

  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    entityType,
    entityId,
    attributes: withMedia,
  });
}
