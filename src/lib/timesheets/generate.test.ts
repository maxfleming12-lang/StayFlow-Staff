import { describe, expect, it } from "vitest";
import type { ClockEvent, ClockEventType } from "@/lib/clock/state";
import { generateTimesheet, rosteredHours } from "./generate";

let seq = 0;
const ev = (eventType: ClockEventType, time: string): ClockEvent => ({
  id: `e${(seq += 1)}`,
  eventType,
  serverTime: time,
});

const T = (hhmm: string) => `2026-08-05T${hhmm}:00+10:00`;
const NOW = new Date(T("18:00"));

const rostered = {
  startsAt: T("09:00"),
  endsAt: T("17:00"),
  unpaidBreakMinutes: 30,
};

describe("rosteredHours", () => {
  it("subtracts planned unpaid breaks", () => {
    expect(rosteredHours(rostered)).toBe(7.5);
  });

  it("never returns negative for a mis-entered break", () => {
    expect(
      rosteredHours({ ...rostered, unpaidBreakMinutes: 600 }),
    ).toBe(0);
  });
});

describe("generateTimesheet", () => {
  it("derives a normal day from the clock events", () => {
    const result = generateTimesheet(
      [
        ev("clock_in", T("09:02")),
        ev("break_start", T("12:00")),
        ev("break_end", T("12:30")),
        ev("clock_out", T("17:05")),
      ],
      rostered,
      NOW,
    );

    expect(result.actualStart).toBe(T("09:02"));
    expect(result.actualEnd).toBe(T("17:05"));
    expect(result.breakMinutes).toBe(30);
    expect(result.paidHours).toBe(7.55);
    expect(result.isNoShow).toBe(false);
    // Within half an hour of rostered, so nothing to flag.
    expect(result.anomalies).toEqual([]);
  });

  it("uses the LAST clock out when somebody is called back", () => {
    const result = generateTimesheet(
      [
        ev("clock_in", T("09:00")),
        ev("clock_out", T("15:00")),
        ev("clock_in", T("16:00")),
        ev("clock_out", T("18:00")),
      ],
      null,
      NOW,
    );
    expect(result.actualEnd).toBe(T("18:00"));
    expect(result.paidHours).toBe(8);
  });

  it("flags working materially more than rostered", () => {
    const result = generateTimesheet(
      [ev("clock_in", T("09:00")), ev("clock_out", T("19:00"))],
      rostered,
      NOW,
    );
    expect(result.varianceHours).toBe(2.5);
    expect(result.anomalies.join(" ")).toContain("more than rostered");
  });

  it("flags working materially less than rostered", () => {
    const result = generateTimesheet(
      [ev("clock_in", T("09:00")), ev("clock_out", T("13:00"))],
      rostered,
      NOW,
    );
    expect(result.varianceHours).toBe(-3.5);
    expect(result.anomalies.join(" ")).toContain("less than rostered");
  });

  it("does not flag a few minutes either way", () => {
    const result = generateTimesheet(
      [
        ev("clock_in", T("09:00")),
        ev("break_start", T("12:00")),
        ev("break_end", T("12:30")),
        ev("clock_out", T("17:10")),
      ],
      rostered,
      NOW,
    );
    expect(result.anomalies).toEqual([]);
  });

  it("marks a rostered day with no events as a no-show", () => {
    const result = generateTimesheet([], rostered, NOW);
    expect(result.isNoShow).toBe(true);
    expect(result.paidHours).toBe(0);
    expect(result.anomalies.join(" ")).toContain("never clocked in");
  });

  it("is not a no-show when there was no roster to miss", () => {
    const result = generateTimesheet([], null, NOW);
    expect(result.isNoShow).toBe(false);
    expect(result.anomalies).toEqual([]);
  });

  it("says so when somebody is still clocked in", () => {
    const result = generateTimesheet(
      [ev("clock_in", T("09:00"))],
      null,
      new Date(T("13:00")),
    );
    expect(result.actualEnd).toBeNull();
    expect(result.anomalies.join(" ")).toContain("Still clocked in");
    expect(result.paidHours).toBe(4);
  });

  it("carries through anomalies from a malformed event stream", () => {
    const result = generateTimesheet(
      [
        ev("clock_in", T("09:00")),
        ev("clock_in", T("10:00")),
        ev("clock_out", T("17:00")),
      ],
      null,
      NOW,
    );
    expect(result.anomalies.join(" ")).toContain("Clocked in twice");
  });

  it("has no variance to report without a roster", () => {
    const result = generateTimesheet(
      [ev("clock_in", T("09:00")), ev("clock_out", T("17:00"))],
      null,
      NOW,
    );
    expect(result.varianceHours).toBeNull();
  });
});
