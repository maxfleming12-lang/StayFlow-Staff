import { describe, expect, it } from "vitest";
import {
  allowedActions,
  deriveClockState,
  idempotencyKeyFor,
  isActionAllowed,
  summariseWorkedTime,
  type ClockEvent,
  type ClockEventType,
} from "./state";

let seq = 0;
const ev = (
  eventType: ClockEventType,
  time: string,
  shiftId?: string,
): ClockEvent => ({
  id: `e${(seq += 1)}`,
  eventType,
  serverTime: time,
  shiftId,
});

const T = (hhmm: string) => `2026-08-05T${hhmm}:00+10:00`;

describe("deriveClockState", () => {
  it("starts clocked out with no events", () => {
    expect(deriveClockState([])).toEqual({
      status: "clocked_out",
      since: null,
      shiftId: null,
    });
  });

  it("follows a normal day", () => {
    const state = deriveClockState([
      ev("clock_in", T("09:00"), "shift-1"),
      ev("break_start", T("12:00")),
      ev("break_end", T("12:30")),
    ]);
    expect(state.status).toBe("clocked_in");
    expect(state.since).toBe(T("12:30"));
    expect(state.shiftId).toBe("shift-1");
  });

  it("returns to clocked out after a clock out", () => {
    const state = deriveClockState([
      ev("clock_in", T("09:00"), "shift-1"),
      ev("clock_out", T("17:00")),
    ]);
    expect(state.status).toBe("clocked_out");
    expect(state.shiftId).toBeNull();
  });

  it("orders by server time, not array order", () => {
    // An offline queue can deliver events out of order.
    const state = deriveClockState([
      ev("clock_out", T("17:00")),
      ev("clock_in", T("09:00")),
    ]);
    expect(state.status).toBe("clocked_out");
  });

  it("leaves ONE open session after a double clock in", () => {
    const state = deriveClockState([
      ev("clock_in", T("09:00")),
      ev("clock_in", T("09:05")),
    ]);
    expect(state.status).toBe("clocked_in");
    expect(state.since).toBe(T("09:05"));
  });

  it("ignores a break started while clocked out", () => {
    const state = deriveClockState([ev("break_start", T("09:00"))]);
    expect(state.status).toBe("clocked_out");
  });

  it("treats a stray break_end as returning to work", () => {
    const state = deriveClockState([
      ev("clock_in", T("09:00")),
      ev("break_end", T("10:00")),
    ]);
    expect(state.status).toBe("clocked_in");
  });
});

describe("allowedActions", () => {
  it("offers only clocking in when clocked out", () => {
    expect(allowedActions("clocked_out")).toEqual(["clock_in"]);
  });

  it("offers a break or clocking out while working", () => {
    expect(allowedActions("clocked_in")).toEqual(["break_start", "clock_out"]);
  });

  it("allows clocking out straight from a break", () => {
    // People forget to end a break; refusing would strand them mid-shift.
    expect(allowedActions("on_break")).toContain("clock_out");
    expect(isActionAllowed("on_break", "clock_out")).toBe(true);
  });

  it("refuses to clock in twice", () => {
    expect(isActionAllowed("clocked_in", "clock_in")).toBe(false);
  });
});

describe("summariseWorkedTime", () => {
  const now = new Date(T("18:00"));

  it("is zero for an empty day", () => {
    const s = summariseWorkedTime([], now);
    expect(s).toMatchObject({
      workedMinutes: 0,
      breakMinutes: 0,
      inProgress: false,
      anomalies: [],
    });
  });

  it("subtracts an unpaid break from worked time", () => {
    const s = summariseWorkedTime(
      [
        ev("clock_in", T("09:00")),
        ev("break_start", T("12:00")),
        ev("break_end", T("12:30")),
        ev("clock_out", T("17:00")),
      ],
      now,
    );
    expect(s.workedMinutes).toBe(450); // 8 h less 30 min
    expect(s.breakMinutes).toBe(30);
    expect(s.inProgress).toBe(false);
    expect(s.anomalies).toEqual([]);
  });

  it("measures a session still running against now", () => {
    const s = summariseWorkedTime([ev("clock_in", T("09:00"))], new Date(T("13:00")));
    expect(s.workedMinutes).toBe(240);
    expect(s.inProgress).toBe(true);
  });

  it("counts a break still running against now", () => {
    const s = summariseWorkedTime(
      [ev("clock_in", T("09:00")), ev("break_start", T("12:00"))],
      new Date(T("12:20")),
    );
    expect(s.breakMinutes).toBe(20);
    // 09:00 to 12:20 is 200 minutes, less the 20 still on break.
    expect(s.workedMinutes).toBe(180);
  });

  it("reports a double clock in and still closes the first session", () => {
    const s = summariseWorkedTime(
      [
        ev("clock_in", T("09:00")),
        ev("clock_in", T("10:00")),
        ev("clock_out", T("12:00")),
      ],
      now,
    );
    expect(s.anomalies.join(" ")).toContain("Clocked in twice");
    // 09:00-10:00 plus 10:00-12:00, not silently losing the first hour.
    expect(s.workedMinutes).toBe(180);
  });

  it("reports a clock out with no clock in and stays at zero", () => {
    const s = summariseWorkedTime([ev("clock_out", T("17:00"))], now);
    expect(s.workedMinutes).toBe(0);
    expect(s.anomalies.join(" ")).toContain("without having clocked in");
  });

  it("reports a break that ended without starting", () => {
    const s = summariseWorkedTime(
      [
        ev("clock_in", T("09:00")),
        ev("break_end", T("10:00")),
        ev("clock_out", T("17:00")),
      ],
      now,
    );
    expect(s.anomalies.join(" ")).toContain("without one having started");
    expect(s.workedMinutes).toBe(480);
  });

  it("closes a break left open at clock out", () => {
    const s = summariseWorkedTime(
      [
        ev("clock_in", T("09:00")),
        ev("break_start", T("16:30")),
        ev("clock_out", T("17:00")),
      ],
      now,
    );
    expect(s.breakMinutes).toBe(30);
    expect(s.workedMinutes).toBe(450);
  });

  it("never returns negative worked time", () => {
    // A break longer than the session, from a mangled stream.
    const s = summariseWorkedTime(
      [
        ev("clock_in", T("09:00")),
        ev("break_start", T("09:05")),
        ev("break_end", T("18:00")),
        ev("clock_out", T("09:30")),
      ],
      now,
    );
    expect(s.workedMinutes).toBeGreaterThanOrEqual(0);
  });
});

describe("idempotencyKeyFor", () => {
  it("is stable for the same queued action", () => {
    const input = {
      userId: "u1",
      eventType: "clock_in" as const,
      clientTime: T("09:00"),
      deviceId: "device-a",
    };
    expect(idempotencyKeyFor(input)).toBe(idempotencyKeyFor(input));
  });

  it("differs by action, time and device", () => {
    const base = {
      userId: "u1",
      eventType: "clock_in" as const,
      clientTime: T("09:00"),
      deviceId: "device-a",
    };
    expect(idempotencyKeyFor({ ...base, eventType: "clock_out" })).not.toBe(
      idempotencyKeyFor(base),
    );
    expect(idempotencyKeyFor({ ...base, clientTime: T("09:01") })).not.toBe(
      idempotencyKeyFor(base),
    );
    expect(idempotencyKeyFor({ ...base, deviceId: "device-b" })).not.toBe(
      idempotencyKeyFor(base),
    );
  });

  it("copes with no device id", () => {
    expect(
      idempotencyKeyFor({
        userId: "u1",
        eventType: "clock_in",
        clientTime: T("09:00"),
      }),
    ).toContain("no-device");
  });
});
