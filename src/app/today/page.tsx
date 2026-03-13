import { AppHeader } from "@/components/AppHeader";
import { CalendarPageClient } from "@/components/calendar/CalendarPageClient";
import { requireSession } from "@/lib/auth/session";

export default async function TodayPage() {
  await requireSession();

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

        <CalendarPageClient todayIso={todayIso} />
      </main>
    </>
  );
}
