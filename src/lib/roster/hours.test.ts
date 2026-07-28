import { describe, expect, it } from "vitest";
import {
  estimatedCost,
  hospitalityCasualEstimatedCost,
  paidHours,
  spanHours,
  totalPaidHours,
  unpaidBreakMinutes,
} from "./hours";

/** Build an instant from a Sydney local time. */
const syd = (iso: string) => new Date(iso);

describe("spanHours", () => {
  it("measures a simple day shift", () => {
    expect(
      spanHours({
        startsAt: syd("2026-08-03T09:00:00+10:00"),
        endsAt: syd("2026-08-03T17:00:00+10:00"),
      }),
    ).toBe(8);
  });

  it("handles an overnight shift crossing midnight", () => {
    expect(
      spanHours({
        startsAt: syd("2026-08-03T22:00:00+10:00"),
        endsAt: syd("2026-08-04T06:00:00+10:00"),
      }),
    ).toBe(8);
  });

  it("counts the extra hour when daylight saving ends in April", () => {
    // 2026-04-05: Sydney clocks go back at 03:00, so 22:00 to 06:00 is
    // nine real hours, not eight. Offsets change +11:00 -> +10:00.
    expect(
      spanHours({
        startsAt: syd("2026-04-04T22:00:00+11:00"),
        endsAt: syd("2026-04-05T06:00:00+10:00"),
      }),
    ).toBe(9);
  });

  it("counts the lost hour when daylight saving starts in October", () => {
    // 2026-10-04: clocks go forward at 02:00, so the same wall-clock span
    // is seven real hours.
    expect(
      spanHours({
        startsAt: syd("2026-10-03T22:00:00+10:00"),
        endsAt: syd("2026-10-04T06:00:00+11:00"),
      }),
    ).toBe(7);
  });
});

describe("breaks", () => {
  const shift = {
    startsAt: syd("2026-08-03T09:00:00+10:00"),
    endsAt: syd("2026-08-03T17:00:00+10:00"),
    breaks: [
      { durationMinutes: 30, isPaid: false },
      { durationMinutes: 15, isPaid: true },
    ],
  };

  it("counts only unpaid breaks", () => {
    expect(unpaidBreakMinutes(shift)).toBe(30);
  });

  it("deducts unpaid breaks from paid hours but keeps paid ones", () => {
    expect(paidHours(shift)).toBe(7.5);
  });

  it("treats a shift with no breaks as fully paid", () => {
    expect(
      paidHours({
        startsAt: syd("2026-08-03T09:00:00+10:00"),
        endsAt: syd("2026-08-03T13:00:00+10:00"),
      }),
    ).toBe(4);
  });

  it("never returns negative hours when a break is mis-entered", () => {
    // A 12-hour break typed onto a 4-hour shift must not produce hours that
    // subtract from the weekly total.
    expect(
      paidHours({
        startsAt: syd("2026-08-03T09:00:00+10:00"),
        endsAt: syd("2026-08-03T13:00:00+10:00"),
        breaks: [{ durationMinutes: 720, isPaid: false }],
      }),
    ).toBe(0);
  });
});

describe("estimatedCost", () => {
  const shift = {
    startsAt: syd("2026-08-03T09:00:00+10:00"),
    endsAt: syd("2026-08-03T17:00:00+10:00"),
    breaks: [{ durationMinutes: 30, isPaid: false }],
  };

  it("multiplies paid hours by the rate", () => {
    expect(estimatedCost(shift, 31.8)).toBe(238.5);
  });

  it("returns null when no rate is known, rather than assuming zero", () => {
    // Zero would silently understate a labour total; null forces the caller
    // to show "unknown".
    expect(estimatedCost(shift, null)).toBeNull();
    expect(estimatedCost(shift, undefined)).toBeNull();
  });
});

describe("hospitalityCasualEstimatedCost", () => {
  it("uses the base casual rate Monday to Friday", () => {
    expect(
      hospitalityCasualEstimatedCost(
        {
          startsAt: syd("2026-08-07T09:00:00+10:00"),
          endsAt: syd("2026-08-07T11:00:00+10:00"),
        },
        33.05,
      ),
    ).toBe(66.1);
  });

  it("applies the Hospitality Award casual Saturday and Sunday rates", () => {
    const saturday = {
      startsAt: syd("2026-08-08T09:00:00+10:00"),
      endsAt: syd("2026-08-08T11:00:00+10:00"),
    };
    const sunday = {
      startsAt: syd("2026-08-09T09:00:00+10:00"),
      endsAt: syd("2026-08-09T11:00:00+10:00"),
    };

    expect(hospitalityCasualEstimatedCost(saturday, 33.05)).toBe(79.32);
    expect(hospitalityCasualEstimatedCost(sunday, 33.05)).toBe(92.54);
  });
});

describe("totalPaidHours", () => {
  it("sums a week without floating-point drift", () => {
    const week = Array.from({ length: 5 }, (_, i) => ({
      startsAt: syd(`2026-08-0${3 + i}T09:00:00+10:00`),
      endsAt: syd(`2026-08-0${3 + i}T16:30:00+10:00`),
      breaks: [{ durationMinutes: 20, isPaid: false }],
    }));
    // 7.5h - 20min = 7.1667h each; five of them.
    expect(totalPaidHours(week)).toBeCloseTo(35.85, 2);
  });

  it("returns zero for an empty roster", () => {
    expect(totalPaidHours([])).toBe(0);
  });
});
