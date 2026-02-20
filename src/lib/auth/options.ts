import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { getEnv } from "@/lib/env";
import {
  getLocalUserByUsername,
  getTenantSecurityPolicy,
  patchLocalUser,
} from "@/lib/auth/local-users";
import { getEnabledUserAccess, getEnabledUserAccessList } from "@/lib/google/sheets";
import { DEFAULT_TENANT_KEY, DEFAULT_TENANT_NAME } from "@/lib/tenant/context";
import { verifyPassword } from "@/lib/security/password";

function normalizeTenantKey(value?: string) {
  const raw = (value ?? DEFAULT_TENANT_KEY).trim().toLowerCase();
  return raw || DEFAULT_TENANT_KEY;
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: getEnv().GOOGLE_CLIENT_ID,
      clientSecret: getEnv().GOOGLE_CLIENT_SECRET,
    }),
    CredentialsProvider({
      id: "credentials",
      name: "Credentials",
      credentials: {
        tenantKey: { label: "Tenant Key", type: "text" },
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const tenantKey = normalizeTenantKey(credentials?.tenantKey);
        const username = (credentials?.username ?? "").trim().toLowerCase();
        const password = credentials?.password ?? "";
        if (!username || !password) {
          return null;
        }

        const user = await getLocalUserByUsername(tenantKey, username);
        if (!user || !user.isEnabled) {
          return null;
        }

        const now = Date.now();
        const lockedUntilMs = user.lockedUntil ? new Date(user.lockedUntil).getTime() : 0;
        if (lockedUntilMs && lockedUntilMs > now) {
          return null;
        }

        const policy = await getTenantSecurityPolicy(tenantKey);
        const valid = verifyPassword(password, user.passwordHash);
        if (!valid) {
          const failedAttempts = user.failedAttempts + 1;
          const shouldLock = failedAttempts >= Math.max(1, policy.lockoutAttempts);
          await patchLocalUser(tenantKey, username, {
            failedAttempts,
            lockedUntil: shouldLock ? new Date(now + 30 * 60 * 1000).toISOString() : "",
          });
          return null;
        }

        await patchLocalUser(tenantKey, username, {
          failedAttempts: 0,
          lockedUntil: "",
        });

        return {
          id: `${tenantKey}:${username}`,
          email: `${username}@local`,
          name: username,
          role: user.role,
          person_id: user.personId,
          tenantKey,
          tenantName: tenantKey,
          tenantAccesses: [
            {
              tenantKey,
              tenantName: tenantKey,
              role: user.role,
              personId: user.personId,
            },
          ],
          authProvider: "credentials",
        } as never;
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "credentials") {
        return true;
      }
      if (!user.email) {
        return false;
      }

      const access = await getEnabledUserAccess(user.email);
      return !!access;
    },
    async jwt({ token, user, account }) {
      if (account?.provider === "credentials" && user) {
        const local = user as {
          role?: "ADMIN" | "USER";
          person_id?: string;
          tenantKey?: string;
          tenantName?: string;
          tenantAccesses?: {
            tenantKey: string;
            tenantName: string;
            role: "ADMIN" | "USER";
            personId: string;
          }[];
        };
        token.role = local.role;
        token.person_id = local.person_id;
        token.tenantKey = local.tenantKey;
        token.tenantName = local.tenantName;
        token.tenantAccesses = local.tenantAccesses ?? [];
        return token;
      }

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
