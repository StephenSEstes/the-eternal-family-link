import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";

export async function AppHeader() {
  const session = await getAppSession();

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link href="/" className="app-brand">
          The Eternal Family Link
        </Link>

        <nav className="app-nav">
          <Link href="/" className="pill-link">
            Home
          </Link>
          <Link href="/people" className="pill-link">
            People
          </Link>
          <Link href="/tree" className="pill-link">
            Family Tree
          </Link>
          <Link href="/today" className="pill-link">
            Today
          </Link>
          <Link href="/games" className="pill-link">
            Games
          </Link>
          <Link href="/api/auth/signout" className="pill-link">
            Sign out
          </Link>
        </nav>

        <div style={{ color: "var(--text-muted)", fontWeight: 700 }}>
          {session?.user?.email ? `${session.user.email} (${session.user.role ?? "USER"})` : "Not signed in"}
        </div>
      </div>
    </header>
  );
}
