/**
 * Shift duration and labour cost arithmetic.
 *
 * Everything here produces an ESTIMATE. StayFlow does not interpret awards,
 * penalty rates, loadings or overtime, and nothing in this module should be
 * presented to a user without saying so.
 */

/** A break within a shift. */
export interface BreakSpec {
  durationMinutes: number;
  /** Paid breaks count towards paid hours; unpaid ones do not. */
  isPaid: boolean;
}

/** The minimum a shift needs for its hours to be calculated. */
export interface ShiftLike {
  startsAt: Date | string;
  endsAt: Date | string;
  breaks?: BreakSpec[];
}

/** Coerce an ISO string or Date to a Date. */
function toDate(value: Date | string): Date {
  return typeof value === "string" ? new Date(value) : value;
}

/**
 * Total elapsed hours between start and finish, ignoring breaks.
 *
 * Because both ends are absolute instants, an overnight shift and the
 * October/April daylight-saving transitions are handled correctly: a shift
 * spanning the April changeover really is nine hours, not eight.
 */
export function spanHours(shift: ShiftLike): number {
  const ms = toDate(shift.endsAt).getTime() - toDate(shift.startsAt).getTime();
  return ms / 3_600_000;
}

/** Total unpaid break minutes in a shift. */
export function unpaidBreakMinutes(shift: ShiftLike): number {
  return (shift.breaks ?? [])
    .filter((b) => !b.isPaid)
    .reduce((total, b) => total + b.durationMinutes, 0);
}

/**
 * Paid hours: elapsed time less unpaid breaks, never below zero.
 *
 * Clamping matters — a mis-entered 12-hour break on a 4-hour shift should
 * show as zero, not as negative hours that then subtract from a weekly total.
 */
export function paidHours(shift: ShiftLike): number {
  const hours = spanHours(shift) - unpaidBreakMinutes(shift) / 60;
  return Math.max(0, round2(hours));
}

/**
 * Estimated labour cost for a shift.
 *
 * @param hourlyRate AUD per hour, from employment_details
 * @returns an estimate in AUD, or null when no rate is known
 */
export function estimatedCost(
  shift: ShiftLike,
  hourlyRate: number | null | undefined,
): number | null {
  if (hourlyRate == null || Number.isNaN(hourlyRate)) return null;
  return round2(paidHours(shift) * hourlyRate);
}

/** Sum paid hours across many shifts. */
export function totalPaidHours(shifts: ShiftLike[]): number {
  return round2(shifts.reduce((sum, s) => sum + paidHours(s), 0));
}

/** Round to two decimals without floating-point drift in the last digit. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
