import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      email?: string | null;
      name?: string | null;
      image?: string | null;
      role?: "ADMIN" | "USER";
      person_id?: string;
      steveAccess?: boolean;
      tenantAccesses?: {
        tenantKey: string;
        tenantName: string;
        familyGroupKey?: string;
        familyGroupName?: string;
        role: "ADMIN" | "USER";
        personId: string;
      }[];
    };
    tenantKey?: string;
    tenantName?: string;
    familyGroupKey?: string;
    familyGroupName?: string;
    accessibleTenants?: {
      tenantKey: string;
      tenantName: string;
      familyGroupKey?: string;
      familyGroupName?: string;
      role: "ADMIN" | "USER";
      personId: string;
    }[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "ADMIN" | "USER";
    person_id?: string;
    steveAccess?: boolean;
    tenantKey?: string;
    tenantName?: string;
    familyGroupKey?: string;
    familyGroupName?: string;
    tenantAccesses?: {
      tenantKey: string;
      tenantName: string;
      familyGroupKey?: string;
      familyGroupName?: string;
      role: "ADMIN" | "USER";
      personId: string;
    }[];
  }
}
