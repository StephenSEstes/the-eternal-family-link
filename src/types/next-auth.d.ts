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
    };
    tenantKey?: string;
    tenantName?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "ADMIN" | "USER";
    person_id?: string;
    tenantKey?: string;
    tenantName?: string;
  }
}
