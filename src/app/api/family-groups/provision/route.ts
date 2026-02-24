import { z } from "zod";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { ensureTenantPhotosFolder } from "@/lib/google/drive";
import { ensureTenantScaffold, upsertTenantAccess } from "@/lib/google/sheets";
import { getRequestFamilyGroupContext } from "@/lib/family-group/context";

const payloadSchema = z.object({
  userEmail: z.string().email(),
  familyGroupKey: z.string().trim().min(1).max(80).optional(),
  tenantKey: z.string().trim().min(1).max(80).optional(),
  familyGroupName: z.string().trim().min(1).max(120).optional(),
  tenantName: z.string().trim().min(1).max(120).optional(),
  role: z.enum(["ADMIN", "USER"]),
  personId: z.string().trim().min(1).max(120),
  isEnabled: z.boolean().default(true),
});

function normalizeFamilyGroupKey(value: string) {
  return value.trim().replace(/[^a-zA-Z]/g, "").toLowerCase();
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const context = await getRequestFamilyGroupContext(session);
  if (context.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const rawFamilyGroupKey = parsed.data.familyGroupKey ?? parsed.data.tenantKey;
  const familyGroupName = parsed.data.familyGroupName ?? parsed.data.tenantName;
  if (!rawFamilyGroupKey || !familyGroupName) {
    return NextResponse.json(
      { error: "invalid_payload", issues: "familyGroupKey and familyGroupName are required." },
      { status: 400 },
    );
  }
  const familyGroupKey = normalizeFamilyGroupKey(rawFamilyGroupKey);
  if (familyGroupKey.length < 4) {
    return NextResponse.json(
      {
        error: "invalid_family_group_key",
        issues: "Family group key must follow maiden+partner-last-name pattern, letters only (example: SnowEstes).",
      },
      { status: 400 },
    );
  }

  const result = await upsertTenantAccess({
    userEmail: parsed.data.userEmail,
    tenantKey: familyGroupKey,
    tenantName: familyGroupName,
    role: parsed.data.role,
    personId: parsed.data.personId,
    isEnabled: parsed.data.isEnabled,
  });

  const photosFolderId = await ensureTenantPhotosFolder(familyGroupKey, familyGroupName);
  await ensureTenantScaffold({
    tenantKey: familyGroupKey,
    tenantName: familyGroupName,
    photosFolderId,
  });

  return NextResponse.json({ ok: true, photosFolderId, familyGroupKey, familyGroupName, ...result });
}
