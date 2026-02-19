import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getEnv } from "@/lib/env";
import { getEnabledUserAccess, getEnabledUserAccessList } from "@/lib/google/sheets";
import { DEFAULT_TENANT_KEY, DEFAULT_TENANT_NAME } from "@/lib/tenant/context";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: getEnv().GOOGLE_CLIENT_ID,
      clientSecret: getEnv().GOOGLE_CLIENT_SECRET,
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) {
        return false;
      }

      const access = await getEnabledUserAccess(user.email);
      return !!access;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const accesses = await getEnabledUserAccessList(user.email);
        if (accesses.length === 0) {
          return token;
        }
        const primary = accesses[0];

        token.role = primary.role;
        token.person_id = primary.personId;
        token.tenantKey = primary.tenantKey;
        token.tenantName = primary.tenantName;
        token.tenantAccesses = accesses;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as "ADMIN" | "USER" | undefined;
        session.user.person_id = token.person_id as string | undefined;
        session.user.tenantAccesses = (token.tenantAccesses as typeof session.user.tenantAccesses) ?? [];
      }
      session.tenantKey = (token.tenantKey as string | undefined) ?? DEFAULT_TENANT_KEY;
      session.tenantName = (token.tenantName as string | undefined) ?? DEFAULT_TENANT_NAME;
      return session;
    },
  },
  secret: getEnv().NEXTAUTH_SECRET,
};
