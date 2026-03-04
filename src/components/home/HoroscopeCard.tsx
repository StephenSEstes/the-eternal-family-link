"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type HoroscopeSuccess = {
  ok: true;
  sign: string;
  day: "today";
  description: string;
  mood: string;
  compatibility: string;
  color: string;
  lucky_number: string;
  lucky_time: string;
};

type HoroscopeFailure = {
  ok: false;
  reason: "missing_birthday" | "upstream_error" | string;
  profilePath?: string;
};

type HoroscopeResponse = HoroscopeSuccess | HoroscopeFailure;

type HoroscopeCardProps = {
  tenantKey?: string;
};

export function HoroscopeCard({ tenantKey }: HoroscopeCardProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<HoroscopeResponse | null>(null);
  const [requestNonce, setRequestNonce] = useState(0);

  const endpoint = useMemo(() => {
    if (!tenantKey) return "/api/horoscope/today";
    return `/api/horoscope/today?tenantKey=${encodeURIComponent(tenantKey)}`;
  }, [tenantKey]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as HoroscopeResponse | null;
      if (!body) {
        setData({ ok: false, reason: "upstream_error" });
      } else {
        setData(body);
      }
    } catch {
      setData({ ok: false, reason: "upstream_error" });
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load, requestNonce]);

  if (loading) {
    return (
      <section className="card" aria-busy="true" aria-live="polite">
        <h2 className="ui-section-title">Today&apos;s Horoscope</h2>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ height: 14, borderRadius: 8, background: "#E7EAF0", width: "35%" }} />
          <div style={{ height: 12, borderRadius: 8, background: "#ECEFF4", width: "100%" }} />
          <div style={{ height: 12, borderRadius: 8, background: "#ECEFF4", width: "96%" }} />
          <div style={{ height: 12, borderRadius: 8, background: "#ECEFF4", width: "82%" }} />
        </div>
      </section>
    );
  }

  if (!data || !data.ok) {
    if (data?.reason === "missing_birthday") {
      const profilePath = data.profilePath || (tenantKey ? `/t/${encodeURIComponent(tenantKey)}/people` : "/people");
      return (
        <section className="card">
          <h2 className="ui-section-title">Today&apos;s Horoscope</h2>
          <p className="page-subtitle">Add birthday to enable horoscope message.</p>
          <Link className="button secondary tap-button" href={profilePath}>
            Open Profile
          </Link>
        </section>
      );
    }
    return (
      <section className="card">
        <h2 className="ui-section-title">Today&apos;s Horoscope</h2>
        <p className="page-subtitle">Horoscope unavailable right now.</p>
        <button type="button" className="button secondary tap-button" onClick={() => setRequestNonce((n) => n + 1)}>
          Retry
        </button>
      </section>
    );
  }

  return (
    <section className="card">
      <h2 className="ui-section-title">Today&apos;s Horoscope</h2>
      <p className="page-subtitle" style={{ textTransform: "capitalize", marginTop: "-0.25rem" }}>
        {data.sign}
      </p>
      <p style={{ marginTop: "0.75rem" }}>{data.description}</p>
      <div className="settings-chip-list" style={{ marginTop: "0.9rem", rowGap: 8 }}>
        <span className="status-chip status-chip--neutral">Mood: {data.mood || "-"}</span>
        <span className="status-chip status-chip--neutral">Lucky #: {data.lucky_number || "-"}</span>
        <span className="status-chip status-chip--neutral">Lucky Time: {data.lucky_time || "-"}</span>
        <span className="status-chip status-chip--neutral">Compatibility: {data.compatibility || "-"}</span>
        <span className="status-chip status-chip--neutral">Color: {data.color || "-"}</span>
      </div>
    </section>
  );
}
