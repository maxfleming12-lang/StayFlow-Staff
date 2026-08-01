import type { Database } from "@/types/database";

/**
 * The views a manager can switch between on the timesheet screen.
 *
 * "Sent to payroll" exists because marking a period as sent moves those rows
 * out of every other view. Without somewhere for them to go, a manager could
 * not confirm what had been sent, and an administrator had no way to find a
 * period to reopen except by guessing dates.
 *
 * Kept apart from `queries.ts` so it can be tested without pulling in the
 * Supabase server client.
 */

type TimesheetStatus = Database["public"]["Enums"]["timesheet_status"];

export const TIMESHEET_VIEWS = {
  open: {
    label: "Awaiting decision",
    statuses: [
      "draft",
      "submitted",
      "manager_review",
      "staff_review_requested",
    ],
  },
  approved: { label: "Approved", statuses: ["approved"] },
  sent: { label: "Sent to payroll", statuses: ["exported", "locked"] },
} as const satisfies Record<
  string,
  { label: string; statuses: readonly TimesheetStatus[] }
>;

export type TimesheetView = keyof typeof TIMESHEET_VIEWS;

/**
 * Whether an arbitrary string names a view, for reading a search param.
 *
 * `Object.hasOwn`, not `in`: `"constructor" in TIMESHEET_VIEWS` and
 * `"__proto__" in TIMESHEET_VIEWS` are both true through the prototype
 * chain, so `in` would accept those as view names straight from the query
 * string and then index the object with them.
 */
export function isTimesheetView(value: unknown): value is TimesheetView {
  return typeof value === "string" && Object.hasOwn(TIMESHEET_VIEWS, value);
}

/**
 * How many rows a view will show before it stops.
 *
 * Exported so the screen can say when it has hit the ceiling. A silently
 * truncated list of hours reads as "that is all of them", which on a payroll
 * screen is the kind of quiet wrong answer worth avoiding.
 */
export const TIMESHEET_VIEW_LIMIT = 300;
