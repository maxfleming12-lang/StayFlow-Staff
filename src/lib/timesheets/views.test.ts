import { describe, expect, it } from "vitest";
import {
  TIMESHEET_VIEWS,
  TIMESHEET_VIEW_LIMIT,
  isTimesheetView,
  type TimesheetView,
} from "./views";
import { TIMESHEET_STATUS_LABEL } from "./generate";

const ALL_VIEWS = Object.keys(TIMESHEET_VIEWS) as TimesheetView[];
const EVERY_STATUS = Object.keys(TIMESHEET_STATUS_LABEL);

describe("TIMESHEET_VIEWS", () => {
  it("covers every status the database can hold", () => {
    // A status in no view is a timesheet nobody can ever see again. That is
    // what happened to `exported` before these views existed.
    const covered = new Set(ALL_VIEWS.flatMap((v) => [...TIMESHEET_VIEWS[v].statuses]));
    for (const status of EVERY_STATUS) {
      expect(covered.has(status as never), `${status} is in no view`).toBe(true);
    }
  });

  it("puts each status in exactly one view", () => {
    // Overlap would show the same timesheet in two places and let it be
    // approved from a view that is meant to be read-only.
    const seen = new Map<string, TimesheetView>();
    for (const view of ALL_VIEWS) {
      for (const status of TIMESHEET_VIEWS[view].statuses) {
        expect(
          seen.has(status),
          `${status} appears in both ${seen.get(status)} and ${view}`,
        ).toBe(false);
        seen.set(status, view);
      }
    }
  });

  it("keeps sent-to-payroll statuses out of the actionable views", () => {
    const actionable = [
      ...TIMESHEET_VIEWS.open.statuses,
      ...TIMESHEET_VIEWS.approved.statuses,
    ] as string[];
    expect(actionable).not.toContain("exported");
    expect(actionable).not.toContain("locked");
  });

  it("treats a correction request as still needing a decision", () => {
    expect([...TIMESHEET_VIEWS.open.statuses]).toContain(
      "staff_review_requested",
    );
  });

  it("gives every view a label", () => {
    for (const view of ALL_VIEWS) {
      expect(TIMESHEET_VIEWS[view].label.length).toBeGreaterThan(0);
    }
  });
});

describe("isTimesheetView", () => {
  it("accepts the real views", () => {
    for (const view of ALL_VIEWS) expect(isTimesheetView(view)).toBe(true);
  });

  it("rejects anything else from a search param", () => {
    for (const value of [
      "",
      "approved'; drop table timesheets;--",
      "constructor",
      "__proto__",
      "toString",
      undefined,
      null,
      42,
    ]) {
      expect(isTimesheetView(value)).toBe(false);
    }
  });
});

describe("TIMESHEET_VIEW_LIMIT", () => {
  it("is large enough for a fortnight at both motels", () => {
    // Roughly 15 staff over 14 days, so a normal period is never truncated.
    expect(TIMESHEET_VIEW_LIMIT).toBeGreaterThanOrEqual(210);
  });
});
