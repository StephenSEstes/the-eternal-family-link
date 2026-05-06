export type AppRole = "ADMIN" | "USER";
export type InviteAuthMode = "google" | "local" | "either";
export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

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
  status: InviteStatus;
  expiresAt: string;
  acceptedAt: string;
  acceptedByEmail: string;
  acceptedAuthMode: "" | "google" | "local";
  createdAt: string;
  createdByEmail: string;
  openAppPath: string;
};

export type InviteEmailDeliveryResult = {
  attempted: boolean;
  sent: boolean;
  errorMessage: string;
};

export type CreatedInvitePayload = {
  invite: InvitePresentation;
  inviteUrl: string;
  inviteMessage: string;
};

export type InviteDirectoryPerson = {
  personId: string;
  displayName: string;
  email: string;
  localUsername: string;
  localRole: AppRole | "";
  relationshipSummary: string;
};
