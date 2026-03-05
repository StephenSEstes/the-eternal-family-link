import { AppHeader } from "@/components/AppHeader";
import { MediaLibraryClient } from "@/components/MediaLibraryClient";
import { requireFamilyGroupSession } from "@/lib/auth/session";

type TenantMediaPageProps = {
  params: Promise<{ tenantKey: string }>;
};

export default async function TenantMediaPage({ params }: TenantMediaPageProps) {
  const { tenantKey } = await params;
  const { tenant } = await requireFamilyGroupSession(tenantKey);

  return (
    <>
      <AppHeader tenantKey={tenant.tenantKey} />
      <MediaLibraryClient tenantKey={tenant.tenantKey} canManage={tenant.role === "ADMIN"} />
    </>
  );
}
