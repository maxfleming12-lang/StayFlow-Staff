import { TZDate } from "@date-fns/tz";
import { format as formatDate } from "date-fns";

/**
 * Australian formatting helpers.
 *
 * Every date shown to a user is rendered in the property's timezone, which
 * for both motels is Australia/Sydney. Server rendering happens in UTC, so
 * formatting without an explicit zone would show the wrong day either side
 * of midnight — and during the October/April daylight-saving transitions,
 * the wrong hour as well.
 */

/** The organisation's operating timezone. */
export const DEFAULT_TIMEZONE = "Australia/Sydney";

/** The locale used for all user-facing formatting. */
export const LOCALE = "en-AU";

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
