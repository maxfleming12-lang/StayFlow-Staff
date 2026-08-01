import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSupabaseStub,
  hasFilter,
  type SupabaseStub,
} from "@/test/supabase-stub";

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: vi.fn(() => stub.client),
  createClient: vi.fn(async () => stub.client),
}));

let stub: SupabaseStub;
beforeEach(() => {
  stub = createSupabaseStub();
  vi.clearAllMocks();
});

const { GET } = await import("./route");

const STAFF = "22222222-2222-4222-8222-222222222222";
// Deliberately readable rather than random: it only has to satisfy the
// route's shape check (32-128 chars of base64url), and a high-entropy
// literal here trips secret scanners for no benefit.
const TOKEN = "example-calendar-token-for-tests-only-000000";

const call = (token: string) =>
  GET(new Request(`https://example.test/api/calendar/${token}`), {
    params: Promise.resolve({ token }),
  });

/**
 * Queue the three reads the route makes.
 *
 * Each is queued exactly once — `stub.on` appends to a queue rather than
 * replacing, so a test that wants a different profile must pass it here
 * instead of calling this and re-queuing on top.
 */
const setup = (
  over: {
    profile?: Record<string, unknown> | null;
    shifts?: { data?: unknown; error?: { message: string } };
  } = {},
) => {
  stub.on("calendar_tokens", "select", {
    data: { user_id: STAFF, organisation_id: "org-1", revoked_at: null },
  });
  stub.on("profiles", "select", {
    data:
      over.profile === undefined
        ? {
            preferred_name: "Aroha",
            legal_first_name: "Aroha",
            is_active: true,
            archived_at: null,
          }
        : over.profile,
  });
  stub.on(
    "shifts",
    "select",
    over.shifts ?? {
      data: [
        {
          id: "s1",
          starts_at: "2026-07-27T23:00:00.000Z",
          ends_at: "2026-07-28T07:00:00.000Z",
          notes: null,
          properties: { name: "Coastal Comfort", address: "1 Beach Rd" },
        },
      ],
    },
  );
};

describe("every failure looks identical from outside", () => {
  it("404s a malformed token without touching the database", async () => {
    const response = await call("short");

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    // Probing must not cost a query either.
    expect(stub.operations).toHaveLength(0);
  });

  it("404s a token with characters no base64url token can contain", async () => {
    const response = await call("../../etc/passwd~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
    expect(response.status).toBe(404);
    expect(stub.operations).toHaveLength(0);
  });

  it("404s an unknown token", async () => {
    stub.on("calendar_tokens", "select", { data: null });

    const response = await call(TOKEN);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("404s a REVOKED token, indistinguishably from an unknown one", async () => {
    stub.on("calendar_tokens", "select", {
      data: {
        user_id: STAFF,
        organisation_id: "org-1",
        revoked_at: "2026-07-01T00:00:00.000Z",
      },
    });

    const response = await call(TOKEN);

    // A different response would confirm that a revoked token once existed,
    // and let somebody probe for live ones.
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(stub.opsFor("shifts")).toHaveLength(0);
  });

  it("404s when the staff member has been deactivated", async () => {
    setup({
      profile: {
        preferred_name: "Aroha",
        legal_first_name: "Aroha",
        is_active: false,
        archived_at: null,
      },
    });

    const response = await call(TOKEN);

    // Disabling an account revokes access immediately — the feed is not an
    // exception to that.
    expect(response.status).toBe(404);
    expect(stub.opsFor("shifts")).toHaveLength(0);
  });

  it("404s an archived staff member", async () => {
    setup({
      profile: {
        preferred_name: "Aroha",
        legal_first_name: "Aroha",
        is_active: true,
        archived_at: "2026-07-01T00:00:00.000Z",
      },
    });

    expect((await call(TOKEN)).status).toBe(404);
  });

  it("404s rather than leaking that the server is misconfigured", async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase/server");
    vi.mocked(createServiceRoleClient).mockImplementationOnce(() => {
      throw new Error("SUPABASE_SECRET_KEY is missing");
    });

    const response = await call(TOKEN);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
});

describe("what the feed contains", () => {
  it("returns only that person's own published shifts", async () => {
    setup();

    await call(TOKEN);

    // There is no session here, so RLS cannot scope this. Every filter is
    // written by hand and this is the one place that matters.
    const shifts = stub.onlyOp("shifts", "select");
    expect(hasFilter(shifts, "eq", "user_id", STAFF)).toBe(true);
    expect(hasFilter(shifts, "eq", "status", "published")).toBe(true);
    expect(hasFilter(shifts, "is", "archived_at", null)).toBe(true);
  });

  it("serves a valid calendar", async () => {
    setup();

    const response = await call(TOKEN);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("END:VCALENDAR");
    expect(body).toContain("Coastal Comfort");
    // Stable per shift, so an edit updates in place instead of duplicating.
    expect(body).toContain("shift-s1@stayflow-staff");
  });

  it("never lets a bearer URL sit in a shared cache", async () => {
    setup();

    const response = await call(TOKEN);

    expect(response.headers.get("cache-control")).toMatch(/private/);
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
    expect(response.headers.get("content-type")).toMatch(/text\/calendar/);
    expect(response.headers.get("x-robots-tag")).toMatch(/noindex/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("stamps usage without breaking the feed", async () => {
    setup();

    const response = await call(TOKEN);

    expect(response.status).toBe(200);
    expect(stub.onlyOp("calendar_tokens", "update").payload).toMatchObject({
      last_used_at: expect.any(String),
    });
  });

  it("404s rather than serving a partial feed when shifts cannot be read", async () => {
    setup({ shifts: { error: { message: "statement timeout" } } });

    const response = await call(TOKEN);

    // An empty calendar would read as "you have no shifts", which is worse
    // than the client simply failing to refresh.
    expect(response.status).toBe(404);
  });
});
