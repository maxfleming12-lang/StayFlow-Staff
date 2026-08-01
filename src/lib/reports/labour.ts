/**
 * Labour reporting: rostered against worked.
 *
 * Pure aggregation, kept apart from the queries so it can be tested. Every
 * figure here is an ESTIMATE for a human to check — the same caveat that
 * applies to timesheets applies with more force once numbers are summed and
 * put in a table, because a total looks more authoritative than the rows it
 * came from.
 */

export interface ReportShift {
  id: string;
  userId: string | null;
  propertyId: string;
  startsAt: string;
  endsAt: string;
  /** Planned unpaid break, in minutes. */
  unpaidBreakMinutes: number;
}

export interface ReportTimesheet {
  id: string;
  userId: string;
  propertyId: string;
  workDate: string;
  paidHours: number | null;
  isNoShow: boolean;
  actualStart: string | null;
  actualEnd: string | null;
}

export interface PersonLabour {
  userId: string;
  /** Hours the roster planned, after planned unpaid breaks. */
  rosteredHours: number;
  /** Hours the timesheets recorded as payable. */
  workedHours: number;
  /** Worked less rostered. Negative means short of the roster. */
  varianceHours: number;
  shiftCount: number;
  timesheetCount: number;
  noShows: number;
  /** Clocked on and never off — the figure cannot be trusted. */
  missingClockOuts: number;
}

export interface LabourReport {
  people: PersonLabour[];
  totals: {
    rosteredHours: number;
    workedHours: number;
    varianceHours: number;
    shiftCount: number;
    noShows: number;
    missingClockOuts: number;
    /** Published shifts in the period with nobody on them. */
    unfilledShifts: number;
  };
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Hours a single shift was rostered for, after its planned unpaid break. */
export function rosteredHoursOf(shift: ReportShift): number {
  const ms = Date.parse(shift.endsAt) - Date.parse(shift.startsAt);
  if (!Number.isFinite(ms)) return 0;
  const hours = ms / 3_600_000 - shift.unpaidBreakMinutes / 60;
  // A break longer than the shift is bad data, not negative work.
  return Math.max(0, round2(hours));
}

/**
 * Build the report.
 *
 * Rostered and worked are counted from DIFFERENT sources on purpose — the
 * roster says what was planned, the timesheets say what was recorded — so a
 * person can appear with one and not the other. Somebody who picked up an
 * unrostered shift has worked hours and no rostered ones; somebody who never
 * turned up has the reverse. Both are exactly what a manager needs to see,
 * so neither side is dropped for want of a match on the other.
 */
export function buildLabourReport(
  shifts: ReportShift[],
  timesheets: ReportTimesheet[],
): LabourReport {
  const byPerson = new Map<string, PersonLabour>();

  const blank = (userId: string): PersonLabour => ({
    userId,
    rosteredHours: 0,
    workedHours: 0,
    varianceHours: 0,
    shiftCount: 0,
    timesheetCount: 0,
    noShows: 0,
    missingClockOuts: 0,
  });

  const person = (userId: string): PersonLabour => {
    const existing = byPerson.get(userId);
    if (existing) return existing;
    const created = blank(userId);
    byPerson.set(userId, created);
    return created;
  };

  let unfilledShifts = 0;

  for (const shift of shifts) {
    if (!shift.userId) {
      // Nobody held it, so it belongs to no one's row — but a period full of
      // unfilled shifts is the most useful thing on the page.
      unfilledShifts += 1;
      continue;
    }
    const row = person(shift.userId);
    row.rosteredHours = round2(row.rosteredHours + rosteredHoursOf(shift));
    row.shiftCount += 1;
  }

  for (const sheet of timesheets) {
    const row = person(sheet.userId);
    row.workedHours = round2(row.workedHours + (sheet.paidHours ?? 0));
    row.timesheetCount += 1;
    if (sheet.isNoShow) row.noShows += 1;
    // Started and never finished. The hours are a running total at best, so
    // the figure beside it should not be read as a day's work.
    if (sheet.actualStart && !sheet.actualEnd) row.missingClockOuts += 1;
  }

  const people = [...byPerson.values()].map((row) => ({
    ...row,
    varianceHours: round2(row.workedHours - row.rosteredHours),
  }));

  // Worst variance first: the rows a manager needs are the ones furthest
  // from plan, in either direction.
  people.sort(
    (a, b) => Math.abs(b.varianceHours) - Math.abs(a.varianceHours),
  );

  const totals = people.reduce(
    (sum, row) => ({
      rosteredHours: round2(sum.rosteredHours + row.rosteredHours),
      workedHours: round2(sum.workedHours + row.workedHours),
      varianceHours: 0,
      shiftCount: sum.shiftCount + row.shiftCount,
      noShows: sum.noShows + row.noShows,
      missingClockOuts: sum.missingClockOuts + row.missingClockOuts,
      unfilledShifts,
    }),
    {
      rosteredHours: 0,
      workedHours: 0,
      varianceHours: 0,
      shiftCount: 0,
      noShows: 0,
      missingClockOuts: 0,
      unfilledShifts,
    },
  );

  // Summed from the totals, not from the rounded per-person variances, so
  // the bottom line matches rostered and worked as displayed.
  totals.varianceHours = round2(totals.workedHours - totals.rosteredHours);

  return { people, totals };
}

/** Anything on a row a manager should look at rather than scroll past. */
export function needsAttention(row: PersonLabour): boolean {
  return (
    row.noShows > 0 ||
    row.missingClockOuts > 0 ||
    Math.abs(row.varianceHours) >= 2
  );
}
