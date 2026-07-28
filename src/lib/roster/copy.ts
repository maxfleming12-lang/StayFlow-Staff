import { TZDate } from "@date-fns/tz";
import { DEFAULT_TIMEZONE } from "@/lib/format";
import { localDateTimeToIso, parseIsoDate, weekDates } from "./week";

/**
 * Copying shifts from one week to another.
 *
 * Shared by "duplicate this week" and "apply a template", which are the same
 * operation: take a set of shifts anchored to one week and re-anchor them to
 * another.
 *
 * The whole difficulty is daylight saving. A shift is stored as an absolute
 * instant, so naively adding 7×N days of milliseconds preserves the INSTANT
 * and silently moves the local time by an hour across a changeover — an
 * 09:00 start copied from August into October would land at 08:00. What a
 * manager means by "same shift next week" is the same wall-clock time, so
 * these functions work in local components and convert back at the end.
 */

export interface CopyableShift {
  id: string;
  startsAt: string;
  endsAt: string;
}

export interface CopiedTimes {
  startsAt: string;
  endsAt: string;
}

/** Local date and time components of an instant, in a given timezone. */
function localParts(
  iso: string,
  timeZone: string,
): { date: string; hour: number; minute: number; second: number } {
  const zoned = new TZDate(new Date(iso), timeZone);
  return {
    date: new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).format(new Date(iso)),
    hour: zoned.getHours(),
    minute: zoned.getMinutes(),
    second: zoned.getSeconds(),
  };
}

/** Build an instant from local components in a timezone. */
function fromLocal(
  date: string,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return localDateTimeToIso(
    `${date}T${pad(hour)}:${pad(minute)}:${pad(second)}`,
    timeZone,
  );
}

/**
 * Re-anchor one shift from a source week to a target week.
 *
 * Preserves the day within the week and the local wall-clock time. Returns
 * null when the shift does not fall inside the source week, which keeps a
 * stray row from silently landing on the wrong day.
 */
export function copyShiftToWeek(
  shift: CopyableShift,
  sourceWeekStart: string,
  targetWeekStart: string,
  timeZone: string = DEFAULT_TIMEZONE,
): CopiedTimes | null {
  const sourceDays = weekDates(sourceWeekStart);
  const targetDays = weekDates(targetWeekStart);

  const start = localParts(shift.startsAt, timeZone);
  const dayIndex = sourceDays.indexOf(start.date);
  if (dayIndex === -1) return null;

  const newStartDate = targetDays[dayIndex];

  // The finish may fall on the next local day (an overnight shift). Measure
  // that offset in local days rather than assuming it is the same date.
  const end = localParts(shift.endsAt, timeZone);
  const dayGap = Math.round(
    (parseIsoDate(end.date).getTime() - parseIsoDate(start.date).getTime()) /
      86_400_000,
  );

  const newEnd = parseIsoDate(newStartDate);
  newEnd.setDate(newEnd.getDate() + dayGap);
  const pad = (n: number) => String(n).padStart(2, "0");
  const newEndDate = `${newEnd.getFullYear()}-${pad(newEnd.getMonth() + 1)}-${pad(newEnd.getDate())}`;

  return {
    startsAt: fromLocal(
      newStartDate,
      start.hour,
      start.minute,
      start.second,
      timeZone,
    ),
    endsAt: fromLocal(newEndDate, end.hour, end.minute, end.second, timeZone),
  };
}

/**
 * Re-anchor a whole week of shifts.
 *
 * Anything outside the source week is dropped and reported, rather than
 * silently discarded — a caller that loses shifts should be able to say so.
 */
export function copyWeekShifts(
  shifts: CopyableShift[],
  sourceWeekStart: string,
  targetWeekStart: string,
  timeZone: string = DEFAULT_TIMEZONE,
): { copied: (CopiedTimes & { sourceId: string })[]; skipped: string[] } {
  const copied: (CopiedTimes & { sourceId: string })[] = [];
  const skipped: string[] = [];

  for (const shift of shifts) {
    const times = copyShiftToWeek(
      shift,
      sourceWeekStart,
      targetWeekStart,
      timeZone,
    );
    if (times) copied.push({ ...times, sourceId: shift.id });
    else skipped.push(shift.id);
  }

  return { copied, skipped };
}
