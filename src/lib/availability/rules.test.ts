import { describe, expect, it } from "vitest";
import { describeRule, isExpired, sortRules, weekdayLabel } from "./rules";

describe("weekdayLabel", () => {
  it("maps Postgres/JS day numbers, where 0 is Sunday", () => {
    expect(weekdayLabel(0)).toBe("Sunday");
    expect(weekdayLabel(3)).toBe("Wednesday");
    expect(weekdayLabel(6)).toBe("Saturday");
  });

  it("does not pretend to know an out-of-range day", () => {
    expect(weekdayLabel(9)).toBe("Day 9");
  });
});

describe("describeRule", () => {
  it("describes a recurring all-day unavailability", () => {
    expect(
      describeRule({
        dayOfWeek: 3,
        specificDate: null,
        startTime: null,
        endTime: null,
        isAvailable: false,
      }),
    ).toBe("Unavailable every Wednesday (all day)");
  });

  it("describes a recurring time range", () => {
    expect(
      describeRule({
        dayOfWeek: 1,
        specificDate: null,
        startTime: "09:00:00",
        endTime: "13:00:00",
        isAvailable: true,
      }),
    ).toBe("Available every Monday, 09:00–13:00");
  });

  it("describes a date-specific rule without shifting the date", () => {
    // Constructed from parts, so this stays 12 August in any timezone.
    expect(
      describeRule({
        dayOfWeek: null,
        specificDate: "2026-08-12",
        startTime: null,
        endTime: null,
        isAvailable: false,
      }),
    ).toBe("Unavailable 12 Aug 2026 (all day)");
  });
});

describe("sortRules", () => {
  it("puts recurring days in week order above date-specific rules", () => {
    const sorted = sortRules([
      { dayOfWeek: null, specificDate: "2026-08-20" },
      { dayOfWeek: 5, specificDate: null },
      { dayOfWeek: null, specificDate: "2026-08-12" },
      { dayOfWeek: 1, specificDate: null },
    ]);
    expect(sorted.map((r) => r.dayOfWeek ?? r.specificDate)).toEqual([
      1,
      5,
      "2026-08-12",
      "2026-08-20",
    ]);
  });

  it("does not mutate the input", () => {
    const input = [{ dayOfWeek: 5, specificDate: null }, { dayOfWeek: 1, specificDate: null }];
    sortRules(input);
    expect(input[0].dayOfWeek).toBe(5);
  });
});

describe("isExpired", () => {
  it("treats a past date-specific rule as expired", () => {
    expect(isExpired({ specificDate: "2026-07-01" }, "2026-08-01")).toBe(true);
  });

  it("does not treat today as expired", () => {
    expect(isExpired({ specificDate: "2026-08-01" }, "2026-08-01")).toBe(false);
  });

  it("never expires a recurring rule", () => {
    expect(isExpired({ specificDate: null }, "2026-08-01")).toBe(false);
  });
});
