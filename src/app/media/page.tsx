import { AppHeader } from "@/components/AppHeader";
import { MediaLibraryClient } from "@/components/MediaLibraryClient";
import { canManageFamilyData } from "@/lib/auth/permissions";
import { requireFamilyGroupSession } from "@/lib/auth/session";

export default async function MediaPage() {
  const { tenant, session } = await requireFamilyGroupSession();

  return (
    <>
      <AppHeader />
      <MediaLibraryClient tenantKey={tenant.tenantKey} canManage={canManageFamilyData(session, tenant)} />
    </>
  );
}
