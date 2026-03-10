import { AppHeader } from "@/components/AppHeader";
import { MediaLibraryClient } from "@/components/MediaLibraryClient";
import { canManageFamilyData } from "@/lib/auth/permissions";
import { requireFamilyGroupSession } from "@/lib/auth/session";

type TenantMediaPageProps = {
  params: Promise<{ tenantKey: string }>;
};

export default async function TenantMediaPage({ params }: TenantMediaPageProps) {
  const { tenantKey } = await params;
  const { tenant, session } = await requireFamilyGroupSession(tenantKey);

  return (
    <>
      <AppHeader tenantKey={tenant.tenantKey} />
      <MediaLibraryClient tenantKey={tenant.tenantKey} canManage={canManageFamilyData(session, tenant)} />
    </>
  );
}
