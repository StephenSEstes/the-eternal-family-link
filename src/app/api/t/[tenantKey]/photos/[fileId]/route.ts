import { NextResponse } from "next/server";
import { z } from "zod";
import { appendSessionAuditLog } from "@/lib/audit/log";
import { ATTRIBUTES_TABLE } from "@/lib/attributes/store";
import { getPeople, updateTableRecordById } from "@/lib/data/runtime";
import { requireTenantAccess } from "@/lib/family-group/guard";
import { getMediaProcessingStatusForFile } from "@/lib/media/processing-status.server";
import type { MediaProcessingStatus } from "@/lib/media/processing-status";
import { resolvePersonDisplayName } from "@/lib/person/display-name";
import {
  getOciMediaAssetByFileId,
  getOciHouseholdsForTenant,
  getOciMediaLinksForFile,
  getOciPersonMediaAttributeRowsForFile,
  updateOciMediaLinksForFile,
} from "@/lib/oci/tables";

type RouteProps = {
  params: Promise<{ tenantKey: string; fileId: string }>;
};

type MediaDetailItem = {
  fileId: string;
  name: string;
  description: string;
  date: string;
  mediaMetadata?: string;
  processingStatus?: MediaProcessingStatus | null;
  people: Array<{ personId: string; displayName: string }>;
  households: Array<{ householdId: string; label: string }>;
};

const metadataSchema = z.object({
  name: z.string().trim().max(256).optional().default(""),
  description: z.string().trim().max(2000).optional().default(""),
  date: z.string().trim().max(32).optional().default(""),
});

function readCell(row: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

async function buildMediaDetail(tenantKey: string, fileId: string) {
  const [people, householdRows, mediaLinks, personMediaAttributes, mediaAsset] = await Promise.all([
    getPeople(tenantKey),
    getOciHouseholdsForTenant(tenantKey).catch(() => []),
    getOciMediaLinksForFile({ familyGroupKey: tenantKey, fileId }).catch(() => []),
    getOciPersonMediaAttributeRowsForFile({ familyGroupKey: tenantKey, fileId }).catch(() => []),
    getOciMediaAssetByFileId(fileId).catch(() => null),
  ]);

  const peopleById = new Map(
    people
      .map((person) => [
        person.personId.trim(),
        resolvePersonDisplayName({
          personId: person.personId,
          displayName: person.displayName,
          firstName: person.firstName,
          middleName: person.middleName,
          lastName: person.lastName,
        }),
      ] as const)
      .filter(([personId]) => Boolean(personId)),
  );
  const householdsById = new Map(
    householdRows.map((row) => {
      const householdId = readCell(row.data, "household_id", "id");
      const label = readCell(row.data, "label", "family_label", "family_name");
      return [householdId, label || householdId] as const;
    }),
  );

  const detail: MediaDetailItem = {
    fileId,
    name: "",
    description: "",
    date: "",
    mediaMetadata: "",
    people: [],
    households: [],
  };

  for (const link of mediaLinks) {
    if (!detail.name) detail.name = link.label.trim() || link.fileName.trim();
    if (!detail.description) detail.description = link.description.trim();
    if (!detail.date) detail.date = link.photoDate.trim();
    if (!detail.mediaMetadata) detail.mediaMetadata = link.mediaMetadata.trim();

    if (link.entityType.trim().toLowerCase() === "person") {
      const personId = link.entityId.trim();
      if (!detail.people.some((entry) => entry.personId === personId)) {
        detail.people.push({
          personId,
          displayName: peopleById.get(personId) || personId,
        });
      }
      continue;
    }

    if (link.entityType.trim().toLowerCase() === "household") {
      if (!detail.households.some((entry) => entry.householdId === link.entityId)) {
        detail.households.push({
          householdId: link.entityId,
          label: householdsById.get(link.entityId) || link.entityId,
        });
      }
    }
  }

  for (const row of personMediaAttributes) {
    if (!detail.description) detail.description = row.attributeNotes.trim();
    if (!detail.date) detail.date = row.attributeDate.trim();
    const personId = row.entityId.trim();
    if (!detail.people.some((entry) => entry.personId === personId)) {
      detail.people.push({
        personId,
        displayName: peopleById.get(personId) || personId,
      });
    }
  }

  for (const person of people) {
    const personId = person.personId.trim();
    if (person.photoFileId.trim() !== fileId || !personId) continue;
    if (!detail.name) detail.name = "Headshot";
    if (!detail.people.some((entry) => entry.personId === personId)) {
      detail.people.push({
        personId,
        displayName: peopleById.get(personId) || personId,
      });
    }
  }

  if (!detail.mediaMetadata && mediaAsset?.mediaMetadata) {
    detail.mediaMetadata = mediaAsset.mediaMetadata.trim();
  }

  detail.processingStatus = await getMediaProcessingStatusForFile({
    familyGroupKey: tenantKey,
    fileId,
    mediaMetadata: detail.mediaMetadata,
    asset: mediaAsset,
  }).catch(() => null);

  detail.people.sort((a, b) => a.displayName.localeCompare(b.displayName));
  detail.households.sort((a, b) => a.label.localeCompare(b.label));

  return {
    item: detail,
    editable: mediaLinks.length > 0 || personMediaAttributes.length > 0,
    canEditName: mediaLinks.length > 0,
  };
}

export async function GET(_: Request, { params }: RouteProps) {
  const { tenantKey, fileId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const detail = await buildMediaDetail(resolved.tenant.tenantKey, fileId.trim());
  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    ...detail,
  });
}

export async function PATCH(request: Request, { params }: RouteProps) {
  const { tenantKey, fileId } = await params;
  const resolved = await requireTenantAccess(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const normalizedFileId = fileId.trim();
  if (!normalizedFileId) {
    return NextResponse.json({ error: "invalid_file_id" }, { status: 400 });
  }

  const parsed = metadataSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const before = await buildMediaDetail(resolved.tenant.tenantKey, normalizedFileId);
  const personMediaAttributes = await getOciPersonMediaAttributeRowsForFile({
    familyGroupKey: resolved.tenant.tenantKey,
    fileId: normalizedFileId,
  });
  const hasWritableLinks = before.canEditName;
  const hasWritableAttributes = personMediaAttributes.length > 0;

  if (!hasWritableLinks && !hasWritableAttributes) {
    return NextResponse.json(
      {
        error: "media_not_editable",
        message: "This file has no app-linked media records yet. Link it to a person or household before editing metadata.",
      },
      { status: 400 },
    );
  }

  const nextName = parsed.data.name.trim();
  const nextDescription = parsed.data.description.trim();
  const nextDate = parsed.data.date.trim();

  if (!hasWritableLinks && nextName !== before.item.name.trim()) {
    return NextResponse.json(
      {
        error: "name_not_editable",
        message: "Name can only be edited when this file has a stored media link in the app.",
      },
      { status: 400 },
    );
  }

  if (hasWritableLinks) {
    await updateOciMediaLinksForFile({
      familyGroupKey: resolved.tenant.tenantKey,
      fileId: normalizedFileId,
      label: nextName,
      description: nextDescription,
      photoDate: nextDate,
    });
  }

  if (hasWritableAttributes) {
    const nowIso = new Date().toISOString();
    for (const row of personMediaAttributes) {
      await updateTableRecordById(
        ATTRIBUTES_TABLE,
        row.attributeId,
        {
          attribute_notes: nextDescription,
          attribute_date: nextDate,
          updated_at: nowIso,
        },
        "attribute_id",
        resolved.tenant.tenantKey,
      );
    }
  }

  await appendSessionAuditLog(resolved.session, {
    action: "UPDATE",
    entityType: "MEDIA",
    entityId: normalizedFileId,
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `Updated media metadata for file=${normalizedFileId}.`,
  });

  const after = await buildMediaDetail(resolved.tenant.tenantKey, normalizedFileId);
  return NextResponse.json({
    tenantKey: resolved.tenant.tenantKey,
    ...after,
  });
}
