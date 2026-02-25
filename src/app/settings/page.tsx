import { redirect } from "next/navigation";
import { requireFamilyGroupSession } from "@/lib/auth/session";
import { getTenantBasePath } from "@/lib/family-group/context";

export default async function SettingsRootPage() {
  const { tenant } = await requireFamilyGroupSession();
  const basePath = getTenantBasePath(tenant.tenantKey);
  redirect(`${basePath}/settings`);
}

