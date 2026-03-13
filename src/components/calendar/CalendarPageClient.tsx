"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type CalendarPageClientProps = {
  todayIso: string;
  basePath: string;
  birthdayPeople: Array<{
    personId: string;
    displayName: string;
    birthDate: string;
  }>;
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function buildMonthGrid(monthDate: Date) {
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1, 12, 0, 0, 0);
  const gridStart = addDays(monthStart, -monthStart.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

function buildPersonHref(basePath: string, personId: string) {
  const encodedPersonId = encodeURIComponent(personId);
  return `${basePath || ""}/people/${encodedPersonId}`;
}

function getBirthdayAgeLabel(turningAge: number) {
  return turningAge >= 0 && turningAge < 30 ? `Age ${turningAge}` : "";
}

export function CalendarPageClient({ todayIso, basePath, birthdayPeople }: CalendarPageClientProps) {
  const today = useMemo(() => parseIsoDate(todayIso) ?? new Date(), [todayIso]);
  const [displayMonth, setDisplayMonth] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1, 12, 0, 0, 0),
  );

  const yearOptions = useMemo(() => {
    const currentYear = today.getFullYear();
    return Array.from({ length: 151 }, (_, index) => currentYear - 100 + index);
  }, [today]);

  const gridDates = useMemo(() => buildMonthGrid(displayMonth), [displayMonth]);
  const monthLabel = displayMonth.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const birthdaysByDayKey = useMemo(() => {
    const result = new Map<string, Array<{ personId: string; displayName: string; ageLabel: string }>>();
    birthdayPeople.forEach((person) => {
      const parsedBirthDate = parseIsoDate(person.birthDate);
      if (!parsedBirthDate) {
        return;
      }
      if (parsedBirthDate.getMonth() !== displayMonth.getMonth()) {
        return;
      }
      const occurrence = new Date(displayMonth.getFullYear(), parsedBirthDate.getMonth(), parsedBirthDate.getDate(), 12, 0, 0, 0);
      const key = `${occurrence.getFullYear()}-${occurrence.getMonth()}-${occurrence.getDate()}`;
      const bucket = result.get(key) ?? [];
      bucket.push({
        personId: person.personId,
        displayName: person.displayName,
        ageLabel: getBirthdayAgeLabel(occurrence.getFullYear() - parsedBirthDate.getFullYear()),
      });
      bucket.sort((left, right) => left.displayName.localeCompare(right.displayName));
      result.set(key, bucket);
    });
    return result;
  }, [birthdayPeople, displayMonth]);

  return (
    <section className="card calendar-card">
      <div className="calendar-toolbar">
        <div className="calendar-nav">
          <button
            type="button"
            className="calendar-nav-button"
            onClick={() => setDisplayMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1, 12))}
            aria-label="Previous month"
          >
            <span aria-hidden="true">{"<"}</span>
          </button>
          <strong className="calendar-month-label">{monthLabel}</strong>
          <button
            type="button"
            className="calendar-nav-button"
            onClick={() => setDisplayMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1, 12))}
            aria-label="Next month"
          >
            <span aria-hidden="true">{">"}</span>
          </button>
        </div>

        <label className="calendar-year-picker">
          <span>Year</span>
          <select
            className="input calendar-year-select"
            value={displayMonth.getFullYear()}
            onChange={(event) =>
              setDisplayMonth((current) => new Date(Number.parseInt(event.target.value, 10), current.getMonth(), 1, 12))
            }
          >
            {yearOptions.map((year) => (
              <option key={`calendar-year-${year}`} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="calendar-weekdays" aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className="calendar-weekday">
            {label}
          </span>
        ))}
      </div>

      <div className="calendar-grid" role="grid" aria-label={monthLabel}>
        {gridDates.map((date) => {
          const outsideMonth = date.getMonth() !== displayMonth.getMonth();
          const isToday = isSameDay(date, today);
          const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
          const dayBirthdays = birthdaysByDayKey.get(dayKey) ?? [];
          return (
            <div
              key={date.toISOString()}
              className={`calendar-day-cell${outsideMonth ? " is-outside" : ""}${isToday ? " is-today" : ""}`}
              role="gridcell"
              aria-selected={isToday}
            >
              <span className="calendar-day-number">{date.getDate()}</span>
              {dayBirthdays.length > 0 ? (
                <div className="calendar-day-chip-list">
                  {dayBirthdays.map((person) => (
                    <Link
                      key={`${dayKey}-${person.personId}`}
                      href={buildPersonHref(basePath, person.personId)}
                      prefetch={false}
                      className="calendar-birthday-chip"
                    >
                      <span>{person.displayName}</span>
                      {person.ageLabel ? <strong>{person.ageLabel}</strong> : null}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
