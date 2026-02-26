import { redirect } from "next/navigation";
import { requireFamilyGroupSession } from "@/lib/auth/session";

export default async function SettingsRootPage() {
  const { tenant } = await requireFamilyGroupSession();
  redirect(`/t/${encodeURIComponent(tenant.tenantKey)}/settings`);
}
