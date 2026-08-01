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
  requireRole: vi.fn(async () => MANAGER),
  requireUser: vi.fn(async () => MANAGER),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => stub.client),
  createServiceRoleClient: vi.fn(() => stub.client),
}));
vi.mock("./session", () => ({
  getKioskSession: vi.fn(async () => kioskSession),
}));

const PROPERTY = "33333333-3333-4333-8333-333333333333";
const STAFF = "22222222-2222-4222-8222-222222222222";

let kioskSession: {
  id: string;
  propertyId: string;
  organisationId: string;
} | null;

let stub: SupabaseStub;
let rpc: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stub = createSupabaseStub();
  kioskSession = {
    id: "kiosk-1",
    propertyId: PROPERTY,
    organisationId: "org-1",
  };
  // The stub covers from()/select()/insert(); rpc() is separate.
  rpc = vi.fn(async () => ({ data: "ok", error: null }));
  (stub.client as { rpc: unknown }).rpc = rpc;
  vi.clearAllMocks();
  rpc.mockImplementation(async () => ({ data: "ok", error: null }));
});

const { kioskPunch } = await import("./actions");

const punch = (over: Record<string, string> = {}) =>
  formData({ pin: "481920", ...over });

/** The property-access check, then the clock history, then the profile. */
const allowAndSee = (events: unknown[] = []) => {
  stub.on("user_property_access", "select", { data: { user_id: STAFF } });
  stub.on("clock_events", "select", { data: events });
  stub.on("profiles", "select", { data: { preferred_name: "Aroha" } });
};

const insertPayload = () =>
  stub.onlyOp("clock_events", "insert").payload as Record<string, unknown>;

const rpcCalls = (name: string) =>
  rpc.mock.calls.filter((c) => c[0] === name);

describe("kioskPunch identity", () => {
  it("refuses when the device is not authorised", async () => {
    kioskSession = null;

    const result = await kioskPunch({}, punch());

    expect(result.error).toMatch(/no longer authorised/i);
    expect(stub.operations).toHaveLength(0);
  });

  it("verifies the PIN even when the PIN alone identified the person", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "resolve_kiosk_user") return { data: STAFF, error: null };
      return { data: "ok", error: null };
    });
    allowAndSee();

    await kioskPunch({}, punch());

    // The attempt counter and lockout live in verify_kiosk_pin. Skipping it
    // on this path made the lockout apply only to the path that already
    // knew who you were.
    expect(rpcCalls("resolve_kiosk_user")).toHaveLength(1);
    expect(rpcCalls("verify_kiosk_pin")).toHaveLength(1);
  });

  it("refuses a LOCKED account on the PIN-only path, and says why", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "resolve_kiosk_user") return { data: STAFF, error: null };
      return { data: "locked", error: null };
    });
    allowAndSee();

    const result = await kioskPunch({}, punch());

    // Previously this clocked on normally: the hash matched, and nothing
    // consulted locked_until.
    expect(result.error).toMatch(/locked for a short while/i);
    expect(stub.opsFor("clock_events", "insert")).toHaveLength(0);
  });

  it("refuses a locked account on the pick-your-name path too", async () => {
    rpc.mockImplementation(async () => ({ data: "locked", error: null }));
    allowAndSee();

    const result = await kioskPunch({}, punch({ userId: STAFF }));

    expect(result.error).toMatch(/locked/i);
    expect(stub.opsFor("clock_events", "insert")).toHaveLength(0);
  });

  it("refuses a wrong PIN", async () => {
    rpc.mockImplementation(async () => ({ data: "invalid", error: null }));
    allowAndSee();

    const result = await kioskPunch({}, punch({ userId: STAFF }));

    expect(result.error).toBe("That code is not right.");
    expect(stub.opsFor("clock_events", "insert")).toHaveLength(0);
  });

  it("refuses a code that matches nobody at this property", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "resolve_kiosk_user") return { data: null, error: null };
      return { data: "ok", error: null };
    });

    const result = await kioskPunch({}, punch());

    expect(result.error).toMatch(/not recognised at this property/i);
    expect(rpcCalls("verify_kiosk_pin")).toHaveLength(0);
  });

  it("refuses somebody who does not work at this property", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "resolve_kiosk_user") return { data: STAFF, error: null };
      return { data: "ok", error: null };
    });
    stub.on("user_property_access", "select", { data: null });

    const result = await kioskPunch({}, punch());

    // A valid PIN must not clock someone on at a motel they have no
    // business at.
    expect(result.error).toMatch(/not set up to clock on at this property/i);
    expect(stub.opsFor("clock_events", "insert")).toHaveLength(0);
  });

  it("checks access against the DEVICE's property, not one supplied by the form", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "resolve_kiosk_user") return { data: STAFF, error: null };
      return { data: "ok", error: null };
    });
    allowAndSee();

    await kioskPunch({}, punch({ propertyId: "44444444-4444-4444-8444-444444444444" }));

    const access = stub.onlyOp("user_property_access", "select");
    expect(hasFilter(access, "eq", "property_id", PROPERTY)).toBe(true);
  });

  it("rejects a PIN that is not six digits without calling the database", async () => {
    const result = await kioskPunch({}, punch({ pin: "12" }));

    expect(result.error).toMatch(/enter your pin/i);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("kioskPunch recording", () => {
  beforeEach(() => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "resolve_kiosk_user") return { data: STAFF, error: null };
      return { data: "ok", error: null };
    });
  });

  it("clocks in when clocked out, and greets them by name", async () => {
    allowAndSee([]);

    const result = await kioskPunch({}, punch());

    expect(insertPayload()).toMatchObject({
      user_id: STAFF,
      property_id: PROPERTY,
      event_type: "clock_in",
      source: "kiosk",
      device_id: "kiosk-1",
    });
    expect(result.success).toMatch(/^Aroha: Clocked in/);
  });

  it("clocks out when already clocked in", async () => {
    allowAndSee([
      { id: "e1", event_type: "clock_in", server_time: "2026-07-28T00:00:00.000Z", shift_id: null },
    ]);

    const result = await kioskPunch({}, punch());

    expect(insertPayload().event_type).toBe("clock_out");
    expect(result.success).toMatch(/Clocked out/);
  });

  it("never sends server_time, so the tablet clock cannot backdate", async () => {
    allowAndSee([]);

    await kioskPunch({}, punch());

    const payload = insertPayload();
    expect(payload).not.toHaveProperty("server_time");
    expect(payload).not.toHaveProperty("received_at");
  });

  it("keys the punch to the minute, so a double tap cannot record twice", async () => {
    allowAndSee([]);

    await kioskPunch({}, punch());

    // The old key embedded a fresh millisecond timestamp and so could never
    // collide — two taps became two clock-ins, because the state check is a
    // read followed by a write with nothing holding the gap.
    const key = String(insertPayload().idempotency_key);
    expect(key).toMatch(/^kiosk:.*:clock_in:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(key).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("does not key on the device, so two tablets still de-duplicate", async () => {
    allowAndSee([]);
    await kioskPunch({}, punch());
    expect(String(insertPayload().idempotency_key)).not.toContain("kiosk-1:");
  });

  it("treats a repeat as done, not as an error", async () => {
    allowAndSee([]);
    stub.on("clock_events", "insert", {
      error: { code: "23505", message: "duplicate key" },
    });

    const result = await kioskPunch({}, punch());

    expect(result.success).toMatch(/already recorded/i);
    expect(result.error).toBeUndefined();
  });

  it("still reports a genuine insert failure", async () => {
    allowAndSee([]);
    stub.on("clock_events", "insert", {
      error: { code: "42501", message: "permission denied" },
    });

    const result = await kioskPunch({}, punch());

    expect(result.error).toMatch(/permission denied/i);
  });

  it("refuses an impossible transition", async () => {
    allowAndSee([
      { id: "e1", event_type: "clock_in", server_time: "2026-07-28T00:00:00.000Z", shift_id: null },
    ]);

    const result = await kioskPunch({}, punch({ eventType: "clock_in" }));

    expect(result.error).toMatch(/not possible from your current state/i);
    expect(stub.opsFor("clock_events", "insert")).toHaveLength(0);
  });

  it("reads only this person's clock history", async () => {
    allowAndSee([]);

    await kioskPunch({}, punch());

    expect(
      hasFilter(stub.onlyOp("clock_events", "select"), "eq", "user_id", STAFF),
    ).toBe(true);
  });
});
