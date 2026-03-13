import { AppHeader } from "@/components/AppHeader";
import { CalendarPageClient } from "@/components/calendar/CalendarPageClient";
import { requireFamilyGroupSession } from "@/lib/auth/session";
import { getPeople } from "@/lib/data/runtime";
import { getTenantBasePath } from "@/lib/family-group/context";

export default async function TodayPage() {
  const { tenant } = await requireFamilyGroupSession();
  const people = await getPeople(tenant.tenantKey);
  const basePath = getTenantBasePath(tenant.tenantKey);

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
      <AppHeader />
      <main className="section">
        <div className="calendar-page-head">
          <div>
            <h1 className="page-title">Calendar</h1>
            <p className="page-subtitle">{date}</p>
          </div>
          <span className="calendar-progress-pill">in progress</span>
        </div>

        <CalendarPageClient
          todayIso={todayIso}
          basePath={basePath}
          birthdayPeople={people.map((person) => ({
            personId: person.personId,
            displayName: person.displayName,
            birthDate: person.birthDate,
          }))}
        />
      </main>
    </>
  );
}
