import { spanHours } from "./hours";

/**
 * Roster conflict detection.
 *
 * These produce WARNINGS, not blocks. A motel roster legitimately breaks its
 * own patterns — someone covers a sick colleague, a manager works a double
 * during a conference. The rule is that an authorised manager may proceed
 * with a recorded reason, so this module's job is to surface the issue
 * clearly, never to refuse.
 *
 * Nothing here is an award-compliance determination.
 */

export type ConflictKind =
  | "overlap"
  | "approved_leave"
  | "unavailable"
  | "minimum_rest"
  | "cross_property_turnaround";

export type ConflictSeverity = "warning" | "advisory";

export interface Conflict {
  kind: ConflictKind;
  severity: ConflictSeverity;
  /** Plain-English message shown to the manager, in Australian English. */
  message: string;
  /** Other shift involved, when the conflict is between two shifts. */
  relatedShiftId?: string;
}

/** A shift as the conflict engine needs to see it. */
export interface CandidateShift {
  id?: string;
  userId: string | null;
  propertyId: string;
  propertyName?: string;
  startsAt: Date | string;
  endsAt: Date | string;
}

/** An approved leave period. */
export interface LeavePeriod {
  firstDate: string;
  lastDate: string;
  isPartialDay: boolean;
  startTime?: string | null;
  endTime?: string | null;
}

/** An availability rule the staff member has submitted. */
export interface AvailabilityRule {
  /** 0 = Sunday … 6 = Saturday. Null for a date-specific rule. */
  dayOfWeek: number | null;
  /** ISO date for a date-specific rule. Null for a recurring rule. */
  specificDate: string | null;
  startTime: string | null;
  endTime: string | null;
  /** false marks an UNAVAILABLE period. */
  isAvailable: boolean;
}

export interface ConflictContext {
  /** Other shifts already rostered for this person. */
  existingShifts: CandidateShift[];
  approvedLeave: LeavePeriod[];
  availability: AvailabilityRule[];
  /** From organisation_settings.minimum_rest_hours. */
  minimumRestHours: number;
  /**
   * Hours below which moving between properties is flagged. Both motels are
   * in Narooma, so this is about a humane turnaround rather than travel.
   */
  crossPropertyMinimumHours?: number;
  /** Timezone for interpreting local dates and times. */
  timeZone?: string;
}

function toDate(v: Date | string): Date {
  return typeof v === "string" ? new Date(v) : v;
}

/** Two periods overlap when each starts before the other ends. */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Format an instant as a short local time for a message. */
function shortTime(d: Date, timeZone = "Australia/Sydney"): string {
  return new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  })
    .format(d)
    .replace(/\s/g, "")
    .toLowerCase();
}

/** Format an instant as a short local date for a message. */
function shortDate(d: Date, timeZone = "Australia/Sydney"): string {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    timeZone,
  }).format(d);
}

/** The local calendar date (yyyy-mm-dd) of an instant in a timezone. */
function localDateKey(d: Date, timeZone = "Australia/Sydney"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(d);
  return parts;
}

/** The local day of week (0 = Sunday) of an instant in a timezone. */
function localDayOfWeek(d: Date, timeZone = "Australia/Sydney"): number {
  const name = new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    timeZone,
  }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    name.slice(0, 3),
  );
}

/**
 * Find every conflict for a proposed shift.
 *
 * Returns an empty array when the shift is unassigned — an open shift cannot
 * clash with one person's leave or availability until somebody holds it.
 */
export function findConflicts(
  shift: CandidateShift,
  context: ConflictContext,
): Conflict[] {
  if (!shift.userId) return [];

  const tz = context.timeZone ?? "Australia/Sydney";
  const start = toDate(shift.startsAt);
  const end = toDate(shift.endsAt);
  const conflicts: Conflict[] = [];

  const others = context.existingShifts.filter(
    (s) => s.userId === shift.userId && s.id !== shift.id,
  );

  // --- Overlapping shifts -------------------------------------------
  for (const other of others) {
    const oStart = toDate(other.startsAt);
    const oEnd = toDate(other.endsAt);

    if (overlaps(start, end, oStart, oEnd)) {
      conflicts.push({
        kind: "overlap",
        severity: "warning",
        relatedShiftId: other.id,
        message: `Overlaps an existing shift on ${shortDate(oStart, tz)} (${shortTime(oStart, tz)}–${shortTime(oEnd, tz)}).`,
      });
      // An overlap already fails rest and turnaround; reporting all three
      // for the same pair is noise.
      continue;
    }

    // --- Minimum rest between shifts --------------------------------
    const gapHours =
      oStart >= end
        ? (oStart.getTime() - end.getTime()) / 3_600_000
        : (start.getTime() - oEnd.getTime()) / 3_600_000;

    if (gapHours >= 0 && gapHours < context.minimumRestHours) {
      conflicts.push({
        kind: "minimum_rest",
        severity: "warning",
        relatedShiftId: other.id,
        message: `Only ${formatHours(gapHours)} between this shift and the one on ${shortDate(oStart, tz)}. The organisation's minimum rest is ${formatHours(context.minimumRestHours)}.`,
      });
      continue;
    }

    // --- Cross-property turnaround ----------------------------------
    const crossMin = context.crossPropertyMinimumHours;
    if (
      crossMin != null &&
      other.propertyId !== shift.propertyId &&
      gapHours >= 0 &&
      gapHours < crossMin
    ) {
      conflicts.push({
        kind: "cross_property_turnaround",
        severity: "advisory",
        relatedShiftId: other.id,
        message: `Rostered at ${other.propertyName ?? "another property"} only ${formatHours(gapHours)} ${oStart >= end ? "after" : "before"} this shift.`,
      });
    }
  }

  // --- Approved leave ------------------------------------------------
  for (const leave of context.approvedLeave) {
    if (leaveCoversShift(leave, start, end, tz)) {
      conflicts.push({
        kind: "approved_leave",
        severity: "warning",
        message: leave.isPartialDay
          ? `Conflicts with approved partial-day leave on ${leave.firstDate}.`
          : `Conflicts with approved leave from ${leave.firstDate} to ${leave.lastDate}.`,
      });
      break;
    }
  }

  // --- Submitted unavailability --------------------------------------
  if (isUnavailable(context.availability, start, end, tz)) {
    conflicts.push({
      kind: "unavailable",
      severity: "advisory",
      message: "The staff member has marked this time as unavailable.",
    });
  }

  return conflicts;
}

/** Does an approved leave period cover any part of this shift? */
function leaveCoversShift(
  leave: LeavePeriod,
  start: Date,
  end: Date,
  tz: string,
): boolean {
  const shiftDates = new Set<string>([
    localDateKey(start, tz),
    localDateKey(end, tz),
  ]);

  const within = [...shiftDates].some(
    (d) => d >= leave.firstDate && d <= leave.lastDate,
  );
  if (!within) return false;

  // A full-day leave covers anything on those dates.
  if (!leave.isPartialDay || !leave.startTime || !leave.endTime) return true;

  // Partial-day leave only clashes if the hours actually intersect.
  const day = [...shiftDates].find(
    (d) => d >= leave.firstDate && d <= leave.lastDate,
  )!;
  const leaveStart = new Date(`${day}T${leave.startTime}`);
  const leaveEnd = new Date(`${day}T${leave.endTime}`);
  return overlaps(start, end, leaveStart, leaveEnd);
}

/** Has the staff member marked this period unavailable? */
function isUnavailable(
  rules: AvailabilityRule[],
  start: Date,
  end: Date,
  tz: string,
): boolean {
  const dateKey = localDateKey(start, tz);
  const dow = localDayOfWeek(start, tz);

  // A date-specific rule overrides the recurring pattern for that date.
  const dated = rules.filter((r) => r.specificDate === dateKey);
  const applicable = dated.length > 0 ? dated : rules.filter((r) => r.dayOfWeek === dow);

  return applicable.some((rule) => {
    if (rule.isAvailable) return false;
    // No times means the whole day is unavailable.
    if (!rule.startTime || !rule.endTime) return true;
    const from = new Date(`${dateKey}T${rule.startTime}`);
    const to = new Date(`${dateKey}T${rule.endTime}`);
    return overlaps(start, end, from, to);
  });
}

/** "9 hours", "8.5 hours", "45 minutes". */
function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} minutes`;
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded} hour${rounded === 1 ? "" : "s"}`;
}

/**
 * True when at least one conflict is severe enough that publishing should
 * require an explicit recorded override reason.
 */
export function requiresOverride(conflicts: Conflict[]): boolean {
  return conflicts.some((c) => c.severity === "warning");
}

/** Re-exported for callers building a weekly summary. */
export { spanHours };
