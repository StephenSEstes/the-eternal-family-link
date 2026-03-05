import { AppHeader } from "@/components/AppHeader";
import { MediaLibraryClient } from "@/components/MediaLibraryClient";
import { requireFamilyGroupSession } from "@/lib/auth/session";

export default async function MediaPage() {
  const { tenant } = await requireFamilyGroupSession();

  return (
    <>
      <AppHeader />
      <MediaLibraryClient tenantKey={tenant.tenantKey} canManage={tenant.role === "ADMIN"} />
    </>
  );
}
