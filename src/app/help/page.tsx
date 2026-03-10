import { AppHeader } from "@/components/AppHeader";
import { HelpAssistantClient } from "@/components/help/HelpAssistantClient";
import { requireFamilyGroupSession } from "@/lib/auth/session";

export default async function HelpPage() {
  const { tenant } = await requireFamilyGroupSession();

  return (
    <>
      <AppHeader />
      <HelpAssistantClient tenantKey={tenant.tenantKey} tenantName={tenant.tenantName} />
    </>
  );
}
