import { AppHeader } from "@/components/AppHeader";
import { SettingsClient } from "@/components/SettingsClient";
import { requireFamilyGroupSession } from "@/lib/auth/session";
import { getPeople, getTenantUserAccessList } from "@/lib/google/sheets";

type SettingsPageProps = {
  params: Promise<{ tenantKey: string }>;
};

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { tenantKey } = await params;
  const { tenant } = await requireFamilyGroupSession(tenantKey);

  if (tenant.role !== "ADMIN") {
    return (
      <>
        <AppHeader tenantKey={tenant.tenantKey} />
        <main className="section">
          <h1 className="page-title">Admin</h1>
          <p className="status-warn">Forbidden. Administrator access required.</p>
        </main>
      </>
    );
  }

  const [accessItems, people, allPeople] = await Promise.all([
    getTenantUserAccessList(tenant.tenantKey),
    getPeople(tenant.tenantKey),
    getPeople(),
  ]);

  return (
    <>
      <AppHeader tenantKey={tenant.tenantKey} />
      <main className="section">
        <h1 className="page-title">Admin</h1>
        <p className="page-subtitle">Administer family-group users and import data.</p>
        <SettingsClient
          tenantKey={tenant.tenantKey}
          tenantName={tenant.tenantName}
          tenantOptions={tenant.tenants.map((option) => ({
            tenantKey: option.tenantKey,
            tenantName: option.tenantName,
            role: option.role,
          }))}
          accessItems={accessItems.map((item) => ({
            userEmail: item.userEmail,
            role: item.role,
            personId: item.personId,
            isEnabled: item.isEnabled,
          }))}
          people={people.map((person) => ({ personId: person.personId, displayName: person.displayName }))}
          allPeople={allPeople.map((person) => ({
            personId: person.personId,
            displayName: person.displayName,
            middleName: person.middleName,
            gender: person.gender,
          }))}
        />
      </main>
    </>
  );
}
