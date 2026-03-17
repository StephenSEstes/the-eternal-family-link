export type PasswordResetPresentation = {
  resetId: string;
  personId: string;
  tenantKey: string;
  tenantName: string;
  resetEmail: string;
  username: string;
  status: "pending" | "used" | "revoked" | "expired";
  expiresAt: string;
};
