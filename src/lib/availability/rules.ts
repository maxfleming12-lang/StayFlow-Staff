/**
 * Availability rules.
 *
 * Two kinds exist, and the database enforces that a row is exactly one of
 * them (`num_nonnulls(day_of_week, specific_date) = 1`):
 *
 *   * Recurring — "I cannot work Wednesdays", keyed on day_of_week.
 *   * Date-specific — "I cannot work 12 August", keyed on specific_date.
 *
 * A date-specific rule overrides the recurring pattern for that date, which
 * is what lets someone say "normally free on Tuesdays, but not this one".
 */

/** 0 = Sunday, matching Postgres and JavaScript's getDay(). */
export const WEEKDAYS = [
  { value: 0, label: "Sunday", short: "Sun" },
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
] as const;

export function weekdayLabel(value: number): string {
  return WEEKDAYS.find((d) => d.value === value)?.label ?? `Day ${value}`;
}

export interface AvailabilityRow {
  id: string;
  dayOfWeek: number | null;
  specificDate: string | null;
  startTime: string | null;
  endTime: string | null;
  isAvailable: boolean;
  note: string | null;
  status: string;
}

/**
 * Plain-English description of a rule, for a list a staff member reads on a
 * phone. "Unavailable every Wednesday", "Available 12 Aug, 9:00am–1:00pm".
 */
export function describeRule(rule: {
  dayOfWeek: number | null;
  specificDate: string | null;
  startTime: string | null;
  endTime: string | null;
  isAvailable: boolean;
}): string {
  const state = rule.isAvailable ? "Available" : "Unavailable";

  const when =
    rule.dayOfWeek != null
      ? `every ${weekdayLabel(rule.dayOfWeek)}`
      : rule.specificDate
        ? formatRuleDate(rule.specificDate)
        : "";

  const times =
    rule.startTime && rule.endTime
      ? `, ${trimSeconds(rule.startTime)}–${trimSeconds(rule.endTime)}`
      : rule.dayOfWeek != null || rule.specificDate
        ? " (all day)"
        : "";

  return `${state} ${when}${times}`.trim();
}

/** "12 Aug 2026" from an ISO date, without a timezone shift. */
function formatRuleDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, (month ?? 1) - 1, day ?? 1));
}

/** "09:00:00" -> "09:00". */
function trimSeconds(time: string): string {
  return time.slice(0, 5);
}

/**
 * Sort rules the way a person reads them: recurring days in week order
 * first, then date-specific rules by date.
 */
export function sortRules<T extends { dayOfWeek: number | null; specificDate: string | null }>(
  rules: T[],
): T[] {
  return [...rules].sort((a, b) => {
    if (a.dayOfWeek != null && b.dayOfWeek != null) {
      return a.dayOfWeek - b.dayOfWeek;
    }
    // Recurring rules sort above date-specific ones.
    if (a.dayOfWeek != null) return -1;
    if (b.dayOfWeek != null) return 1;
    return (a.specificDate ?? "").localeCompare(b.specificDate ?? "");
  });
}

/**
 * True when a date-specific rule has already passed and is therefore only
 * of historical interest.
 */
export function isExpired(
  rule: { specificDate: string | null },
  today: string = new Date().toISOString().slice(0, 10),
): boolean {
  return rule.specificDate != null && rule.specificDate < today;
}
