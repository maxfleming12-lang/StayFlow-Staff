import { summariseWorkedTime, type ClockEvent } from "@/lib/clock/state";

/**
 * Turning a day's clock events into a timesheet.
 *
 * The timesheet is DERIVED from clock_events, which are append-only. That
 * means a timesheet can always be recomputed and compared against the
 * original record — a corrected timesheet never destroys the evidence it
 * was corrected from.
 *
 * Everything here is an estimate for payroll to check, never an award
 * interpretation.
 */

export interface RosteredWindow {
  startsAt: string;
  endsAt: string;
  /** Unpaid break minutes planned on the shift. */
  unpaidBreakMinutes: number;
}

export interface GeneratedTimesheet {
  actualStart: string | null;
  actualEnd: string | null;
  breakMinutes: number;
  paidHours: number;
  /** Actual paid hours less rostered paid hours. Negative means short. */
  varianceHours: number | null;
  isNoShow: boolean;
  /** Anything a manager should look at before approving. */
  anomalies: string[];
}

/** Hours a shift was rostered for, after planned unpaid breaks. */
export function rosteredHours(window: RosteredWindow): number {
  const ms =
    new Date(window.endsAt).getTime() - new Date(window.startsAt).getTime();
  const hours = ms / 3_600_000 - window.unpaidBreakMinutes / 60;
  return Math.max(0, round2(hours));
}

/**
 * Build the timesheet figures for one day.
 *
 * `rostered` is optional: an unrostered shift someone picked up still
 * produces a timesheet, it simply has no variance to report.
 */
export function generateTimesheet(
  events: ClockEvent[],
  rostered?: RosteredWindow | null,
  now: Date = new Date(),
): GeneratedTimesheet {
  const ordered = [...events].sort((a, b) =>
    a.serverTime.localeCompare(b.serverTime),
  );

  const first = ordered.find((e) => e.eventType === "clock_in") ?? null;
  // The LAST clock_out, not the first: someone who clocked out, was called
  // back and clocked out again finished at the later time.
  const last =
    [...ordered].reverse().find((e) => e.eventType === "clock_out") ?? null;

  const summary = summariseWorkedTime(ordered, now);
  const paidHours = round2(summary.workedMinutes / 60);

  const anomalies = [...summary.anomalies];

  // A session still open when the timesheet is built means somebody forgot
  // to clock out. The figure is a running total, not a day's work.
  if (summary.inProgress) {
    anomalies.push(
      "Still clocked in. The hours below are a running total until they clock out.",
    );
  }

  const noShow = ordered.length === 0 && Boolean(rostered);
  if (noShow) {
    anomalies.push("Rostered but never clocked in.");
  }

  let varianceHours: number | null = null;
  if (rostered) {
    varianceHours = round2(paidHours - rosteredHours(rostered));
    // Half an hour either way is ordinary; flag anything larger so a
    // manager sees it without having to compare columns.
    if (Math.abs(varianceHours) >= 0.5) {
      anomalies.push(
        varianceHours > 0
          ? `Worked ${varianceHours.toFixed(2)} h more than rostered.`
          : `Worked ${Math.abs(varianceHours).toFixed(2)} h less than rostered.`,
      );
    }
  }

  return {
    actualStart: first?.serverTime ?? null,
    actualEnd: last?.serverTime ?? null,
    breakMinutes: summary.breakMinutes,
    paidHours,
    varianceHours,
    isNoShow: noShow,
    anomalies,
  };
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Statuses a staff member may still act on. */
export const STAFF_ACTIONABLE = new Set(["draft", "submitted"]);

/** Statuses a manager may still change. */
export const MANAGER_ACTIONABLE = new Set([
  "draft",
  "submitted",
  "manager_review",
  "staff_review_requested",
]);

export const TIMESHEET_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  staff_review_requested: "Correction requested",
  submitted: "Submitted",
  manager_review: "Being reviewed",
  approved: "Approved",
  exported: "Sent to payroll",
  locked: "Locked",
};
