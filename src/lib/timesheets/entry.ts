import { DEFAULT_TIMEZONE, addIsoDays, localDateTimeToIso } from "@/lib/format";

/**
 * Turning a wall-clock entry into stored timesheet figures.
 *
 * Shared by every path that writes hours — entering them by hand, editing
 * them afterwards, and applying a staff correction — so all three agree on
 * what "9am to 5pm on the 28th" means, including across daylight saving.
 *
 * Kept pure and separate from the server actions so it can be tested. The
 * actions themselves need a Supabase session and cannot be.
 */

export interface HoursEntry {
  /** The date the shift STARTED, yyyy-mm-dd, local to the property. */
  workDate: string;
  /** Wall-clock start, HH:mm. */
  startTime: string;
  /** Wall-clock finish, HH:mm. Earlier than the start means overnight. */
  endTime: string;
  breakMinutes: number;
}

export interface DerivedHours {
  startIso: string;
  endIso: string;
  /** True when the finish rolled into the following local day. */
  endsNextDay: boolean;
  paidHours: number;
}

export type DeriveResult =
  | { ok: true; value: DerivedHours }
  | { ok: false; field: keyof HoursEntry; message: string };

/**
 * Longest single entry accepted.
 *
 * Not an award rule — a typo guard. The overnight reading means a finish
 * time equal to the start would otherwise silently record 24 hours.
 */
export const MAX_ENTRY_HOURS = 16;

/** Round to cents-of-an-hour, the precision `paid_hours` stores. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Resolve an entry into instants and payable hours.
 *
 * Times are wall-clock AT THE PROPERTY. They go through
 * `localDateTimeToIso` rather than `new Date(...)` so an entry made in
 * January resolves at +11 and one in July at +10, whatever the server's own
 * clock is set to.
 */
export function deriveHours(
  entry: HoursEntry,
  timeZone: string = DEFAULT_TIMEZONE,
): DeriveResult {
  const startIso = localDateTimeToIso(
    `${entry.workDate}T${entry.startTime}`,
    timeZone,
  );

  // A finish at or before the start means the shift ran past midnight, which
  // is how night audit is actually worked.
  const endsNextDay = entry.endTime <= entry.startTime;
  const endIso = localDateTimeToIso(
    `${endsNextDay ? addIsoDays(entry.workDate, 1) : entry.workDate}T${entry.endTime}`,
    timeZone,
  );

  // Measured between instants, so a shift spanning a daylight-saving change
  // is the length actually worked, not the difference on the clock face.
  const paidHours =
    (Date.parse(endIso) - Date.parse(startIso)) / 3_600_000 -
    entry.breakMinutes / 60;

  if (paidHours <= 0) {
    return {
      ok: false,
      field: "breakMinutes",
      message: "That leaves no paid time. Check the times and the break.",
    };
  }
  if (paidHours > MAX_ENTRY_HOURS) {
    return {
      ok: false,
      field: "endTime",
      message: `That is more than ${MAX_ENTRY_HOURS} hours. For an overnight shift, use the date it started.`,
    };
  }

  return {
    ok: true,
    value: { startIso, endIso, endsNextDay, paidHours: round2(paidHours) },
  };
}

/**
 * The local wall-clock time of an instant, as HH:mm.
 *
 * Used to seed an edit form from what is already stored, so the manager
 * sees the times the way the staff member worked them.
 */
export function localTimeOf(
  iso: string,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}
