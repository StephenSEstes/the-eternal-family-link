import { NextResponse } from "next/server";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { getPeople } from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { buildPhotoIntelligenceSuggestion, canRunPhotoIntelligence, readPhotoIntelligenceSuggestion } from "@/lib/media/photo-intelligence";
import {
  getOciMediaAssetByFileId,
  getOciMediaLinksForFile,
  updateOciMediaMetadataForFile,
} from "@/lib/oci/tables";

type RouteProps = {
  params: Promise<{ tenantKey: string; fileId: string }>;
};

function norm(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function parseMetadata(raw: string): Record<string, unknown> {
  const value = raw.trim();
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function POST(request: Request, { params }: RouteProps) {
  const { tenantKey, fileId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const normalizedFileId = fileId.trim();
  if (!normalizedFileId) {
    return NextResponse.json({ error: "invalid_file_id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const forceValue = (body as { force?: string | boolean } | null)?.force;
  const force = forceValue === true || norm(String(forceValue ?? "")) === "true";

  const [asset, links, people] = await Promise.all([
    getOciMediaAssetByFileId(normalizedFileId),
    getOciMediaLinksForFile({
      familyGroupKey: resolved.tenant.tenantKey,
      fileId: normalizedFileId,
    }).catch(() => []),
    getPeople(resolved.tenant.tenantKey),
  ]);

  if (!asset && links.length === 0) {
    return NextResponse.json({ error: "media_not_found" }, { status: 404 });
  }

  const baseMetadata = (asset?.mediaMetadata || links[0]?.mediaMetadata || "").trim();
  const parsedMetadata = parseMetadata(baseMetadata);
  if (!canRunPhotoIntelligence(normalizedFileId, baseMetadata)) {
    return NextResponse.json({
      ok: true,
      fileId: normalizedFileId,
      skipped: true,
      reason: "only_image_supported",
    });
  }

  const existing = readPhotoIntelligenceSuggestion(baseMetadata);
  if (existing && !force) {
    return NextResponse.json({
      ok: true,
      fileId: normalizedFileId,
      suggestion: existing,
      cached: true,
    });
  }

  const peopleById = new Map(people.map((item) => [item.personId, item.displayName]));
  const linkedPeople = links
    .filter((item) => norm(item.entityType) === "person")
    .map((item) => peopleById.get(item.entityId) || item.entityId)
    .filter((value, index, array) => Boolean(value) && array.indexOf(value) === index);

  const generated = buildPhotoIntelligenceSuggestion({
    fileId: normalizedFileId,
    fileName: String(parsedMetadata.fileName ?? links[0]?.fileName ?? normalizedFileId).trim() || normalizedFileId,
    createdAt: String(parsedMetadata.createdAt ?? "").trim(),
    linkedPeople,
    existingMetadata: baseMetadata,
  });

  await updateOciMediaMetadataForFile({
    familyGroupKey: resolved.tenant.tenantKey,
    fileId: normalizedFileId,
    mediaMetadata: generated.mediaMetadata,
  });

  await appendSessionAuditLog(resolved.session, {
    action: "UPDATE",
    entityType: "MEDIA_INTELLIGENCE",
    entityId: normalizedFileId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `Generated photo intelligence suggestions for file=${normalizedFileId}.`,
  });

  return NextResponse.json({
    ok: true,
    fileId: normalizedFileId,
    suggestion: generated.suggestion,
    cached: false,
  });
}
