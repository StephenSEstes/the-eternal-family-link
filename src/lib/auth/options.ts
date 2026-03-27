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
  updateTableRecordById,
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

function localAuditEmail(username: string) {
  return `${username}@local`;
}

function localUsernameFromEmail(email?: string | null) {
  const normalized = String(email ?? "").trim().toLowerCase();
  return normalized.endsWith("@local") ? normalized.slice(0, -6) : "";
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
          await appendAuditLog({
            actorEmail: username ? localAuditEmail(username) : "",
            actorUsername: username,
            action: "LOGIN",
            entityType: "AUTH",
            entityId: "credentials",
            familyGroupKey: tenantKey,
            status: "FAILURE",
            details: "Credentials sign-in rejected: username and password are required.",
          }).catch(() => undefined);
          return null;
        }

        const user = await getLocalUserByUsername(tenantKey, username);
        if (!user || !user.isEnabled) {
          await appendAuditLog({
            actorEmail: localAuditEmail(username),
            actorUsername: username,
            actorPersonId: user?.personId ?? "",
            action: "LOGIN",
            entityType: "AUTH",
            entityId: "credentials",
            familyGroupKey: tenantKey,
            status: "FAILURE",
            details: "Credentials sign-in rejected: local access not found or disabled.",
          }).catch(() => undefined);
          return null;
        }

        const now = Date.now();
        const lockedUntilMs = user.lockedUntil ? new Date(user.lockedUntil).getTime() : 0;
        if (lockedUntilMs && lockedUntilMs > now) {
          await appendAuditLog({
            actorEmail: localAuditEmail(username),
            actorUsername: username,
            actorPersonId: user.personId,
            action: "LOGIN",
            entityType: "AUTH",
            entityId: "credentials",
            familyGroupKey: tenantKey,
            status: "FAILURE",
            details: `Credentials sign-in rejected: account locked until ${user.lockedUntil}.`,
          }).catch(() => undefined);
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
          await appendAuditLog({
            actorEmail: localAuditEmail(username),
            actorUsername: username,
            actorPersonId: user.personId,
            action: "LOGIN",
            entityType: "AUTH",
            entityId: "credentials",
            familyGroupKey: tenantKey,
            status: "FAILURE",
            details: shouldLock
              ? `Credentials sign-in rejected: invalid password; account locked after attempt ${failedAttempts}.`
              : `Credentials sign-in rejected: invalid password (attempt ${failedAttempts}).`,
          }).catch(() => undefined);
          return null;
        }

        await patchLocalUser(tenantKey, username, {
          failedAttempts: 0,
          lockedUntil: "",
          lastLoginAt: new Date(now).toISOString(),
        });

        return {
          id: `${tenantKey}:${username}`,
          email: localAuditEmail(username),
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
        const localUser = user as { person_id?: string; tenantKey?: string } | undefined;
        await appendAuditLog({
          actorEmail: user.email ?? "",
          actorUsername: user.name ?? localUsernameFromEmail(user.email),
          actorPersonId: typeof localUser?.person_id === "string" ? localUser.person_id : "",
          action: "LOGIN",
          entityType: "AUTH",
          entityId: "credentials",
          familyGroupKey: typeof localUser?.tenantKey === "string" ? localUser.tenantKey : "",
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
        const steveAccesses = await getEnabledUserAccessList(user.email).catch(() => []);
        const primarySteveAccess = steveAccesses[0];
        if (primarySteveAccess?.personId) {
          await updateTableRecordById(
            "UserAccess",
            primarySteveAccess.personId,
            { last_login_at: new Date().toISOString() },
            "person_id",
          ).catch(() => undefined);
        }
        await appendAuditLog({
          actorEmail: user.email,
          actorPersonId: primarySteveAccess?.personId ?? "",
          action: "LOGIN",
          entityType: "AUTH",
          entityId: "oauth",
          familyGroupKey: primarySteveAccess?.tenantKey ?? "",
          status: "SUCCESS",
          details: "Steve super-access sign-in accepted.",
        }).catch(() => undefined);
        return true;
      }

      const access = await getEnabledUserAccess(user.email);
      const ok = !!access;
      if (access?.personId) {
        await updateTableRecordById(
          "UserAccess",
          access.personId,
          { last_login_at: new Date().toISOString() },
          "person_id",
        ).catch(() => undefined);
      }
      await appendAuditLog({
        actorEmail: user.email,
        actorPersonId: access?.personId ?? "",
        action: "LOGIN",
        entityType: "AUTH",
        entityId: "oauth",
        familyGroupKey: access?.tenantKey ?? "",
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
        const localPersonId = typeof local.person_id === "string" ? local.person_id.trim() : "";
        const localAccesses = localPersonId ? await getEnabledUserAccessListByPersonId(localPersonId).catch(() => []) : [];
        const primaryLocalAccess = localAccesses[0];

        token.role = primaryLocalAccess?.role ?? local.role;
        token.person_id = primaryLocalAccess?.personId ?? local.person_id;
        token.tenantKey = primaryLocalAccess?.tenantKey ?? local.tenantKey;
        token.tenantName = primaryLocalAccess?.tenantName ?? local.tenantName;
        token.tenantAccesses = localAccesses.length > 0 ? localAccesses : local.tenantAccesses ?? [];
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
      (session as Session & { accessibleTenants?: typeof session.user.tenantAccesses }).accessibleTenants =
        (token.tenantAccesses as typeof session.user.tenantAccesses) ?? [];
      return session;
    },
  },
  events: {
    async signOut(message) {
      const token = message.token as { email?: string; person_id?: string; tenantKey?: string } | undefined;
      await appendAuditLog({
        actorEmail: token?.email ?? "",
        actorUsername: localUsernameFromEmail(token?.email),
        actorPersonId: token?.person_id ?? "",
        action: "LOGOUT",
        entityType: "AUTH",
        entityId: "session",
        familyGroupKey: token?.tenantKey ?? "",
        status: "SUCCESS",
        details: "User signed out.",
      }).catch(() => undefined);
    },
  },
  secret: getEnv().NEXTAUTH_SECRET,
};
