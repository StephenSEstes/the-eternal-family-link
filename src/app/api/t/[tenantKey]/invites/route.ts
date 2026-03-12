import { z } from "zod";
import { NextResponse } from "next/server";
import { appendAuditLog, getPeople } from "@/lib/data/runtime";
import { requireTenantAdmin } from "@/lib/family-group/guard";
import { createInvite } from "@/lib/invite/store";
import type { InviteEmailDeliveryResult } from "@/lib/invite/types";
import { sendPlainTextEmail } from "@/lib/google/gmail";

const createInviteSchema = z.object({
  personId: z.string().trim().min(1),
  inviteEmail: z.string().trim().email(),
  authMode: z.enum(["google", "local", "either"]),
  role: z.enum(["ADMIN", "USER"]).optional().default("USER"),
  localUsername: z.string().trim().max(80).optional().default(""),
  expiresInDays: z.coerce.number().int().min(1).max(60).optional().default(14),
  sendEmail: z.coerce.boolean().optional().default(false),
});

export async function POST(request: Request, { params }: { params: Promise<{ tenantKey: string }> }) {
  const { tenantKey } = await params;
  const resolved = await requireTenantAdmin(tenantKey);
  if ("error" in resolved) {
    return resolved.error;
  }

  const parsed = createInviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const familyPeople = await getPeople(resolved.tenant.tenantKey);
  const person = familyPeople.find((item) => item.personId === parsed.data.personId);
  if (!person) {
    return NextResponse.json({ error: "not_found", message: "Person is not in this family group." }, { status: 404 });
  }

  try {
    const created = await createInvite({
      sourceTenantKey: resolved.tenant.tenantKey,
      personId: parsed.data.personId,
      inviteEmail: parsed.data.inviteEmail,
      authMode: parsed.data.authMode,
      role: parsed.data.role,
      localUsername: parsed.data.localUsername,
      expiresInDays: parsed.data.expiresInDays,
      createdByEmail: resolved.session.user?.email ?? "",
      createdByPersonId: resolved.session.user?.person_id ?? "",
      appBaseUrl: new URL(request.url).origin,
    });
    const emailDelivery: InviteEmailDeliveryResult = {
      attempted: parsed.data.sendEmail,
      sent: false,
      errorMessage: "",
    };

    await appendAuditLog({
      actorEmail: resolved.session.user?.email ?? "",
      actorPersonId: resolved.session.user?.person_id ?? "",
      action: "CREATE",
      entityType: "INVITE",
      entityId: created.invite.inviteId,
      familyGroupKey: resolved.tenant.tenantKey,
      status: "SUCCESS",
      details: `person_id=${parsed.data.personId}, email=${parsed.data.inviteEmail.toLowerCase()}, auth_mode=${parsed.data.authMode}, role=${parsed.data.role}, send_email=${parsed.data.sendEmail ? "true" : "false"}`,
    }).catch(() => undefined);

    if (parsed.data.sendEmail) {
      try {
        await sendPlainTextEmail({
          to: created.invite.inviteEmail,
          subject: `Invitation to join The Eternal Family Link for ${created.invite.familyGroupName}`,
          text: created.inviteMessage,
        });
        emailDelivery.sent = true;
        await appendAuditLog({
          actorEmail: resolved.session.user?.email ?? "",
          actorPersonId: resolved.session.user?.person_id ?? "",
          action: "SEND_EMAIL",
          entityType: "INVITE",
          entityId: created.invite.inviteId,
          familyGroupKey: resolved.tenant.tenantKey,
          status: "SUCCESS",
          details: `invite_id=${created.invite.inviteId}, email=${created.invite.inviteEmail}, subject=Invitation to join The Eternal Family Link for ${created.invite.familyGroupName}`,
        }).catch(() => undefined);
      } catch (error) {
        emailDelivery.errorMessage = error instanceof Error ? error.message : "Invite email failed.";
        await appendAuditLog({
          actorEmail: resolved.session.user?.email ?? "",
          actorPersonId: resolved.session.user?.person_id ?? "",
          action: "SEND_EMAIL",
          entityType: "INVITE",
          entityId: created.invite.inviteId,
          familyGroupKey: resolved.tenant.tenantKey,
          status: "FAILURE",
          details: `invite_id=${created.invite.inviteId}, email=${created.invite.inviteEmail}, error=${emailDelivery.errorMessage}`,
        }).catch(() => undefined);
      }
    }

    return NextResponse.json({ ok: true, ...created, emailDelivery }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "invite_create_failed", message: error instanceof Error ? error.message : "Invite creation failed." },
      { status: 400 },
    );
  }
}
