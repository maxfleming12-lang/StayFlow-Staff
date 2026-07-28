import { TZDate } from "@date-fns/tz";
import { addDays, format, startOfWeek } from "date-fns";
import { DEFAULT_TIMEZONE, localDateTimeToIso } from "@/lib/format";

/**
 * Roster week arithmetic.
 *
 * Australian rosters run Monday to Sunday. All boundaries are computed in the
 * property's timezone, not the server's — a manager in Sydney and a server in
 * UTC must agree on which week a Sunday-evening shift belongs to.
 */

/** ISO date (yyyy-mm-dd) of the Monday starting the week containing `date`. */
export function weekStart(
  date: Date | string = new Date(),
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const zoned = new TZDate(
    typeof date === "string" ? parseIsoDate(date) : date,
    timeZone,
  );
  return format(startOfWeek(zoned, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

/** Move a week-start date by whole weeks. */
export function shiftWeek(weekStartDate: string, weeks: number): string {
  return format(addDays(parseIsoDate(weekStartDate), weeks * 7), "yyyy-MM-dd");
}

/** The seven ISO dates of a roster week, Monday first. */
export function weekDates(weekStartDate: string): string[] {
  const start = parseIsoDate(weekStartDate);
  return Array.from({ length: 7 }, (_, i) =>
    format(addDays(start, i), "yyyy-MM-dd"),
  );
}

/**
 * The instant range covering a roster week in a given timezone.
 *
 * Returned as ISO strings for querying `starts_at`, which is timestamptz.
 */
export function weekRange(
  weekStartDate: string,
  timeZone: string = DEFAULT_TIMEZONE,
): { fromIso: string; toIso: string } {
  return {
    fromIso: localDateTimeToIso(`${weekStartDate}T00:00`, timeZone),
    toIso: localDateTimeToIso(`${shiftWeek(weekStartDate, 1)}T00:00`, timeZone),
  };
}

/**
 * Re-exported because the roster modules are its main callers, but it lives
 * in `@/lib/format` — leave and timesheet code needs it too and must not
 * reach into the roster library for it.
 */
export { localDateTimeToIso };

/** "3–9 August 2026", collapsing a shared month. */
export function formatWeekLabel(weekStartDate: string): string {
  const start = parseIsoDate(weekStartDate);
  const end = addDays(start, 6);

  const sameMonth = start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();

  if (sameMonth && sameYear) {
    return `${format(start, "d")}–${format(end, "d MMMM yyyy")}`;
  }
  if (sameYear) {
    return `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`;
  }
  return `${format(start, "d MMM yyyy")} – ${format(end, "d MMM yyyy")}`;
}

/** Short weekday + day-of-month for a column heading, e.g. "Mon 3". */
export function formatDayHeading(isoDate: string): string {
  return format(parseIsoDate(isoDate), "EEE d");
}

/** True when the ISO date is today in the given timezone. */
export function isToday(
  isoDate: string,
  timeZone: string = DEFAULT_TIMEZONE,
): boolean {
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date());
  return isoDate === todayKey;
}

/**
 * Parse a yyyy-mm-dd string as a local calendar date.
 *
 * `new Date("2026-08-03")` parses as UTC midnight, which in Sydney is the
 * 3rd at 10am — fine — but in any negative-offset zone lands on the 2nd.
 * Constructing from parts keeps the calendar date intact wherever this runs.
 */
export function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}
