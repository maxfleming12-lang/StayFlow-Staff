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

const {
  savePushSubscription,
  removePushSubscription,
  saveNotificationPreferences,
} = await import("./actions");

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";

// Obviously-fake key material. The schema only checks these are non-empty
// strings, so realistic-looking values buy nothing and trip secret scanners.
const subscription = (over: Record<string, unknown> = {}) => ({
  endpoint: ENDPOINT,
  p256dh: "example-p256dh-public-key-not-real",
  auth: "example-auth-key-not-real",
  deviceLabel: "Reception iPad",
  ...over,
});

describe("savePushSubscription", () => {
  it("replaces an existing row for the same endpoint rather than stacking", async () => {
    await savePushSubscription(subscription());

    // A browser hands back the same endpoint after re-subscribing, and dead
    // duplicates would each get their own delivery attempt.
    const order = stub
      .opsFor("push_subscriptions")
      .map((o) => o.verb);
    expect(order).toEqual(["delete", "insert"]);
    expect(
      hasFilter(stub.onlyOp("push_subscriptions", "delete"), "eq", "endpoint", ENDPOINT),
    ).toBe(true);
  });

  it("stores the keys against the caller", async () => {
    await savePushSubscription(subscription());

    expect(stub.onlyOp("push_subscriptions", "insert").payload).toMatchObject({
      user_id: MANAGER.id,
      endpoint: ENDPOINT,
      device_label: "Reception iPad",
    });
  });

  it("turns the preference on, since a subscription is what enables delivery", async () => {
    await savePushSubscription(subscription());

    expect(stub.onlyOp("notification_preferences", "upsert").payload).toMatchObject(
      { user_id: MANAGER.id, push_enabled: true },
    );
  });

  it("refuses an endpoint that is not a URL", async () => {
    const result = await savePushSubscription(subscription({ endpoint: "abc" }));

    expect(result.error).toMatch(/could not be stored/i);
    expect(stub.operations).toHaveLength(0);
  });

  it("refuses a subscription missing its keys", async () => {
    const result = await savePushSubscription({ endpoint: ENDPOINT });
    expect(result.error).toBeTruthy();
    expect(stub.operations).toHaveLength(0);
  });

  it("reports a failure rather than claiming notifications are on", async () => {
    stub.on("push_subscriptions", "insert", { error: { message: "denied" } });

    const result = await savePushSubscription(subscription());

    expect(result.error).toMatch(/could not turn on/i);
    expect(result.success).toBeUndefined();
  });
});

describe("removePushSubscription", () => {
  it("removes that device's subscription", async () => {
    const result = await removePushSubscription(ENDPOINT);

    // Filtering by endpoint alone is safe HERE, unlike the clock and
    // acknowledgement cases: `push_subs_all_self` is the only policy on this
    // table and it is self-scoped, with no manager policy OR-ed in.
    expect(
      hasFilter(stub.onlyOp("push_subscriptions", "delete"), "eq", "endpoint", ENDPOINT),
    ).toBe(true);
    expect(result.success).toMatch(/off for this device/i);
  });

  it("reports a failure", async () => {
    stub.on("push_subscriptions", "delete", { error: { message: "denied" } });
    const result = await removePushSubscription(ENDPOINT);
    expect(result.error).toMatch(/could not turn notifications off/i);
  });
});

describe("saveNotificationPreferences", () => {
  const prefs = (over: Record<string, string | string[]> = {}) =>
    formData({ muted: [], ...over });

  it("saves muted categories and quiet hours", async () => {
    await saveNotificationPreferences(
      {},
      prefs({
        muted: ["roster_published"],
        quietHoursStart: "22:00",
        quietHoursEnd: "06:00",
      }),
    );

    expect(stub.onlyOp("notification_preferences", "upsert").payload).toMatchObject({
      user_id: MANAGER.id,
      quiet_hours_start: "22:00",
      quiet_hours_end: "06:00",
    });
  });

  it("insists on both ends of a quiet window, or neither", async () => {
    const startOnly = await saveNotificationPreferences(
      {},
      prefs({ quietHoursStart: "22:00" }),
    );
    expect(startOnly.error).toMatch(/both a start and an end/i);

    stub = createSupabaseStub();
    const endOnly = await saveNotificationPreferences(
      {},
      prefs({ quietHoursEnd: "06:00" }),
    );
    // Guessing the missing half would mute somebody at a time they never
    // chose.
    expect(endOnly.error).toMatch(/both a start and an end/i);
    expect(stub.operations).toHaveLength(0);
  });

  it("accepts neither, meaning no quiet hours", async () => {
    await saveNotificationPreferences({}, prefs());

    expect(stub.onlyOp("notification_preferences", "upsert").payload).toMatchObject({
      quiet_hours_start: null,
      quiet_hours_end: null,
    });
  });

  it("rejects a malformed time", async () => {
    const result = await saveNotificationPreferences(
      {},
      prefs({ quietHoursStart: "10pm", quietHoursEnd: "06:00" }),
    );

    expect(result.error).toMatch(/could not be saved/i);
    expect(stub.operations).toHaveLength(0);
  });
});
