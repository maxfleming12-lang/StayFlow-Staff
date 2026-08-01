import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MANAGER,
  createSupabaseStub,
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

const { generateCalendarToken, revokeCalendarToken, getMyCalendarToken } =
  await import("./actions");

describe("generateCalendarToken", () => {
  it("revokes any existing link BEFORE issuing a new one", async () => {
    await generateCalendarToken();

    // "Regenerate" has to genuinely invalidate the old URL. Leaving it live
    // would mean a link someone shared by accident keeps working forever.
    const order = stub.operations
      .filter((o) => o.table === "calendar_tokens")
      .map((o) => o.verb);
    expect(order).toEqual(["update", "insert"]);
  });

  it("revokes only the caller's own live token", async () => {
    await generateCalendarToken();

    const revoke = stub.onlyOp("calendar_tokens", "update");
    expect(hasFilter(revoke, "eq", "user_id", MANAGER.id)).toBe(true);
    expect(hasFilter(revoke, "is", "revoked_at", null)).toBe(true);
  });

  it("issues a long, unguessable token", async () => {
    await generateCalendarToken();

    const token = String(
      (stub.onlyOp("calendar_tokens", "insert").payload as Record<string, unknown>)
        .token,
    );
    // 32 random bytes, base64url. A calendar client cannot authenticate, so
    // this token IS the credential for the feed.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("issues a different token every time", async () => {
    await generateCalendarToken();
    const first = (stub.onlyOp("calendar_tokens", "insert").payload as Record<
      string,
      unknown
    >).token;

    stub = createSupabaseStub();
    await generateCalendarToken();
    const second = (stub.onlyOp("calendar_tokens", "insert").payload as Record<
      string,
      unknown
    >).token;

    expect(first).not.toBe(second);
  });

  it("issues nothing if the old link could not be revoked", async () => {
    stub.on("calendar_tokens", "update", { error: { message: "denied" } });

    const result = await generateCalendarToken();

    // Two live feeds is the failure worth avoiding here.
    expect(result.error).toBeTruthy();
    expect(stub.opsFor("calendar_tokens", "insert")).toHaveLength(0);
  });
});

describe("revokeCalendarToken", () => {
  it("revokes the caller's own live token", async () => {
    const result = await revokeCalendarToken();

    const revoke = stub.onlyOp("calendar_tokens", "update");
    expect(revoke.payload).toMatchObject({ revoked_at: expect.any(String) });
    expect(hasFilter(revoke, "eq", "user_id", MANAGER.id)).toBe(true);
    expect(result.success).toMatch(/stop updating/i);
  });

  it("marks revoked rather than deleting, so the audit trail survives", async () => {
    await revokeCalendarToken();
    expect(stub.opsFor("calendar_tokens", "delete")).toHaveLength(0);
  });
});

describe("getMyCalendarToken", () => {
  it("returns only a live token belonging to the caller", async () => {
    stub.on("calendar_tokens", "select", { data: { token: "abc" } });

    const token = await getMyCalendarToken();

    expect(token).toBe("abc");
    const read = stub.onlyOp("calendar_tokens", "select");
    expect(hasFilter(read, "eq", "user_id", MANAGER.id)).toBe(true);
    expect(hasFilter(read, "is", "revoked_at", null)).toBe(true);
  });

  it("returns null when there is none", async () => {
    stub.on("calendar_tokens", "select", { data: null });
    expect(await getMyCalendarToken()).toBeNull();
  });

  it("returns null rather than throwing when the read fails", async () => {
    stub.on("calendar_tokens", "select", { error: { message: "boom" } });
    // The settings page renders either way; a broken read must not 500 it.
    expect(await getMyCalendarToken()).toBeNull();
  });
});
