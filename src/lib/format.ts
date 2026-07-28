import { TZDate } from "@date-fns/tz";
import { format as formatDate } from "date-fns";

/**
 * Australian date, time and timezone helpers.
 *
 * Every date shown to a user is rendered in the property's timezone, which
 * for both motels is Australia/Sydney. Server rendering happens in UTC, so
 * formatting without an explicit zone would show the wrong day either side
 * of midnight — and during the October/April daylight-saving transitions,
 * the wrong hour as well.
 *
 * The same applies in reverse: a date or time a manager typed is wall-clock
 * at the property and must be resolved through `localDateTimeToIso`, never
 * through `new Date(...)` and never through a hardcoded "+10:00" — that
 * offset is wrong for half the year.
 */

/** The organisation's operating timezone. */
export const DEFAULT_TIMEZONE = "Australia/Sydney";

/** The locale used for all user-facing formatting. */
export const LOCALE = "en-AU";

/**
 * `yyyy-mm-ddThh:mm`, optionally with seconds and a fractional part. A space
 * may replace the "T". Fractional seconds are accepted because Postgres `time`
 * columns can carry them, and discarded because nothing here is sub-second.
 */
const WALL_CLOCK =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

/**
 * Convert a timezone-less local datetime entered at a property into an
 * unambiguous UTC instant.
 *
 * The parts must be read out of the string and handed to `TZDate.tz`. Passing
 * the string to `new TZDate(...)` instead parses it like `new Date(...)` — as
 * SERVER-local time — and only then attaches the zone, so "09:00" typed in
 * Sydney became 09:00 UTC on a UTC host and came back out as 7pm. It looked
 * correct in local development purely because the developer's machine was
 * already on Sydney time.
 */
export function localDateTimeToIso(
  localDateTime: string,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const parts = WALL_CLOCK.exec(localDateTime.trim());
  if (!parts) {
    throw new RangeError(`Not a local datetime value: ${localDateTime}`);
  }
  const [, year, month, day, hour, minute, second] = parts;

  const zoned = TZDate.tz(
    timeZone,
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? 0),
  );

  // Normalise to UTC. TZDate.toISOString() keeps the offset form ("…+10:00"),
  // which is the same instant but is easy to misread wherever it is logged,
  // compared or pasted into a query.
  return new Date(zoned.getTime()).toISOString();
}

/**
 * The instant a local calendar day begins at the property.
 *
 * Pair the day after `date` with a strictly-less-than comparison to cover a
 * whole day. An inclusive "23:59:59" bound looks equivalent but drops the
 * final second, and a hardcoded offset drifts by an hour across daylight
 * saving.
 */
export function startOfLocalDay(
  isoDate: string,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  return localDateTimeToIso(`${isoDate}T00:00`, timeZone);
}

/** Move a yyyy-mm-dd calendar date by whole days, staying a calendar date. */
export function addIsoDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  // Built in UTC so the arithmetic cannot be perturbed by the host clock.
  const shifted = new Date(Date.UTC(year, (month ?? 1) - 1, (day ?? 1) + days));
  return shifted.toISOString().slice(0, 10);
}

/** Convert an instant into a timezone-aware date. */
function zoned(value: Date | string, timeZone: string = DEFAULT_TIMEZONE) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new TZDate(date, timeZone);
}

/** Day and month with no year, e.g. "3 Aug". */
export function formatDayMonth(value: Date | string, timeZone?: string): string {
  return formatDate(zoned(value, timeZone), "d MMM");
}

/** Australian short date, e.g. "03/08/2026". */
export function formatShortDate(value: Date | string, timeZone?: string): string {
  return formatDate(zoned(value, timeZone), "dd/MM/yyyy");
}

/** Full date, e.g. "Monday, 3 August 2026". */
export function formatLongDate(value: Date | string, timeZone?: string): string {
  return formatDate(zoned(value, timeZone), "EEEE, d MMMM yyyy");
}

/** Time of day in 12-hour form with lowercase meridiem, e.g. "6:30am". */
export function formatTime(value: Date | string, timeZone?: string): string {
  return formatDate(zoned(value, timeZone), "h:mmaaa");
}

/** Date and time together, e.g. "3 Aug 2026, 6:30am". */
export function formatDateTime(value: Date | string, timeZone?: string): string {
  return `${formatDate(zoned(value, timeZone), "d MMM yyyy")}, ${formatTime(value, timeZone)}`;
}

/**
 * Format an amount as Australian currency, e.g. "$1,234.50".
 *
 * Labour figures produced by this application are estimates. They are not
 * award-interpreted payroll and must be labelled as estimates wherever they
 * are shown.
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: "AUD",
    currencyDisplay: "narrowSymbol",
  }).format(amount);
}

/**
 * Format a duration in hours the way a roster reads it: "7.5 h", "8 h".
 * Trailing zeroes are dropped because "8 h" is easier to scan than "8.00 h".
 */
export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(2).replace(/0$/, "")} h`;
}
