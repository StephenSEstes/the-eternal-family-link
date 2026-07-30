import { cookies } from "next/headers";
import { LoginPageClient } from "@/components/LoginPageClient";
import {
  ACTIVE_FAMILY_GROUP_COOKIE,
  ACTIVE_TENANT_COOKIE,
  DEFAULT_FAMILY_GROUP_KEY,
} from "@/lib/family-group/constants";
import { getFamilyGroupBasePath, normalizeFamilyGroupRouteKey } from "@/lib/tenant/context";

type LoginPageProps = {
  searchParams?: Promise<{
    tenantKey?: string;
    familyGroupKey?: string;
    callbackUrl?: string;
  }>;
};

function getSafeCallbackUrl(value: string | undefined, tenantKey: string) {
  const fallback = getFamilyGroupBasePath(tenantKey) || "/";
  const candidate = String(value ?? "").trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//")) {
    return fallback;
  }
  return candidate;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = (await searchParams) ?? {};
  const cookieStore = await cookies();
  const requestedTenantKey = normalizeFamilyGroupRouteKey(
    params.tenantKey ??
      params.familyGroupKey ??
      cookieStore.get(ACTIVE_FAMILY_GROUP_COOKIE)?.value ??
      cookieStore.get(ACTIVE_TENANT_COOKIE)?.value ??
      DEFAULT_FAMILY_GROUP_KEY,
  );
  const callbackUrl = getSafeCallbackUrl(params.callbackUrl, requestedTenantKey);

  return <LoginPageClient defaultTenantKey={requestedTenantKey} callbackUrl={callbackUrl} />;
}
