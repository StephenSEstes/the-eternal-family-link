import { AppHeader } from "@/components/AppHeader";
import { SharesClient } from "@/components/shares/SharesClient";
import { requireFamilyGroupSession } from "@/lib/auth/session";

export default async function SharesPage() {
  const { tenant } = await requireFamilyGroupSession();

  return (
    <>
      <AppHeader />
      <SharesClient tenantKey={tenant.tenantKey} />
    </>
  );
}
