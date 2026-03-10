import type { AppRole } from "@/lib/google/types";

export type InviteAuthMode = "google" | "local" | "either";
export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export type InviteFamilyGroupGrant = {
  tenantKey: string;
  tenantName: string;
  role: AppRole;
};

export type InvitePresentation = {
  inviteId: string;
  personId: string;
  personDisplayName: string;
  inviteEmail: string;
  authMode: InviteAuthMode;
  role: AppRole;
  localUsername: string;
  familyGroupKey: string;
  familyGroupName: string;
  familyGroups: InviteFamilyGroupGrant[];
  status: InviteStatus;
  expiresAt: string;
  acceptedAt: string;
  acceptedByEmail: string;
  acceptedAuthMode: "" | "google" | "local";
  createdAt: string;
  createdByEmail: string;
  openAppPath: string;
  canUseGoogle: boolean;
  canUseLocal: boolean;
  sessionEmailMatches: boolean;
};

export type CreatedInvitePayload = {
  invite: InvitePresentation;
  inviteUrl: string;
  inviteMessage: string;
};
