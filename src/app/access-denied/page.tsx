import Link from "next/link";

type AccessDeniedPageProps = {
  searchParams: Promise<{
    tenantKey?: string;
    from?: string;
    reason?: string;
  }>;
};

export default async function AccessDeniedPage({ searchParams }: AccessDeniedPageProps) {
  const params = await searchParams;
  const tenantKey = (params.tenantKey ?? "").trim().toLowerCase();
  const fromPath = (params.from ?? "").trim();
  const reason = (params.reason ?? "").trim();
  const debugHref = tenantKey
    ? `/api/debug/tenant-access?tenantKey=${encodeURIComponent(tenantKey)}`
    : "/api/debug/tenant-access";

  return (
    <main className="section">
      <section className="card">
        <h1 className="page-title">Access Denied</h1>
        <p className="status-warn" style={{ marginTop: 0 }}>
          Your current session does not have access to the requested family group.
        </p>
        <p className="page-subtitle">
          Requested family group: <strong>{tenantKey || "(unknown)"}</strong>
        </p>
        {fromPath ? (
          <p className="page-subtitle">
            Requested path: <code>{fromPath}</code>
          </p>
        ) : null}
        {reason ? (
          <p className="page-subtitle">
            Reason: <code>{reason}</code>
          </p>
        ) : null}

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "1rem" }}>
          <Link href="/" prefetch={false} className="btn btn-secondary">
            Go Home
          </Link>
          <Link href="/settings" prefetch={false} className="btn btn-secondary">
            Open Admin
          </Link>
          <Link href={debugHref} prefetch={false} className="btn">
            Run Access Diagnostics
          </Link>
        </div>
      </section>
    </main>
  );
}
