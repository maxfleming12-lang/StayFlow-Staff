import { describe, expect, it } from "vitest";
import {
  buildLabourReport,
  needsAttention,
  rosteredHoursOf,
  type ReportShift,
  type ReportTimesheet,
} from "./labour";

const AROHA = "user-aroha";
const DEBBIE = "user-debbie";
const PROPERTY = "prop-coastal";

const shift = (over: Partial<ReportShift> = {}): ReportShift => ({
  id: "s1",
  userId: AROHA,
  propertyId: PROPERTY,
  // 9am to 5pm Sydney in July.
  startsAt: "2026-07-27T23:00:00.000Z",
  endsAt: "2026-07-28T07:00:00.000Z",
  unpaidBreakMinutes: 30,
  ...over,
});

const sheet = (over: Partial<ReportTimesheet> = {}): ReportTimesheet => ({
  id: "t1",
  userId: AROHA,
  propertyId: PROPERTY,
  workDate: "2026-07-28",
  paidHours: 7.5,
  isNoShow: false,
  actualStart: "2026-07-27T23:00:00.000Z",
  actualEnd: "2026-07-28T07:00:00.000Z",
  ...over,
});

const rowFor = (report: ReturnType<typeof buildLabourReport>, userId: string) =>
  report.people.find((p) => p.userId === userId)!;

describe("rosteredHoursOf", () => {
  it("subtracts the planned unpaid break", () => {
    // Eight hours on the clock face, less thirty unpaid minutes.
    expect(rosteredHoursOf(shift())).toBe(7.5);
    expect(rosteredHoursOf(shift({ unpaidBreakMinutes: 0 }))).toBe(8);
  });

  it("measures across a daylight-saving change in real hours", () => {
    // 10pm to 6am over Sydney's spring-forward is seven hours, not eight.
    expect(
      rosteredHoursOf(
        shift({
          startsAt: "2026-10-03T11:00:00.000Z",
          endsAt: "2026-10-03T19:00:00.000Z",
          unpaidBreakMinutes: 0,
        }),
      ),
    ).toBe(8);
  });

  it("never returns negative hours from a nonsense break", () => {
    expect(rosteredHoursOf(shift({ unpaidBreakMinutes: 600 }))).toBe(0);
  });
});

describe("buildLabourReport", () => {
  it("reports rostered, worked and the variance between them", () => {
    const report = buildLabourReport([shift()], [sheet({ paidHours: 8.25 })]);
    const row = rowFor(report, AROHA);

    expect(row.rosteredHours).toBe(7.5);
    expect(row.workedHours).toBe(8.25);
    expect(row.varianceHours).toBe(0.75);
  });

  it("keeps somebody who worked an UNROSTERED shift", () => {
    const report = buildLabourReport([], [sheet({ userId: DEBBIE })]);
    const row = rowFor(report, DEBBIE);

    // Picking up cover that was never rostered is exactly what a manager
    // needs to see, so the row must not be dropped for want of a shift.
    expect(row.rosteredHours).toBe(0);
    expect(row.workedHours).toBe(7.5);
    expect(row.varianceHours).toBe(7.5);
  });

  it("keeps somebody who was rostered and recorded nothing", () => {
    const report = buildLabourReport([shift({ userId: DEBBIE })], []);
    const row = rowFor(report, DEBBIE);

    expect(row.rosteredHours).toBe(7.5);
    expect(row.workedHours).toBe(0);
    expect(row.varianceHours).toBe(-7.5);
  });

  it("counts unfilled shifts without attributing them to anybody", () => {
    const report = buildLabourReport(
      [shift(), shift({ id: "s2", userId: null })],
      [],
    );

    expect(report.totals.unfilledShifts).toBe(1);
    // One row, for the person who actually holds a shift.
    expect(report.people).toHaveLength(1);
    expect(report.totals.shiftCount).toBe(1);
  });

  it("counts no-shows and missing clock-outs", () => {
    const report = buildLabourReport(
      [shift(), shift({ id: "s2" })],
      [
        sheet({ isNoShow: true, paidHours: 0 }),
        sheet({ id: "t2", actualEnd: null, paidHours: 3 }),
      ],
    );
    const row = rowFor(report, AROHA);

    expect(row.noShows).toBe(1);
    // Clocked on and never off: the hours beside it are a running total.
    expect(row.missingClockOuts).toBe(1);
  });

  it("treats an unrecorded figure as nothing worked, not as a gap", () => {
    const report = buildLabourReport([shift()], [sheet({ paidHours: null })]);
    expect(rowFor(report, AROHA).workedHours).toBe(0);
  });

  it("totals match the rows as displayed", () => {
    const report = buildLabourReport(
      [shift(), shift({ id: "s2", userId: DEBBIE })],
      [sheet({ paidHours: 8 }), sheet({ id: "t2", userId: DEBBIE, paidHours: 6 })],
    );

    expect(report.totals.rosteredHours).toBe(15);
    expect(report.totals.workedHours).toBe(14);
    // Summed from the totals rather than the rounded per-person variances,
    // so the bottom line agrees with the two columns above it.
    expect(report.totals.varianceHours).toBe(-1);
    expect(report.totals.shiftCount).toBe(2);
  });

  it("puts the furthest from plan at the top, in either direction", () => {
    const report = buildLabourReport(
      [shift(), shift({ id: "s2", userId: DEBBIE })],
      [
        sheet({ paidHours: 7.5 }), // exactly to plan
        sheet({ id: "t2", userId: DEBBIE, paidHours: 1 }), // well short
      ],
    );

    expect(report.people[0].userId).toBe(DEBBIE);
  });

  it("handles a period with nothing in it", () => {
    const report = buildLabourReport([], []);

    expect(report.people).toEqual([]);
    expect(report.totals.rosteredHours).toBe(0);
    expect(report.totals.varianceHours).toBe(0);
    expect(report.totals.unfilledShifts).toBe(0);
  });

  it("adds up several shifts and sheets for one person", () => {
    const report = buildLabourReport(
      [shift(), shift({ id: "s2" }), shift({ id: "s3" })],
      [sheet(), sheet({ id: "t2" })],
    );
    const row = rowFor(report, AROHA);

    expect(row.shiftCount).toBe(3);
    expect(row.timesheetCount).toBe(2);
    expect(row.rosteredHours).toBe(22.5);
    expect(row.workedHours).toBe(15);
  });
});

describe("needsAttention", () => {
  const row = (over: Record<string, number> = {}) => ({
    userId: AROHA,
    rosteredHours: 8,
    workedHours: 8,
    varianceHours: 0,
    shiftCount: 1,
    timesheetCount: 1,
    noShows: 0,
    missingClockOuts: 0,
    ...over,
  });

  it("ignores a row that matches the roster", () => {
    expect(needsAttention(row())).toBe(false);
  });

  it("flags a no-show", () => {
    expect(needsAttention(row({ noShows: 1 }))).toBe(true);
  });

  it("flags a missing clock-out", () => {
    expect(needsAttention(row({ missingClockOuts: 1 }))).toBe(true);
  });

  it("flags a large variance either way", () => {
    expect(needsAttention(row({ varianceHours: 2.5 }))).toBe(true);
    expect(needsAttention(row({ varianceHours: -2.5 }))).toBe(true);
  });

  it("does not flag ordinary drift", () => {
    // A shift running twenty minutes over is normal and should not shout.
    expect(needsAttention(row({ varianceHours: 0.33 }))).toBe(false);
  });
});
