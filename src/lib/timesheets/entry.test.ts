import { describe, expect, it } from "vitest";
import { deriveHours, localTimeOf, round2 } from "./entry";

/**
 * Vitest pins TZ=UTC, so these assertions actually exercise the timezone
 * conversion. On a Sydney machine they would pass even if the property
 * timezone were ignored entirely.
 */

const entry = (over: Partial<Parameters<typeof deriveHours>[0]> = {}) => ({
  workDate: "2026-07-28",
  startTime: "09:00",
  endTime: "17:00",
  breakMinutes: 30,
  ...over,
});

function ok(result: ReturnType<typeof deriveHours>) {
  if (!result.ok) throw new Error(`expected success, got: ${result.message}`);
  return result.value;
}

describe("deriveHours", () => {
  it("resolves an ordinary winter day at AEST (+10)", () => {
    const v = ok(deriveHours(entry()));
    expect(v.startIso).toBe("2026-07-27T23:00:00.000Z");
    expect(v.endIso).toBe("2026-07-28T07:00:00.000Z");
    expect(v.endsNextDay).toBe(false);
    expect(v.paidHours).toBe(7.5);
  });

  it("resolves a summer day at AEDT (+11)", () => {
    const v = ok(deriveHours(entry({ workDate: "2026-01-20" })));
    expect(v.startIso).toBe("2026-01-19T22:00:00.000Z");
    expect(v.paidHours).toBe(7.5);
  });

  it("reads a finish before the start as an overnight shift", () => {
    const v = ok(
      deriveHours(entry({ startTime: "22:00", endTime: "06:00", breakMinutes: 0 })),
    );
    expect(v.endsNextDay).toBe(true);
    expect(v.paidHours).toBe(8);
  });

  it("counts the hours actually worked across the spring-forward", () => {
    // Sydney springs forward at 2am on 2026-10-04, so 10pm–6am is 7 hours.
    const v = ok(
      deriveHours(
        entry({
          workDate: "2026-10-03",
          startTime: "22:00",
          endTime: "06:00",
          breakMinutes: 0,
        }),
      ),
    );
    expect(v.paidHours).toBe(7);
  });

  it("counts the hours actually worked across the fall-back", () => {
    // Sydney falls back at 3am on 2026-04-05, so 10pm–6am is 9 hours.
    const v = ok(
      deriveHours(
        entry({
          workDate: "2026-04-04",
          startTime: "22:00",
          endTime: "06:00",
          breakMinutes: 0,
        }),
      ),
    );
    expect(v.paidHours).toBe(9);
  });

  it("subtracts the unpaid break", () => {
    expect(ok(deriveHours(entry({ breakMinutes: 0 }))).paidHours).toBe(8);
    expect(ok(deriveHours(entry({ breakMinutes: 45 }))).paidHours).toBe(7.25);
  });

  it("rejects a break longer than the shift", () => {
    const result = deriveHours(
      entry({ startTime: "09:00", endTime: "10:00", breakMinutes: 90 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("breakMinutes");
  });

  it("rejects an identical start and finish rather than recording 24 hours", () => {
    const result = deriveHours(entry({ startTime: "09:00", endTime: "09:00" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("endTime");
  });

  it("rejects anything longer than 16 hours", () => {
    const result = deriveHours(
      entry({ startTime: "05:00", endTime: "23:00", breakMinutes: 0 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("endTime");
  });

  it("accepts a shift of exactly 16 hours", () => {
    const v = ok(
      deriveHours(
        entry({ startTime: "06:00", endTime: "22:00", breakMinutes: 0 }),
      ),
    );
    expect(v.paidHours).toBe(16);
  });
});

describe("localTimeOf", () => {
  it("reads an instant back as property wall-clock time", () => {
    expect(localTimeOf("2026-07-27T23:00:00.000Z")).toBe("09:00");
    // Same clock face in summer, an hour further from UTC.
    expect(localTimeOf("2026-01-19T22:00:00.000Z")).toBe("09:00");
  });

  it("round-trips with deriveHours", () => {
    const v = ok(deriveHours(entry({ startTime: "06:30", endTime: "14:15" })));
    expect(localTimeOf(v.startIso)).toBe("06:30");
    expect(localTimeOf(v.endIso)).toBe("14:15");
  });

  it("reports midnight as 00:00, not 24:00", () => {
    const v = ok(
      deriveHours(
        entry({ startTime: "16:00", endTime: "00:00", breakMinutes: 0 }),
      ),
    );
    expect(localTimeOf(v.endIso)).toBe("00:00");
    expect(v.endsNextDay).toBe(true);
    expect(v.paidHours).toBe(8);
  });
});

describe("round2", () => {
  it("keeps two decimal places without float drift", () => {
    expect(round2(7.505)).toBe(7.51);
    expect(round2(8)).toBe(8);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});
