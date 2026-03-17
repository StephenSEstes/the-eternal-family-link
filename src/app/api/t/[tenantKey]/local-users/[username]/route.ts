import { z } from "zod";
import { NextResponse } from "next/server";
import { appendSessionAuditLog } from "@/lib/audit/log";
import {
  deleteLocalUser,
  getLocalUserByUsername,
  getTenantSecurityPolicy,
  patchLocalUser,
  renameLocalUser,
  updateLocalUser,
} from "@/lib/auth/local-users";
import { requireTenantAdmin } from "@/lib/family-group/guard";
import { validatePasswordComplexity } from "@/lib/security/password";

const patchSchema = z
  .object({
    action: z.enum(["set_enabled", "unlock", "reset_password", "update_role", "rename_username", "update_user"]),
    isEnabled: z.boolean().optional(),
    password: z.string().optional(),
    role: z.enum(["ADMIN", "USER"]).optional(),
    nextUsername: z.string().trim().min(3).max(80).optional(),
  })
  .strict();

function decodeRouteUsername(username: string) {
  try {
    return decodeURIComponent(username);
  } catch {
    return username;
  }
}

function localUserNotFoundResponse() {
  return NextResponse.json({ error: "not_found", message: "Local user not found." }, { status: 404 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tenantKey: string; username: string }> },
) {
  const { tenantKey, username } = await params;
  const decodedUsername = decodeRouteUsername(username);
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const existingUser = await getLocalUserByUsername(resolved.tenant.tenantKey, decodedUsername);

  if (parsed.data.action === "set_enabled") {
    if (parsed.data.isEnabled === undefined) {
      return NextResponse.json({ error: "invalid_payload", message: "isEnabled required" }, { status: 400 });
    }
    if (!existingUser) {
      return localUserNotFoundResponse();
    }
    const updated = await patchLocalUser(resolved.tenant.tenantKey, decodedUsername, { isEnabled: parsed.data.isEnabled });
    if (!updated) {
      return localUserNotFoundResponse();
    }
    if (existingUser) {
      await appendSessionAuditLog(resolved.session, {
        action: "UPDATE",
        entityType: "LOCAL_USER",
        entityId: existingUser.personId,
        familyGroupKey: resolved.tenant.tenantKey,
        status: "SUCCESS",
        details: `Set local access enabled=${String(parsed.data.isEnabled)} for username=${existingUser.username}.`,
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (parsed.data.action === "unlock") {
    if (!existingUser) {
      return localUserNotFoundResponse();
    }
    const updated = await patchLocalUser(resolved.tenant.tenantKey, decodedUsername, {
      failedAttempts: 0,
      lockedUntil: "",
    });
    if (!updated) {
      return localUserNotFoundResponse();
    }
    if (existingUser) {
      await appendSessionAuditLog(resolved.session, {
        action: "UPDATE",
        entityType: "LOCAL_USER",
        entityId: existingUser.personId,
        familyGroupKey: resolved.tenant.tenantKey,
        status: "SUCCESS",
        details: `Unlocked local access for username=${existingUser.username}.`,
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (parsed.data.action === "update_role") {
    if (!parsed.data.role) {
      return NextResponse.json({ error: "invalid_payload", message: "role required" }, { status: 400 });
    }
    if (!existingUser) {
      return localUserNotFoundResponse();
    }
    const updated = await patchLocalUser(resolved.tenant.tenantKey, decodedUsername, { role: parsed.data.role });
    if (!updated) {
      return localUserNotFoundResponse();
    }
    if (existingUser) {
      await appendSessionAuditLog(resolved.session, {
        action: "UPDATE",
        entityType: "LOCAL_USER",
        entityId: existingUser.personId,
        familyGroupKey: resolved.tenant.tenantKey,
        status: "SUCCESS",
        details: `Updated local access role=${parsed.data.role} for username=${existingUser.username}.`,
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (parsed.data.action === "rename_username") {
    if (!parsed.data.nextUsername) {
      return NextResponse.json({ error: "invalid_payload", message: "nextUsername required" }, { status: 400 });
    }
    try {
      await renameLocalUser(resolved.tenant.tenantKey, decodedUsername, parsed.data.nextUsername);
      if (existingUser) {
        await appendSessionAuditLog(resolved.session, {
          action: "UPDATE",
          entityType: "LOCAL_USER",
          entityId: existingUser.personId,
          familyGroupKey: resolved.tenant.tenantKey,
          status: "SUCCESS",
          details: `Renamed local username from ${decodedUsername.trim().toLowerCase()} to ${parsed.data.nextUsername.trim().toLowerCase()}.`,
        });
      }
      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json(
        { error: "rename_failed", message: error instanceof Error ? error.message : "Rename failed" },
        { status: 400 },
      );
    }
  }

  if (parsed.data.action === "update_user") {
    if (!existingUser) {
      return localUserNotFoundResponse();
    }
    if (parsed.data.password) {
      const policy = await getTenantSecurityPolicy(resolved.tenant.tenantKey);
      const complexityError = validatePasswordComplexity(parsed.data.password, policy);
      if (complexityError) {
        return NextResponse.json({ error: "password_policy_failed", message: complexityError }, { status: 400 });
      }
    }
    try {
      const updatedUser = await updateLocalUser(resolved.tenant.tenantKey, decodedUsername, {
        nextUsername: parsed.data.nextUsername,
        password: parsed.data.password,
        role: parsed.data.role,
        isEnabled: parsed.data.isEnabled,
        failedAttempts: parsed.data.password !== undefined ? 0 : undefined,
        lockedUntil: parsed.data.password !== undefined ? "" : undefined,
        mustChangePassword: parsed.data.password !== undefined ? false : undefined,
      });
      const detailParts: string[] = [];
      if (updatedUser.previousUsername !== updatedUser.username) {
        detailParts.push(`username ${updatedUser.previousUsername} -> ${updatedUser.username}`);
      }
      if (parsed.data.role) {
        detailParts.push(`role=${parsed.data.role}`);
      }
      if (parsed.data.isEnabled !== undefined) {
        detailParts.push(`enabled=${String(parsed.data.isEnabled)}`);
      }
      if (parsed.data.password !== undefined) {
        detailParts.push("password reset");
      }
      await appendSessionAuditLog(resolved.session, {
        action: "UPDATE",
        entityType: "LOCAL_USER",
        entityId: updatedUser.personId,
        familyGroupKey: resolved.tenant.tenantKey,
        status: "SUCCESS",
        details:
          detailParts.length > 0
            ? `Updated local user (${detailParts.join(", ")}).`
            : `Updated local user username=${updatedUser.username}.`,
      });
      return NextResponse.json({ ok: true, username: updatedUser.username });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Update failed";
      const status = message === "Local user not found." ? 404 : 400;
      return NextResponse.json({ error: "update_failed", message }, { status });
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
  if (!existingUser) {
    return localUserNotFoundResponse();
  }
  const updated = await patchLocalUser(resolved.tenant.tenantKey, decodedUsername, {
    password: parsed.data.password,
    failedAttempts: 0,
    lockedUntil: "",
    mustChangePassword: false,
  });
  if (!updated) {
    return localUserNotFoundResponse();
  }
  if (existingUser) {
    await appendSessionAuditLog(resolved.session, {
      action: "UPDATE",
      entityType: "LOCAL_USER",
      entityId: existingUser.personId,
      familyGroupKey: resolved.tenant.tenantKey,
      status: "SUCCESS",
      details: `Reset local password for username=${existingUser.username}.`,
    });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ tenantKey: string; username: string }> },
) {
  const { tenantKey, username } = await params;
  const decodedUsername = decodeRouteUsername(username);
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const existingUser = await getLocalUserByUsername(resolved.tenant.tenantKey, decodedUsername);
  const deleted = await deleteLocalUser(resolved.tenant.tenantKey, decodedUsername);
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await appendSessionAuditLog(resolved.session, {
    action: "DELETE",
    entityType: "LOCAL_USER",
    entityId: existingUser?.personId ?? decodedUsername.trim().toLowerCase(),
    familyGroupKey: resolved.tenant.tenantKey,
    status: "SUCCESS",
    details: `Deleted local access for username=${decodedUsername.trim().toLowerCase()}.`,
  });

  return NextResponse.json({ ok: true });
}
