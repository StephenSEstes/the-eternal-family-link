"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { getPhotoProxyPath } from "@/lib/google/photo-path";

type BirthdayRange = "today" | "week" | "month";

type BirthdayPerson = {
  personId: string;
  displayName: string;
  birthDate: string;
  deathDate?: string;
  gender?: "male" | "female" | "unspecified";
  photoFileId?: string;
  personBasePath?: string;
};

type BirthdayMatch = {
  person: BirthdayPerson;
  occurrence: Date;
  turningAge: number | null;
};

type BirthdaysSectionProps = {
  tenantKey: string;
  basePath: string;
  returnToPath: string;
  todayIso: string;
  people: BirthdayPerson[];
};

const RANGE_OPTIONS: Array<{ value: BirthdayRange; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This Month" },
];

function parseIsoDate(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  return { year, month, day };
}

function buildLocalDate(year: number, month: number, day: number) {
  const maxDay = new Date(year, month, 0).getDate();
  return new Date(year, month - 1, Math.min(day, maxDay), 12, 0, 0, 0);
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function getRangeEnd(today: Date, range: BirthdayRange) {
  if (range === "today") {
    return today;
  }
  if (range === "week") {
    return addDays(today, 6);
  }
  return new Date(today.getFullYear(), today.getMonth() + 1, 0, 12, 0, 0, 0);
}

function getNextBirthday(today: Date, birthDate: string) {
  const parsed = parseIsoDate(birthDate);
  if (!parsed) {
    return null;
  }
  let occurrence = buildLocalDate(today.getFullYear(), parsed.month, parsed.day);
  if (occurrence.getTime() < today.getTime()) {
    occurrence = buildLocalDate(today.getFullYear() + 1, parsed.month, parsed.day);
  }
  return {
    occurrence,
    turningAge: occurrence.getFullYear() - parsed.year,
  };
}

function formatBirthDate(value: string) {
  const parsed = parseIsoDate(value);
  if (!parsed) {
    return "Birthdate not set";
  }
  return buildLocalDate(parsed.year, parsed.month, parsed.day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function buildPersonHref(basePath: string, personId: string, returnToPath: string) {
  const encodedPersonId = encodeURIComponent(personId);
  const routeBase = basePath || "";
  const encodedReturnTo = encodeURIComponent(returnToPath || "/");
  return `${routeBase}/people/${encodedPersonId}?returnTo=${encodedReturnTo}`;
}

function getAvatarUrl(person: BirthdayPerson, tenantKey: string) {
  if (person.photoFileId?.trim()) {
    return getPhotoProxyPath(person.photoFileId.trim(), tenantKey);
  }
  return person.gender === "female" ? "/placeholders/avatar-female.png" : "/placeholders/avatar-male.png";
}

export function BirthdaysSection({ tenantKey, basePath, returnToPath, todayIso, people }: BirthdaysSectionProps) {
  const [range, setRange] = useState<BirthdayRange>("month");
  const today = useMemo(() => {
    const parsed = parseIsoDate(todayIso);
    if (!parsed) {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
    }
    return buildLocalDate(parsed.year, parsed.month, parsed.day);
  }, [todayIso]);

  const matches = useMemo(() => {
    const rangeEnd = getRangeEnd(today, range).getTime();
    return people
      .map((person) => {
        const nextBirthday = getNextBirthday(today, person.birthDate);
        if (!nextBirthday) {
          return null;
        }
        if (nextBirthday.occurrence.getTime() > rangeEnd) {
          return null;
        }
        return {
          person,
          occurrence: nextBirthday.occurrence,
          turningAge:
            person.deathDate?.trim()
              ? -1
              : nextBirthday.turningAge >= 0 && nextBirthday.turningAge < 30
                ? nextBirthday.turningAge
                : null,
        } satisfies BirthdayMatch;
      })
      .filter((item): item is BirthdayMatch => Boolean(item))
      .sort((left, right) => {
        const timeDelta = left.occurrence.getTime() - right.occurrence.getTime();
        if (timeDelta !== 0) {
          return timeDelta;
        }
        return left.person.displayName.localeCompare(right.person.displayName);
      });
  }, [people, range, today]);

  return (
    <section className="card birthdays-card">
      <div className="birthdays-header">
        <div>
          <h2 className="ui-section-title">Birthdays</h2>
          <p className="ui-section-subtitle">Jump straight into the people celebrating soon.</p>
        </div>
        <div className="birthdays-range-row" role="tablist" aria-label="Birthday range">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`birthday-range-chip${range === option.value ? " is-active" : ""}`}
              onClick={() => setRange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="birthday-chip-list">
        {matches.length === 0 ? <p className="birthday-empty">No birthdays in this range.</p> : null}
        {matches.map((item) => (
          <Link
            key={`${range}-${item.person.personId}`}
            href={buildPersonHref(item.person.personBasePath ?? basePath, item.person.personId, returnToPath)}
            prefetch={false}
            className="birthday-chip"
          >
            <img
              src={getAvatarUrl(item.person, tenantKey)}
              alt={item.person.displayName}
              className="birthday-chip-avatar"
            />
            <span className="birthday-chip-copy">
              <span className="birthday-chip-name">{item.person.displayName}</span>
              <span className="birthday-chip-meta">{formatBirthDate(item.person.birthDate)}</span>
            </span>
            {item.turningAge === -1 ? <span className="birthday-chip-age">In Mem</span> : null}
            {item.turningAge !== null && item.turningAge >= 0 ? <span className="birthday-chip-age">Turning {item.turningAge}</span> : null}
          </Link>
        ))}
      </div>
    </section>
  );
}
