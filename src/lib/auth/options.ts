import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { getEnv } from "@/lib/env";
import {
  getLocalUserByUsername,
  getTenantSecurityPolicy,
  patchLocalUser,
} from "@/lib/auth/local-users";
import {
  appendAuditLog,
  getAllFamilyGroupAccesses,
  getEnabledUserAccess,
  getEnabledUserAccessList,
  getEnabledUserAccessListByPersonId,
} from "@/lib/data/runtime";
import { DEFAULT_TENANT_KEY, DEFAULT_TENANT_NAME } from "@/lib/family-group/context";
import { verifyPassword } from "@/lib/security/password";

function normalizeTenantKey(value?: string) {
  const raw = (value ?? DEFAULT_TENANT_KEY).trim().toLowerCase();
  if (raw === "default") {
    return DEFAULT_TENANT_KEY;
  }
  return raw || DEFAULT_TENANT_KEY;
}

const STEVE_ACCESS_EMAIL = "stephensestes@gmail.com";
const STEVE_PERSON_ID = "19660812-stephen-snow-estes";

function hasSteveAccess(email?: string | null) {
  return (email ?? "").trim().toLowerCase() === STEVE_ACCESS_EMAIL;
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
        const localUser = user as { person_id?: string } | undefined;
        await appendAuditLog({
          actorEmail: user.email ?? "",
          actorPersonId: typeof localUser?.person_id === "string" ? localUser.person_id : "",
          action: "LOGIN",
          entityType: "AUTH",
          entityId: "credentials",
          status: "SUCCESS",
          details: "Credentials sign-in accepted.",
        }).catch(() => undefined);
        return true;
      }
      if (!user.email) {
        await appendAuditLog({
          actorEmail: "",
          action: "LOGIN",
          entityType: "AUTH",
          entityId: "oauth",
          status: "FAILURE",
          details: "OAuth sign-in rejected: missing user email.",
        }).catch(() => undefined);
        return false;
      }
      if (hasSteveAccess(user.email)) {
        await appendAuditLog({
          actorEmail: user.email,
          action: "LOGIN",
          entityType: "AUTH",
          entityId: "oauth",
          status: "SUCCESS",
          details: "Steve super-access sign-in accepted.",
        }).catch(() => undefined);
        return true;
      }

      const access = await getEnabledUserAccess(user.email);
      const ok = !!access;
      await appendAuditLog({
        actorEmail: user.email,
        actorPersonId: access?.personId ?? "",
        action: "LOGIN",
        entityType: "AUTH",
        entityId: "oauth",
        status: ok ? "SUCCESS" : "FAILURE",
        details: ok ? "OAuth sign-in accepted via enabled access." : "OAuth sign-in rejected: no enabled family-group access.",
      }).catch(() => undefined);
      return ok;
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

      const currentEmail = (typeof user?.email === "string" ? user.email : token.email) ?? "";
      if (hasSteveAccess(currentEmail)) {
        const normalizedEmail = currentEmail.trim().toLowerCase();
        const emailAccesses = normalizedEmail ? await getEnabledUserAccessList(normalizedEmail) : [];
        const resolvedPersonId =
          emailAccesses[0]?.personId ||
          (typeof token.person_id === "string" ? token.person_id : "") ||
          STEVE_PERSON_ID;
        const personId = resolvedPersonId.trim();
        const cachedAccesses =
          Array.isArray(token.tenantAccesses) && token.tenantAccesses.length > 0
            ? (token.tenantAccesses as {
                tenantKey: string;
                tenantName: string;
                role: "ADMIN" | "USER";
                personId: string;
              }[])
            : [];
        let allAccesses = cachedAccesses;
        // Refresh only on initial sign-in or when cache is empty.
        if (user?.email || allAccesses.length === 0 || emailAccesses.length > 0) {
          try {
            allAccesses = await getAllFamilyGroupAccesses(personId);
          } catch {
            allAccesses = [
              {
                tenantKey: DEFAULT_TENANT_KEY,
                tenantName: DEFAULT_TENANT_NAME,
                role: "ADMIN",
                personId,
              },
            ];
          }
        }
        const primary = allAccesses[0] ?? {
          tenantKey: DEFAULT_TENANT_KEY,
          tenantName: DEFAULT_TENANT_NAME,
          role: "ADMIN" as const,
          personId,
        };
        token.role = "ADMIN";
        token.person_id = personId;
        token.tenantKey = primary.tenantKey;
        token.tenantName = primary.tenantName;
        token.tenantAccesses = allAccesses;
        token.steveAccess = true;
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

      const tokenPersonId = typeof token.person_id === "string" ? token.person_id.trim() : "";
      if (tokenPersonId) {
        const accesses = await getEnabledUserAccessListByPersonId(tokenPersonId);
        if (accesses.length > 0) {
          const primary = accesses[0];
          token.role = primary.role;
          token.person_id = primary.personId;
          token.tenantKey = primary.tenantKey;
          token.tenantName = primary.tenantName;
          token.tenantAccesses = accesses;
        } else {
          token.tenantAccesses = [];
          token.tenantKey = DEFAULT_TENANT_KEY;
          token.tenantName = DEFAULT_TENANT_NAME;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as "ADMIN" | "USER" | undefined;
        session.user.person_id = token.person_id as string | undefined;
        session.user.tenantAccesses = (token.tenantAccesses as typeof session.user.tenantAccesses) ?? [];
        session.user.steveAccess = Boolean(token.steveAccess);
      }
      session.tenantKey = (token.tenantKey as string | undefined) ?? DEFAULT_TENANT_KEY;
      session.tenantName = (token.tenantName as string | undefined) ?? DEFAULT_TENANT_NAME;
      return session;
    },
  },
  events: {
    async signOut(message) {
      const token = message.token as { email?: string; person_id?: string } | undefined;
      await appendAuditLog({
        actorEmail: token?.email ?? "",
        actorPersonId: token?.person_id ?? "",
        action: "LOGOUT",
        entityType: "AUTH",
        entityId: "session",
        status: "SUCCESS",
        details: "User signed out.",
      }).catch(() => undefined);
    },
  },
  secret: getEnv().NEXTAUTH_SECRET,
};
