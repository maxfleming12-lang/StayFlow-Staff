import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MANAGER,
  createSupabaseStub,
  formData,
  hasFilter,
  type SupabaseStub,
} from "@/test/supabase-stub";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/notifications/deliver", () => ({
  notify: vi.fn(async () => ({ recorded: 0, pushed: 0, pruned: 0 })),
}));
vi.mock("@/lib/auth/session", () => ({
  requireRole: vi.fn(async () => MANAGER),
  requireUser: vi.fn(async () => MANAGER),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => stub.client),
  createServiceRoleClient: vi.fn(() => stub.client),
}));
// Conflict detection has its own tests and its own queries; stubbing the
// boundary keeps these tests about what saveShift itself writes.
vi.mock("./manager-queries", () => ({
  getConflictContext: vi.fn(async () => ({
    existingShifts: [],
    approvedLeave: [],
    availability: [],
    minimumRestHours: 10,
    timeZone: "Australia/Sydney",
  })),
}));

let stub: SupabaseStub;
beforeEach(() => {
  stub = createSupabaseStub();
  vi.clearAllMocks();
});

const { removeShift, saveShift } = await import("./manager-actions");
const { notify } = await import("@/lib/notifications/deliver");

const SHIFT = "11111111-1111-4111-8111-111111111111";
const STAFF = "22222222-2222-4222-8222-222222222222";
const PROPERTY = "33333333-3333-4333-8333-333333333333";

describe("removeShift", () => {
  it("archives an unfilled shift rather than deleting the row", async () => {
    stub.on("shifts", "select", {
      data: { id: SHIFT, user_id: null, status: "published", archived_at: null },
    });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    const result = await removeShift({}, formData({ shiftId: SHIFT }));

    expect(result.success).toBe("Shift removed.");
    const update = stub.onlyOp("shifts", "update");
    expect(update.payload).toMatchObject({ archived_at: expect.any(String) });
    // Soft delete only — a hard delete would orphan attendance and audit rows.
    expect(stub.opsFor("shifts", "delete")).toHaveLength(0);
  });

  it("archives an assigned DRAFT shift, which staff cannot see yet", async () => {
    stub.on("shifts", "select", {
      data: { id: SHIFT, user_id: STAFF, status: "draft", archived_at: null },
    });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    expect((await removeShift({}, formData({ shiftId: SHIFT }))).success).toBe(
      "Shift removed.",
    );
  });

  it("refuses a published shift that somebody is rostered on", async () => {
    stub.on("shifts", "select", {
      data: { id: SHIFT, user_id: STAFF, status: "published", archived_at: null },
    });

    const result = await removeShift({}, formData({ shiftId: SHIFT }));

    expect(result.error).toMatch(/published and assigned/i);
    expect(result.success).toBeUndefined();
    // Nothing was written.
    expect(stub.opsFor("shifts", "update")).toHaveLength(0);
  });

  it("refuses an unfilled shift somebody has claimed", async () => {
    stub.on("shifts", "select", {
      data: { id: SHIFT, user_id: null, status: "published", archived_at: null },
    });
    stub.on("open_shift_offers", "select", { data: { id: "offer-1" } });

    const result = await removeShift({}, formData({ shiftId: SHIFT }));

    expect(result.error).toMatch(/claimed/i);
    expect(stub.opsFor("shifts", "update")).toHaveLength(0);
  });

  it("only looks for CLAIMED offers, not merely offered ones", async () => {
    stub.on("shifts", "select", {
      data: { id: SHIFT, user_id: null, status: "draft", archived_at: null },
    });
    stub.on("open_shift_offers", "select", { data: null });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    await removeShift({}, formData({ shiftId: SHIFT }));

    const offers = stub.onlyOp("open_shift_offers", "select");
    expect(hasFilter(offers, "eq", "status", "claimed")).toBe(true);
  });

  it("constrains the write so the database settles a mid-air change", async () => {
    stub.on("shifts", "select", {
      data: { id: SHIFT, user_id: null, status: "draft", archived_at: null },
    });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    await removeShift({}, formData({ shiftId: SHIFT }));

    // The read cannot be trusted on its own: the shift may be assigned or
    // published between it and the write. Both conditions must be in the
    // WHERE clause, or a live shift could be archived from under someone.
    const update = stub.onlyOp("shifts", "update");
    expect(hasFilter(update, "eq", "id", SHIFT)).toBe(true);
    expect(hasFilter(update, "is", "archived_at", null)).toBe(true);
    expect(hasFilter(update, "or", "user_id.is.null,status.eq.draft")).toBe(true);
  });

  it("reports a lost race rather than claiming success", async () => {
    stub.on("shifts", "select", {
      data: { id: SHIFT, user_id: null, status: "draft", archived_at: null },
    });
    // Zero rows matched: it was assigned and published in the meantime.
    stub.on("shifts", "update", { data: null });

    const result = await removeShift({}, formData({ shiftId: SHIFT }));

    expect(result.success).toBeUndefined();
    expect(result.error).toMatch(/changed while you were looking at it/i);
  });

  it("refuses one that is already archived", async () => {
    stub.on("shifts", "select", {
      data: {
        id: SHIFT,
        user_id: null,
        status: "draft",
        archived_at: "2026-07-01T00:00:00.000Z",
      },
    });

    const result = await removeShift({}, formData({ shiftId: SHIFT }));

    expect(result.error).toMatch(/already been removed/i);
    expect(stub.opsFor("shifts", "update")).toHaveLength(0);
  });

  it("rejects an id that is not a uuid without touching the database", async () => {
    const result = await removeShift({}, formData({ shiftId: "not-a-uuid" }));

    expect(result.error).toMatch(/could not be identified/i);
    expect(stub.operations).toHaveLength(0);
  });
});

describe("saveShift when editing", () => {
  const editForm = (over: Record<string, string> = {}) =>
    formData({
      shiftId: SHIFT,
      propertyId: PROPERTY,
      userId: STAFF,
      startsAt: "2026-07-28T09:00",
      endsAt: "2026-07-28T17:00",
      breakMinutes: "30",
      ...over,
    });

  it("stores the times as property-local wall clock", async () => {
    stub.on("shifts", "select", { data: { status: "draft" } });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    await saveShift({}, editForm());

    const update = stub.onlyOp("shifts", "update");
    // 9am Sydney in July is 23:00 UTC the day before, not 09:00 UTC.
    expect(update.payload).toMatchObject({
      starts_at: "2026-07-27T23:00:00.000Z",
      ends_at: "2026-07-28T07:00:00.000Z",
    });
  });

  it("clears an existing break when the manager sets it to zero", async () => {
    stub.on("shifts", "select", { data: { status: "draft" } });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    await saveShift({}, editForm({ breakMinutes: "0" }));

    // The delete must run unconditionally. Guarding it on a non-zero break
    // left the old break in place, so payroll kept deducting it.
    expect(stub.opsFor("shift_breaks", "delete")).toHaveLength(1);
    expect(stub.opsFor("shift_breaks", "insert")).toHaveLength(0);
  });

  it("replaces the break wholesale when one is given", async () => {
    stub.on("shifts", "select", { data: { status: "draft" } });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    await saveShift({}, editForm({ breakMinutes: "45" }));

    expect(stub.opsFor("shift_breaks", "delete")).toHaveLength(1);
    expect(stub.onlyOp("shift_breaks", "insert").payload).toMatchObject({
      shift_id: SHIFT,
      duration_minutes: 45,
    });
  });

  it("tells the staff member when a PUBLISHED shift changes", async () => {
    stub.on("shifts", "select", { data: { status: "published" } });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    await saveShift({}, editForm());

    expect(notify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify).mock.calls[0][0]).toMatchObject({
      userIds: [STAFF],
      deepLink: "/roster",
    });
    // And their acknowledgement is reset, so they confirm the new times.
    expect(stub.onlyOp("shift_acknowledgements", "update").payload).toMatchObject(
      { status: "pending" },
    );
  });

  it("stays quiet when a DRAFT changes, since nobody has seen it", async () => {
    stub.on("shifts", "select", { data: { status: "draft" } });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    await saveShift({}, editForm());

    expect(notify).not.toHaveBeenCalled();
    expect(stub.opsFor("shift_acknowledgements")).toHaveLength(0);
  });

  it("does not notify when an unassigned shift changes", async () => {
    stub.on("shifts", "select", { data: { status: "published" } });
    stub.on("shifts", "update", { data: { id: SHIFT } });

    await saveShift({}, editForm({ userId: "" }));

    expect(notify).not.toHaveBeenCalled();
  });

  it("refuses to edit a shift that has been removed", async () => {
    stub.on("shifts", "select", { data: null });

    const result = await saveShift({}, editForm());

    expect(result.error).toMatch(/no longer exists/i);
    expect(stub.opsFor("shifts", "update")).toHaveLength(0);
  });

  it("rejects a finish at or before the start", async () => {
    const result = await saveShift(
      {},
      editForm({ startsAt: "2026-07-28T17:00", endsAt: "2026-07-28T09:00" }),
    );

    expect(result.fieldErrors?.endsAt).toMatch(/after the start/i);
    expect(stub.operations).toHaveLength(0);
  });
});
