import { AppHeader } from "@/components/AppHeader";
import { requireSession } from "@/lib/auth/session";

export default async function TodayPage() {
  await requireSession();

  const date = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <>
      <AppHeader />
      <main className="section">
        <h1 className="page-title">Today</h1>
        <p className="page-subtitle">{date}</p>

        <section className="card">
          <p style={{ margin: 0, fontSize: "1.1rem" }}>
            Today view is a placeholder in MVP. Add reminders, birthdays, and memory prompts next.
          </p>
        </section>
      </main>
    </>
  );
}