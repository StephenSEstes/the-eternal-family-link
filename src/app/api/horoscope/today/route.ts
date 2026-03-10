import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { getRequestTenantContext, getTenantContext, hasTenantAccess, normalizeTenantRouteKey } from "@/lib/family-group/context";
import { getPersonById } from "@/lib/data/runtime";
import { getTenantBasePath } from "@/lib/tenant/context";

type HoroscopePayload = {
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

const TTL_MS = 6 * 60 * 60 * 1000;
const horoscopeCache = new Map<string, { expiresAt: number; payload: HoroscopePayload }>();

function parseMonthDay(value: string): { month: number; day: number } | null {
  const raw = value.trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const month = Number.parseInt(match[2] ?? "", 10);
    const day = Number.parseInt(match[3] ?? "", 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { month, day };
    }
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    month: parsed.getUTCMonth() + 1,
    day: parsed.getUTCDate(),
  };
}

function zodiacSign(month: number, day: number) {
  if ((month === 3 && day >= 21) || (month === 4 && day <= 19)) return "aries";
  if ((month === 4 && day >= 20) || (month === 5 && day <= 20)) return "taurus";
  if ((month === 5 && day >= 21) || (month === 6 && day <= 20)) return "gemini";
  if ((month === 6 && day >= 21) || (month === 7 && day <= 22)) return "cancer";
  if ((month === 7 && day >= 23) || (month === 8 && day <= 22)) return "leo";
  if ((month === 8 && day >= 23) || (month === 9 && day <= 22)) return "virgo";
  if ((month === 9 && day >= 23) || (month === 10 && day <= 22)) return "libra";
  if ((month === 10 && day >= 23) || (month === 11 && day <= 21)) return "scorpio";
  if ((month === 11 && day >= 22) || (month === 12 && day <= 21)) return "sagittarius";
  if ((month === 12 && day >= 22) || (month === 1 && day <= 19)) return "capricorn";
  if ((month === 1 && day >= 20) || (month === 2 && day <= 18)) return "aquarius";
  return "pisces";
}

export async function GET(request: Request) {
  const session = await getAppSession();
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const requestedTenantKey = url.searchParams.get("tenantKey")?.trim().toLowerCase();
  if (requestedTenantKey && !hasTenantAccess(session, requestedTenantKey)) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }
  const tenant = requestedTenantKey
    ? getTenantContext(session, normalizeTenantRouteKey(requestedTenantKey))
    : await getRequestTenantContext(session);

  const personId = (tenant.personId || session.user.person_id || "").trim();
  const basePath = getTenantBasePath(tenant.tenantKey);
  const profilePath = personId ? `${basePath}/people/${encodeURIComponent(personId)}` : `${basePath}/people`;
  if (!personId) {
    return NextResponse.json({ ok: false, reason: "missing_birthday", profilePath }, { status: 200 });
  }

  const person = await getPersonById(personId, tenant.tenantKey).catch(() => null);
  const md = parseMonthDay(person?.birthDate ?? "");
  if (!md) {
    return NextResponse.json({ ok: false, reason: "missing_birthday", profilePath }, { status: 200 });
  }

  const sign = zodiacSign(md.month, md.day);
  const dayKey = new Date().toISOString().slice(0, 10);
  const cacheKey = `${dayKey}|${sign}`;
  const cached = horoscopeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.payload);
  }

  try {
    const upstream = await fetch(
      `https://aztro.sameerkumar.website?sign=${encodeURIComponent(sign)}&day=today`,
      {
        method: "POST",
        cache: "force-cache",
        next: { revalidate: 21600 },
      },
    );
    if (!upstream.ok) {
      return NextResponse.json({ ok: false, reason: "upstream_error" }, { status: 200 });
    }
    const json = (await upstream.json()) as Record<string, unknown>;
    const payload: HoroscopePayload = {
      ok: true,
      sign,
      day: "today",
      description: String(json.description ?? ""),
      mood: String(json.mood ?? ""),
      compatibility: String(json.compatibility ?? ""),
      color: String(json.color ?? ""),
      lucky_number: String(json.lucky_number ?? ""),
      lucky_time: String(json.lucky_time ?? ""),
    };
    horoscopeCache.set(cacheKey, { expiresAt: Date.now() + TTL_MS, payload });
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ ok: false, reason: "upstream_error" }, { status: 200 });
  }
}
