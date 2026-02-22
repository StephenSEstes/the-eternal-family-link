import { z } from "zod";
import { NextResponse } from "next/server";
import { deleteLocalUser, getTenantSecurityPolicy, patchLocalUser, renameLocalUser } from "@/lib/auth/local-users";
import { requireTenantAdmin } from "@/lib/tenant/guard";
import { validatePasswordComplexity } from "@/lib/security/password";

const patchSchema = z
  .object({
    action: z.enum(["set_enabled", "unlock", "reset_password", "update_role", "rename_username"]),
    isEnabled: z.boolean().optional(),
    password: z.string().optional(),
    role: z.enum(["ADMIN", "USER"]).optional(),
    nextUsername: z.string().trim().min(3).max(80).optional(),
  })
  .strict();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tenantKey: string; username: string }> },
) {
  const { tenantKey, username } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.action === "set_enabled") {
    if (parsed.data.isEnabled === undefined) {
      return NextResponse.json({ error: "invalid_payload", message: "isEnabled required" }, { status: 400 });
    }
    await patchLocalUser(resolved.tenant.tenantKey, username, { isEnabled: parsed.data.isEnabled });
    return NextResponse.json({ ok: true });
  }

  if (parsed.data.action === "unlock") {
    await patchLocalUser(resolved.tenant.tenantKey, username, {
      failedAttempts: 0,
      lockedUntil: "",
    });
    return NextResponse.json({ ok: true });
  }

  if (parsed.data.action === "update_role") {
    if (!parsed.data.role) {
      return NextResponse.json({ error: "invalid_payload", message: "role required" }, { status: 400 });
    }
    await patchLocalUser(resolved.tenant.tenantKey, username, { role: parsed.data.role });
    return NextResponse.json({ ok: true });
  }

  if (parsed.data.action === "rename_username") {
    if (!parsed.data.nextUsername) {
      return NextResponse.json({ error: "invalid_payload", message: "nextUsername required" }, { status: 400 });
    }
    try {
      await renameLocalUser(resolved.tenant.tenantKey, username, parsed.data.nextUsername);
      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json(
        { error: "rename_failed", message: error instanceof Error ? error.message : "Rename failed" },
        { status: 400 },
      );
    }
  }

  if (!parsed.data.password) {
    return NextResponse.json({ error: "invalid_payload", message: "password required" }, { status: 400 });
  }
  const policy = await getTenantSecurityPolicy(resolved.tenant.tenantKey);
  const complexityError = validatePasswordComplexity(parsed.data.password, policy);
  if (complexityError) {
    return NextResponse.json({ error: "password_policy_failed", message: complexityError }, { status: 400 });
  }
  await patchLocalUser(resolved.tenant.tenantKey, username, {
    password: parsed.data.password,
    failedAttempts: 0,
    lockedUntil: "",
    mustChangePassword: false,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ tenantKey: string; username: string }> },
) {
  const { tenantKey, username } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const deleted = await deleteLocalUser(resolved.tenant.tenantKey, username);
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
