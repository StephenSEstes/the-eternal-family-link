import { AppHeader } from "@/components/AppHeader";
import { SharesClient } from "@/components/shares/SharesClient";
import { requireFamilyGroupSession } from "@/lib/auth/session";

type TenantSharesPageProps = {
  params: Promise<{ tenantKey: string }>;
};

export default async function TenantSharesPage({ params }: TenantSharesPageProps) {
  const { tenantKey } = await params;
  const { tenant } = await requireFamilyGroupSession(tenantKey);

  return (
    <>
      <AppHeader tenantKey={tenant.tenantKey} />
      <SharesClient tenantKey={tenant.tenantKey} />
    </>
  );
}
