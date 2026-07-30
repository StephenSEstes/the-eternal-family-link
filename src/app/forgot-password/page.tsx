import { cookies } from "next/headers";
import { ForgotPasswordPageClient } from "@/components/ForgotPasswordPageClient";
import {
  ACTIVE_FAMILY_GROUP_COOKIE,
  ACTIVE_TENANT_COOKIE,
  DEFAULT_FAMILY_GROUP_KEY,
} from "@/lib/family-group/constants";
import { normalizeFamilyGroupRouteKey } from "@/lib/tenant/context";

type ForgotPasswordPageProps = {
  searchParams?: Promise<{
    tenantKey?: string;
    familyGroupKey?: string;
  }>;
};

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const params = (await searchParams) ?? {};
  const cookieStore = await cookies();
  const requestedTenantKey = normalizeFamilyGroupRouteKey(
    params.tenantKey ??
      params.familyGroupKey ??
      cookieStore.get(ACTIVE_FAMILY_GROUP_COOKIE)?.value ??
      cookieStore.get(ACTIVE_TENANT_COOKIE)?.value ??
      DEFAULT_FAMILY_GROUP_KEY,
  );

  return <ForgotPasswordPageClient defaultTenantKey={requestedTenantKey} />;
}
