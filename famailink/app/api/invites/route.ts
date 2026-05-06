import { NextRequest, NextResponse } from "next/server";
import { isGmailSendingConfigured, sendPlainTextEmail } from "@/lib/auth/email";
import { requireRouteSession } from "@/lib/auth/guards";
import { canAdministerInvites, createInvite } from "@/lib/invite/store";
import type { AppRole, InviteEmailDeliveryResult } from "@/lib/invite/types";

function normalize(value?: unknown) {
  return String(value ?? "").trim();
}

function normalizeRole(value?: unknown): AppRole {
  return normalize(value).toUpperCase() === "ADMIN" ? "ADMIN" : "USER";
}

function parseBoolean(value?: unknown) {
  const normalized = normalize(value).toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "y";
}

function parseExpiryDays(value?: unknown) {
  const parsed = Number.parseInt(normalize(value), 10);
  if (!Number.isFinite(parsed)) return 14;
  return Math.min(60, Math.max(1, parsed));
}

export async function POST(request: NextRequest) {
  const { session, unauthorized } = requireRouteSession(request);
  if (!session || unauthorized) {
    return unauthorized;
  }

  const inviteAdmin = await canAdministerInvites(session.personId);
  if (!inviteAdmin) {
    return NextResponse.json({ error: "forbidden", message: "Only admins can create invites." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json", message: "Invite payload must be valid JSON." }, { status: 400 });
  }

  try {
    const created = await createInvite({
      adminPersonId: session.personId,
      personId: normalize(body.personId),
      inviteEmail: normalize(body.inviteEmail),
      role: normalizeRole(body.role),
      localUsername: normalize(body.localUsername),
      expiresInDays: parseExpiryDays(body.expiresInDays),
      createdByEmail: session.userEmail,
      createdByPersonId: session.personId,
      appBaseUrl: new URL(request.url).origin,
    });

    const emailDelivery: InviteEmailDeliveryResult = {
      attempted: parseBoolean(body.sendEmail),
      sent: false,
      errorMessage: "",
    };

    if (emailDelivery.attempted) {
      if (!isGmailSendingConfigured()) {
        emailDelivery.errorMessage = "Outbound Gmail is not configured.";
      } else {
        try {
          await sendPlainTextEmail({
            to: created.invite.inviteEmail,
            subject: `Invitation to join Famailink for ${created.invite.familyGroupName}`,
            text: created.inviteMessage,
          });
          emailDelivery.sent = true;
        } catch (error) {
          emailDelivery.errorMessage = error instanceof Error ? error.message : "Invite email failed.";
        }
      }
    }

    return NextResponse.json({ ok: true, ...created, emailDelivery }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "invite_create_failed",
        message: error instanceof Error ? error.message : "Invite creation failed.",
      },
      { status: 400 },
    );
  }
}
