import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { getAttributesForEntity, getAttributeMediaLinks } from "@/lib/attributes/store";
import { getPersonById } from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { getOciDirectObjectUrlFactory } from "@/lib/oci/object-storage";
import { getOciMediaLinksForEntityAllFamilies } from "@/lib/oci/tables";

function normalize(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export async function GET(request: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  try {
    const { tenantKey } = await params;

    const searchParams = new URL(request.url).searchParams;
    const entityType = normalize(searchParams.get("entity_type") ?? "") as "person" | "household";
    const entityId = String(searchParams.get("entity_id") ?? "").trim();
    if (!entityType || !entityId) {
      return NextResponse.json(
        { error: "invalid_payload", message: "entity_type and entity_id are required" },
        { status: 400 },
      );
    }

    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let effectiveTenantKey = normalize(tenantKey);
    if (!effectiveTenantKey) {
      effectiveTenantKey = "default";
    }
    if (entityType !== "person") {
      const resolved = await requireTenantAccess(tenantKey);
      if ("error" in resolved) {
        return resolved.error;
      }
      effectiveTenantKey = resolved.tenant.tenantKey;
    }

    let person = null as Awaited<ReturnType<typeof getPersonById>>;
    if (entityType === "person") {
      person = await getPersonById(entityId);
      if (!person) {
        return NextResponse.json({ error: "not_found", message: "person not found" }, { status: 404 });
      }
    }

    const attributes = await getAttributesForEntity(effectiveTenantKey, entityType, entityId);
    const canonicalPrimaryPhotoFileId = entityType === "person" ? person?.photoFileId.trim() ?? "" : "";
    const directObjectUrlFactory = await getOciDirectObjectUrlFactory().catch(() => null);
    const withMedia: Array<(typeof attributes)[number] & { media: Awaited<ReturnType<typeof getAttributeMediaLinks>> }> = [];
    for (const item of attributes) {
      const mediaLinks = await getAttributeMediaLinks(
        effectiveTenantKey,
        item.attributeId,
        entityType === "person" ? { allFamilies: true } : undefined,
      );
      withMedia.push({
        ...item,
        media: mediaLinks.map((media) => ({
          ...media,
          previewUrl:
            directObjectUrlFactory && media.thumbnailObjectKey
              ? directObjectUrlFactory(media.thumbnailObjectKey)
              : "",
          originalUrl:
            directObjectUrlFactory && media.originalObjectKey
              ? directObjectUrlFactory(media.originalObjectKey)
              : "",
          isPrimary: Boolean(canonicalPrimaryPhotoFileId) && media.fileId.trim() === canonicalPrimaryPhotoFileId,
        })),
      });
    }
    const directMediaLinks: Awaited<ReturnType<typeof getAttributeMediaLinks>> = [];
    if (entityType === "person") {
      const fileIdsInAttributeLinks = new Set(
        withMedia.flatMap((item) => item.media.map((media) => media.fileId.trim()).filter(Boolean)),
      );
      const directPersonLinks = await getOciMediaLinksForEntityAllFamilies({
        entityType: "person",
        entityId,
      }).catch(() => []);
      const seenDirectFileIds = new Set<string>();
      for (const media of directPersonLinks) {
        const fileId = media.fileId.trim();
        if (!fileId || fileIdsInAttributeLinks.has(fileId) || seenDirectFileIds.has(fileId)) {
          continue;
        }
        seenDirectFileIds.add(fileId);
        directMediaLinks.push({
          ...media,
          previewUrl:
            directObjectUrlFactory && media.thumbnailObjectKey
              ? directObjectUrlFactory(media.thumbnailObjectKey)
              : "",
          originalUrl:
            directObjectUrlFactory && media.originalObjectKey
              ? directObjectUrlFactory(media.originalObjectKey)
              : "",
          isPrimary: Boolean(canonicalPrimaryPhotoFileId) && media.fileId.trim() === canonicalPrimaryPhotoFileId,
        });
      }
    }

    return NextResponse.json({
      tenantKey: effectiveTenantKey,
      entityType,
      entityId,
      attributes: withMedia,
      directMediaLinks,
    });
  } catch (error) {
    console.error("[tenant-attributes] failed", error);
    return NextResponse.json(
      { error: "attribute_load_failed", message: "Failed to load attributes for this entity." },
      { status: 500 },
    );
  }
}
