import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseStub, hasFilter, type SupabaseStub } from "@/test/supabase-stub";

vi.mock("server-only", () => ({}));
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async () => ({})),
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => stub.client),
  createServiceRoleClient: vi.fn(() => {
    if (serviceRoleThrows) throw new Error("SUPABASE_SECRET_KEY is not set.");
    return stub.client;
  }),
}));

let stub: SupabaseStub;
let serviceRoleThrows = false;

// Set before the module is imported: `configureVapid` caches its answer in a
// module-level variable, so the keys have to be present at first call.
process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-public-key";
process.env.VAPID_PRIVATE_KEY = "test-private-key";

const { notify } = await import("./deliver");
const webpush = (await import("web-push")).default;

beforeEach(() => {
  stub = createSupabaseStub();
  serviceRoleThrows = false;
  vi.clearAllMocks();
  vi.mocked(webpush.sendNotification).mockResolvedValue({} as never);
});

const ORG = "org-1";
const ALICE = "user-alice";
const BOB = "user-bob";
const SUB = "sub-1";

const input = (over: Partial<Parameters<typeof notify>[0]> = {}) => ({
  organisationId: ORG,
  userIds: [ALICE],
  category: "roster_published" as const,
  title: "Roster published",
  body: "Open StayFlow to see your week.",
  deepLink: "/roster",
  ...over,
});

/** A live subscription for one person. */
const subscribed = (over: Record<string, unknown> = {}) =>
  stub.on("push_subscriptions", "select", {
    data: [
      {
        id: SUB,
        user_id: ALICE,
        endpoint: "https://push.example/abc",
        p256dh: "key",
        auth_key: "auth",
        failure_count: 0,
        ...over,
      },
    ],
    error: null,
  });

/** Preferences that permit a push. */
const prefsAllow = () =>
  stub.on("notification_preferences", "select", {
    data: [
      {
        user_id: ALICE,
        push_enabled: true,
        muted_categories: [],
        quiet_hours_start: null,
        quiet_hours_end: null,
      },
    ],
    error: null,
  });

describe("recording", () => {
  it("does nothing at all for an empty audience", async () => {
    const result = await notify(input({ userIds: [] }));

    expect(result).toEqual({ recorded: 0, pushed: 0, pruned: 0 });
    expect(stub.operations).toHaveLength(0);
  });

  it("counts a person once and ignores empty ids", async () => {
    prefsAllow();

    const result = await notify(input({ userIds: [ALICE, ALICE, "", BOB] }));

    const rows = stub.onlyOp("notifications", "insert").payload as unknown[];
    expect(rows).toHaveLength(2);
    expect(result.recorded).toBe(2);
  });

  it("writes a row per person with the caller's detail", async () => {
    prefsAllow();

    await notify(input({ propertyId: "prop-1" }));

    const rows = stub.onlyOp("notifications", "insert").payload as Record<
      string,
      unknown
    >[];
    expect(rows[0]).toMatchObject({
      organisation_id: ORG,
      property_id: "prop-1",
      user_id: ALICE,
      category: "roster_published",
      title: "Roster published",
      deep_link: "/roster",
    });
  });

  it("records even when the person will never be pushed", async () => {
    // Muting a category should quieten the phone, not hide information. The
    // row is the part that must not be skipped.
    stub.on("notification_preferences", "select", {
      data: [
        {
          user_id: ALICE,
          push_enabled: false,
          muted_categories: [],
          quiet_hours_start: null,
          quiet_hours_end: null,
        },
      ],
      error: null,
    });

    const result = await notify(input());

    expect(stub.opsFor("notifications", "insert")).toHaveLength(1);
    expect(result.recorded).toBe(1);
    expect(result.pushed).toBe(0);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it("reports a failed write instead of pretending it landed", async () => {
    stub.on("notifications", "insert", {
      data: null,
      error: { message: "violates foreign key" },
    });

    const result = await notify(input());

    expect(result.error).toBe("violates foreign key");
    expect(result.recorded).toBe(0);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it("never throws when the server is not configured", async () => {
    // A failed notification must not roll back the action that triggered it.
    // A published roster stays published even if nothing can be sent.
    serviceRoleThrows = true;

    const result = await notify(input());

    expect(result.error).toContain("not configured");
    expect(result.recorded).toBe(0);
  });
});

describe("who gets pushed", () => {
  it("pushes when preferences allow it", async () => {
    prefsAllow();
    subscribed();

    const result = await notify(input());

    expect(result.pushed).toBe(1);
    const [subscription, payload] = vi.mocked(webpush.sendNotification).mock.calls[0];
    expect(subscription).toEqual({
      endpoint: "https://push.example/abc",
      keys: { p256dh: "key", auth: "auth" },
    });
    expect(JSON.parse(String(payload))).toEqual({
      title: "Roster published",
      body: "Open StayFlow to see your week.",
      url: "/roster",
      category: "roster_published",
    });
  });

  it("treats somebody with no preferences row as willing", async () => {
    // Having a subscription IS the evidence they opted in — the row only
    // exists once they have been through settings, and most never do.
    stub.on("notification_preferences", "select", { data: [], error: null });
    subscribed();

    const result = await notify(input());

    expect(result.pushed).toBe(1);
  });

  it("does not push a muted category", async () => {
    stub.on("notification_preferences", "select", {
      data: [
        {
          user_id: ALICE,
          push_enabled: true,
          muted_categories: ["roster_published"],
          quiet_hours_start: null,
          quiet_hours_end: null,
        },
      ],
      error: null,
    });

    const result = await notify(input());

    expect(result.pushed).toBe(0);
    expect(stub.opsFor("push_subscriptions", "select")).toHaveLength(0);
  });

  it("delivers an urgent notice through a silenced phone", async () => {
    // The whole point of the flag: a cancelled shift or an urgent notice
    // reaches somebody who has turned push off entirely.
    stub.on("notification_preferences", "select", {
      data: [
        {
          user_id: ALICE,
          push_enabled: false,
          muted_categories: ["urgent_notice"],
          quiet_hours_start: "22:00",
          quiet_hours_end: "07:00",
        },
      ],
      error: null,
    });
    subscribed();

    const result = await notify(input({ category: "urgent_notice" }));

    expect(result.pushed).toBe(1);
  });

  it("looks up preferences and subscriptions only for the people involved", async () => {
    prefsAllow();
    subscribed();

    await notify(input());

    expect(
      hasFilter(stub.onlyOp("notification_preferences", "select"), "in", "user_id", [
        ALICE,
      ]),
    ).toBe(true);
    expect(
      hasFilter(stub.onlyOp("push_subscriptions", "select"), "in", "user_id", [ALICE]),
    ).toBe(true);
  });

  it("copes with nobody having a device", async () => {
    prefsAllow();
    stub.on("push_subscriptions", "select", { data: [], error: null });

    const result = await notify(input());

    expect(result).toEqual({ recorded: 1, pushed: 0, pruned: 0 });
  });
});

describe("dead and failing subscriptions", () => {
  const rejectWith = (statusCode?: number) =>
    vi
      .mocked(webpush.sendNotification)
      .mockRejectedValue(Object.assign(new Error("push failed"), { statusCode }));

  it("removes a subscription the browser has discarded", async () => {
    prefsAllow();
    subscribed();
    rejectWith(410);

    const result = await notify(input());

    expect(result.pruned).toBe(1);
    expect(result.pushed).toBe(0);
    expect(hasFilter(stub.onlyOp("push_subscriptions", "delete"), "in", "id", [SUB])).toBe(
      true,
    );
  });

  it("treats a 404 the same way", async () => {
    prefsAllow();
    subscribed();
    rejectWith(404);

    expect((await notify(input())).pruned).toBe(1);
  });

  it("counts a transient failure rather than retrying it forever", async () => {
    // Without a counter, a permanently broken subscription is retried on
    // every notification for ever and nothing notices.
    prefsAllow();
    subscribed({ failure_count: 3 });
    rejectWith(500);

    const result = await notify(input());

    expect(result.pruned).toBe(0);
    const update = stub.onlyOp("push_subscriptions", "update");
    expect((update.payload as Record<string, unknown>).failure_count).toBe(4);
    expect(hasFilter(update, "eq", "id", SUB)).toBe(true);
  });

  it("counts a failure that throws before any request is made", async () => {
    // Malformed keys throw during encryption, so there is no status code.
    prefsAllow();
    subscribed();
    rejectWith(undefined);

    const result = await notify(input());

    expect(result.pruned).toBe(0);
    expect(
      (stub.onlyOp("push_subscriptions", "update").payload as Record<string, unknown>)
        .failure_count,
    ).toBe(1);
  });

  it("gives up once a subscription has failed ten times", async () => {
    prefsAllow();
    subscribed({ failure_count: 9 });
    rejectWith(500);

    const result = await notify(input());

    expect(result.pruned).toBe(1);
    expect(hasFilter(stub.onlyOp("push_subscriptions", "delete"), "in", "id", [SUB])).toBe(
      true,
    );
    expect(stub.opsFor("push_subscriptions", "update")).toHaveLength(0);
  });

  it("forgives a subscription that starts working again", async () => {
    prefsAllow();
    subscribed({ failure_count: 5 });

    const result = await notify(input());

    expect(result.pushed).toBe(1);
    const update = stub.onlyOp("push_subscriptions", "update").payload as Record<
      string,
      unknown
    >;
    expect(update.failure_count).toBe(0);
    expect(update.last_used_at).toBeTruthy();
  });

  it("leaves a healthy subscription alone", async () => {
    prefsAllow();
    subscribed({ failure_count: 0 });

    await notify(input());

    expect(stub.opsFor("push_subscriptions", "update")).toHaveLength(0);
    expect(stub.opsFor("push_subscriptions", "delete")).toHaveLength(0);
  });
});

describe("without VAPID keys", () => {
  it("records the notification and skips the push", async () => {
    // In development there may simply be no keys. That is not worth failing
    // the caller over — the notification is still visible in the app.
    vi.resetModules();
    const saved = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

    try {
      const fresh = await import("./deliver");
      const result = await fresh.notify(input());

      expect(result).toEqual({ recorded: 1, pushed: 0, pruned: 0 });
      expect(result.error).toBeUndefined();
      expect(stub.opsFor("notifications", "insert")).toHaveLength(1);
      expect(stub.opsFor("notification_preferences")).toHaveLength(0);
    } finally {
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = saved;
    }
  });
});
