import { AppHeader } from "@/components/AppHeader";
import { CalendarPageClient } from "@/components/calendar/CalendarPageClient";
import { requireFamilyGroupSession } from "@/lib/auth/session";
import { getTenantBasePath } from "@/lib/family-group/context";
import { loadBirthdayPeopleForAccessibleFamilies } from "@/lib/home/birthdays";

type TenantTodayPageProps = {
  params: Promise<{ tenantKey: string }>;
};

export default async function TenantTodayPage({ params }: TenantTodayPageProps) {
  const { tenantKey } = await params;
  const { session, tenant } = await requireFamilyGroupSession(tenantKey);
  const basePath = getTenantBasePath(tenant.tenantKey);
  const { familyGroups, birthdayPeople } = await loadBirthdayPeopleForAccessibleFamilies(
    session.user?.tenantAccesses ?? [],
    tenant.tenantKey,
  );
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const date = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <>
      <AppHeader tenantKey={tenant.tenantKey} />
      <main className="section">
        <div className="calendar-page-head">
          <div>
            <h1 className="page-title">Calendar</h1>
            <p className="page-subtitle">{tenant.tenantName} | {date}</p>
          </div>
          <span className="calendar-progress-pill">in progress</span>
        </div>
        <CalendarPageClient
          todayIso={todayIso}
          basePath={basePath}
          returnToPath={`${basePath || ""}/today` || "/today"}
          activeTenantKey={tenant.tenantKey}
          familyGroups={familyGroups}
          birthdayPeople={birthdayPeople}
        />
      </main>
    </>
  );
}
