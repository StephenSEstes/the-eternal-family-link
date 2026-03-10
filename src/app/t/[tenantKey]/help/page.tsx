import { AppHeader } from "@/components/AppHeader";
import { HelpAssistantClient } from "@/components/help/HelpAssistantClient";
import { requireFamilyGroupSession } from "@/lib/auth/session";

type TenantHelpPageProps = {
  params: Promise<{ tenantKey: string }>;
};

export default async function TenantHelpPage({ params }: TenantHelpPageProps) {
  const { tenantKey } = await params;
  const { tenant } = await requireFamilyGroupSession(tenantKey);

  return (
    <>
      <AppHeader tenantKey={tenant.tenantKey} />
      <HelpAssistantClient tenantKey={tenant.tenantKey} tenantName={tenant.tenantName} />
    </>
  );
}
