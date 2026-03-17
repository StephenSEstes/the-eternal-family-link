import { cookies } from "next/headers";
import { LoginPageClient } from "@/components/LoginPageClient";
import {
  ACTIVE_FAMILY_GROUP_COOKIE,
  ACTIVE_TENANT_COOKIE,
  DEFAULT_FAMILY_GROUP_KEY,
} from "@/lib/family-group/constants";
import { getFamilyGroupBasePath, normalizeFamilyGroupRouteKey } from "@/lib/tenant/context";

export default async function LoginPage() {
  const cookieStore = await cookies();
  const requestedTenantKey = normalizeFamilyGroupRouteKey(
    cookieStore.get(ACTIVE_FAMILY_GROUP_COOKIE)?.value ??
      cookieStore.get(ACTIVE_TENANT_COOKIE)?.value ??
      DEFAULT_FAMILY_GROUP_KEY,
  );
  const callbackUrl = getFamilyGroupBasePath(requestedTenantKey) || "/";

  return <LoginPageClient defaultTenantKey={requestedTenantKey} callbackUrl={callbackUrl} />;
}
