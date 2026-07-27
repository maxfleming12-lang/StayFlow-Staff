import { describe, expect, it } from "vitest";
import {
  inclusiveDays,
  leaveCategoryLabel,
  suggestedHours,
  weekdaysBetween,
} from "./hours";

describe("inclusiveDays", () => {
  it("counts a single day as one, not zero", () => {
    expect(inclusiveDays("2026-08-03", "2026-08-03")).toBe(1);
  });

  it("counts both ends of a range", () => {
    // Mon 3rd to Fri 7th is five days, not four.
    expect(inclusiveDays("2026-08-03", "2026-08-07")).toBe(5);
  });

  it("spans a month boundary", () => {
    expect(inclusiveDays("2026-08-30", "2026-09-02")).toBe(4);
  });
});

describe("weekdaysBetween", () => {
  it("excludes the weekend from a full week", () => {
    // Mon 3 Aug to Sun 9 Aug 2026: seven days, five weekdays.
    expect(weekdaysBetween("2026-08-03", "2026-08-09")).toBe(5);
  });

  it("returns zero for a weekend-only range", () => {
    expect(weekdaysBetween("2026-08-08", "2026-08-09")).toBe(0);
  });

  it("counts a single weekday as one", () => {
    expect(weekdaysBetween("2026-08-05", "2026-08-05")).toBe(1);
  });
});

describe("suggestedHours", () => {
  it("uses the time range for partial-day leave", () => {
    expect(
      suggestedHours({
        firstDate: "2026-08-05",
        lastDate: "2026-08-05",
        isPartialDay: true,
        startTime: "09:00",
        endTime: "13:30",
      }),
    ).toBe(4.5);
  });

  it("returns null for partial-day leave with no times, rather than zero", () => {
    // Zero would look like a deliberate "no hours" request.
    expect(
      suggestedHours({
        firstDate: "2026-08-05",
        lastDate: "2026-08-05",
        isPartialDay: true,
      }),
    ).toBeNull();
  });

  it("returns null when the times are inverted", () => {
    expect(
      suggestedHours({
        firstDate: "2026-08-05",
        lastDate: "2026-08-05",
        isPartialDay: true,
        startTime: "15:00",
        endTime: "09:00",
      }),
    ).toBeNull();
  });

  it("uses weekdays times a standard day for whole-day leave", () => {
    // Mon-Fri = 5 weekdays x 7.6 = 38 hours.
    expect(
      suggestedHours({
        firstDate: "2026-08-03",
        lastDate: "2026-08-07",
        isPartialDay: false,
      }),
    ).toBe(38);
  });

  it("honours a non-standard day length", () => {
    expect(
      suggestedHours({
        firstDate: "2026-08-03",
        lastDate: "2026-08-04",
        isPartialDay: false,
        standardDayHours: 4,
      }),
    ).toBe(8);
  });
});

describe("leaveCategoryLabel", () => {
  it("maps a stored value to its label", () => {
    expect(leaveCategoryLabel("long_service")).toBe("Long service leave");
  });

  it("falls back to the raw value for anything unknown", () => {
    expect(leaveCategoryLabel("mystery")).toBe("mystery");
  });
});
