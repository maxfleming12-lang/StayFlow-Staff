import { describe, expect, it } from "vitest";
import {
  formatDayHeading,
  formatWeekLabel,
  localDateTimeToIso,
  parseIsoDate,
  shiftWeek,
  weekDates,
  weekRange,
  weekStart,
} from "./week";

describe("localDateTimeToIso", () => {
  it("treats a winter datetime-local value as Sydney wall-clock time", () => {
    expect(localDateTimeToIso("2026-07-28T09:00")).toBe(
      "2026-07-27T23:00:00.000Z",
    );
  });

  it("uses Sydney daylight-saving time in summer", () => {
    expect(localDateTimeToIso("2026-01-20T09:00")).toBe(
      "2026-01-19T22:00:00.000Z",
    );
  });

  it("ignores the host clock", () => {
    // The whole point of the helper. This assertion only bites when the test
    // runner's TZ differs from the property timezone, which is why vitest
    // pins TZ=UTC — on a Sydney laptop a broken conversion still looks right.
    expect(localDateTimeToIso("2026-07-28T09:00", "Australia/Sydney")).toBe(
      localDateTimeToIso("2026-07-27T23:00", "UTC"),
    );
  });

  it("accepts optional seconds", () => {
    expect(localDateTimeToIso("2026-07-28T09:00:30")).toBe(
      "2026-07-27T23:00:30.000Z",
    );
  });

  it("rejects a value it cannot read rather than returning Invalid Date", () => {
    expect(() => localDateTimeToIso("28/07/2026 9am")).toThrow(RangeError);
  });
});

describe("weekStart", () => {
  it("returns the Monday of the containing week", () => {
    // 2026-08-05 is a Wednesday.
    expect(weekStart("2026-08-05")).toBe("2026-08-03");
  });

  it("treats Monday as the start of its own week", () => {
    expect(weekStart("2026-08-03")).toBe("2026-08-03");
  });

  it("keeps Sunday in the week that began the previous Monday", () => {
    // Sunday must not roll forward — an Australian roster week ends on it.
    expect(weekStart("2026-08-09")).toBe("2026-08-03");
  });
});

describe("shiftWeek", () => {
  it("moves forward and back by whole weeks", () => {
    expect(shiftWeek("2026-08-03", 1)).toBe("2026-08-10");
    expect(shiftWeek("2026-08-03", -1)).toBe("2026-07-27");
  });

  it("crosses a month boundary correctly", () => {
    expect(shiftWeek("2026-08-31", 1)).toBe("2026-09-07");
  });

  it("crosses a year boundary correctly", () => {
    expect(shiftWeek("2026-12-28", 1)).toBe("2027-01-04");
  });
});

describe("weekDates", () => {
  it("returns seven consecutive dates starting on the Monday", () => {
    expect(weekDates("2026-08-03")).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ]);
  });
});

describe("weekRange", () => {
  it("spans exactly seven days", () => {
    const { fromIso, toIso } = weekRange("2026-08-03");
    const hours =
      (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 3_600_000;
    expect(hours).toBe(168);
  });

  it("starts at local midnight in the property timezone", () => {
    const { fromIso } = weekRange("2026-08-03", "Australia/Sydney");
    // August is AEST (+10:00), so local midnight is 14:00 UTC the day before.
    expect(fromIso).toBe("2026-08-02T14:00:00.000Z");
  });

  it("absorbs the daylight-saving change within the week", () => {
    // Sydney springs forward on 2026-10-04, so that roster week is 167 hours.
    const { fromIso, toIso } = weekRange("2026-09-28", "Australia/Sydney");
    const hours =
      (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 3_600_000;
    expect(hours).toBe(167);
  });
});

describe("formatWeekLabel", () => {
  it("collapses a shared month", () => {
    expect(formatWeekLabel("2026-08-03")).toBe("3–9 August 2026");
  });

  it("spells out both months when the week straddles them", () => {
    expect(formatWeekLabel("2026-08-31")).toBe("31 Aug – 6 Sep 2026");
  });

  it("includes both years across a new year", () => {
    expect(formatWeekLabel("2026-12-28")).toBe("28 Dec 2026 – 3 Jan 2027");
  });
});

describe("formatDayHeading", () => {
  it("shows weekday and day of month", () => {
    expect(formatDayHeading("2026-08-03")).toBe("Mon 3");
    expect(formatDayHeading("2026-08-09")).toBe("Sun 9");
  });
});

describe("parseIsoDate", () => {
  it("keeps the calendar date rather than shifting by UTC offset", () => {
    const d = parseIsoDate("2026-08-03");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7); // August
    expect(d.getDate()).toBe(3);
  });
});
