import { describe, expect, it } from "vitest";
import { addIsoDays, localDateTimeToIso, startOfLocalDay } from "./format";

/**
 * These assertions are only meaningful because vitest pins TZ=UTC. On a
 * Sydney machine — which is what this project is developed on — a conversion
 * that ignored the property timezone entirely would still pass.
 */

describe("localDateTimeToIso", () => {
  it("resolves a winter wall-clock time as AEST (+10)", () => {
    expect(localDateTimeToIso("2026-07-28T09:00")).toBe(
      "2026-07-27T23:00:00.000Z",
    );
  });

  it("resolves a summer wall-clock time as AEDT (+11)", () => {
    expect(localDateTimeToIso("2026-01-20T09:00")).toBe(
      "2026-01-19T22:00:00.000Z",
    );
  });

  it("accepts seconds and the fractional form a Postgres time column returns", () => {
    expect(localDateTimeToIso("2026-07-28T09:00:30")).toBe(
      "2026-07-27T23:00:30.000Z",
    );
    expect(localDateTimeToIso("2026-07-28T09:00:30.500")).toBe(
      "2026-07-27T23:00:30.000Z",
    );
  });

  it("accepts a space in place of the T", () => {
    expect(localDateTimeToIso("2026-07-28 09:00")).toBe(
      "2026-07-27T23:00:00.000Z",
    );
  });

  it("rejects a value it cannot read rather than returning Invalid Date", () => {
    expect(() => localDateTimeToIso("28/07/2026 9am")).toThrow(RangeError);
    expect(() => localDateTimeToIso("")).toThrow(RangeError);
  });
});

describe("startOfLocalDay", () => {
  it("is local midnight in winter, not UTC midnight", () => {
    expect(startOfLocalDay("2026-08-03")).toBe("2026-08-02T14:00:00.000Z");
  });

  it("shifts by an hour under daylight saving", () => {
    // The bug this replaced hardcoded +10:00 all year, so every AEDT window
    // began at 1am local instead of midnight.
    expect(startOfLocalDay("2026-01-20")).toBe("2026-01-19T13:00:00.000Z");
  });

  it("covers exactly 24 hours on an ordinary day", () => {
    const hours =
      (Date.parse(startOfLocalDay(addIsoDays("2026-08-03", 1))) -
        Date.parse(startOfLocalDay("2026-08-03"))) /
      3_600_000;
    expect(hours).toBe(24);
  });

  it("covers 23 hours on the day daylight saving starts", () => {
    // Sydney springs forward on 2026-10-04.
    const hours =
      (Date.parse(startOfLocalDay("2026-10-05")) -
        Date.parse(startOfLocalDay("2026-10-04"))) /
      3_600_000;
    expect(hours).toBe(23);
  });

  it("covers 25 hours on the day daylight saving ends", () => {
    // Sydney falls back at 3am on 2026-04-05, so it is that day that runs long.
    const hours =
      (Date.parse(startOfLocalDay("2026-04-06")) -
        Date.parse(startOfLocalDay("2026-04-05"))) /
      3_600_000;
    expect(hours).toBe(25);
  });
});

describe("addIsoDays", () => {
  it("moves forward and back", () => {
    expect(addIsoDays("2026-08-03", 1)).toBe("2026-08-04");
    expect(addIsoDays("2026-08-03", -1)).toBe("2026-08-02");
  });

  it("crosses month, year and leap-day boundaries", () => {
    expect(addIsoDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addIsoDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addIsoDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("is unaffected by daylight saving", () => {
    // A day-arithmetic helper that went through local time would stall or
    // skip here; these are calendar dates, not instants.
    expect(addIsoDays("2026-10-03", 1)).toBe("2026-10-04");
    expect(addIsoDays("2026-04-04", 1)).toBe("2026-04-05");
  });
});
