import { NextResponse } from "next/server";
import { getAttributesForEntity, getAttributeMediaLinks } from "@/lib/attributes/store";
import { getPersonById } from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { getTenantAccesses } from "@/lib/tenant/context";

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export async function GET(request: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  try {
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

    const tenantScopeKeys = Array.from(
      new Set([
        resolved.tenant.tenantKey,
        ...getTenantAccesses(resolved.session).map((entry) => normalize(entry.tenantKey)),
      ].filter(Boolean)),
    );

    let person = null as Awaited<ReturnType<typeof getPersonById>>;
    if (entityType === "person") {
      for (const scopeTenantKey of tenantScopeKeys) {
        person = await getPersonById(entityId, scopeTenantKey);
        if (person) {
          break;
        }
      }
      if (!person) {
        return NextResponse.json({ error: "not_found", message: "person not found" }, { status: 404 });
      }
    }

    const attributes = await getAttributesForEntity(resolved.tenant.tenantKey, entityType, entityId);
    const canonicalPrimaryPhotoFileId = entityType === "person" ? person?.photoFileId.trim() ?? "" : "";
    const withMedia = await Promise.all(
      attributes.map(async (item) => ({
        ...item,
        media: (await getAttributeMediaLinks(
          resolved.tenant.tenantKey,
          item.attributeId,
          entityType === "person" ? { familyGroupKeys: tenantScopeKeys } : undefined,
        )).map((media) => ({
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
  } catch (error) {
    console.error("[tenant-attributes] failed", error);
    return NextResponse.json(
      { error: "attribute_load_failed", message: "Failed to load attributes for this entity." },
      { status: 500 },
    );
  }
}
