import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MANAGER,
  createSupabaseStub,
  formData,
  hasFilter,
  type SupabaseStub,
} from "@/test/supabase-stub";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => MANAGER),
  requireRole: vi.fn(async () => MANAGER),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => stub.client),
  createServiceRoleClient: vi.fn(() => stub.client),
}));

let stub: SupabaseStub;
beforeEach(() => {
  stub = createSupabaseStub();
  vi.clearAllMocks();
});

const { recordPunch, getClockState } = await import("./actions");

const PROPERTY = "33333333-3333-4333-8333-333333333333";
const SHIFT = "11111111-1111-4111-8111-111111111111";

const punch = (over: Record<string, string> = {}) =>
  formData({
    eventType: "clock_in",
    propertyId: PROPERTY,
    clientTime: "2026-07-28T09:00:00.000Z",
    deviceId: "device-1",
    ...over,
  });

/** Events the history read returns, oldest first. */
const history = (
  rows: { event_type: string; server_time: string; shift_id?: string | null }[],
) =>
  stub.on("clock_events", "select", {
    data: rows.map((r, i) => ({
      id: `e${i}`,
      event_type: r.event_type,
      server_time: r.server_time,
      shift_id: r.shift_id ?? null,
    })),
  });

const insertPayload = () =>
  stub.onlyOp("clock_events", "insert").payload as Record<string, unknown>;

describe("reading clock history", () => {
  it("asks only for this person's events", async () => {
    history([]);

    await recordPunch({}, punch());

    // RLS is NOT enough: clock_events_select_management lets a manager read
    // every event at their properties, and permissive policies are OR-ed.
    // Unfiltered, a manager's own state was derived from the whole floor's
    // punches.
    const read = stub.opsFor("clock_events", "select")[0];
    expect(hasFilter(read, "eq", "user_id", MANAGER.id)).toBe(true);
  });

  it("filters by user for the clock screen too", async () => {
    history([]);

    await getClockState();

    expect(
      hasFilter(stub.opsFor("clock_events", "select")[0], "eq", "user_id", MANAGER.id),
    ).toBe(true);
  });

  it("looks back beyond midnight, so an overnight session is still open", async () => {
    history([]);

    await getClockState();

    const read = stub.opsFor("clock_events", "select")[0];
    const gte = read.filters.find(
      (f) => f.method === "gte" && f.args[0] === "server_time",
    );
    const lookbackHours =
      (Date.now() - Date.parse(String(gte?.args[1]))) / 3_600_000;
    // A night-audit shift starting at 10pm must still be found next morning.
    expect(lookbackHours).toBeGreaterThan(12);
  });
});

describe("recordPunch", () => {
  it("records a clock-in and confirms it", async () => {
    history([]);

    const result = await recordPunch({}, punch());

    expect(result.success).toMatch(/Clocked in/i);
    expect(insertPayload()).toMatchObject({
      user_id: MANAGER.id,
      property_id: PROPERTY,
      event_type: "clock_in",
      client_time: "2026-07-28T09:00:00.000Z",
      source: "app",
      device_id: "device-1",
      was_offline: false,
    });
  });

  it("never sends server_time, so a wrong device clock cannot backdate", async () => {
    history([]);

    await recordPunch({}, punch({ clientTime: "2019-01-01T00:00:00.000Z" }));

    // server_time and received_at are stamped by a database trigger. The
    // device's own time is recorded as client_time and nothing more.
    const payload = insertPayload();
    expect(payload).not.toHaveProperty("server_time");
    expect(payload).not.toHaveProperty("received_at");
    expect(payload.client_time).toBe("2019-01-01T00:00:00.000Z");
  });

  it("carries an idempotency key, so a replayed offline punch is not a second event", async () => {
    history([]);
    await recordPunch({}, punch());
    expect(insertPayload().idempotency_key).toEqual(expect.any(String));
  });

  it("treats a duplicate key as SUCCESS, not failure", async () => {
    history([]);
    stub.on("clock_events", "insert", { error: { code: "23505", message: "dup" } });

    const result = await recordPunch({}, punch({ wasOffline: "true" }));

    // A queued action replayed after reconnecting has already been recorded.
    // Reporting failure would make staff punch again and think it broke.
    expect(result.duplicate).toBe(true);
    expect(result.success).toMatch(/already recorded/i);
    expect(result.error).toBeUndefined();
  });

  it("reports a genuine insert failure", async () => {
    history([]);
    stub.on("clock_events", "insert", {
      error: { code: "42501", message: "permission denied" },
    });

    const result = await recordPunch({}, punch());

    expect(result.error).toMatch(/permission denied/i);
    expect(result.success).toBeUndefined();
  });

  it("records that a punch was made offline", async () => {
    history([]);
    await recordPunch({}, punch({ wasOffline: "true" }));
    expect(insertPayload().was_offline).toBe(true);
  });

  it("attaches the shift the person is already clocked into", async () => {
    history([
      { event_type: "clock_in", server_time: "2026-07-28T00:00:00.000Z", shift_id: SHIFT },
    ]);

    await recordPunch({}, punch({ eventType: "clock_out" }));

    expect(insertPayload().shift_id).toBe(SHIFT);
  });

  it("prefers an explicitly chosen shift", async () => {
    history([]);
    await recordPunch({}, punch({ shiftId: SHIFT }));
    expect(insertPayload().shift_id).toBe(SHIFT);
  });

  describe("refuses impossible transitions", () => {
    const clockedIn = [
      { event_type: "clock_in", server_time: "2026-07-28T00:00:00.000Z" },
    ];
    const onBreak = [
      ...clockedIn,
      { event_type: "break_start", server_time: "2026-07-28T02:00:00.000Z" },
    ];

    it("a second clock-in from a stale screen", async () => {
      history(clockedIn);

      const result = await recordPunch({}, punch({ eventType: "clock_in" }));

      expect(result.error).toBe("You are already clocked in.");
      expect(stub.opsFor("clock_events", "insert")).toHaveLength(0);
    });

    it("clocking out when never clocked in", async () => {
      history([]);
      const result = await recordPunch({}, punch({ eventType: "clock_out" }));
      expect(result.error).toBe("You are not clocked in.");
      expect(stub.opsFor("clock_events", "insert")).toHaveLength(0);
    });

    it("starting a break before clocking in", async () => {
      history([]);
      const result = await recordPunch({}, punch({ eventType: "break_start" }));
      expect(result.error).toMatch(/clock in before starting a break/i);
    });

    it("starting a second break", async () => {
      history(onBreak);
      const result = await recordPunch({}, punch({ eventType: "break_start" }));
      expect(result.error).toMatch(/already on a break/i);
    });

    it("ending a break that never started", async () => {
      history(clockedIn);
      const result = await recordPunch({}, punch({ eventType: "break_end" }));
      expect(result.error).toMatch(/not on a break/i);
    });

    it("clocking in while on a break, with advice", async () => {
      history(onBreak);
      const result = await recordPunch({}, punch({ eventType: "clock_in" }));
      expect(result.error).toMatch(/end the break to carry on/i);
    });
  });

  it("rejects an unknown event type", async () => {
    const result = await recordPunch({}, punch({ eventType: "nap" }));
    expect(result.error).toBeTruthy();
    expect(stub.operations).toHaveLength(0);
  });

  it("rejects a property that is not a uuid", async () => {
    const result = await recordPunch({}, punch({ propertyId: "coastal" }));
    expect(result.error).toMatch(/choose a property/i);
    expect(stub.operations).toHaveLength(0);
  });
});
